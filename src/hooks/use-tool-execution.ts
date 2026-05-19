import { useRef } from "react";

import {
  ASK_USER_TOOL_NAME,
  CHECKLIST_WRITE_TOOL_NAME,
  createAskUserToolResult,
  createChecklistWriteToolResult,
  parseAskUserRequestFromToolCall,
  parseChecklistWriteRequestFromToolCall,
} from "@/lib/ai-chat/builtin-tools";
import { runQueuedTool } from "@/lib/ai-chat/tool-execution-queue";
import type {
  AskUserRequest,
  AskUserResponse,
  ChatToolCall,
  ChatToolResult,
  LoadedToolInfo,
  ToolCommandResult,
  ToolExecutionStatus,
  UserInputStatus,
} from "@/lib/ai-chat/types";

type PendingAskUserRequest = {
  chatId: string;
  assistantMessageId: string;
  variantId: string;
  stepId: string;
  resolve: (result: ChatToolResult) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};

export function useToolExecution({
  activeChatId,
  loadedTools,
  executeExternalTool,
  abortChatGeneration,
  completeAssistantUserInputStep,
  updateAssistantToolStepStatus,
  updateAssistantUserInputStepStatus,
  scheduleStickyScrollToBottom,
  showError,
  labelError,
  askUserSettleFrames,
}: {
  activeChatId?: string;
  loadedTools: LoadedToolInfo[];
  executeExternalTool: (
    toolName: string,
    args: unknown,
  ) => Promise<ToolCommandResult>;
  abortChatGeneration: (chatId: string) => void;
  completeAssistantUserInputStep: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    response: AskUserResponse,
    toolResult: ChatToolResult,
  ) => void;
  updateAssistantToolStepStatus: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: ToolExecutionStatus,
  ) => void;
  updateAssistantUserInputStepStatus: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: UserInputStatus,
  ) => void;
  scheduleStickyScrollToBottom: (options?: {
    force?: boolean;
    settleFrames?: number;
  }) => void;
  showError: (message: string, description?: string) => void;
  labelError: (error: unknown) => string;
  askUserSettleFrames: number;
}) {
  const pendingAskUserRequestsRef = useRef<Record<string, PendingAskUserRequest>>({});

  async function executeAskUserToolCall(
    toolCall: ChatToolCall,
    options: {
      chatId: string;
      assistantMessageId: string;
      variantId: string;
      stepId: string;
      signal?: AbortSignal;
    },
  ): Promise<ChatToolResult> {
    parseAskUserRequestFromToolCall(toolCall);

    return new Promise<ChatToolResult>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        delete pendingAskUserRequestsRef.current[toolCall.id];
        options.signal?.removeEventListener("abort", abortHandler);
      };

      const settleResolve = (result: ChatToolResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const settleReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const abortHandler = () => {
        updateAssistantUserInputStepStatus(
          options.chatId,
          options.assistantMessageId,
          options.variantId,
          options.stepId,
          "cancelled",
        );
        settleReject(new DOMException("Generation was cancelled.", "AbortError"));
      };

      pendingAskUserRequestsRef.current[toolCall.id] = {
        chatId: options.chatId,
        assistantMessageId: options.assistantMessageId,
        variantId: options.variantId,
        stepId: options.stepId,
        resolve: settleResolve,
        reject: settleReject,
        cleanup,
      };

      updateAssistantUserInputStepStatus(
        options.chatId,
        options.assistantMessageId,
        options.variantId,
        options.stepId,
        "waiting",
      );

      if (options.signal?.aborted) {
        abortHandler();
        return;
      }

      options.signal?.addEventListener("abort", abortHandler, { once: true });
    });
  }

  async function executeChecklistWriteToolCall(
    toolCall: ChatToolCall,
  ): Promise<ChatToolResult> {
    const request = parseChecklistWriteRequestFromToolCall(toolCall);
    return createChecklistWriteToolResult(toolCall, request);
  }

  async function executeToolCall(
    toolCall: ChatToolCall,
    options: {
      chatId: string;
      assistantMessageId: string;
      variantId: string;
      stepId: string;
      signal?: AbortSignal;
    },
  ): Promise<ChatToolResult> {
    const toolName = toolCall.function.name;
    const tool = loadedTools.find((candidate) => candidate.name === toolName);

    try {
      if (toolName === ASK_USER_TOOL_NAME) {
        return await executeAskUserToolCall(toolCall, options);
      }

      if (toolName === CHECKLIST_WRITE_TOOL_NAME) {
        return await executeChecklistWriteToolCall(toolCall);
      }

      const argsText = toolCall.function.arguments.trim() || "{}";
      const args = JSON.parse(argsText);
      const result = await runQueuedTool(
        toolName,
        tool,
        () => executeExternalTool(toolName, args),
        (status) =>
          updateAssistantToolStepStatus(
            options.chatId,
            options.assistantMessageId,
            options.variantId,
            options.stepId,
            status,
          ),
      );

      return {
        toolCallId: toolCall.id,
        toolName: result.toolName || toolName,
        content: result.content,
        isError: result.timedOut || result.exitCode !== 0,
        execution: result.execution,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      return {
        toolCallId: toolCall.id,
        toolName,
        content: `Error: ${labelError(error)}`,
        isError: true,
      };
    }
  }

  function submitAskUserResponse(
    toolCall: ChatToolCall,
    request: AskUserRequest,
    response: AskUserResponse,
  ) {
    const pendingRequest = pendingAskUserRequestsRef.current[toolCall.id];
    if (!pendingRequest) {
      showError("This input request is no longer active.");
      return;
    }

    const toolResult = createAskUserToolResult(toolCall, request, response);
    completeAssistantUserInputStep(
      pendingRequest.chatId,
      pendingRequest.assistantMessageId,
      pendingRequest.variantId,
      pendingRequest.stepId,
      response,
      toolResult,
    );
    pendingRequest.resolve(toolResult);

    if (pendingRequest.chatId === activeChatId) {
      scheduleStickyScrollToBottom({ force: true, settleFrames: askUserSettleFrames });
    }
  }

  function cancelAskUserRequest(toolCallId: string) {
    const pendingRequest = pendingAskUserRequestsRef.current[toolCallId];
    if (!pendingRequest) {
      showError("This input request is no longer active.");
      return;
    }

    updateAssistantUserInputStepStatus(
      pendingRequest.chatId,
      pendingRequest.assistantMessageId,
      pendingRequest.variantId,
      pendingRequest.stepId,
      "cancelled",
    );

    abortChatGeneration(pendingRequest.chatId);
    pendingRequest.reject(new DOMException("Generation was cancelled.", "AbortError"));
  }

  function canSubmitAskUserResponse(toolCallId: string) {
    return Boolean(pendingAskUserRequestsRef.current[toolCallId]);
  }

  return {
    executeToolCall,
    submitAskUserResponse,
    cancelAskUserRequest,
    canSubmitAskUserResponse,
  };
}
