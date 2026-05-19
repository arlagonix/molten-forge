import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createId,
  labelForError,
  titleFromMessage,
} from "@/lib/ai-chat/chat-utils";
import {
  ASK_USER_TOOL_NAME,
  CHECKLIST_WRITE_TOOL_NAME,
  parseAskUserRequestFromToolCall,
  parseChecklistWriteRequestFromToolCall,
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
  getEnabledToolsForChat,
  getGlobalEnabledTools,
  resolveProviderForChat,
  validateProviderForGeneration,
  validateToolMentionsForRequest,
} from "@/lib/ai-chat/request-builder";
import type {
  AskUserResponse,
  ChatAssistantProcessStep,
  ChatAssistantVariant,
  ChatMessage,
  ChatSession,
  ChatToolCall,
  ChatToolResult,
  LoadedToolInfo,
  ProviderConfig,
  ToolCommandResult,
  ToolExecutionStatus,
  ToolsSettings,
  UserInputStatus,
} from "@/lib/ai-chat/types";
import { useToolExecution } from "@/hooks/use-tool-execution";

const MAX_TOOL_ROUNDS = 20;

export function useChatGeneration({
  activeChat,
  activeChatId,
  activeProvider,
  providers,
  chats,
  systemPrompt,
  toolsSettings,
  loadedTools,
  availableToolsByName,
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
  loadedTools: LoadedToolInfo[];
  availableToolsByName: Map<string, LoadedToolInfo>;
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
  const [, setStreamingAssistantByChatId] = useState<Record<string, string>>({});
  const generationRefs = useRef<Record<string, ActiveGeneration>>({});
  const streamBuffersRef = useRef<Record<string, StreamBuffer>>({});
  const streamActiveProcessStepRefs = useRef<Record<string, ActiveProcessStepRef>>({});
  const streamFlushTimeoutRefs = useRef<Record<string, number>>({});

  const globalEnabledTools = useMemo(
    () => getGlobalEnabledTools({ toolsSettings, loadedTools }),
    [toolsSettings, loadedTools],
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
            if (message.id !== assistantMessageId || message.role !== "assistant") {
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
      appendToAssistantVariant: (chatId, assistantMessageId, variantId, events) =>
        appendToAssistantVariant(chatId, assistantMessageId, variantId, events, {
          transition: false,
        }),
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
          if (message.id !== assistantMessageId || message.role !== "assistant") {
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
      { id: thinkingStepId, type: "thinking", content: "" },
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
    return Boolean(generationRefs.current[chatId]) || generatingChatIds.includes(chatId);
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

  function resolveProviderForActiveChat(chat: ChatSession) {
    return resolveProviderForChat({ chat, providers, activeProvider });
  }

  function getToolsForChat(chat: ChatSession, oneShotToolNames: string[] = []) {
    return getEnabledToolsForChat({
      chat,
      oneShotToolNames,
      globalEnabledTools,
      availableToolsByName,
    });
  }

  function stopChatGeneration(chatId: string) {
    const generation = generationRefs.current[chatId];
    if (!generation) return;

    flushBufferedAssistantVariant(
      getStreamBufferKey(chatId, generation.assistantMessageId, generation.variantId),
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
  }: {
    chatId: string;
    contextMessages: ChatMessage[];
    userMessage: string;
    assistantMessageId: string;
    variantId: string;
    responseStartedAtMs: number;
    providerForRun: ProviderConfig;
    toolsForRun: LoadedToolInfo[];
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

    const appendToolCallsToVariant = (toolCalls: ChatToolCall[]) => {
      toolCallsForContext = [...toolCallsForContext, ...toolCalls];
      const toolSteps: ChatAssistantProcessStep[] = toolCalls.map((toolCall) => {
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
      });

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
          (toolCall, index) => [toolCall.id, toolSteps[index]?.id ?? toolCall.id] as const,
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
          { id: thinkingStepId, type: "thinking", content: "" },
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
          systemPrompt,
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
            appendBufferedAssistantVariant(chatId, assistantMessageId, variantId, {
              type: "content",
              delta,
              assistantMessageStepId,
            });

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
            appendBufferedAssistantVariant(chatId, assistantMessageId, variantId, {
              type: "reasoning",
              delta,
              reasoningStepId,
            });

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom();
            }
          },
        });

        lastStreamResult = streamResult;

        flushBufferedAssistantVariant(bufferKey);

        const toolCalls = streamResult.toolCalls ?? [];
        if (!toolCalls.length) break;

        if (toolRound >= MAX_TOOL_ROUNDS) {
          throw new Error(
            `Stopped after ${MAX_TOOL_ROUNDS} tool rounds to avoid an infinite loop.`,
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
            });

            applyToolResultToVisibleStep(toolResult);

            if (chatId === activeChatId) {
              scheduleStickyScrollToBottom({ force: true, settleFrames: 5 });
            }

            return toolResult;
          }),
        );
        applyToolResultsToVariant(toolResults);

        if (chatId === activeChatId) {
          scheduleStickyScrollToBottom({ force: true, settleFrames: 5 });
        }

        currentMessages = buildContinuationMessages();
        currentUserMessage = undefined;
      }

      flushBufferedAssistantVariant(bufferKey);

      updateAssistantVariant(
        chatId,
        assistantMessageId,
        variantId,
        (variant) =>
          markAssistantVariantDone({
            variant,
            responseStartedAtMs,
            provider: providerForRun,
            streamResult: lastStreamResult ?? {},
          }),
      );
    } catch (error) {
      const wasAborted = error instanceof DOMException && error.name === "AbortError";

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

    const toolsForRun = getToolsForChat(activeChat, oneShotToolNames);

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
    const nextMessages = [...activeChat.messages, userChatMessage, assistantMessage];

    armStickyScrollToBottom();
    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title:
        chat.messages.length === 0 && chat.title === "New chat"
          ? titleFromMessage(userMessage)
          : chat.title,
      messages: nextMessages,
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
    });

    return true;
  }

  async function regenerateAssistantMessage(assistantMessageId: string) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const providerForRun = resolveProviderForActiveChat(activeChat);
    if (!validateProviderForRun(providerForRun)) return;

    const assistantIndex = activeChat.messages.findIndex(
      (message) => message.id === assistantMessageId && message.role === "assistant",
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

    const toolsForRun = getToolsForChat(activeChat, oneShotToolNames);
    const contextMessages = activeChat.messages.slice(0, userIndex);
    const variantId = createId();
    const responseStartedAtMs = performance.now();
    const responseStartedAt = new Date().toISOString();

    armStickyScrollToBottom();

    updateActiveChatMessages(
      (currentMessages) =>
        currentMessages.slice(0, assistantIndex + 1).map((message) => {
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
      { touch: false },
    );

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

    const toolsForRun = getToolsForChat(activeChat, oneShotToolNames);

    const userIndex = activeChat.messages.findIndex(
      (message) => message.id === messageId && message.role === "user",
    );
    const currentMessage = activeChat.messages[userIndex];

    if (userIndex < 0 || !currentMessage || currentMessage.role !== "user") {
      showError("Could not find the message to edit.");
      return;
    }

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
    const contextMessages = activeChat.messages.slice(0, userIndex);
    const nextMessages = [...contextMessages, editedUserMessage, assistantMessage];

    armStickyScrollToBottom();
    setEditingMessageId(null);

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title: userIndex === 0 ? titleFromMessage(userMessage) : chat.title,
      messages: nextMessages,
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
    submitEditedUserMessage,
    selectAssistantVariant,
    stopChatGeneration,
    isChatGenerating,
    submitAskUserResponse,
    cancelAskUserRequest,
    canSubmitAskUserResponse,
  };
}
