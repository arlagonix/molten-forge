import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createId,
  getProviderFallbackModel,
  isAutoTitledChat,
  labelForError,
  mergeReasoningMetadata,
  titleFromMessage,
} from "@/lib/ai-chat/chat-utils";
import { generateTitleFromFirstExchange } from "@/lib/ai-chat/title-generation";
import {
  ASK_USER_TOOL_NAME,
  CHECKLIST_WRITE_TOOL_NAME,
  CALL_AGENT_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  createAgentToolResult,
  createCallAgentTool,
  createChecklistWriteToolResult,
  parseCallAgentRequestFromToolCall,
  parseAskUserRequestFromToolCall,
  parseChecklistWriteRequestFromToolCall,
  parseFileToolApprovalRequestFromToolCall,
  parseSkillMentionNames,
  requiresFileToolApproval,
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
  cancelUnfinishedChecklistListSteps,
  createContinuationAssistantMessage,
  createStreamingAssistantMessage,
  createStreamingAssistantVariant,
  getVisualFlushKeysForGeneration,
  keepOnlyLatestChecklistListStep,
  markAssistantVariantDone,
  markAssistantVariantErrored,
  type ActiveGeneration,
  type ActiveProcessStepRef,
} from "@/lib/ai-chat/generation-metadata";
import {
  buildSystemPromptWithActiveSkills,
  getEnabledAgentsForChat,
  getEnabledSkillsForChat,
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
  FileToolApprovalResponse,
  ChatAgentCall,
  ChatAssistantProcessStep,
  ChatAssistantVariant,
  ChatReasoningMetadata,
  ChatTitleGenerationMode,
  ChatMessage,
  ChatSession,
  ChatWorkspaceRoot,
  ChatToolCall,
  ChatToolResult,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  ProviderConfig,
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
    context?: { workspaceRoots?: ChatWorkspaceRoot[] },
  ) => Promise<ToolCommandResult>;
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
          step.id === stepId && step.type === "file_approval"
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
    response: FileToolApprovalResponse,
    toolResult: ChatToolResult,
  ) {
    updateAssistantVariant(
      chatId,
      assistantMessageId,
      variantId,
      (variant) => ({
        ...variant,
        processSteps: (variant.processSteps ?? []).map((step) =>
          step.id === stepId && step.type === "file_approval"
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
    workspaceRoots: activeChat?.workspaceRoots ?? [],
    modelSelectableSkillNames: activeChat
      ? getEnabledSkillsForChat({
          chat: activeChat,
          globalEnabledSkills,
          availableSkillsByName,
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
    const tools = getEnabledToolsForChat({
      chat,
      oneShotToolNames,
      globalEnabledTools,
      availableToolsByName,
    });
    const enabledAgentsForChat = getEnabledAgentsForChat({
      chat,
      globalEnabledAgents,
      availableAgentsByName,
    });

    const toolsWithAgentTool = (() => {
      const callAgentTool = createCallAgentTool(enabledAgentsForChat);
      return callAgentTool ? [...tools, callAgentTool] : tools;
    })();

    return getToolsWithLoadSkillTool({
      tools: toolsWithAgentTool,
      modelSelectableSkills: getEnabledSkillsForChat({
        chat,
        globalEnabledSkills,
        availableSkillsByName,
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

  function composeSystemPrompt(activeSkillNames: string[]) {
    return buildSystemPromptWithActiveSkills({
      systemPrompt,
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
        processSteps: keepOnlyLatestChecklistListStep(
          cancelUnfinishedChecklistListSteps(variant.processSteps ?? []),
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

  function updateAgentCallTree(
    calls: ChatAgentCall[],
    callId: string,
    updater: (agentCall: ChatAgentCall) => ChatAgentCall,
  ): ChatAgentCall[] {
    return calls.map((call) => {
      if (call.id === callId) return updater(call);
      return {
        ...call,
        childAgentCalls: updateAgentCallTree(
          call.childAgentCalls ?? [],
          callId,
          updater,
        ),
      };
    });
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
          if (step.agentCall.id === agentCallId) {
            const nextAgentCall = updater(step.agentCall);
            return {
              ...step,
              status: nextAgentCall.status,
              agentCall: nextAgentCall,
            };
          }
          return {
            ...step,
            agentCall: {
              ...step.agentCall,
              childAgentCalls: updateAgentCallTree(
                step.agentCall.childAgentCalls ?? [],
                agentCallId,
                updater,
              ),
            },
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
    childAgentCall,
  }: {
    chatId: string;
    assistantMessageId: string;
    variantId: string;
    parentAgentCallId: string;
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
  }: {
    chatId: string;
    assistantMessageId: string;
    variantId: string;
    toolCall: ChatToolCall;
    agentCall: ChatAgentCall;
  }) {
    appendAssistantProcessSteps(chatId, assistantMessageId, variantId, [
      {
        id: createId(),
        type: "agent_call",
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

  function createAgentSystemPrompt(agent: LoadedAgentInfo) {
    const basePrompt = [
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
      activeSkillNames: agent.loadedSkillNames ?? [],
      availableSkillsByName,
    });
  }

  function getAgentTools(agent: LoadedAgentInfo, depth: number) {
    const allowedToolNames = new Set(agent.allowedToolNames ?? []);
    const tools = [...allowedToolNames]
      .map((toolName) => availableToolsByName.get(toolName))
      .filter((tool): tool is LoadedToolInfo => {
        if (!tool) return false;
        return tool.enabled && tool.name !== CALL_AGENT_TOOL_NAME;
      });

    const allowedAgentNames = new Set(agent.allowedAgentNames ?? []);
    const nextAgents = globalEnabledAgents.filter(
      (candidate) =>
        candidate.name !== agent.name && allowedAgentNames.has(candidate.name),
    );
    const canCallAllowedAgents =
      agentsSettings.enabled && depth < Math.max(1, agent.maxNestingDepth ?? 2);
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
    depth,
    parentAgentCallId,
    parentProvider,
    maxAllowedDepth,
    signal,
    contextMessages,
    userMessage,
  }: {
    chatId: string;
    assistantMessageId: string;
    variantId: string;
    agentName: string;
    task: string;
    toolCall?: ChatToolCall;
    depth: number;
    parentAgentCallId?: string;
    parentProvider: ProviderConfig;
    maxAllowedDepth?: number;
    signal: AbortSignal;
    contextMessages: ChatMessage[];
    userMessage: string;
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
      const content = `Agent nesting depth exceeded (${maxAllowedDepth}).`;
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
        childAgentCall: agentCall,
      });
    } else {
      appendTopLevelAgentCallStep({
        chatId,
        assistantMessageId,
        variantId,
        toolCall: visibleToolCall,
        agentCall,
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
    const transcriptMessages = [
      {
        id: createId(),
        role: "system" as const,
        content: createAgentSystemPrompt(agent),
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
    let toolCallsForContext: ChatToolCall[] = [];
    let toolResultsForContext: ChatToolResult[] = [];
    const agentContextMessages =
      agent.contextMode === "full_chat"
        ? [
            ...contextMessages,
            {
              id: createId(),
              role: "user" as const,
              content: userMessage,
              createdAt: new Date().toISOString(),
            },
          ]
        : [];
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
      },
    ];
    let currentMessages = agentContextMessages;
    let currentUserMessage: string | undefined = delegatedTaskMessage;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        const result = await streamProviderChat({
          provider,
          systemPrompt: createAgentSystemPrompt(agent),
          messages: currentMessages,
          userMessage: currentUserMessage,
          signal,
          tools: getAgentTools(agent, depth),
          onContentDelta: (delta) => {
            accumulatedOutput += delta;
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

        const toolCalls = result.toolCalls ?? [];
        toolCallsForContext = [...toolCallsForContext, ...toolCalls];
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

        const toolResults = await Promise.all(
          toolCalls.map(async (childToolCall) => {
            if (childToolCall.function.name === CALL_AGENT_TOOL_NAME) {
              try {
                const request =
                  parseCallAgentRequestFromToolCall(childToolCall);
                const child = await runAgentCall({
                  chatId,
                  assistantMessageId,
                  variantId,
                  agentName: request.agentName,
                  task: request.task,
                  toolCall: childToolCall,
                  depth: depth + 1,
                  parentAgentCallId: agentCall.id,
                  parentProvider: provider,
                  maxAllowedDepth: agent.maxNestingDepth,
                  signal,
                  contextMessages,
                  userMessage,
                });
                return {
                  ...child.toolResult,
                  toolCallId: childToolCall.id,
                };
              } catch (error) {
                return createAgentToolResult({
                  toolCall: childToolCall,
                  agentName,
                  output: labelForError(error),
                  isError: true,
                });
              }
            }

            try {
              if (childToolCall.function.name === ASK_USER_TOOL_NAME) {
                return {
                  toolCallId: childToolCall.id,
                  toolName: ASK_USER_TOOL_NAME,
                  content:
                    "ask_user is not supported inside agent calls. Return the best result you can without asking the user directly.",
                  isError: true,
                } satisfies ChatToolResult;
              }

              if (childToolCall.function.name === CHECKLIST_WRITE_TOOL_NAME) {
                return createChecklistWriteToolResult(
                  childToolCall,
                  parseChecklistWriteRequestFromToolCall(childToolCall),
                );
              }

              const childWorkspaceRoots =
                chats.find((chat) => chat.id === chatId)?.workspaceRoots ?? [];

              if (requiresFileToolApproval(childToolCall.function.name)) {
                const approvalStepId = createId();
                appendAssistantProcessSteps(
                  chatId,
                  assistantMessageId,
                  variantId,
                  [
                    {
                      id: approvalStepId,
                      type: "file_approval" as const,
                      status: "waiting" as const,
                      toolCall: childToolCall,
                      request: parseFileToolApprovalRequestFromToolCall(
                        childToolCall,
                        childWorkspaceRoots,
                      ),
                    },
                  ],
                );

                return await executeToolCall(childToolCall, {
                  chatId,
                  assistantMessageId,
                  variantId,
                  stepId: approvalStepId,
                  signal,
                  activeSkillNames: agent.loadedSkillNames ?? [],
                  workspaceRoots: childWorkspaceRoots,
                });
              }

              const args = childToolCall.function.arguments.trim()
                ? JSON.parse(childToolCall.function.arguments)
                : {};
              const execution = await executeExternalTool(
                childToolCall.function.name,
                args,
                { workspaceRoots: childWorkspaceRoots },
              );
              return {
                toolCallId: childToolCall.id,
                toolName: childToolCall.function.name,
                content: execution.content,
                isError: execution.exitCode !== 0 || execution.timedOut,
                execution: execution.execution,
              } satisfies ChatToolResult;
            } catch (error) {
              return {
                toolCallId: childToolCall.id,
                toolName: childToolCall.function.name,
                content: labelForError(error),
                isError: true,
              } satisfies ChatToolResult;
            }
          }),
        );

        toolResultsForContext = [...toolResultsForContext, ...toolResults];
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
            accumulatedReasoningMetadata: undefined,
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

  async function runAssistantVariant({
    chatId,
    contextMessages,
    userMessage,
    assistantMessageId,
    variantId,
    responseStartedAtMs,
    providerForRun,
    toolsForRun,
    activeSkillNamesForRun,
    oneShotAgentNames = [],
  }: {
    chatId: string;
    contextMessages: ChatMessage[];
    userMessage: string;
    assistantMessageId: string;
    variantId: string;
    responseStartedAtMs: number;
    providerForRun: ProviderConfig;
    toolsForRun: LoadedToolInfo[];
    activeSkillNamesForRun: string[];
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
    let accumulatedContent = "";
    let accumulatedReasoning = "";
    let accumulatedReasoningMetadata: ChatReasoningMetadata | undefined;
    let currentActiveSkillNames = [...new Set(activeSkillNamesForRun)];
    const forcedAgentRequests = oneShotAgentNames.map((agentName) => ({
      agentName,
      task: userMessage,
    }));
    let forcedAgentResultPrompt = "";

    const appendToolCallsToVariant = (toolCalls: ChatToolCall[]) => {
      toolCallsForContext = [...toolCallsForContext, ...toolCalls];
      const toolSteps: ChatAssistantProcessStep[] = [];

      for (const toolCall of toolCalls) {
        if (toolCall.function.name === CALL_AGENT_TOOL_NAME) {
          continue;
        }

        if (toolCall.function.name === ASK_USER_TOOL_NAME) {
          try {
            toolSteps.push({
              id: createId(),
              type: "user_input" as const,
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

        if (requiresFileToolApproval(toolCall.function.name)) {
          try {
            toolSteps.push({
              id: createId(),
              type: "file_approval" as const,
              status: "waiting" as const,
              toolCall,
              request: parseFileToolApprovalRequestFromToolCall(
                toolCall,
                chats.find((chat) => chat.id === chatId)?.workspaceRoots ?? [],
              ),
            });
            continue;
          } catch {
            // Keep invalid file approval calls visible as failed tool executions once
            // executeToolCall returns the validation error.
          }
        }

        if (toolCall.function.name === CHECKLIST_WRITE_TOOL_NAME) {
          try {
            toolSteps.push({
              id: createId(),
              type: "checklist" as const,
              status: "pending" as const,
              toolCall,
              request: parseChecklistWriteRequestFromToolCall(toolCall),
            });
            continue;
          } catch {
            // Keep invalid checklist_write calls visible as failed tool executions once
            // executeToolCall returns the validation error.
          }
        }

        toolSteps.push({
          id: createId(),
          type: "tool_execution" as const,
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
          toolCalls: [...(variant.toolCalls ?? []), ...toolCalls],
          processSteps: [...(variant.processSteps ?? []), ...toolSteps],
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
          processSteps: keepOnlyLatestChecklistListStep(
            (variant.processSteps ?? []).map((step) => {
              if (
                step.type !== "tool_execution" &&
                step.type !== "agent_call" &&
                step.type !== "user_input" &&
                step.type !== "file_approval" &&
                step.type !== "checklist"
              ) {
                return step;
              }

              if (step.toolCall.id !== toolResult.toolCallId) return step;

              if (step.type === "agent_call") {
                return {
                  ...step,
                  status: toolResult.isError ? "failed" : "complete",
                };
              }

              return {
                ...step,
                status: toolResult.isError ? "failed" : "complete",
                toolResult,
              };
            }),
          ),
        }),
        { touch: false },
      );
    };

    const applyToolResultsToVariant = (toolResults: ChatToolResult[]) => {
      toolResultsForContext = [...toolResultsForContext, ...toolResults];

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) => {
          const existingResults = variant.toolResults ?? [];
          const existingResultIds = new Set(
            existingResults.map((result) => result.toolCallId),
          );
          const newResults = toolResults.filter(
            (toolResult) => !existingResultIds.has(toolResult.toolCallId),
          );

          return {
            ...variant,
            toolResults: [...existingResults, ...newResults],
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

    async function runForcedAgents() {
      if (!forcedAgentRequests.length) return;

      const forcedResults: ChatToolResult[] = [];
      for (const request of forcedAgentRequests) {
        const forcedToolCall = createSyntheticAgentToolCall(
          request.agentName,
          request.task,
        );
        const result = await runAgentCall({
          chatId,
          assistantMessageId,
          variantId,
          agentName: request.agentName,
          task: request.task,
          toolCall: forcedToolCall,
          depth: 1,
          parentProvider: providerForRun,
          signal: controller.signal,
          contextMessages,
          userMessage,
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

    try {
      await runForcedAgents();
      let currentMessages = forcedAgentRequests.length
        ? [
            ...contextMessages,
            {
              id: createId(),
              role: "user" as const,
              content: userMessage,
              createdAt: new Date().toISOString(),
            },
            ...buildForcedAgentContextMessages(),
          ]
        : contextMessages;
      let currentUserMessage: string | undefined = forcedAgentRequests.length
        ? "Use the completed agent result above to answer the user's original request. Do not call that same agent again unless the user explicitly asks for another agent pass."
        : userMessage;
      let lastStreamResult: StreamProviderChatResult | undefined;

      for (let toolRound = 0; toolRound <= MAX_TOOL_ROUNDS; toolRound += 1) {
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
          systemPrompt: composeSystemPrompt(currentActiveSkillNames),
          messages: currentMessages,
          userMessage: currentUserMessage,
          signal: controller.signal,
          tools: forcedAgentRequests.length
            ? toolsForRun.filter((tool) => tool.name !== CALL_AGENT_TOOL_NAME)
            : toolsForRun,
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
          scheduleStickyScrollToBottom({ force: true, settleFrames: 5 });
        }

        const toolResults = await Promise.all(
          toolCalls.map(async (toolCall) => {
            const toolResult =
              toolCall.function.name === CALL_AGENT_TOOL_NAME
                ? await (async () => {
                    try {
                      const request =
                        parseCallAgentRequestFromToolCall(toolCall);
                      const agentResult = await runAgentCall({
                        chatId,
                        assistantMessageId,
                        variantId,
                        agentName: request.agentName,
                        task: request.task,
                        toolCall,
                        depth: 1,
                        parentProvider: providerForRun,
                        signal: controller.signal,
                        contextMessages,
                        userMessage,
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
                    stepId:
                      toolStepIdsByToolCallId.get(toolCall.id) ?? toolCall.id,
                    signal: controller.signal,
                    activeSkillNames: currentActiveSkillNames,
                  });

            applyToolResultToVisibleStep(toolResult);

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom({ force: true, settleFrames: 5 });
            }

            return toolResult;
          }),
        );
        applyToolResultsToVariant(toolResults);

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
          scheduleStickyScrollToBottom({ force: true, settleFrames: 5 });
        }

        currentMessages = buildContinuationMessages();
        currentUserMessage = undefined;
      }

      flushBufferedAssistantVariant(bufferKey);

      updateAssistantVariant(chatId, assistantMessageId, variantId, (variant) =>
        markAssistantVariantDone({
          variant,
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
        setVisualFlushRequests((current) => ({
          ...current,
          [assistantMessageId]: (current[assistantMessageId] ?? 0) + 1,
        }));
      }
      updateAssistantVariant(chatId, assistantMessageId, variantId, (variant) =>
        markAssistantVariantErrored({
          variant,
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

  async function sendMessage(content: string) {
    const userMessage = content.trim();

    if (!activeChat) return false;
    if (isChatGenerating(activeChat.id)) return false;

    const providerForRun = resolveProviderForActiveChat(activeChat);
    if (!validateProviderForRun(providerForRun)) return false;

    if (!userMessage) {
      showError("Message is required.");
      return false;
    }

    const oneShotToolNames = validateToolMentions(userMessage);
    if (!oneShotToolNames) return false;

    const oneShotSkillNames = validateSkillMentions(userMessage);
    if (!oneShotSkillNames) return false;

    const oneShotAgentNames = validateAgentMentions(userMessage);
    if (!oneShotAgentNames) return false;

    const activeSkillNamesForRun = getActiveSkillNamesForRun(
      activeChat,
      oneShotSkillNames,
    );
    const toolsForRun = getToolsForChat(
      activeChat,
      oneShotToolNames,
      activeSkillNamesForRun,
    );

    const userChatMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
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

    const contextMessages = activeChat.messages;
    const nextMessages = [
      ...activeChat.messages,
      userChatMessage,
      assistantMessage,
    ];

    armStickyScrollToBottom();
    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title:
        chat.messages.length === 0 && isAutoTitledChat(chat)
          ? titleFromMessage(userMessage)
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
      chatId: activeChat.id,
      contextMessages,
      userMessage,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
      toolsForRun,
      activeSkillNamesForRun,
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
    const oneShotToolNames = validateToolMentions(userMessage);
    if (!oneShotToolNames) return;

    const oneShotSkillNames = validateSkillMentions(userMessage);
    if (!oneShotSkillNames) return;

    const oneShotAgentNames = validateAgentMentions(userMessage);
    if (!oneShotAgentNames) return;

    const contextMessages = activeChat.messages.slice(0, userIndex);
    const retainedMessages = activeChat.messages.slice(0, userIndex + 1);
    const discardedMessages = activeChat.messages.slice(userIndex + 1);
    const activeSkillNamesForRun = pruneActiveSkillNamesForRegeneration({
      activeSkillNames: activeChat.activeSkillNames ?? [],
      retainedMessages,
      discardedMessages,
      oneShotSkillNames,
    });
    const toolsForRun = getToolsForChat(
      activeChat,
      oneShotToolNames,
      activeSkillNamesForRun,
    );
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();

    armStickyScrollToBottom();

    updateChat(activeChat.id, (chat) => ({
      ...chat,
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
      chatId: activeChat.id,
      contextMessages,
      userMessage,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
      toolsForRun,
      activeSkillNamesForRun,
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

    const contextMessages = activeChat.messages.slice(0, assistantIndex + 1);
    const discardedMessages = activeChat.messages.slice(assistantIndex + 1);
    const activeSkillNamesForRun = pruneActiveSkillNamesForRegeneration({
      activeSkillNames: activeChat.activeSkillNames ?? [],
      retainedMessages: contextMessages,
      discardedMessages,
      oneShotSkillNames: [],
    });
    const toolsForRun = getToolsForChat(activeChat, [], activeSkillNamesForRun);
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

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      messages: [
        ...chat.messages.slice(0, assistantIndex + 1),
        assistantMessage,
      ],
      activeSkillNames: activeSkillNamesForRun,
      updatedAt: responseStartedAt,
    }));

    await runAssistantVariant({
      chatId: activeChat.id,
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
  ) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const providerForRun = resolveProviderForActiveChat(activeChat);
    if (!validateProviderForRun(providerForRun)) return;

    const userMessage = editedContent.trim();
    if (!userMessage) {
      showError("Message is required.");
      return;
    }

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

    const contextMessages = activeChat.messages.slice(0, userIndex);
    const activeSkillNamesForRun = pruneActiveSkillNamesForRegeneration({
      activeSkillNames: activeChat.activeSkillNames ?? [],
      retainedMessages: contextMessages,
      discardedMessages: activeChat.messages.slice(userIndex + 1),
      oneShotSkillNames,
    });
    const toolsForRun = getToolsForChat(
      activeChat,
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

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title:
        userIndex === 0 && isAutoTitledChat(chat)
          ? titleFromMessage(userMessage)
          : chat.title,
      titleMode:
        userIndex === 0 && isAutoTitledChat(chat) ? "auto" : chat.titleMode,
      messages: nextMessages,
      activeSkillNames: activeSkillNamesForRun,
      updatedAt: responseStartedAt,
    }));

    await runAssistantVariant({
      chatId: activeChat.id,
      contextMessages,
      userMessage,
      assistantMessageId,
      variantId,
      responseStartedAtMs,
      providerForRun,
      toolsForRun,
      activeSkillNamesForRun,
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
