import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createId,
  isAutoTitledChat,
  labelForError,
  mergeReasoningMetadata,
  titleFromMessage,
} from "@/lib/ai-chat/chat-utils";
import { generateTitleFromFirstExchange } from "@/lib/ai-chat/title-generation";
import {
  ASK_USER_TOOL_NAME,
  CHECKLIST_WRITE_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  parseAskUserRequestFromToolCall,
  parseChecklistWriteRequestFromToolCall,
  parseSkillMentionNames,
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
  getEnabledSkillsForChat,
  getEnabledToolsForChat,
  getGlobalEnabledSkills,
  getGlobalEnabledTools,
  getToolsWithLoadSkillTool,
  resolveProviderForChat,
  validateProviderForGeneration,
  validateSkillMentionsForRequest,
  validateToolMentionsForRequest,
} from "@/lib/ai-chat/request-builder";
import type {
  AskUserResponse,
  ChatAssistantProcessStep,
  ChatAssistantVariant,
  ChatReasoningMetadata,
  ChatTitleGenerationMode,
  ChatMessage,
  ChatSession,
  ChatToolCall,
  ChatToolResult,
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
  chatTitleGenerationMode,
  loadedTools,
  availableToolsByName,
  loadedSkills,
  availableSkillsByName,
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
  chatTitleGenerationMode: ChatTitleGenerationMode;
  loadedTools: LoadedToolInfo[];
  availableToolsByName: Map<string, LoadedToolInfo>;
  loadedSkills: LoadedSkillInfo[];
  availableSkillsByName: Map<string, LoadedSkillInfo>;
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

  function abortChatGeneration(chatId: string) {
    generationRefs.current[chatId]?.controller.abort();
  }

  const {
    executeToolCall,
    submitAskUserResponse,
    cancelAskUserRequest,
    canSubmitAskUserResponse,
  } = useToolExecution({
    activeChatId,
    loadedTools,
    availableSkillsByName,
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
    updateAssistantToolStepStatus,
    updateAssistantUserInputStepStatus,
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

    return getToolsWithLoadSkillTool({
      tools,
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

    const appendToolCallsToVariant = (toolCalls: ChatToolCall[]) => {
      toolCallsForContext = [...toolCallsForContext, ...toolCalls];
      const toolSteps: ChatAssistantProcessStep[] = toolCalls.map(
        (toolCall) => {
          if (toolCall.function.name === ASK_USER_TOOL_NAME) {
            try {
              return {
                id: createId(),
                type: "user_input" as const,
                status: "waiting" as const,
                toolCall,
                request: parseAskUserRequestFromToolCall(toolCall),
              };
            } catch {
              // Keep invalid ask_user calls visible as failed tool executions once
              // executeToolCall returns the validation error.
            }
          }

          if (toolCall.function.name === CHECKLIST_WRITE_TOOL_NAME) {
            try {
              return {
                id: createId(),
                type: "checklist" as const,
                status: "pending" as const,
                toolCall,
                request: parseChecklistWriteRequestFromToolCall(toolCall),
              };
            } catch {
              // Keep invalid checklist_write calls visible as failed tool executions once
              // executeToolCall returns the validation error.
            }
          }

          return {
            id: createId(),
            type: "tool_execution" as const,
            status: "pending" as const,
            toolCall,
          };
        },
      );

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
        toolCalls.map(
          (toolCall, index) =>
            [toolCall.id, toolSteps[index]?.id ?? toolCall.id] as const,
        ),
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
                step.type !== "user_input" &&
                step.type !== "checklist"
              ) {
                return step;
              }

              if (step.toolCall.id !== toolResult.toolCallId) return step;

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

    const buildContinuationMessages = (): ChatMessage[] => [
      ...contextMessages,
      {
        id: createId(),
        role: "user",
        content: userMessage,
        createdAt: new Date().toISOString(),
      },
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

    try {
      let currentMessages = contextMessages;
      let currentUserMessage: string | undefined = userMessage;
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
          tools: toolsForRun,
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
            const toolResult = await executeToolCall(toolCall, {
              chatId,
              assistantMessageId,
              variantId,
              stepId: toolStepIdsByToolCallId.get(toolCall.id) ?? toolCall.id,
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
      providerId: providerForRun.id,
      model: providerForRun.model,
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
      providerId: providerForRun.id,
      model: providerForRun.model,
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
      providerId: providerForRun.id,
      model: providerForRun.model,
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
      providerId: providerForRun.id,
      model: providerForRun.model,
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
    cancelAskUserRequest,
    canSubmitAskUserResponse,
  };
}
