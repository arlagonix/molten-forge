import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createId,
  getProviderFallbackModel,
  isAutoTitledChat,
  labelForError,
  mergeReasoningMetadata,
  resolveChatThinkingSettings,
  titleFromMessage,
} from "@/lib/ai-chat/chat-utils";
import { generateTitleFromFirstExchange } from "@/lib/ai-chat/title-generation";
import { resolveModeForChat } from "@/lib/ai-chat/modes";
import {
  isBuiltInAgentName,
} from "@/lib/ai-chat/builtin-agents";
import {
  ASK_USER_TOOL_NAME,
  isTaskToolName,
  CALL_AGENT_TOOL_NAME,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  createAgentToolResult,
  createCallAgentTool,
  createTaskToolResult,
  parseCallAgentRequestFromToolCall,
  parseAskUserRequestFromToolCall,
  parseTaskToolRequestFromToolCall,
  parseFileToolApprovalRequestFromToolCall,
  parseSkillMentionNames,
  requiresFileToolApproval,
  requiresToolApproval,
  createToolApprovalRequest,
} from "@/lib/ai-chat/builtin-tools";
import { streamProviderChat } from "@/lib/ai-chat/direct-provider-client";
import type { StreamProviderChatResult } from "@/lib/ai-chat/direct-provider-client";
import {
  appendBufferedAssistantVariant as appendBufferedAssistantVariantToBuffer,
  clearStreamFlushTimeouts,
  flushBufferedAssistantVariant as flushBufferedAssistantVariantBuffer,
  getStreamBufferKey,
  type StreamBuffer,
  type StreamBufferEvent,
} from "@/lib/ai-chat/stream-buffer";
import {
  appendStreamEventsToAssistantVariant,
  cancelUnfinishedTaskListSteps,
  createContinuationAssistantMessage,
  createStreamingAssistantMessage,
  createStreamingAssistantVariant,
  getVisualFlushKeysForGeneration,
  keepOnlyLatestTaskListStep,
  markAssistantVariantDone,
  markAssistantVariantErrored,
  type ActiveGeneration,
  type ActiveProcessStepRef,
} from "@/lib/ai-chat/generation-metadata";
import {
  buildSystemPromptWithActiveSkills,
  getEnabledAgentsForChat,
  getEnabledSkillsForChat,
  getEffectiveWorkspaceRoots,
  getEnabledToolsForChat,
  getGlobalEnabledAgents,
  getGlobalEnabledSkills,
  getGlobalEnabledTools,
  getToolsWithLoadSkillTool,
  resolveProviderForChat,
  validateProviderForGeneration,
  validateAgentMentionsForRequest,
  validateSkillMentionsForRequest,
  validateToolMentionsForRequest,
} from "@/lib/ai-chat/request-builder";
import type {
  AgentsSettings,
  AskUserResponse,
  ToolApprovalResponse,
  ChatAgentCall,
  ChatFileToolAutoApproval,
  ChatAssistantProcessStep,
  ChatAssistantVariant,
  ChatAttachment,
  ChatReasoningMetadata,
  ChatTitleGenerationMode,
  ChatMessage,
  ChatSession,
  ChatWorkspaceRoot,
  ChatToolCall,
  ChatToolResult,
  LoadedAgentInfo,
  LoadedModeInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  ProviderConfig,
  ModesState,
  SkillsSettings,
  ToolCommandResult,
  ToolExecutionStatus,
  ToolsSettings,
  UserInputStatus,
} from "@/lib/ai-chat/types";
import { useToolExecution } from "@/hooks/use-tool-execution";

const MAX_TOOL_ROUNDS = 20;

function isNewlyLoadedSkillResult(
  toolResult: ChatToolResult,
): toolResult is ChatToolResult & { loadedSkillName: string } {
  if (toolResult.toolName !== LOAD_SKILL_TOOL_NAME) return false;
  if (toolResult.isError || !toolResult.loadedSkillName) return false;

  try {
    const parsed = JSON.parse(toolResult.content) as { status?: unknown };
    return parsed.status === "loaded";
  } catch {
    return true;
  }
}

function collectNewlyLoadedSkillNames(messages: ChatMessage[]) {
  const skillNames = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    for (const variant of message.variants) {
      for (const toolResult of variant.toolResults ?? []) {
        if (isNewlyLoadedSkillResult(toolResult)) {
          skillNames.add(toolResult.loadedSkillName);
        }
      }
    }
  }

  return skillNames;
}

function collectMentionedSkillNames(messages: ChatMessage[]) {
  const skillNames = new Set<string>();

  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const skillName of parseSkillMentionNames(message.content)) {
      skillNames.add(skillName);
    }
  }

  return skillNames;
}

function pruneActiveSkillNamesForRegeneration({
  activeSkillNames,
  retainedMessages,
  discardedMessages,
  oneShotSkillNames,
}: {
  activeSkillNames: string[];
  retainedMessages: ChatMessage[];
  discardedMessages: ChatMessage[];
  oneShotSkillNames: string[];
}) {
  const discardedLoadedSkillNames =
    collectNewlyLoadedSkillNames(discardedMessages);

  if (discardedLoadedSkillNames.size === 0) {
    return [...new Set([...activeSkillNames, ...oneShotSkillNames])];
  }

  const retainedLoadedSkillNames =
    collectNewlyLoadedSkillNames(retainedMessages);
  const retainedMentionedSkillNames =
    collectMentionedSkillNames(retainedMessages);
  const oneShotSkillNameSet = new Set(oneShotSkillNames);

  return [
    ...new Set([
      ...activeSkillNames.filter(
        (skillName) =>
          !discardedLoadedSkillNames.has(skillName) ||
          retainedLoadedSkillNames.has(skillName) ||
          retainedMentionedSkillNames.has(skillName) ||
          oneShotSkillNameSet.has(skillName),
      ),
      ...oneShotSkillNames,
    ]),
  ];
}


const CHAT_WORKSPACE_ROOT_ID = "chat";

function mergeChatWorkspaceRoot(
  workspaceRoots: ChatWorkspaceRoot[] | undefined,
  root: ChatWorkspaceRoot,
) {
  const existingRoots = workspaceRoots ?? [];
  const withoutChatRoot = existingRoots.filter(
    (candidate) => candidate.id !== CHAT_WORKSPACE_ROOT_ID,
  );
  return [{ ...root, automatic: true, kind: "chat" as const }, ...withoutChatRoot];
}

export function useChatGeneration({
  activeChat,
  activeChatId,
  activeProvider,
  providers,
  chats,
  systemPrompt,
  toolsSettings,
  skillsSettings,
  agentsSettings,
  modesState,
  chatTitleGenerationMode,
  loadedTools,
  availableToolsByName,
  loadedSkills,
  availableSkillsByName,
  loadedAgents,
  availableAgentsByName,
  autoScrollEnabledRef,
  setEditingMessageId,
  setSettingsOpen,
  setVisualFlushRequests,
  generatingChatIds,
  setGeneratingChatIds,
  updateActiveChatMessages,
  updateChat,
  updateChatMessages,
  armStickyScrollToBottom,
  scheduleStickyScrollToBottom,
  isStickyScrollSuppressed,
  syncChatScrollState,
  executeExternalTool,
  onChatGenerationFinished,
  showError,
}: {
  activeChat?: ChatSession;
  activeChatId?: string;
  activeProvider: ProviderConfig;
  providers: ProviderConfig[];
  chats: ChatSession[];
  systemPrompt: string;
  toolsSettings: ToolsSettings;
  skillsSettings: SkillsSettings;
  agentsSettings: AgentsSettings;
  modesState: ModesState;
  chatTitleGenerationMode: ChatTitleGenerationMode;
  loadedTools: LoadedToolInfo[];
  availableToolsByName: Map<string, LoadedToolInfo>;
  loadedSkills: LoadedSkillInfo[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
  loadedAgents: LoadedAgentInfo[];
  availableAgentsByName: Map<string, LoadedAgentInfo>;
  autoScrollEnabledRef: MutableRefObject<boolean>;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setVisualFlushRequests: Dispatch<SetStateAction<Record<string, number>>>;
  generatingChatIds: string[];
  setGeneratingChatIds: Dispatch<SetStateAction<string[]>>;
  updateActiveChatMessages: (
    updater: (messages: ChatMessage[]) => ChatMessage[],
    options?: { touch?: boolean },
  ) => void;
  updateChat: (
    chatId: string,
    updater: (chat: ChatSession) => ChatSession,
  ) => void;
  updateChatMessages: (
    chatId: string,
    updater: (messages: ChatMessage[]) => ChatMessage[],
    options?: { touch?: boolean },
  ) => void;
  armStickyScrollToBottom: () => void;
  scheduleStickyScrollToBottom: (options?: {
    force?: boolean;
    settleFrames?: number;
  }) => void;
  isStickyScrollSuppressed: () => boolean;
  syncChatScrollState: () => void;
  executeExternalTool: (
    toolName: string,
    args: unknown,
    context?: { workspaceRoots?: ChatWorkspaceRoot[]; signal?: AbortSignal },
  ) => Promise<ToolCommandResult>;
  onChatGenerationFinished?: (
    chatId: string,
    options: { wasCancelled: boolean },
  ) => void;
  showError: (message: string, description?: string) => void;
}) {
  const [, setStreamingAssistantByChatId] = useState<Record<string, string>>(
    {},
  );
  const generationRefs = useRef<Record<string, ActiveGeneration>>({});
  const streamBuffersRef = useRef<Record<string, StreamBuffer>>({});
  const streamActiveProcessStepRefs = useRef<
    Record<string, ActiveProcessStepRef>
  >({});
  const streamFlushTimeoutRefs = useRef<Record<string, number>>({});
  const chatsRef = useRef<ChatSession[]>(chats);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const globalEnabledTools = useMemo(
    () => getGlobalEnabledTools({ toolsSettings, loadedTools }),
    [toolsSettings, loadedTools],
  );

  const globalEnabledSkills = useMemo(
    () => getGlobalEnabledSkills({ skillsSettings, loadedSkills }),
    [skillsSettings, loadedSkills],
  );

  const globalEnabledAgents = useMemo(
    () => getGlobalEnabledAgents({ agentsSettings, loadedAgents }),
    [agentsSettings, loadedAgents],
  );

  const modeCapabilityContext = useMemo(
    () => ({
      availableTools: [...availableToolsByName.values()],
      availableSkills: [...availableSkillsByName.values()],
      availableAgents: [...availableAgentsByName.values()],
    }),
    [availableAgentsByName, availableSkillsByName, availableToolsByName],
  );

  function getModeForChat(chat: ChatSession | undefined): LoadedModeInfo {
    return resolveModeForChat(chat?.modeId, modesState);
  }

  function appendToAssistantVariant(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    events: StreamBufferEvent[],
    options: { transition?: boolean } = {},
  ) {
    if (!events.length) return;

    const updateVariant = () => {
      updateChatMessages(
        chatId,
        (currentMessages) =>
          currentMessages.map((message) => {
            if (
              message.id !== assistantMessageId ||
              message.role !== "assistant"
            ) {
              return message;
            }

            return {
              ...message,
              variants: message.variants.map((variant) =>
                variant.id === variantId
                  ? appendStreamEventsToAssistantVariant(variant, events)
                  : variant,
              ),
            };
          }),
        { touch: false },
      );
    };

    updateVariant();
  }

  function flushBufferedAssistantVariant(bufferKey: string) {
    flushBufferedAssistantVariantBuffer({
      bufferKey,
      streamBuffersRef,
      appendToAssistantVariant: (
        chatId,
        assistantMessageId,
        variantId,
        events,
      ) =>
        appendToAssistantVariant(
          chatId,
          assistantMessageId,
          variantId,
          events,
          {
            transition: false,
          },
        ),
    });
  }

  function appendBufferedAssistantVariant(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    event: StreamBufferEvent,
  ) {
    appendBufferedAssistantVariantToBuffer({
      chatId,
      assistantMessageId,
      variantId,
      event,
      streamBuffersRef,
      streamFlushTimeoutRefs,
      appendToAssistantVariant,
      getDelayMs: () => (autoScrollEnabledRef.current ? 85 : 140),
    });
  }

  function setActiveStreamProcessStep(
    bufferKey: string,
    step: ActiveProcessStepRef,
  ) {
    streamActiveProcessStepRefs.current[bufferKey] = step;
  }

  function getActiveStreamProcessStep(bufferKey: string) {
    return streamActiveProcessStepRefs.current[bufferKey];
  }

  function updateAssistantVariant(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    updater: (variant: ChatAssistantVariant) => ChatAssistantVariant,
    options: { touch?: boolean } = {},
  ) {
    updateChatMessages(
      chatId,
      (currentMessages) =>
        currentMessages.map((message) => {
          if (
            message.id !== assistantMessageId ||
            message.role !== "assistant"
          ) {
            return message;
          }

          return {
            ...message,
            variants: message.variants.map((variant) =>
              variant.id === variantId ? updater(variant) : variant,
            ),
          };
        }),
      options,
    );
  }

  function appendAssistantProcessSteps(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    steps: ChatAssistantProcessStep[],
  ) {
    if (!steps.length) return;

    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: [...(variant.processSteps ?? []), ...steps],
      }),
      { touch: false },
    );
  }

  function completeAssistantThinkingStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
  ) {
    const completedAt = new Date().toISOString();

    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) => {
          if (step.id !== stepId || step.type !== "thinking") return step;
          if (step.status === "complete") return step;

          return {
            ...step,
            status: "complete",
            startedAt: step.startedAt ?? completedAt,
            completedAt: step.completedAt ?? completedAt,
          };
        }),
      }),
      { touch: false },
    );
  }

  function updateAssistantToolStepStatus(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: ToolExecutionStatus,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && step.type === "tool_execution"
            ? { ...step, status }
            : step,
        ),
      }),
      { touch: false },
    );
  }

  function updateAssistantUserInputStepStatus(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: UserInputStatus,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && step.type === "user_input"
            ? { ...step, status }
            : step,
        ),
      }),
      { touch: false },
    );
  }

  function completeAssistantUserInputStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    response: AskUserResponse,
    toolResult: ChatToolResult,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && step.type === "user_input"
            ? {
                ...step,
                status: "complete",
                response,
                toolResult,
              }
            : step,
        ),
      }),
      { touch: false },
    );
  }

  function updateAssistantFileApprovalStepStatus(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: UserInputStatus,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && (step.type === "approval" || step.type === "file_approval")
            ? { ...step, status }
            : step,
        ),
      }),
      { touch: false },
    );
  }

  function completeAssistantFileApprovalStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    response: ToolApprovalResponse,
    toolResult: ChatToolResult,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && (step.type === "approval" || step.type === "file_approval")
            ? {
                ...step,
                status: "complete",
                response,
                toolResult,
              }
            : step,
        ),
      }),
      { touch: false },
    );
  }

  function abortChatGeneration(chatId: string) {
    generationRefs.current[chatId]?.controller.abort();
  }

  function shouldRenderTaskListStep(toolResult: ChatToolResult) {
    return isTaskToolName(toolResult.toolName) && toolResult.isError !== true;
  }

  function getFinalTaskToolCall(toolCalls: ChatToolCall[]) {
    return [...toolCalls]
      .reverse()
      .find((toolCall) => isTaskToolName(toolCall.function.name));
  }

  function getFinalTaskToolResult(toolResults: ChatToolResult[]) {
    return [...toolResults]
      .reverse()
      .find((toolResult) => isTaskToolName(toolResult.toolName));
  }

  function coalesceTaskToolCallsForContext(toolCalls: ChatToolCall[]) {
    const finalTaskToolCall = getFinalTaskToolCall(toolCalls);
    if (!finalTaskToolCall) return toolCalls;

    return toolCalls.filter(
      (toolCall) =>
        !isTaskToolName(toolCall.function.name) ||
        toolCall.id === finalTaskToolCall.id,
    );
  }

  function coalesceTaskToolResultsForContext(toolResults: ChatToolResult[]) {
    const finalTaskToolResult = getFinalTaskToolResult(toolResults);
    if (!finalTaskToolResult) return toolResults;

    return toolResults.filter(
      (toolResult) =>
        !isTaskToolName(toolResult.toolName) ||
        toolResult.toolCallId === finalTaskToolResult.toolCallId,
    );
  }

  function executeTaskTool(toolCall: ChatToolCall, chatId: string): ChatToolResult {
    void chatId;
    const request = parseTaskToolRequestFromToolCall(toolCall);
    return createTaskToolResult({ toolCall, tasks: request.tasks });
  }

  const {
    executeToolCall,
    submitAskUserResponse,
    submitFileToolApprovalResponse,
    cancelAskUserRequest,
    canSubmitAskUserResponse,
  } = useToolExecution({
    activeChatId,
    loadedTools,
    availableSkillsByName,
    workspaceRoots: activeChat
      ? getEffectiveWorkspaceRootsForChat(
          activeChat,
          activeChat.activeSkillNames ?? [],
        )
      : [],
    fileToolAutoApproval: activeChat?.fileToolAutoApproval,
    modelSelectableSkillNames: activeChat
      ? getEnabledSkillsForChat({
          chat: activeChat,
          globalEnabledSkills,
          availableSkillsByName,
          mode: getModeForChat(activeChat),
          modeCapabilityContext,
        }).map((skill) => skill.name)
      : [],
    activeSkillNames: activeChat?.activeSkillNames ?? [],
    onSkillActivated: (skillName, chatId) => {
      updateChat(chatId, (chat) => ({
        ...chat,
        activeSkillNames: [
          ...new Set([...(chat.activeSkillNames ?? []), skillName]),
        ],
      }));
    },
    executeExternalTool,
    executeTaskTool,
    abortChatGeneration,
    completeAssistantUserInputStep,
    completeAssistantFileApprovalStep,
    updateAssistantToolStepStatus,
    updateAssistantUserInputStepStatus,
    updateAssistantFileApprovalStepStatus,
    scheduleStickyScrollToBottom,
    showError,
    labelError: labelForError,
    askUserSettleFrames: 5,
  });

  function ensureAssistantMessageProcessStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    bufferKey: string,
  ) {
    const activeStep = getActiveStreamProcessStep(bufferKey);
    if (activeStep?.type === "assistant_message" && activeStep.id) {
      return activeStep.id;
    }

    if (activeStep?.type === "thinking" && activeStep.id) {
      flushBufferedAssistantVariant(bufferKey);
      completeAssistantThinkingStep(
        chatId,
        assistantMessageId,
        variantId,
        activeStep.id,
      );
    }

    const assistantMessageStepId = createId();
    appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
      { id: assistantMessageStepId, type: "assistant_message", content: "" },
    ]);
    setActiveStreamProcessStep(bufferKey, {
      type: "assistant_message",
      id: assistantMessageStepId,
    });

    return assistantMessageStepId;
  }

  function ensureThinkingProcessStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    bufferKey: string,
  ) {
    const activeStep = getActiveStreamProcessStep(bufferKey);
    if (activeStep?.type === "thinking" && activeStep.id) {
      return activeStep.id;
    }

    const thinkingStepId = createId();
    appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
      {
        id: thinkingStepId,
        type: "thinking",
        content: "",
        status: "waiting",
      },
    ]);
    setActiveStreamProcessStep(bufferKey, {
      type: "thinking",
      id: thinkingStepId,
    });

    return thinkingStepId;
  }

  function upsertToolBuildingProcessStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    bufferKey: string,
    toolCalls: ChatToolCall[],
  ) {
    if (toolCalls.length === 0) return;

    const activeStep = getActiveStreamProcessStep(bufferKey);
    if (activeStep?.type === "thinking" && activeStep.id) {
      flushBufferedAssistantVariant(bufferKey);
      completeAssistantThinkingStep(
        chatId,
        assistantMessageId,
        variantId,
        activeStep.id,
      );
    }

    const now = new Date().toISOString();
    const existingStepId =
      activeStep?.type === "tool_building" ? activeStep.id : undefined;
    const stepId = existingStepId ?? createId();
    const toolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id));

    let shouldKeepBuildingStep = true;

    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => {
        const processSteps = variant.processSteps ?? [];
        const hasVisibleToolStep = processSteps.some((step) => {
          if (step.type === "tool_building") return false;
          if (!("toolCall" in step)) return false;
          return toolCallIds.has(step.toolCall.id);
        });

        if (hasVisibleToolStep) {
          shouldKeepBuildingStep = false;

          return {
            ...variant,
            processSteps: processSteps.filter(
              (step) => step.type !== "tool_building",
            ),
          };
        }

        const hasExistingToolBuildingStep = processSteps.some(
          (step) => step.id === stepId && step.type === "tool_building",
        );

        return {
          ...variant,
          processSteps: hasExistingToolBuildingStep
            ? processSteps.map((step) =>
                step.id === stepId && step.type === "tool_building"
                  ? { ...step, toolCalls, updatedAt: now }
                  : step,
              )
            : [
                ...processSteps,
                {
                  id: stepId,
                  type: "tool_building" as const,
                  status: "running" as const,
                  toolCalls,
                  updatedAt: now,
                },
              ],
        };
      },
      { touch: false },
    );

    if (shouldKeepBuildingStep) {
      setActiveStreamProcessStep(bufferKey, {
        type: "tool_building",
        id: stepId,
      });
    } else if (activeStep?.type === "tool_building") {
      delete streamActiveProcessStepRefs.current[bufferKey];
    }
  }

  function removeToolBuildingProcessSteps(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).filter(
          (step) => step.type !== "tool_building",
        ),
      }),
      { touch: false },
    );
  }

  function selectAssistantVariant(messageId: string, variantIndex: number) {
    updateActiveChatMessages(
      (currentMessages) =>
        currentMessages.map((message) => {
          if (message.id !== messageId || message.role !== "assistant") {
            return message;
          }

          const safeIndex = Math.min(
            Math.max(variantIndex, 0),
            message.variants.length - 1,
          );

          return {
            ...message,
            activeVariantIndex: safeIndex,
          };
        }),
      { touch: false },
    );
  }

  function setChatGenerating(chatId: string, isGenerating: boolean) {
    setGeneratingChatIds((currentChatIds) => {
      const nextChatIds = isGenerating
        ? [...new Set([...currentChatIds, chatId])]
        : currentChatIds.filter((currentChatId) => currentChatId !== chatId);
      return nextChatIds;
    });
  }

  function isChatGenerating(chatId: string) {
    return (
      Boolean(generationRefs.current[chatId]) ||
      generatingChatIds.includes(chatId)
    );
  }

  function validateProviderForRun(providerForRun: ProviderConfig) {
    const validation = validateProviderForGeneration(providerForRun);
    if (validation.ok) return true;

    showError(validation.message, validation.description);
    if (validation.shouldOpenSettings) setSettingsOpen(true);
    return false;
  }

  function validateToolMentions(content: string) {
    const validation = validateToolMentionsForRequest({
      content,
      availableToolsByName,
    });

    if (!validation.ok) {
      showError(validation.message);
      return undefined;
    }

    if (activeChat && validation.toolNames.length > 0) {
      const enabledToolNames = new Set(
        getToolsForChat(activeChat).map((tool) => tool.name),
      );
      const unavailableToolNames = validation.toolNames.filter(
        (toolName) => !enabledToolNames.has(toolName),
      );

      if (unavailableToolNames.length > 0) {
        showError(
          unavailableToolNames.length === 1
            ? `Tool is not available in this chat mode: ${unavailableToolNames[0]}`
            : `Tools are not available in this chat mode: ${unavailableToolNames.join(", ")}`,
        );
        return undefined;
      }
    }

    return validation.toolNames;
  }

  function validateSkillMentions(content: string) {
    const validation = validateSkillMentionsForRequest({
      content,
      availableSkillsByName,
    });

    if (!validation.ok) {
      showError(validation.message);
      return undefined;
    }

    if (activeChat && validation.skillNames.length > 0) {
      const enabledSkillNames = new Set(
        getEnabledSkillsForChat({
          chat: activeChat,
          globalEnabledSkills,
          availableSkillsByName,
          mode: getModeForChat(activeChat),
          modeCapabilityContext,
        }).map((skill) => skill.name),
      );
      const activeSkillNames = new Set(activeChat.activeSkillNames ?? []);
      const unavailableSkillNames = validation.skillNames.filter(
        (skillName) =>
          !enabledSkillNames.has(skillName) && !activeSkillNames.has(skillName),
      );

      if (unavailableSkillNames.length > 0) {
        showError(
          unavailableSkillNames.length === 1
            ? `Skill is not available in this chat mode: ${unavailableSkillNames[0]}`
            : `Skills are not available in this chat mode: ${unavailableSkillNames.join(", ")}`,
        );
        return undefined;
      }
    }

    return validation.skillNames;
  }

  function validateAgentMentions(content: string) {
    const validation = validateAgentMentionsForRequest({
      content,
      availableAgentsByName,
    });

    if (!validation.ok) {
      showError(validation.message);
      return undefined;
    }

    if (activeChat && validation.agentNames.length > 0) {
      const enabledAgentNames = new Set(
        getEnabledAgentsForChat({
          chat: activeChat,
          globalEnabledAgents,
          availableAgentsByName,
          mode: getModeForChat(activeChat),
          modeCapabilityContext,
        }).map((agent) => agent.name),
      );
      const unavailableAgentNames = validation.agentNames.filter(
        (agentName) => !enabledAgentNames.has(agentName),
      );

      if (unavailableAgentNames.length > 0) {
        showError(
          unavailableAgentNames.length === 1
            ? `Agent is not available in this chat mode: ${unavailableAgentNames[0]}`
            : `Agents are not available in this chat mode: ${unavailableAgentNames.join(", ")}`,
        );
        return undefined;
      }
    }

    return validation.agentNames;
  }

  function resolveProviderForActiveChat(chat: ChatSession) {
    return resolveProviderForChat({ chat, providers, activeProvider });
  }

  function maybeGenerateAutomaticAiTitle({
    chatId,
    contextMessages,
    userMessage,
    assistantMessage,
    providerForRun,
  }: {
    chatId: string;
    contextMessages: ChatMessage[];
    userMessage: string;
    assistantMessage: string;
    providerForRun: ProviderConfig;
  }) {
    if (chatTitleGenerationMode !== "ai") return;
    if (contextMessages.length > 0) return;
    if (!assistantMessage.trim()) return;

    void (async () => {
      try {
        const title = await generateTitleFromFirstExchange({
          provider: providerForRun,
          userMessage,
          assistantMessage,
        });

        if (!title) return;

        updateChat(chatId, (chat) => {
          if (!isAutoTitledChat(chat)) return chat;

          const firstUserMessage = chat.messages[0];
          const firstAssistantMessage = chat.messages[1];
          if (
            firstUserMessage?.role !== "user" ||
            firstAssistantMessage?.role !== "assistant"
          ) {
            return chat;
          }

          return {
            ...chat,
            title,
            titleMode: "auto",
          };
        });
      } catch (error) {
        console.error("Failed to generate chat title:", error);
      }
    })();
  }

  function getToolsForChat(
    chat: ChatSession,
    oneShotToolNames: string[] = [],
    activeSkillNames: string[] = chat.activeSkillNames ?? [],
  ) {
    const skillRecommendedToolNames = activeSkillNames.flatMap(
      (skillName) =>
        availableSkillsByName.get(skillName)?.recommendedToolNames ?? [],
    );
    const effectiveWorkspaceRoots = getEffectiveWorkspaceRoots({
      workspaceRoots: chat.workspaceRoots ?? [],
      activeSkillNames,
      availableSkillsByName,
    });
    const mode = getModeForChat(chat);
    const tools = getEnabledToolsForChat({
      chat,
      oneShotToolNames,
      skillRecommendedToolNames,
      globalEnabledTools,
      availableToolsByName,
      effectiveWorkspaceRoots,
      mode,
      modeCapabilityContext,
    });
    const enabledAgentsForChat = getEnabledAgentsForChat({
      chat,
      globalEnabledAgents,
      availableAgentsByName,
      mode,
      modeCapabilityContext,
    });
    const chatDisabledToolNames = new Set(chat.disabledToolNames ?? []);
    const toolsWithoutStaticAgentTool = tools.filter(
      (tool) => tool.name !== CALL_AGENT_TOOL_NAME,
    );

    const toolsWithAgentTool = (() => {
      if (chatDisabledToolNames.has(CALL_AGENT_TOOL_NAME)) {
        return toolsWithoutStaticAgentTool;
      }
      const callAgentTool = createCallAgentTool(enabledAgentsForChat);
      return callAgentTool
        ? [...toolsWithoutStaticAgentTool, callAgentTool]
        : toolsWithoutStaticAgentTool;
    })();

    return getToolsWithLoadSkillTool({
      tools: toolsWithAgentTool,
      modelSelectableSkills: getEnabledSkillsForChat({
        chat,
        globalEnabledSkills,
        availableSkillsByName,
        mode,
        modeCapabilityContext,
      }),
      activeSkillNames,
      loadSkillEnabled: toolsSettings.enabled && toolsSettings.loadSkillEnabled,
    });
  }

  function getActiveSkillNamesForRun(
    chat: ChatSession,
    oneShotSkillNames: string[] = [],
  ) {
    return [
      ...new Set([...(chat.activeSkillNames ?? []), ...oneShotSkillNames]),
    ];
  }

  function getEffectiveWorkspaceRootsForChat(
    chat: ChatSession | undefined,
    activeSkillNames: string[],
  ) {
    return getEffectiveWorkspaceRoots({
      workspaceRoots: chat?.workspaceRoots ?? [],
      activeSkillNames,
      availableSkillsByName,
    });
  }

  function getCurrentChatSnapshot(chatId: string) {
    return chatsRef.current.find((chat) => chat.id === chatId);
  }


  function mergeToolsByName(...toolLists: LoadedToolInfo[][]) {
    const byName = new Map<string, LoadedToolInfo>();
    for (const tools of toolLists) {
      for (const tool of tools) {
        if (!byName.has(tool.name)) byName.set(tool.name, tool);
      }
    }
    return [...byName.values()];
  }

  function getChatFileToolAutoApproval(chatId: string) {
    return getCurrentChatSnapshot(chatId)?.fileToolAutoApproval;
  }

  function getChatThinkingSettings(chatId: string) {
    return resolveChatThinkingSettings(
      chatsRef.current.find((chat) => chat.id === chatId)?.thinkingMode,
    );
  }

  function isFileToolCallAutoApproved(
    toolName: string,
    settings?: ChatFileToolAutoApproval,
  ) {
    if (toolName === FILE_CREATE_TOOL_NAME) return settings?.create === true;
    if (toolName === FILE_REPLACE_TEXT_TOOL_NAME) {
      return settings?.replaceText === true;
    }
    if (toolName === FILE_DELETE_TOOL_NAME) return settings?.delete === true;
    return false;
  }

  function composeSystemPrompt(
    chat: ChatSession | undefined,
    activeSkillNames: string[],
    alreadyLoadedMentionedSkillNames: string[] = [],
  ) {
    const mentionedSkills = [...new Set(alreadyLoadedMentionedSkillNames)].filter(
      (skillName) => activeSkillNames.includes(skillName),
    );
    const mentionNote = mentionedSkills.length
      ? [
          `The user's message explicitly mentioned these skills: ${mentionedSkills.join(", ")}.`,
          "They have already been loaded by the app before this model response. Their full instructions are included in the active skills section below.",
          "Do not call load_skill for these skills and do not say that you need to load them. Continue directly with the user's task using the already-loaded skill instructions.",
        ].join(" ")
      : "";

    return buildSystemPromptWithActiveSkills({
      systemPrompt: [systemPrompt.trim(), mentionNote].filter(Boolean).join("\n\n"),
      activeSkillNames,
      availableSkillsByName,
    });
  }

  function stopChatGeneration(chatId: string) {
    const generation = generationRefs.current[chatId];
    if (!generation) return;

    flushBufferedAssistantVariant(
      getStreamBufferKey(
        chatId,
        generation.assistantMessageId,
        generation.variantId,
      ),
    );
    const chat = chats.find((item) => item.id === chatId);
    const visualFlushKeys = getVisualFlushKeysForGeneration({
      chatMessages: chat?.messages ?? [],
      assistantMessageId: generation.assistantMessageId,
    });

    setVisualFlushRequests((current) => {
      const next = { ...current };
      for (const key of visualFlushKeys) {
        next[key] = (next[key] ?? 0) + 1;
      }
      return next;
    });
    updateAssistantVariant(
      chatId,
      generation.assistantMessageId,
      generation.variantId,
      (variant) => ({
        ...variant,
        processSteps: keepOnlyLatestTaskListStep(
          cancelUnfinishedTaskListSteps(variant.processSteps ?? []).filter(
            (step) => step.type !== "tool_building",
          ),
        ),
      }),
      { touch: false },
    );
    generation.controller.abort();
  }

  function createSyntheticAgentToolCall(
    agentName: string,
    task: string,
  ): ChatToolCall {
    return {
      id: createId(),
      type: "function",
      function: {
        name: CALL_AGENT_TOOL_NAME,
        arguments: JSON.stringify({ agentName, task }),
      },
    };
  }

  function createSyntheticLoadSkillToolCall(skillName: string): ChatToolCall {
    return {
      id: createId(),
      type: "function",
      function: {
        name: LOAD_SKILL_TOOL_NAME,
        arguments: JSON.stringify({ skillName }),
      },
    };
  }

  function createLoadSkillMentionToolResult(
    toolCall: ChatToolCall,
    skillName: string,
  ): ChatToolResult {
    const skill = availableSkillsByName.get(skillName);
    const payload = {
      ok: Boolean(skill),
      status: skill ? "loaded" : "missing",
      skillName,
      instructions: skill?.instructions ?? "",
      recommendedToolNames: skill?.recommendedToolNames ?? [],
      ...(skill?.directoryPath ? { directoryPath: skill.directoryPath } : {}),
    };

    return {
      toolCallId: toolCall.id,
      toolName: LOAD_SKILL_TOOL_NAME,
      content: JSON.stringify(payload, null, 2),
      isError: !skill,
      loadedSkillName: skill ? skillName : undefined,
      loadedSkillInstructions: skill?.instructions,
      loadedSkillRecommendedToolNames: skill?.recommendedToolNames ?? [],
    };
  }

  function updateAgentCallProcessSteps(
    processSteps: ChatAssistantProcessStep[] | undefined,
    callId: string,
    updater: (agentCall: ChatAgentCall) => ChatAgentCall,
  ): ChatAssistantProcessStep[] | undefined {
    if (!processSteps) return processSteps;

    return processSteps.map((step) => {
      if (step.type !== "agent_call") return step;
      const nextAgentCall = updateAgentCallInTree(
        step.agentCall,
        callId,
        updater,
      );
      return {
        ...step,
        status: nextAgentCall.status,
        agentCall: nextAgentCall,
      };
    });
  }

  function updateAgentCallInTree(
    call: ChatAgentCall,
    callId: string,
    updater: (agentCall: ChatAgentCall) => ChatAgentCall,
  ): ChatAgentCall {
    const nextCall = {
      ...call,
      processSteps: updateAgentCallProcessSteps(
        call.processSteps,
        callId,
        updater,
      ),
      childAgentCalls: updateAgentCallTree(
        call.childAgentCalls ?? [],
        callId,
        updater,
      ),
    };

    return call.id === callId ? updater(nextCall) : nextCall;
  }

  function updateAgentCallTree(
    calls: ChatAgentCall[],
    callId: string,
    updater: (agentCall: ChatAgentCall) => ChatAgentCall,
  ): ChatAgentCall[] {
    return calls.map((call) => updateAgentCallInTree(call, callId, updater));
  }

  function updateAssistantAgentCall(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    agentCallId: string,
    updater: (agentCall: ChatAgentCall) => ChatAgentCall,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) => {
          if (step.type !== "agent_call") return step;
          const nextAgentCall = updateAgentCallInTree(
            step.agentCall,
            agentCallId,
            updater,
          );
          return {
            ...step,
            status: nextAgentCall.status,
            agentCall: nextAgentCall,
          };
        }),
      }),
      { touch: false },
    );
  }

  function attachChildAgentCallToVisibleTree({
    chatId,
    assistantMessageId,
    variantId,
    parentAgentCallId,
    toolCall,
    toolBatchId,
    childAgentCall,
  }: {
    chatId: string;
    assistantMessageId: string;
    variantId: string;
    parentAgentCallId: string;
    toolCall: ChatToolCall;
    toolBatchId?: string;
    childAgentCall: ChatAgentCall;
  }) {
    updateAssistantAgentCall(
      chatId,
      assistantMessageId,
      variantId,
      parentAgentCallId,
      (agentCall) => ({
        ...agentCall,
        childAgentCalls: [...(agentCall.childAgentCalls ?? []), childAgentCall],
        processSteps: [
          ...(agentCall.processSteps ?? []),
          {
            id: createId(),
            type: "agent_call" as const,
            toolBatchId,
            status: childAgentCall.status,
            toolCall,
            agentCall: childAgentCall,
          },
        ],
      }),
    );
  }

  // --- Agent processSteps recording (ordered timeline per agent run) ---------
  //
  // These mirror the main-chat process-step helpers but write into the agent
  // call's own `processSteps` so the transcript can reconstruct interleaving
  // (think -> tool -> think -> tool -> nested agent -> answer) faithfully.

  function appendAgentProcessSteps(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    agentCallId: string,
    steps: ChatAssistantProcessStep[],
  ) {
    if (steps.length === 0) return;
    updateAssistantAgentCall(
      chatId,
      assistantMessageId,
      variantId,
      agentCallId,
      (agentCall) => ({
        ...agentCall,
        processSteps: [...(agentCall.processSteps ?? []), ...steps],
      }),
    );
  }

  function updateAgentProcessStep(
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    agentCallId: string,
    stepId: string,
    updater: (step: ChatAssistantProcessStep) => ChatAssistantProcessStep,
  ) {
    updateAssistantAgentCall(
      chatId,
      assistantMessageId,
      variantId,
      agentCallId,
      (agentCall) => ({
        ...agentCall,
        processSteps: (agentCall.processSteps ?? []).map((step) =>
          step.id === stepId ? updater(step) : step,
        ),
      }),
    );
  }

  function createAgentCall({
    agent,
    task,
    depth,
    provider,
  }: {
    agent: LoadedAgentInfo;
    task: string;
    depth: number;
    provider: ProviderConfig;
  }): ChatAgentCall {
    return {
      id: createId(),
      agentId: agent.id,
      agentName: agent.name,
      description: agent.description,
      task,
      status: "pending",
      contextMode: agent.contextMode,
      depth,
      startedAt: new Date().toISOString(),
      providerName: provider.name,
      model: provider.model,
      output: "",
      reasoning: "",
      messages: [],
      toolCalls: [],
      toolResults: [],
      childAgentCalls: [],
    };
  }

  function appendTopLevelAgentCallStep({
    chatId,
    assistantMessageId,
    variantId,
    toolCall,
    agentCall,
    toolBatchId,
  }: {
    chatId: string;
    assistantMessageId: string;
    variantId: string;
    toolCall: ChatToolCall;
    agentCall: ChatAgentCall;
    toolBatchId?: string;
  }) {
    appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
      {
        id: createId(),
        type: "agent_call",
        toolBatchId,
        status: agentCall.status,
        toolCall,
        agentCall,
      },
    ]);
  }

  function resolveProviderForAgent(
    agent: LoadedAgentInfo,
    fallbackProvider: ProviderConfig,
  ) {
    const provider = agent.providerId
      ? providers.find((item) => item.id === agent.providerId)
      : undefined;
    const resolvedProvider = provider ?? fallbackProvider;
    const model =
      agent.model?.trim() ||
      resolvedProvider.model ||
      getProviderFallbackModel(resolvedProvider);
    return { ...resolvedProvider, model };
  }

  function createAgentSystemPrompt(
    agent: LoadedAgentInfo,
    activeSkillNamesForAgent: string[],
  ) {
    const basePrompt = isBuiltInAgentName(agent.name)
      ? [
          systemPrompt.trim(),
          `You are the built-in Chat Forge agent named ${agent.name}.`,
          agent.description.trim()
            ? `Agent description: ${agent.description.trim()}`
            : "",
          agent.instructions.trim(),
          "Return the result for the delegated task. Do not address the user unless the task asks you to draft user-facing text.",
        ]
          .filter(Boolean)
          .join("\n\n")
      : [
          `You are the configured Chat Forge agent named ${agent.name}.`,
          agent.description.trim()
            ? `Agent description: ${agent.description.trim()}`
            : "",
          agent.instructions.trim(),
          "Return the result for the delegated task. Do not address the user unless the task asks you to draft user-facing text.",
        ]
          .filter(Boolean)
          .join("\n\n");

    return buildSystemPromptWithActiveSkills({
      systemPrompt: basePrompt,
      activeSkillNames: activeSkillNamesForAgent,
      availableSkillsByName,
    });
  }

  function getAgentTools({
    agent,
    depth,
    inheritedToolsForRun,
    chatEnabledAgents,
  }: {
    agent: LoadedAgentInfo;
    depth: number;
    inheritedToolsForRun: LoadedToolInfo[];
    chatEnabledAgents: LoadedAgentInfo[];
  }) {
    const canCallAllowedAgents = agentsSettings.enabled;

    if (isBuiltInAgentName(agent.name)) {
      const tools = inheritedToolsForRun.filter(
        (tool) => tool.enabled && tool.name !== CALL_AGENT_TOOL_NAME,
      );
      // Built-in agents are depth-limited, so allow them to call any enabled
      // agent, including another instance of themselves. This is important for
      // general_full -> general_full decomposition where the same full-context
      // helper may need to split work recursively.
      const nextAgents = chatEnabledAgents;
      const callAgentTool = canCallAllowedAgents
        ? createCallAgentTool(nextAgents)
        : null;

      return callAgentTool ? [...tools, callAgentTool] : tools;
    }

    const allowedToolNames = new Set(agent.allowedToolNames ?? []);
    const tools = [...allowedToolNames]
      .map((toolName) => availableToolsByName.get(toolName))
      .filter((tool): tool is LoadedToolInfo => {
        if (!tool) return false;
        return tool.enabled && tool.name !== CALL_AGENT_TOOL_NAME;
      });

    const allowedAgentNames = new Set(agent.allowedAgentNames ?? []);
    const nextAgents = globalEnabledAgents.filter((candidate) =>
      allowedAgentNames.has(candidate.name),
    );
    const callAgentTool = canCallAllowedAgents
      ? createCallAgentTool(nextAgents)
      : null;

    return callAgentTool ? [...tools, callAgentTool] : tools;
  }

  async function runAgentCall({
    chatId,
    assistantMessageId,
    variantId,
    agentName,
    task,
    toolCall: sourceToolCall,
    toolBatchId,
    depth,
    parentAgentCallId,
    parentProvider,
    maxAllowedDepth,
    signal,
    contextMessages,
    userAttachments,
    inheritedToolsForRun,
    inheritedActiveSkillNames,
  }: {
    chatId: string;
    assistantMessageId: string;
    variantId: string;
    agentName: string;
    task: string;
    toolCall?: ChatToolCall;
    toolBatchId?: string;
    depth: number;
    parentAgentCallId?: string;
    parentProvider: ProviderConfig;
    maxAllowedDepth?: number;
    signal: AbortSignal;
    contextMessages: ChatMessage[];
    userAttachments?: ChatAttachment[];
    inheritedToolsForRun: LoadedToolInfo[];
    inheritedActiveSkillNames: string[];
  }): Promise<{ agentCall: ChatAgentCall; toolResult: ChatToolResult }> {
    const toolCall =
      sourceToolCall ?? createSyntheticAgentToolCall(agentName, task);
    const agent = availableAgentsByName.get(agentName);

    if (!agentsSettings.enabled || !agent || !agent.enabled) {
      const content = !agentsSettings.enabled
        ? "Agents are disabled."
        : `Agent not available: ${agentName}`;
      const result = createAgentToolResult({
        toolCall,
        agentName,
        output: content,
        isError: true,
      });
      return {
        agentCall: {
          id: createId(),
          agentName,
          task,
          status: "failed",
          contextMode: "task_only",
          depth,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          output: "",
          error: content,
          messages: [],
          childAgentCalls: [],
        },
        toolResult: result,
      };
    }

    if (maxAllowedDepth !== undefined && depth > Math.max(1, maxAllowedDepth)) {
      const content = `Max agent nesting depth has been reached (${maxAllowedDepth}). Do not call another agent from this agent call; continue with the available context or explain that deeper delegation is blocked.`;
      const result = createAgentToolResult({
        toolCall,
        agentName,
        output: content,
        isError: true,
      });
      return {
        agentCall: {
          id: createId(),
          agentId: agent.id,
          agentName,
          description: agent.description,
          task,
          status: "failed",
          contextMode: agent.contextMode,
          depth,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          output: "",
          error: content,
          messages: [],
          childAgentCalls: [],
        },
        toolResult: result,
      };
    }

    const provider = resolveProviderForAgent(agent, parentProvider);
    const agentCall = createAgentCall({ agent, task, depth, provider });
    const visibleToolCall = toolCall;

    if (parentAgentCallId) {
      attachChildAgentCallToVisibleTree({
        chatId,
        assistantMessageId,
        variantId,
        parentAgentCallId,
        toolCall: visibleToolCall,
        toolBatchId,
        childAgentCall: agentCall,
      });
    } else {
      appendTopLevelAgentCallStep({
        chatId,
        assistantMessageId,
        variantId,
        toolCall: visibleToolCall,
        agentCall,
        toolBatchId,
      });
    }

    updateAssistantAgentCall(
      chatId,
      assistantMessageId,
      variantId,
      agentCall.id,
      (call) => ({
        ...call,
        status: "running",
      }),
    );

    const startedAt = new Date().toISOString();
    let currentAgentActiveSkillNames = isBuiltInAgentName(agent.name)
      ? [...new Set(inheritedActiveSkillNames)]
      : [...new Set(agent.loadedSkillNames ?? [])];
    const chatForAgentCall = chats.find((candidate) => candidate.id === chatId) ?? {
      id: chatId,
      title: "",
      messages: [],
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    const chatEnabledAgents = getEnabledAgentsForChat({
      chat: chatForAgentCall,
      globalEnabledAgents,
      availableAgentsByName,
      mode: getModeForChat(chatForAgentCall),
      modeCapabilityContext,
    });

    const transcriptMessages = [
      {
        id: createId(),
        role: "system" as const,
        content: createAgentSystemPrompt(agent, currentAgentActiveSkillNames),
        createdAt: startedAt,
      },
      {
        id: createId(),
        role: "user" as const,
        content: task,
        createdAt: startedAt,
      },
    ];
    updateAssistantAgentCall(
      chatId,
      assistantMessageId,
      variantId,
      agentCall.id,
      (call) => ({
        ...call,
        messages: transcriptMessages,
      }),
    );

    let accumulatedOutput = "";
    let accumulatedReasoning = "";
    let accumulatedReasoningMetadata: ChatReasoningMetadata | undefined;
    let toolCallsForContext: ChatToolCall[] = [];
    let toolResultsForContext: ChatToolResult[] = [];

    // Design 2: an agent always sees its caller's transcript plus its
    // delegated task. `contextMessages` is the caller's context: for a
    // top-level call that is the main chat's prior messages; for a nested
    // call it is the parent agent's transcript so far. A `task_only` agent
    // gets no caller transcript, only the task.
    const agentContextMessages =
      agent.contextMode === "full_chat" ? [...contextMessages] : [];
    const delegatedTaskMessage =
      agent.contextMode === "full_chat"
        ? `Delegated task for agent ${agent.name}:\n\n${task}`
        : task;
    const baseAgentMessages: ChatMessage[] = [
      ...agentContextMessages,
      {
        id: createId(),
        role: "user",
        content: delegatedTaskMessage,
        createdAt: new Date().toISOString(),
        ...(userAttachments?.length ? { attachments: userAttachments } : {}),
      },
    ];
    let currentMessages = agentContextMessages;
    let currentUserMessage: string | undefined = delegatedTaskMessage;

    // Active per-round process-step ids for the agent timeline. A new
    // thinking/assistant_message step is opened on the first delta of a run
    // and continued by subsequent deltas, mirroring the main chat loop.
    let activeAgentThinkingStepId: string | undefined;
    let activeAgentMessageStepId: string | undefined;

    const completeActiveAgentThinkingStep = () => {
      if (!activeAgentThinkingStepId) return;
      const stepId = activeAgentThinkingStepId;
      activeAgentThinkingStepId = undefined;
      updateAgentProcessStep(
        chatId,
        assistantMessageId,
        variantId,
        agentCall.id,
        stepId,
        (step) =>
          step.type === "thinking"
            ? {
                ...step,
                status: "complete",
                completedAt: step.completedAt ?? new Date().toISOString(),
              }
            : step,
      );
    };

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        // A fresh provider turn starts a new assistant text block; any open
        // thinking block from the previous round is finished.
        activeAgentMessageStepId = undefined;
        const chatSnapshot = getCurrentChatSnapshot(chatId);
        const currentInheritedToolsForRun = chatSnapshot
          ? mergeToolsByName(
              inheritedToolsForRun,
              getToolsForChat(chatSnapshot, [], currentAgentActiveSkillNames),
            )
          : inheritedToolsForRun;

        const result = await streamProviderChat({
          provider,
          systemPrompt: createAgentSystemPrompt(agent, currentAgentActiveSkillNames),
          messages: currentMessages,
          userMessage: currentUserMessage,
          userAttachments: round === 0 ? userAttachments : undefined,
          signal,
          tools: getAgentTools({
            agent,
            depth,
            inheritedToolsForRun: currentInheritedToolsForRun,
            chatEnabledAgents,
          }),
          settingsOverride: getChatThinkingSettings(chatId),
          onContentDelta: (delta) => {
            accumulatedOutput += delta;
            if (!activeAgentMessageStepId) {
              completeActiveAgentThinkingStep();
              const stepId = createId();
              activeAgentMessageStepId = stepId;
              appendAgentProcessSteps(
                chatId,
                assistantMessageId,
                variantId,
                agentCall.id,
                [{ id: stepId, type: "assistant_message", content: delta }],
              );
            } else {
              const stepId = activeAgentMessageStepId;
              updateAgentProcessStep(
                chatId,
                assistantMessageId,
                variantId,
                agentCall.id,
                stepId,
                (step) =>
                  step.type === "assistant_message"
                    ? { ...step, content: step.content + delta }
                    : step,
              );
            }
            updateAssistantAgentCall(
              chatId,
              assistantMessageId,
              variantId,
              agentCall.id,
              (call) => ({
                ...call,
                output: accumulatedOutput,
              }),
            );
            if (chatId === activeChatId) scheduleStickyScrollToBottom();
          },
          onReasoningDelta: (delta) => {
            accumulatedReasoning += delta;
            const hasVisibleDelta = delta.trim().length > 0;
            if (!activeAgentThinkingStepId) {
              if (!hasVisibleDelta) return;
              const stepId = createId();
              activeAgentThinkingStepId = stepId;
              activeAgentMessageStepId = undefined;
              appendAgentProcessSteps(
                chatId,
                assistantMessageId,
                variantId,
                agentCall.id,
                [
                  {
                    id: stepId,
                    type: "thinking",
                    content: delta,
                    status: "in_progress",
                    startedAt: new Date().toISOString(),
                  },
                ],
              );
            } else {
              const stepId = activeAgentThinkingStepId;
              updateAgentProcessStep(
                chatId,
                assistantMessageId,
                variantId,
                agentCall.id,
                stepId,
                (step) =>
                  step.type === "thinking"
                    ? { ...step, content: step.content + delta }
                    : step,
              );
            }
            updateAssistantAgentCall(
              chatId,
              assistantMessageId,
              variantId,
              agentCall.id,
              (call) => ({
                ...call,
                reasoning: accumulatedReasoning,
              }),
            );
          },
        });

        // The model finished a turn; close any open thinking block before
        // tool steps are recorded so the timeline reads think -> tools.
        completeActiveAgentThinkingStep();

        accumulatedReasoningMetadata = mergeReasoningMetadata(
          accumulatedReasoningMetadata,
          result.reasoningMetadata,
        );

        const toolCalls = result.toolCalls ?? [];
        const childToolBatchId = toolCalls.length > 1 ? createId() : undefined;
        const childToolBatchIdsByToolCallId = new Map<string, string>();
        const callerTranscriptToolCallsForContext = toolCallsForContext;
        const callerTranscriptToolResultsForContext = toolResultsForContext;
        const contextToolCalls = coalesceTaskToolCallsForContext(toolCalls);
        toolCallsForContext = [...toolCallsForContext, ...contextToolCalls];
        updateAssistantAgentCall(
          chatId,
          assistantMessageId,
          variantId,
          agentCall.id,
          (call) => ({
            ...call,
            toolCalls: [...(call.toolCalls ?? []), ...toolCalls],
          }),
        );

        if (!toolCalls.length) break;
        if (round >= MAX_TOOL_ROUNDS) {
          throw new Error(
            `Stopped after ${MAX_TOOL_ROUNDS} agent tool rounds.`,
          );
        }

        // Record an ordered timeline step for each tool call in this round so
        // the transcript reconstructs think -> tool -> think interleaving.
        // - call_agent gets a `tool_execution` step (the "called an agent"
        //   block) that completes on successful dispatch (status (i)); the
        //   running agent itself is recorded separately as an `agent_call`
        //   step by the nested run via attachChildAgentCallToVisibleTree.
        // - ask_user / approvals are surfaced at the parent level for the
        //   interactive affordance, but also mirrored here in order.
        const agentToolExecutionStepIdByToolCallId = new Map<string, string>();
        const agentApprovalStepIdByToolCallId = new Map<string, string>();
        const agentTimelineSteps: ChatAssistantProcessStep[] = [];
        for (const childToolCall of toolCalls) {
          const stepId = createId();
          const childTool = availableToolsByName.get(
            childToolCall.function.name,
          );
          const childNeedsApproval = requiresToolApproval(
            childToolCall.function.name,
            childTool,
          );
          const childAutoApproval = getChatFileToolAutoApproval(chatId);
          const childAutoApproved =
            requiresFileToolApproval(childToolCall.function.name) &&
            isFileToolCallAutoApproved(
              childToolCall.function.name,
              childAutoApproval,
            );
          const shouldMirrorApproval = childNeedsApproval && !childAutoApproved;
          const stepToolBatchId =
            childToolCall.function.name === CALL_AGENT_TOOL_NAME
              ? (childToolBatchId ?? createId())
              : (childToolBatchId ??
                (shouldMirrorApproval ? createId() : undefined));
          if (stepToolBatchId) {
            childToolBatchIdsByToolCallId.set(childToolCall.id, stepToolBatchId);
          }

          if (shouldMirrorApproval) {
            try {
              const approvalStepId = createId();
              agentApprovalStepIdByToolCallId.set(
                childToolCall.id,
                approvalStepId,
              );
              agentTimelineSteps.push({
                id: approvalStepId,
                type: "approval" as const,
                toolBatchId: stepToolBatchId,
                status: "waiting" as const,
                toolCall: childToolCall,
                request: requiresFileToolApproval(childToolCall.function.name)
                  ? parseFileToolApprovalRequestFromToolCall(
                      childToolCall,
                      getEffectiveWorkspaceRootsForChat(
                        getCurrentChatSnapshot(chatId),
                        currentAgentActiveSkillNames,
                      ),
                    )
                  : createToolApprovalRequest(childToolCall, childTool),
              });
            } catch {
              // Keep invalid approval calls visible as failed tool executions
              // once executeToolCall returns the validation error.
            }
          }

          agentToolExecutionStepIdByToolCallId.set(childToolCall.id, stepId);
          agentTimelineSteps.push({
            id: stepId,
            type: "tool_execution",
            toolBatchId: stepToolBatchId,
            status: shouldMirrorApproval ? "pending" : "running",
            toolCall: childToolCall,
          });
        }
        appendAgentProcessSteps(
          chatId,
          assistantMessageId,
          variantId,
          agentCall.id,
          agentTimelineSteps,
        );

        const recordAgentToolStepResult = (toolResult: ChatToolResult) => {
          const stepId = agentToolExecutionStepIdByToolCallId.get(
            toolResult.toolCallId,
          );
          if (!stepId) return;
          updateAgentProcessStep(
            chatId,
            assistantMessageId,
            variantId,
            agentCall.id,
            stepId,
            (step) =>
              step.type === "tool_execution"
                ? {
                    ...step,
                    status: toolResult.isError ? "failed" : "complete",
                    toolResult,
                  }
                : step,
          );
        };

        const recordAgentApprovalStepResult = (toolResult: ChatToolResult) => {
          const stepId = agentApprovalStepIdByToolCallId.get(
            toolResult.toolCallId,
          );
          if (!stepId) return;
          updateAgentProcessStep(
            chatId,
            assistantMessageId,
            variantId,
            agentCall.id,
            stepId,
            (step) =>
              step.type === "approval" || step.type === "file_approval"
                ? {
                    ...step,
                    status: "complete",
                    toolResult,
                  }
                : step,
          );
        };

        // For call_agent, the tool step (the act of delegating) completes as
        // soon as the call is dispatched, decoupled from the agent outcome.
        const markAgentCallDispatched = (childToolCall: ChatToolCall) => {
          const stepId = agentToolExecutionStepIdByToolCallId.get(
            childToolCall.id,
          );
          if (!stepId) return;
          updateAgentProcessStep(
            chatId,
            assistantMessageId,
            variantId,
            agentCall.id,
            stepId,
            (step) =>
              step.type === "tool_execution"
                ? { ...step, status: "complete" }
                : step,
          );
        };

        // Build this agent's conversation so far, to forward to a nested
        // agent as its caller transcript (Design 2). It mirrors how the main
        // chat's context is the user's prior turns: here the "caller" is this
        // agent, so the transcript is the delegated task plus the assistant
        // turn (content + tool calls/results) accumulated to this point.
        const buildAgentCallerTranscript = (): ChatMessage[] => [
          ...baseAgentMessages,
          createContinuationAssistantMessage({
            assistantMessageId: createId(),
            variantId: createId(),
            accumulatedContent: accumulatedOutput,
            accumulatedReasoning,
            accumulatedReasoningMetadata,
            // A nested full-context agent must receive only this caller's
            // completed transcript. Do not include the current unresolved
            // call_agent tool call: provider APIs require assistant tool calls
            // to be followed by matching tool results, and the nested agent is
            // being launched before that result exists.
            toolCalls: callerTranscriptToolCallsForContext,
            toolResults: callerTranscriptToolResultsForContext,
          }),
        ];

        const executeChildToolCall = async (childToolCall: ChatToolCall) => {
          if (childToolCall.function.name === CALL_AGENT_TOOL_NAME) {
            // Status (i): the call_agent tool step is complete on dispatch.
            markAgentCallDispatched(childToolCall);
            try {
              const request = parseCallAgentRequestFromToolCall(childToolCall);
              const child = await runAgentCall({
                chatId,
                assistantMessageId,
                variantId,
                agentName: request.agentName,
                task: request.task,
                toolCall: childToolCall,
                toolBatchId: childToolBatchIdsByToolCallId.get(
                  childToolCall.id,
                ),
                depth: depth + 1,
                parentAgentCallId: agentCall.id,
                parentProvider: provider,
                maxAllowedDepth: agent.maxNestingDepth,
                signal,
                // Design 2 / Q1-A: a nested agent sees its CALLER's
                // transcript, not the root chat. The caller here is this
                // agent, so forward this agent's conversation so far.
                contextMessages: buildAgentCallerTranscript(),
                userAttachments,
                inheritedToolsForRun: currentInheritedToolsForRun,
                inheritedActiveSkillNames: currentAgentActiveSkillNames,
              });
              return {
                ...child.toolResult,
                toolCallId: childToolCall.id,
              };
            } catch (error) {
              const errorResult = createAgentToolResult({
                toolCall: childToolCall,
                agentName: "unknown",
                output: labelForError(error),
                isError: true,
              });
              recordAgentToolStepResult(errorResult);
              return errorResult;
            }
          }

          try {
            if (childToolCall.function.name === ASK_USER_TOOL_NAME) {
              const askResult = await executeToolCall(childToolCall, {
                chatId,
                assistantMessageId,
                variantId,
                stepId: `${agentCall.id}:${childToolCall.id}`,
                signal,
                activeSkillNames: currentAgentActiveSkillNames,
                workspaceRoots: getEffectiveWorkspaceRootsForChat(
                  getCurrentChatSnapshot(chatId),
                  currentAgentActiveSkillNames,
                ),
                fileToolAutoApproval: getChatFileToolAutoApproval(chatId),
              });
              recordAgentToolStepResult(askResult);
              return askResult;
            }

            if (isTaskToolName(childToolCall.function.name)) {
              const taskResult = executeTaskTool(childToolCall, chatId);
              recordAgentToolStepResult(taskResult);
              return taskResult;
            }

            const childWorkspaceRoots = getEffectiveWorkspaceRootsForChat(
              getCurrentChatSnapshot(chatId),
              currentAgentActiveSkillNames,
            );

            const childTool = availableToolsByName.get(
              childToolCall.function.name,
            );

            if (requiresToolApproval(childToolCall.function.name, childTool)) {
              const autoApproval = getChatFileToolAutoApproval(chatId);
              const autoApproved =
                requiresFileToolApproval(childToolCall.function.name) &&
                isFileToolCallAutoApproved(
                  childToolCall.function.name,
                  autoApproval,
                );
              const approvalStepId = createId();
              const agentTimelineStepId =
                agentToolExecutionStepIdByToolCallId.get(childToolCall.id) ??
                createId();

              // The approval prompt is surfaced at the parent (main chat)
              // level so the user can act on it even while the agent
              // transcript modal is closed. The executed tool result is
              // recorded into the agent timeline for the transcript.
              if (!autoApproved) {
                appendAssistantProcessSteps(
                  chatId,
                  assistantMessageId,
                  variantId,
                  [
                    {
                      id: approvalStepId,
                      type: "approval" as const,
                      toolBatchId: childToolBatchId,
                      status: "waiting" as const,
                      toolCall: childToolCall,
                      request: requiresFileToolApproval(childToolCall.function.name)
                        ? parseFileToolApprovalRequestFromToolCall(
                            childToolCall,
                            childWorkspaceRoots,
                          )
                        : createToolApprovalRequest(childToolCall, childTool),
                    },
                  ],
                );
              }

              const toolResult = await executeToolCall(childToolCall, {
                chatId,
                assistantMessageId,
                variantId,
                stepId: autoApproved ? agentTimelineStepId : approvalStepId,
                signal,
                activeSkillNames: currentAgentActiveSkillNames,
                workspaceRoots: childWorkspaceRoots,
                fileToolAutoApproval: autoApproval,
              });
              recordAgentApprovalStepResult(toolResult);
              recordAgentToolStepResult(toolResult);
              return toolResult;
            }

            const agentTimelineStepId =
              agentToolExecutionStepIdByToolCallId.get(childToolCall.id) ??
              createId();
            const toolResult = await executeToolCall(childToolCall, {
              chatId,
              assistantMessageId,
              variantId,
              stepId: agentTimelineStepId,
              signal,
              activeSkillNames: currentAgentActiveSkillNames,
              workspaceRoots: childWorkspaceRoots,
              fileToolAutoApproval: getChatFileToolAutoApproval(chatId),
            });
            recordAgentToolStepResult(toolResult);
            return toolResult;
          } catch (error) {
            const errorResult = {
              toolCallId: childToolCall.id,
              toolName: childToolCall.function.name,
              content: labelForError(error),
              isError: true,
            } satisfies ChatToolResult;
            recordAgentApprovalStepResult(errorResult);
            recordAgentToolStepResult(errorResult);
            return errorResult;
          }
        };

        let childTaskQueue = Promise.resolve();
        const toolResults = await Promise.all(
          toolCalls.map((childToolCall) => {
            if (!isTaskToolName(childToolCall.function.name)) {
              return executeChildToolCall(childToolCall);
            }

            const childTaskToolResultPromise = childTaskQueue.then(() =>
              executeChildToolCall(childToolCall),
            );
            childTaskQueue = childTaskToolResultPromise.then(
              () => undefined,
              () => undefined,
            );
            return childTaskToolResultPromise;
          }),
        );

        const finalTaskToolResult = getFinalTaskToolResult(toolResults);
        const finalTaskToolCall = finalTaskToolResult
          ? toolCalls.find((toolCall) => toolCall.id === finalTaskToolResult.toolCallId)
          : undefined;
        if (
          finalTaskToolResult &&
          shouldRenderTaskListStep(finalTaskToolResult) &&
          finalTaskToolCall
        ) {
          appendAssistantProcessSteps(
            chatId,
            assistantMessageId,
            variantId,
            [
              {
                id: createId(),
                type: "tasks" as const,
                toolBatchId: childToolBatchId,
                status: "complete" as const,
                toolCall: finalTaskToolCall,
                toolResult: finalTaskToolResult,
              },
            ],
          );
        }

        toolResultsForContext = [
          ...toolResultsForContext,
          ...coalesceTaskToolResultsForContext(toolResults),
        ];
        const loadedAgentSkillNames = toolResults
          .map((toolResult) =>
            toolResult.toolName === LOAD_SKILL_TOOL_NAME && !toolResult.isError
              ? toolResult.loadedSkillName
              : undefined,
          )
          .filter((skillName): skillName is string => Boolean(skillName));
        if (loadedAgentSkillNames.length > 0) {
          currentAgentActiveSkillNames = [
            ...new Set([...currentAgentActiveSkillNames, ...loadedAgentSkillNames]),
          ];
        }

        updateAssistantAgentCall(
          chatId,
          assistantMessageId,
          variantId,
          agentCall.id,
          (call) => ({
            ...call,
            toolResults: [...(call.toolResults ?? []), ...toolResults],
          }),
        );

        currentMessages = [
          ...baseAgentMessages,
          createContinuationAssistantMessage({
            assistantMessageId: createId(),
            variantId: createId(),
            accumulatedContent: accumulatedOutput,
            accumulatedReasoning,
            accumulatedReasoningMetadata,
            toolCalls: toolCallsForContext,
            toolResults: toolResultsForContext,
          }),
        ];
        currentUserMessage = undefined;
      }

      const completedAt = new Date().toISOString();
      const finalMessages = [
        ...transcriptMessages,
        {
          id: createId(),
          role: "assistant" as const,
          content: accumulatedOutput,
          createdAt: completedAt,
        },
      ];
      updateAssistantAgentCall(
        chatId,
        assistantMessageId,
        variantId,
        agentCall.id,
        (call) => ({
          ...call,
          status: "complete",
          completedAt,
          output: accumulatedOutput,
          reasoning: accumulatedReasoning,
          messages: finalMessages,
        }),
      );

      const toolResult = createAgentToolResult({
        toolCall: visibleToolCall,
        agentName,
        output: accumulatedOutput || "Agent completed with no output.",
      });
      return {
        agentCall: {
          ...agentCall,
          status: "complete",
          completedAt,
          output: accumulatedOutput,
          reasoning: accumulatedReasoning,
          messages: finalMessages,
        },
        toolResult,
      };
    } catch (error) {
      const wasAborted =
        error instanceof DOMException && error.name === "AbortError";
      const completedAt = new Date().toISOString();
      const errorMessage = wasAborted
        ? "Agent call cancelled."
        : labelForError(error);
      updateAssistantAgentCall(
        chatId,
        assistantMessageId,
        variantId,
        agentCall.id,
        (call) => ({
          ...call,
          status: wasAborted ? "cancelled" : "failed",
          completedAt,
          output: accumulatedOutput,
          reasoning: accumulatedReasoning,
          error: errorMessage,
        }),
      );
      const toolResult = createAgentToolResult({
        toolCall: visibleToolCall,
        agentName,
        output: errorMessage,
        isError: true,
      });
      return {
        agentCall: {
          ...agentCall,
          status: wasAborted ? "cancelled" : "failed",
          completedAt,
          output: accumulatedOutput,
          reasoning: accumulatedReasoning,
          error: errorMessage,
        },
        toolResult,
      };
    }
  }

  async function prepareChatWorkspaceForRun(
    chat: ChatSession,
    messageId: string,
    attachments: ChatAttachment[],
  ): Promise<{ chatForRun: ChatSession; attachmentsForRun: ChatAttachment[] }> {
    let chatForRun = chat;
    let attachmentsForRun = attachments;

    try {
      const chatWorkspaceRoot = await window.chatForgeWorkspace?.ensureChatWorkspace?.(chat.id);
      if (chatWorkspaceRoot) {
        chatForRun = {
          ...chatForRun,
          workspaceRoots: mergeChatWorkspaceRoot(
            chatForRun.workspaceRoots,
            chatWorkspaceRoot,
          ),
        };
      }
    } catch (error) {
      console.error("Failed to ensure chat workspace:", error);
      showError("Chat workspace failed", labelForError(error));
    }

    if (attachmentsForRun.length && window.codeForgeAI?.materializeAttachments) {
      try {
        const result = await window.codeForgeAI.materializeAttachments({
          chatId: chat.id,
          messageId,
          attachments: attachmentsForRun,
        });

        attachmentsForRun = result.attachments;
        chatForRun = {
          ...chatForRun,
          workspaceRoots: mergeChatWorkspaceRoot(
            chatForRun.workspaceRoots,
            result.workspaceRoot,
          ),
          messages: chatForRun.messages.map((message) =>
            message.id === messageId && message.role === "user"
              ? { ...message, attachments: attachmentsForRun }
              : message,
          ),
        };
      } catch (error) {
        console.error("Failed to copy attachments into chat workspace:", error);
        showError("Attachment workspace failed", labelForError(error));
      }
    }

    if (chatForRun !== chat) {
      updateChat(chat.id, (currentChat) => ({
        ...currentChat,
        workspaceRoots: chatForRun.workspaceRoots,
        messages: currentChat.messages.map((message) =>
          message.id === messageId && message.role === "user"
            ? { ...message, attachments: attachmentsForRun }
            : message,
        ),
      }));
    }

    return { chatForRun, attachmentsForRun };
  }

  async function runAssistantVariant({
    chatId,
    contextMessages,
    userMessage,
    userAttachments,
    assistantMessageId,
    variantId,
    responseStartedAtMs,
    providerForRun,
    toolsForRun,
    activeSkillNamesForRun,
    oneShotSkillNames = [],
    oneShotAgentNames = [],
  }: {
    chatId: string;
    contextMessages: ChatMessage[];
    userMessage: string;
    userAttachments?: ChatAttachment[];
    assistantMessageId: string;
    variantId: string;
    responseStartedAtMs: number;
    providerForRun: ProviderConfig;
    toolsForRun: LoadedToolInfo[];
    activeSkillNamesForRun: string[];
    oneShotSkillNames?: string[];
    oneShotAgentNames?: string[];
  }) {
    const controller = new AbortController();
    generationRefs.current[chatId] = {
      controller,
      assistantMessageId,
      variantId,
    };
    setChatGenerating(chatId, true);
    setStreamingAssistantByChatId((current) => ({
      ...current,
      [chatId]: assistantMessageId,
    }));

    if (chatId === activeChatId) {
      armStickyScrollToBottom();
    }

    let toolCallsForContext: ChatToolCall[] = [];
    let toolResultsForContext: ChatToolResult[] = [];
    const toolBatchIdsByToolCallId = new Map<string, string>();
    let accumulatedContent = "";
    let accumulatedReasoning = "";
    let accumulatedReasoningMetadata: ChatReasoningMetadata | undefined;
    let currentActiveSkillNames = [...new Set(activeSkillNamesForRun)];
    const forcedSkillRequests = [...new Set(oneShotSkillNames)];
    const forcedAgentRequests = oneShotAgentNames.map((agentName) => ({
      agentName,
      task: userMessage || "Please analyze the attached files.",
    }));
    let forcedAgentResultPrompt = "";

    const appendToolCallsToVariant = (toolCalls: ChatToolCall[]) => {
      const contextToolCalls = coalesceTaskToolCallsForContext(toolCalls);
      toolCallsForContext = [...toolCallsForContext, ...contextToolCalls];

      const toolBatchId = toolCalls.length > 1 ? createId() : undefined;
      if (toolBatchId) {
        for (const toolCall of toolCalls) {
          toolBatchIdsByToolCallId.set(toolCall.id, toolBatchId);
        }
      }

      const toolSteps: ChatAssistantProcessStep[] = [];

      for (const toolCall of toolCalls) {
        if (toolCall.function.name === CALL_AGENT_TOOL_NAME) {
          // Q2=B: show the call_agent invocation as its own tool block ("I
          // called an agent"), grouped with the agent block that follows.
          // Ensure both share a batch id so they render as one group even
          // when call_agent is the only tool call this round.
          const agentGroupId =
            toolBatchIdsByToolCallId.get(toolCall.id) ?? createId();
          toolBatchIdsByToolCallId.set(toolCall.id, agentGroupId);
          toolSteps.push({
            id: createId(),
            type: "tool_execution" as const,
            toolBatchId: agentGroupId,
            // Status (i): completed on successful dispatch. Marked complete
            // immediately since reaching this point means the call is being
            // dispatched; the agent's own lifecycle is shown by the agent
            // block. Errors in dispatch surface via the agent block.
            status: "complete" as const,
            toolCall,
            toolResult: {
              toolCallId: toolCall.id,
              toolName: CALL_AGENT_TOOL_NAME,
              content: "Agent dispatched.",
              isError: false,
            },
          });
          continue;
        }


        if (toolCall.function.name === ASK_USER_TOOL_NAME) {
          try {
            toolSteps.push({
              id: createId(),
              type: "user_input" as const,
              toolBatchId,
              status: "waiting" as const,
              toolCall,
              request: parseAskUserRequestFromToolCall(toolCall),
            });
            continue;
          } catch {
            // Keep invalid ask_user calls visible as failed tool executions once
            // executeToolCall returns the validation error.
          }
        }

        const tool = availableToolsByName.get(toolCall.function.name);
        if (requiresToolApproval(toolCall.function.name, tool)) {
          const autoApproval = getChatFileToolAutoApproval(chatId);
          const autoApproved =
            requiresFileToolApproval(toolCall.function.name) &&
            isFileToolCallAutoApproved(
              toolCall.function.name,
              autoApproval,
            );

          try {
            const approvalGroupId = !autoApproved
              ? (toolBatchId ?? createId())
              : toolBatchId;

            if (approvalGroupId) {
              toolBatchIdsByToolCallId.set(toolCall.id, approvalGroupId);
            }

            if (!autoApproved) {
              toolSteps.push({
                id: createId(),
                type: "approval" as const,
                toolBatchId: approvalGroupId,
                status: "waiting" as const,
                toolCall,
                request: requiresFileToolApproval(toolCall.function.name)
                  ? parseFileToolApprovalRequestFromToolCall(
                      toolCall,
                      getEffectiveWorkspaceRootsForChat(
                        getCurrentChatSnapshot(chatId),
                        currentActiveSkillNames,
                      ),
                    )
                  : createToolApprovalRequest(toolCall, tool),
              });
            }

            toolSteps.push({
              id: createId(),
              type: "tool_execution" as const,
              toolBatchId: approvalGroupId,
              status: "pending" as const,
              toolCall,
            });
            continue;
          } catch {
            // Keep invalid approval calls visible as failed tool executions once
            // executeToolCall returns the validation error.
          }
        }

        toolSteps.push({
          id: createId(),
          type: "tool_execution" as const,
          toolBatchId,
          status: "pending" as const,
          toolCall,
        });
      }

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => ({
          ...variant,
          toolCalls: [...(variant.toolCalls ?? []), ...contextToolCalls],
          processSteps: [
            ...(variant.processSteps ?? []).filter(
              (step) => step.type !== "tool_building",
            ),
            ...toolSteps,
          ],
        }),
        { touch: false },
      );

      return new Map(
        toolCalls.map((toolCall) => {
          const step = toolSteps.find(
            (item) => "toolCall" in item && item.toolCall.id === toolCall.id,
          );
          return [toolCall.id, step?.id ?? toolCall.id] as const;
        }),
      );
    };

    const applyToolResultToVisibleStep = (toolResult: ChatToolResult) => {
      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => ({
          ...variant,
          processSteps: (variant.processSteps ?? []).map(
            (step): ChatAssistantProcessStep => {
              if (
                step.type !== "tool_execution" &&
                step.type !== "agent_call" &&
                step.type !== "user_input" &&
                step.type !== "approval" &&
                step.type !== "file_approval" &&
                step.type !== "tasks"
              ) {
                return step;
              }

              if (step.toolCall.id !== toolResult.toolCallId) return step;

              // The call_agent tool step is completed on dispatch (status (i))
              // and must not be re-coupled to the agent's eventual result. The
              // agent's outcome is reflected on the sibling agent_call step.
              if (
                step.type === "tool_execution" &&
                step.toolCall.function.name === CALL_AGENT_TOOL_NAME
              ) {
                return step;
              }

              if (step.type === "agent_call") {
                return {
                  ...step,
                  status: toolResult.isError ? "failed" : "complete",
                };
              }

              if (step.type === "approval" || step.type === "file_approval") {
                return {
                  ...step,
                  toolResult,
                };
              }

              return {
                ...step,
                status: toolResult.isError ? "failed" : "complete",
                toolResult,
              };
            },
          ),
        }),
        { touch: false },
      );
    };

    const applyToolResultsToVariant = (
      toolResults: ChatToolResult[],
      toolCalls: ChatToolCall[],
    ) => {
      const contextToolResults = coalesceTaskToolResultsForContext(toolResults);
      toolResultsForContext = [...toolResultsForContext, ...contextToolResults];

      const finalTaskToolResult = getFinalTaskToolResult(toolResults);
      const finalTaskToolCall = finalTaskToolResult
        ? toolCalls.find((toolCall) => toolCall.id === finalTaskToolResult.toolCallId)
        : undefined;
      const taskBatchId = finalTaskToolResult
        ? toolBatchIdsByToolCallId.get(finalTaskToolResult.toolCallId)
        : undefined;

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => {
          const existingResults = variant.toolResults ?? [];
          const existingResultIds = new Set(
            existingResults.map((result) => result.toolCallId),
          );
          const newResults = contextToolResults.filter(
            (toolResult) => !existingResultIds.has(toolResult.toolCallId),
          );
          const processSteps = variant.processSteps ?? [];

          return {
            ...variant,
            toolResults: [...existingResults, ...newResults],
            processSteps: keepOnlyLatestTaskListStep(
              finalTaskToolResult &&
                shouldRenderTaskListStep(finalTaskToolResult) &&
                finalTaskToolCall
                ? [
                    ...processSteps.filter(
                      (step) =>
                        step.type !== "tasks" ||
                        step.toolCall.id !== finalTaskToolCall.id,
                    ),
                    {
                      id: createId(),
                      type: "tasks" as const,
                      toolBatchId: taskBatchId,
                      status: "complete" as const,
                      toolCall: finalTaskToolCall,
                      toolResult: finalTaskToolResult,
                    },
                  ]
                : processSteps,
            ),
          };
        },
        { touch: false },
      );
    };

    const bufferKey = getStreamBufferKey(chatId, assistantMessageId, variantId);

    const buildForcedAgentContextMessages = (): ChatMessage[] => {
      const content = forcedAgentResultPrompt.trim();
      if (!content) return [];

      const createdAt = new Date().toISOString();
      return [
        {
          id: createId(),
          role: "assistant",
          activeVariantIndex: 0,
          createdAt,
          variants: [
            {
              id: createId(),
              content,
              reasoning: "",
              status: "done",
              createdAt,
            },
          ],
        },
      ];
    };

    const buildContinuationMessages = (): ChatMessage[] => [
      ...contextMessages,
      {
        id: createId(),
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
        ...(userAttachments?.length ? { attachments: userAttachments } : {}),
      },
      ...buildForcedAgentContextMessages(),
      createContinuationAssistantMessage({
        assistantMessageId,
        variantId,
        accumulatedContent,
        accumulatedReasoning,
        accumulatedReasoningMetadata,
        toolCalls: toolCallsForContext,
        toolResults: toolResultsForContext,
      }),
    ];

    function runForcedSkills() {
      if (!forcedSkillRequests.length) return;

      const forcedSkillToolCalls = forcedSkillRequests.map((skillName) =>
        createSyntheticLoadSkillToolCall(skillName),
      );
      const forcedSkillToolResults = forcedSkillToolCalls.map((toolCall) => {
        try {
          const parsed = JSON.parse(toolCall.function.arguments || "{}");
          const skillName =
            parsed && typeof parsed.skillName === "string"
              ? parsed.skillName.trim()
              : "";
          return createLoadSkillMentionToolResult(toolCall, skillName);
        } catch (error) {
          return {
            toolCallId: toolCall.id,
            toolName: LOAD_SKILL_TOOL_NAME,
            content: labelForError(error),
            isError: true,
          } satisfies ChatToolResult;
        }
      });
      const forcedSkillBatchId =
        forcedSkillToolCalls.length > 1 ? createId() : undefined;

      toolCallsForContext = [...toolCallsForContext, ...forcedSkillToolCalls];
      toolResultsForContext = [
        ...toolResultsForContext,
        ...forcedSkillToolResults,
      ];

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => {
          const existingCallIds = new Set(
            (variant.toolCalls ?? []).map((toolCall) => toolCall.id),
          );
          const existingResultIds = new Set(
            (variant.toolResults ?? []).map((toolResult) => toolResult.toolCallId),
          );

          return {
            ...variant,
            toolCalls: [
              ...(variant.toolCalls ?? []),
              ...forcedSkillToolCalls.filter(
                (toolCall) => !existingCallIds.has(toolCall.id),
              ),
            ],
            toolResults: [
              ...(variant.toolResults ?? []),
              ...forcedSkillToolResults.filter(
                (toolResult) => !existingResultIds.has(toolResult.toolCallId),
              ),
            ],
            processSteps: [
              ...(variant.processSteps ?? []),
              ...forcedSkillToolCalls.map((toolCall, index) => ({
                id: createId(),
                type: "tool_execution" as const,
                toolBatchId: forcedSkillBatchId,
                status: forcedSkillToolResults[index]?.isError
                  ? ("failed" as const)
                  : ("complete" as const),
                toolCall,
                toolResult: forcedSkillToolResults[index],
              })),
            ],
          };
        },
        { touch: false },
      );

      if (chatId === activeChatId) {
        scheduleStickyScrollToBottom({ force: true, settleFrames: 5 });
      }
    }

    async function runForcedAgents() {
      if (!forcedAgentRequests.length) return;

      const forcedResults: ChatToolResult[] = [];
      for (const request of forcedAgentRequests) {
        const forcedToolCall = createSyntheticAgentToolCall(
          request.agentName,
          request.task,
        );
        const forcedAgentGroupId = createId();
        appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
          {
            id: createId(),
            type: "tool_execution" as const,
            toolBatchId: forcedAgentGroupId,
            status: "complete" as const,
            toolCall: forcedToolCall,
            toolResult: {
              toolCallId: forcedToolCall.id,
              toolName: CALL_AGENT_TOOL_NAME,
              content: "Agent dispatched.",
              isError: false,
            },
          },
        ]);
        const result = await runAgentCall({
          chatId,
          assistantMessageId,
          variantId,
          agentName: request.agentName,
          task: request.task,
          toolCall: forcedToolCall,
          toolBatchId: forcedAgentGroupId,
          depth: 1,
          parentProvider: providerForRun,
          signal: controller.signal,
          contextMessages: [
            ...contextMessages,
            {
              id: createId(),
              role: "user" as const,
              content: userMessage,
              createdAt: new Date().toISOString(),
              ...(userAttachments?.length
                ? { attachments: userAttachments }
                : {}),
            },
          ],
          userAttachments,
          inheritedToolsForRun: toolsForRun,
          inheritedActiveSkillNames: activeSkillNamesForRun,
        });
        const toolResult = {
          ...result.toolResult,
          toolCallId: forcedToolCall.id,
        };
        forcedResults.push(toolResult);
        applyToolResultToVisibleStep(toolResult);
        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({ force: true, settleFrames: 5 });
        }
      }

      forcedAgentResultPrompt = [
        "Completed agent results for the user's request:",
        ...forcedResults.map((result) => {
          let agentName = result.toolName;
          let output = result.content;

          try {
            const parsed = JSON.parse(result.content) as {
              agentName?: unknown;
              output?: unknown;
            };
            if (
              typeof parsed.agentName === "string" &&
              parsed.agentName.trim()
            ) {
              agentName = parsed.agentName.trim();
            }
            if (typeof parsed.output === "string") {
              output = parsed.output;
            }
          } catch {
            // Keep the raw tool result content.
          }

          const status = result.isError ? "failed" : "complete";
          return `\nAgent ${agentName} (${status}):\n${output}`;
        }),
      ].join("\n");
    }

    let runWasCancelled = false;

    try {
      runForcedSkills();
      await runForcedAgents();
      let currentMessages = forcedAgentRequests.length
        ? [
            ...contextMessages,
            {
              id: createId(),
              role: "user" as const,
              content: userMessage,
              createdAt: new Date().toISOString(),
              ...(userAttachments?.length ? { attachments: userAttachments } : {}),
            },
            ...buildForcedAgentContextMessages(),
          ]
        : contextMessages;
      let currentUserMessage: string | undefined = forcedAgentRequests.length
        ? "Use the completed agent result above to answer the user's original request. Do not call that same agent again unless the user explicitly asks for another agent pass."
        : userMessage;
      let lastStreamResult: StreamProviderChatResult | undefined;

      for (let toolRound = 0; toolRound <= MAX_TOOL_ROUNDS; toolRound += 1) {
        const chatSnapshot = getCurrentChatSnapshot(chatId);
        const currentToolsForRun = chatSnapshot
          ? mergeToolsByName(
              toolsForRun,
              getToolsForChat(chatSnapshot, [], currentActiveSkillNames),
            )
          : toolsForRun;
        const currentWorkspaceRoots = getEffectiveWorkspaceRootsForChat(
          chatSnapshot,
          currentActiveSkillNames,
        );

        const thinkingStepId = createId();
        appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
          {
            id: thinkingStepId,
            type: "thinking",
            content: "",
            status: "waiting",
          },
        ]);
        setActiveStreamProcessStep(bufferKey, {
          type: "thinking",
          id: thinkingStepId,
        });

        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({ settleFrames: 5 });
        }

        const streamResult = await streamProviderChat({
          provider: providerForRun,
          systemPrompt: composeSystemPrompt(
            getCurrentChatSnapshot(chatId),
            currentActiveSkillNames,
            forcedSkillRequests,
          ),
          messages: currentMessages,
          userMessage: currentUserMessage,
          userAttachments:
            toolRound === 0 && !forcedAgentRequests.length
              ? userAttachments
              : undefined,
          signal: controller.signal,
          tools: forcedAgentRequests.length
            ? currentToolsForRun.filter((tool) => tool.name !== CALL_AGENT_TOOL_NAME)
            : currentToolsForRun,
          settingsOverride: getChatThinkingSettings(chatId),
          onContentDelta: (delta) => {
            accumulatedContent += delta;
            const assistantMessageStepId = ensureAssistantMessageProcessStep(
              chatId,
              assistantMessageId,
              variantId,
              bufferKey,
            );
            appendBufferedAssistantVariant(
              chatId,
              assistantMessageId,
              variantId,
              {
                type: "content",
                delta,
                assistantMessageStepId,
              },
            );

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom();
            }
          },
          onReasoningDelta: (delta) => {
            accumulatedReasoning += delta;

            const activeStep = getActiveStreamProcessStep(bufferKey);
            const isWhitespaceOnlyReasoning = delta.trim().length === 0;

            // Some OpenAI-compatible providers emit whitespace-only reasoning
            // deltas in the middle of normal content streaming. Those invisible
            // reasoning chunks should not split one visible assistant answer into
            // multiple message blocks.
            if (isWhitespaceOnlyReasoning && activeStep?.type !== "thinking") {
              return;
            }

            const reasoningStepId = ensureThinkingProcessStep(
              chatId,
              assistantMessageId,
              variantId,
              bufferKey,
            );
            appendBufferedAssistantVariant(
              chatId,
              assistantMessageId,
              variantId,
              {
                type: "reasoning",
                delta,
                reasoningStepId,
              },
            );

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom();
            }
          },
          onToolCallDelta: (toolCalls) => {
            upsertToolBuildingProcessStep(
              chatId,
              assistantMessageId,
              variantId,
              bufferKey,
              toolCalls,
            );

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom({ settleFrames: 2 });
            }
          },
        });

        lastStreamResult = streamResult;
        accumulatedReasoningMetadata = mergeReasoningMetadata(
          accumulatedReasoningMetadata,
          streamResult.reasoningMetadata,
        );

        if (streamResult.reasoningMetadata) {
          updateAssistantVariant(
            chatId,
            assistantMessageId,
            variantId,
            (variant) => ({
              ...variant,
              reasoningMetadata: mergeReasoningMetadata(
                variant.reasoningMetadata,
                streamResult.reasoningMetadata,
              ),
            }),
            { touch: false },
          );
        }

        flushBufferedAssistantVariant(bufferKey);
        removeToolBuildingProcessSteps(chatId, assistantMessageId, variantId);

        const toolCalls = streamResult.toolCalls ?? [];
        if (!toolCalls.length) break;

        if (toolRound >= MAX_TOOL_ROUNDS) {
          throw new Error(
            `Stopped after ${MAX_TOOL_ROUNDS} tool rounds to avoid an infinite loop.`,
          );
        }

        const activeStepBeforeTools = getActiveStreamProcessStep(bufferKey);
        if (
          activeStepBeforeTools?.type === "thinking" &&
          activeStepBeforeTools.id
        ) {
          completeAssistantThinkingStep(
            chatId,
            assistantMessageId,
            variantId,
            activeStepBeforeTools.id,
          );
        }

        const toolStepIdsByToolCallId = appendToolCallsToVariant(toolCalls);
        setActiveStreamProcessStep(bufferKey, { type: "tool_execution" });

        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({ settleFrames: 5 });
        }

        const executeVisibleToolCall = async (toolCall: ChatToolCall) => {
          const toolResult =
            toolCall.function.name === CALL_AGENT_TOOL_NAME
              ? await (async () => {
                  try {
                    const request = parseCallAgentRequestFromToolCall(toolCall);
                    const agentResult = await runAgentCall({
                      chatId,
                      assistantMessageId,
                      variantId,
                      agentName: request.agentName,
                      task: request.task,
                      toolCall,
                      toolBatchId: toolBatchIdsByToolCallId.get(toolCall.id),
                      depth: 1,
                      parentProvider: providerForRun,
                      signal: controller.signal,
                      contextMessages: [
                        ...contextMessages,
                        {
                          id: createId(),
                          role: "user" as const,
                          content: userMessage,
                          createdAt: new Date().toISOString(),
                          ...(userAttachments?.length
                            ? { attachments: userAttachments }
                            : {}),
                        },
                      ],
                      userAttachments,
                      inheritedToolsForRun: currentToolsForRun,
                      inheritedActiveSkillNames: currentActiveSkillNames,
                    });
                    return {
                      ...agentResult.toolResult,
                      toolCallId: toolCall.id,
                    };
                  } catch (error) {
                    return createAgentToolResult({
                      toolCall,
                      agentName: "unknown",
                      output: labelForError(error),
                      isError: true,
                    });
                  }
                })()
              : await executeToolCall(toolCall, {
                  chatId,
                  assistantMessageId,
                  variantId,
                  stepId: toolStepIdsByToolCallId.get(toolCall.id) ?? toolCall.id,
                  signal: controller.signal,
                  activeSkillNames: currentActiveSkillNames,
                  workspaceRoots: currentWorkspaceRoots,
                  fileToolAutoApproval: getChatFileToolAutoApproval(chatId),
                });

          applyToolResultToVisibleStep(toolResult);

          if (chatId === activeChatId) {
            scheduleStickyScrollToBottom({ settleFrames: 5 });
          }

          return toolResult;
        };

        let taskQueue = Promise.resolve();
        const toolResults = await Promise.all(
          toolCalls.map((toolCall) => {
            if (!isTaskToolName(toolCall.function.name)) {
              return executeVisibleToolCall(toolCall);
            }

            const taskToolResultPromise = taskQueue.then(() =>
              executeVisibleToolCall(toolCall),
            );
            taskQueue = taskToolResultPromise.then(
              () => undefined,
              () => undefined,
            );
            return taskToolResultPromise;
          }),
        );
        applyToolResultsToVariant(toolResults, toolCalls);

        const loadedSkillNames = toolResults
          .map((toolResult) =>
            toolResult.toolName === LOAD_SKILL_TOOL_NAME && !toolResult.isError
              ? toolResult.loadedSkillName
              : undefined,
          )
          .filter((skillName): skillName is string => Boolean(skillName));
        if (loadedSkillNames.length > 0) {
          currentActiveSkillNames = [
            ...new Set([...currentActiveSkillNames, ...loadedSkillNames]),
          ];
        }

        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({ settleFrames: 5 });
        }

        currentMessages = buildContinuationMessages();
        currentUserMessage = undefined;
      }

      flushBufferedAssistantVariant(bufferKey);

      updateAssistantVariant(chatId, assistantMessageId, variantId, (variant) =>
        markAssistantVariantDone({
          variant: {
            ...variant,
            processSteps: (variant.processSteps ?? []).filter(
              (step) => step.type !== "tool_building",
            ),
          },
          responseStartedAtMs,
          provider: providerForRun,
          streamResult: lastStreamResult ?? {},
        }),
      );

      maybeGenerateAutomaticAiTitle({
        chatId,
        contextMessages,
        userMessage,
        assistantMessage: accumulatedContent,
        providerForRun,
      });
    } catch (error) {
      const wasAborted =
        error instanceof DOMException && error.name === "AbortError";

      flushBufferedAssistantVariant(bufferKey);

      if (wasAborted) {
        runWasCancelled = true;
        setVisualFlushRequests((current) => ({
          ...current,
          [assistantMessageId]: (current[assistantMessageId] ?? 0) + 1,
        }));
      }
      updateAssistantVariant(chatId, assistantMessageId, variantId, (variant) =>
        markAssistantVariantErrored({
          variant: {
            ...variant,
            processSteps: (variant.processSteps ?? []).filter(
              (step) => step.type !== "tool_building",
            ),
          },
          errorLabel: labelForError(error),
          wasAborted,
          responseStartedAtMs,
          provider: providerForRun,
        }),
      );
    } finally {
      delete streamActiveProcessStepRefs.current[bufferKey];
      delete streamBuffersRef.current[bufferKey];
      const currentGeneration = generationRefs.current[chatId];
      if (currentGeneration?.controller === controller) {
        delete generationRefs.current[chatId];
        setChatGenerating(chatId, false);
        onChatGenerationFinished?.(chatId, { wasCancelled: runWasCancelled });
        setStreamingAssistantByChatId((current) => {
          const { [chatId]: _removed, ...remaining } = current;
          return remaining;
        });
      }

      if (chatId === activeChatId) {
        if (autoScrollEnabledRef.current && !isStickyScrollSuppressed()) {
          scheduleStickyScrollToBottom({ force: true, settleFrames: 5 });
        } else {
          syncChatScrollState();
        }
      }
    }
  }

  async function sendMessage(content: string, attachments: ChatAttachment[] = []) {
    const userMessage = content.trim();

    if (!activeChat) return false;
    if (isChatGenerating(activeChat.id)) return false;

    const providerForRun = resolveProviderForActiveChat(activeChat);
    if (!validateProviderForRun(providerForRun)) return false;

    if (!userMessage && attachments.length === 0) {
      showError("Message is required.");
      return false;
    }

    const oneShotToolNames = validateToolMentions(userMessage);
    if (!oneShotToolNames) return false;

    const oneShotSkillNames = validateSkillMentions(userMessage);
    if (!oneShotSkillNames) return false;

    const oneShotAgentNames = validateAgentMentions(userMessage);
    if (!oneShotAgentNames) return false;

    const userMessageId = createId();
    const { chatForRun, attachmentsForRun } = await prepareChatWorkspaceForRun(
      activeChat,
      userMessageId,
      attachments,
    );

    const activeSkillNamesForRun = getActiveSkillNamesForRun(
      chatForRun,
      oneShotSkillNames,
    );
    const toolsForRun = getToolsForChat(
      chatForRun,
      oneShotToolNames,
      activeSkillNamesForRun,
    );

    const userChatMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
      ...(attachmentsForRun.length ? { attachments: attachmentsForRun } : {}),
    };

    const assistantMessageId = createId();
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();
    const assistantMessage = createStreamingAssistantMessage({
      assistantMessageId,
      variantId,
      responseStartedAt,
    });

    const contextMessages = chatForRun.messages;
    const nextMessages = [
      ...chatForRun.messages,
      userChatMessage,
      assistantMessage,
    ];

    armStickyScrollToBottom();
    updateChat(chatForRun.id, (chat) => ({
      ...chat,
      workspaceRoots: chatForRun.workspaceRoots,
      title:
        chat.messages.length === 0 && isAutoTitledChat(chat)
          ? titleFromMessage(userMessage || attachmentsForRun[0]?.name || "Attached files")
          : chat.title,
      titleMode:
        chat.messages.length === 0 && isAutoTitledChat(chat)
          ? "auto"
          : chat.titleMode,
      messages: nextMessages,
      activeSkillNames: activeSkillNamesForRun,
      updatedAt: responseStartedAt,
    }));

    void runAssistantVariant({
      chatId: chatForRun.id,
      contextMessages,
      userMessage,
      userAttachments: attachmentsForRun,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
      toolsForRun,
      activeSkillNamesForRun,
      oneShotSkillNames,
      oneShotAgentNames,
    });

    return true;
  }

  async function regenerateAssistantMessage(assistantMessageId: string) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const providerForRun = resolveProviderForActiveChat(activeChat);
    if (!validateProviderForRun(providerForRun)) return;

    const assistantIndex = activeChat.messages.findIndex(
      (message) =>
        message.id === assistantMessageId && message.role === "assistant",
    );
    if (assistantIndex < 0) return;

    let userIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (activeChat.messages[index]?.role === "user") {
        userIndex = index;
        break;
      }
    }

    const userMessageSource = activeChat.messages[userIndex];
    if (!userMessageSource || userMessageSource.role !== "user") {
      showError("Could not find the user message to regenerate from.");
      return;
    }

    const userMessage = userMessageSource.content;
    const userAttachments = userMessageSource.attachments ?? [];
    const oneShotToolNames = validateToolMentions(userMessage);
    if (!oneShotToolNames) return;

    const oneShotSkillNames = validateSkillMentions(userMessage);
    if (!oneShotSkillNames) return;

    const oneShotAgentNames = validateAgentMentions(userMessage);
    if (!oneShotAgentNames) return;

    const { chatForRun, attachmentsForRun } = await prepareChatWorkspaceForRun(
      activeChat,
      userMessageSource.id,
      userAttachments,
    );

    const contextMessages = chatForRun.messages.slice(0, userIndex);
    const retainedMessages = chatForRun.messages.slice(0, userIndex + 1);
    const discardedMessages = chatForRun.messages.slice(userIndex + 1);
    const activeSkillNamesForRun = pruneActiveSkillNamesForRegeneration({
      activeSkillNames: chatForRun.activeSkillNames ?? [],
      retainedMessages,
      discardedMessages,
      oneShotSkillNames,
    });
    const toolsForRun = getToolsForChat(
      chatForRun,
      oneShotToolNames,
      activeSkillNamesForRun,
    );
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();

    armStickyScrollToBottom();

    updateChat(chatForRun.id, (chat) => ({
      ...chat,
      workspaceRoots: chatForRun.workspaceRoots,
      messages: chat.messages.slice(0, assistantIndex + 1).map((message) => {
        if (message.id !== assistantMessageId || message.role !== "assistant") {
          return message;
        }

        return {
          ...message,
          variants: [
            ...message.variants,
            createStreamingAssistantVariant({ variantId, responseStartedAt }),
          ],
          activeVariantIndex: message.variants.length,
        };
      }),
      activeSkillNames: activeSkillNamesForRun,
      updatedAt: responseStartedAt,
    }));

    armStickyScrollToBottom();

    await runAssistantVariant({
      chatId: chatForRun.id,
      contextMessages,
      userMessage,
      userAttachments: attachmentsForRun,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
      toolsForRun,
      activeSkillNamesForRun,
      oneShotSkillNames,
      oneShotAgentNames,
    });
  }

  async function continueAssistantMessage(assistantMessageId: string) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const providerForRun = resolveProviderForActiveChat(activeChat);
    if (!validateProviderForRun(providerForRun)) return;

    const assistantIndex = activeChat.messages.findIndex(
      (message) =>
        message.id === assistantMessageId && message.role === "assistant",
    );
    const assistantMessageSource = activeChat.messages[assistantIndex];
    if (
      assistantIndex < 0 ||
      !assistantMessageSource ||
      assistantMessageSource.role !== "assistant"
    ) {
      showError("Could not find the assistant message to continue.");
      return;
    }

    const activeVariant =
      assistantMessageSource.variants[
        assistantMessageSource.activeVariantIndex
      ];
    if (!activeVariant?.content.trim()) {
      showError("Assistant message has no content to continue from.");
      return;
    }

    const { chatForRun } = await prepareChatWorkspaceForRun(
      activeChat,
      assistantMessageId,
      [],
    );
    const contextMessages = chatForRun.messages.slice(0, assistantIndex + 1);
    const discardedMessages = chatForRun.messages.slice(assistantIndex + 1);
    const activeSkillNamesForRun = pruneActiveSkillNamesForRegeneration({
      activeSkillNames: chatForRun.activeSkillNames ?? [],
      retainedMessages: contextMessages,
      discardedMessages,
      oneShotSkillNames: [],
    });
    const toolsForRun = getToolsForChat(chatForRun, [], activeSkillNamesForRun);
    const userMessage =
      "Continue generating from where the previous assistant message stopped. Do not repeat already generated content.";

    const nextAssistantMessageId = createId();
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();
    const assistantMessage = createStreamingAssistantMessage({
      assistantMessageId: nextAssistantMessageId,
      variantId,
      responseStartedAt,
    });

    armStickyScrollToBottom();

    updateChat(chatForRun.id, (chat) => ({
      ...chat,
      workspaceRoots: chatForRun.workspaceRoots,
      messages: [
        ...chat.messages.slice(0, assistantIndex + 1),
        assistantMessage,
      ],
      activeSkillNames: activeSkillNamesForRun,
      updatedAt: responseStartedAt,
    }));

    await runAssistantVariant({
      chatId: chatForRun.id,
      contextMessages,
      userMessage,
      assistantMessageId: nextAssistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
      toolsForRun,
      activeSkillNamesForRun,
    });
  }

  async function submitEditedUserMessage(
    messageId: string,
    editedContent: string,
    editedAttachments?: ChatAttachment[],
  ) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const providerForRun = resolveProviderForActiveChat(activeChat);
    if (!validateProviderForRun(providerForRun)) return;

    const userMessage = editedContent.trim();

    const oneShotToolNames = validateToolMentions(userMessage);
    if (!oneShotToolNames) return;

    const oneShotSkillNames = validateSkillMentions(userMessage);
    if (!oneShotSkillNames) return;

    const oneShotAgentNames = validateAgentMentions(userMessage);
    if (!oneShotAgentNames) return;

    const userIndex = activeChat.messages.findIndex(
      (message) => message.id === messageId && message.role === "user",
    );
    const currentMessage = activeChat.messages[userIndex];

    if (userIndex < 0 || !currentMessage || currentMessage.role !== "user") {
      showError("Could not find the message to edit.");
      return;
    }

    const finalAttachments = editedAttachments ?? currentMessage.attachments ?? [];
    if (!userMessage && finalAttachments.length === 0) {
      showError("Message is required.");
      return;
    }

    const { chatForRun, attachmentsForRun } = await prepareChatWorkspaceForRun(
      activeChat,
      currentMessage.id,
      finalAttachments,
    );

    const contextMessages = chatForRun.messages.slice(0, userIndex);
    const activeSkillNamesForRun = pruneActiveSkillNamesForRegeneration({
      activeSkillNames: chatForRun.activeSkillNames ?? [],
      retainedMessages: contextMessages,
      discardedMessages: chatForRun.messages.slice(userIndex + 1),
      oneShotSkillNames,
    });
    const toolsForRun = getToolsForChat(
      chatForRun,
      oneShotToolNames,
      activeSkillNamesForRun,
    );

    const assistantMessageId = createId();
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();
    const editedUserMessage: ChatMessage = {
      ...currentMessage,
      content: userMessage,
      ...(attachmentsForRun.length ? { attachments: attachmentsForRun } : { attachments: undefined }),
    };
    const assistantMessage = createStreamingAssistantMessage({
      assistantMessageId,
      variantId,
      responseStartedAt,
    });
    const nextMessages = [
      ...contextMessages,
      editedUserMessage,
      assistantMessage,
    ];

    armStickyScrollToBottom();
    setEditingMessageId(null);

    updateChat(chatForRun.id, (chat) => ({
      ...chat,
      workspaceRoots: chatForRun.workspaceRoots,
      title:
        userIndex === 0 && isAutoTitledChat(chat)
          ? titleFromMessage(userMessage || attachmentsForRun[0]?.name || "Attached files")
          : chat.title,
      titleMode:
        userIndex === 0 && isAutoTitledChat(chat) ? "auto" : chat.titleMode,
      messages: nextMessages,
      activeSkillNames: activeSkillNamesForRun,
      updatedAt: responseStartedAt,
    }));

    await runAssistantVariant({
      chatId: chatForRun.id,
      contextMessages,
      userMessage,
      userAttachments: attachmentsForRun,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
      toolsForRun,
      activeSkillNamesForRun,
      oneShotSkillNames,
      oneShotAgentNames,
    });
  }

  useEffect(() => {
    return () => {
      clearStreamFlushTimeouts(streamFlushTimeoutRefs);
      Object.values(generationRefs.current).forEach((generation) =>
        generation.controller.abort(),
      );
    };
  }, []);

  return {
    sendMessage,
    regenerateAssistantMessage,
    continueAssistantMessage,
    submitEditedUserMessage,
    selectAssistantVariant,
    stopChatGeneration,
    isChatGenerating,
    submitAskUserResponse,
    submitFileToolApprovalResponse,
    cancelAskUserRequest,
    canSubmitAskUserResponse,
  };
}
