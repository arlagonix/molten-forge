import { useRef } from "react";

import {
  ASK_USER_TOOL_NAME,
  isTaskToolName,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL_NAME,
  LOAD_SKILL_TOOL_NAME,
  isFileToolName,
  requiresFileToolApproval,
  requiresToolApproval,
  createAskUserToolResult,
  createCancelledToolResult,
  createToolApprovalRequest,
  isFileToolApprovalResponseApproved,
  parseAskUserRequestFromToolCall,
  parseFileToolApprovalRequestFromToolCall,
} from "@/lib/ai-chat/builtin-tools";
import { TERMINAL_EXEC_TOOL_NAME } from "@/lib/ai-chat/terminal-tool";
import { runQueuedTool } from "@/lib/ai-chat/tool-execution-queue";
import type {
  AskUserRequest,
  AskUserResponse,
  ToolApprovalResponse,
  ChatFileToolAutoApproval,
  ChatToolCall,
  ChatToolResult,
  ChatWorkspaceRoot,
  LoadedSkillInfo,
  LoadedToolInfo,
  ToolCommandResult,
  TerminalExecutionResult,
  TerminalStreamEvent,
  ToolExecutionStatus,
  UserInputStatus,
} from "@/lib/ai-chat/types";

type PendingUserInputRequest = {
  kind: "ask_user" | "tool_approval";
  chatId: string;
  assistantMessageId: string;
  variantId: string;
  stepId: string;
  toolCall: ChatToolCall;
  resolve: (result: ChatToolResult) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
  workspaceRoots?: ChatWorkspaceRoot[];
  signal?: AbortSignal;
};

export function useToolExecution({
  activeChatId,
  loadedTools,
  workspaceRoots,
  fileToolAutoApproval,
  availableSkillsByName,
  modelSelectableSkillNames,
  activeSkillNames,
  onSkillActivated,
  executeExternalTool,
  executeTaskTool,
  abortChatGeneration,
  completeAssistantUserInputStep,
  completeAssistantFileApprovalStep,
  updateAssistantToolApprovalPartialResult,
  updateAssistantToolStepStatus,
  updateAssistantToolCallPartialResult,
  updateAssistantUserInputStepStatus,
  updateAssistantFileApprovalStepStatus,
  scheduleStickyScrollToBottom,
  showError,
  labelError,
  askUserSettleFrames,
}: {
  activeChatId?: string;
  loadedTools: LoadedToolInfo[];
  workspaceRoots: ChatWorkspaceRoot[];
  fileToolAutoApproval?: ChatFileToolAutoApproval;
  availableSkillsByName: Map<string, LoadedSkillInfo>;
  modelSelectableSkillNames: string[];
  activeSkillNames: string[];
  onSkillActivated: (skillName: string, chatId: string) => void;
  executeExternalTool: (
    toolName: string,
    args: unknown,
    context?: {
      workspaceRoots?: ChatWorkspaceRoot[];
      signal?: AbortSignal;
      onTerminalStreamEvent?: (event: TerminalStreamEvent) => void;
    },
  ) => Promise<ToolCommandResult>;
  executeTaskTool: (toolCall: ChatToolCall, chatId: string) => ChatToolResult;
  abortChatGeneration: (chatId: string) => void;
  completeAssistantUserInputStep: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    response: AskUserResponse,
    toolResult: ChatToolResult,
  ) => void;
  completeAssistantFileApprovalStep: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    response: ToolApprovalResponse,
    toolResult: ChatToolResult,
  ) => void;
  updateAssistantToolApprovalPartialResult: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    response: ToolApprovalResponse,
    toolResult: ChatToolResult,
    status?: UserInputStatus,
  ) => void;
  updateAssistantToolStepStatus: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: ToolExecutionStatus,
  ) => void;
  updateAssistantToolCallPartialResult: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    toolCallId: string,
    toolResult: ChatToolResult,
    status: ToolExecutionStatus,
  ) => void;
  updateAssistantUserInputStepStatus: (
    chatId: string,
    assistantMessageId: string,
    variantId: string,
    stepId: string,
    status: UserInputStatus,
  ) => void;
  updateAssistantFileApprovalStepStatus: (
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
  const pendingUserInputRequestsRef = useRef<
    Record<string, PendingUserInputRequest>
  >({});

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
        delete pendingUserInputRequestsRef.current[toolCall.id];
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
        settleReject(
          new DOMException("Generation was cancelled.", "AbortError"),
        );
      };

      pendingUserInputRequestsRef.current[toolCall.id] = {
        kind: "ask_user",
        toolCall,
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


  async function executeToolCallWithApproval(
    toolCall: ChatToolCall,
    options: {
      chatId: string;
      assistantMessageId: string;
      variantId: string;
      stepId: string;
      signal?: AbortSignal;
      workspaceRoots?: ChatWorkspaceRoot[];
      fileToolAutoApproval?: ChatFileToolAutoApproval;
    },
  ): Promise<ChatToolResult> {
    const tool = loadedTools.find((candidate) => candidate.name === toolCall.function.name);

    if (requiresFileToolApproval(toolCall.function.name)) {
      parseFileToolApprovalRequestFromToolCall(
        toolCall,
        options.workspaceRoots ?? workspaceRoots,
      );
    } else {
      createToolApprovalRequest(toolCall, tool);
    }

    return new Promise<ChatToolResult>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        delete pendingUserInputRequestsRef.current[toolCall.id];
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
        updateAssistantFileApprovalStepStatus(
          options.chatId,
          options.assistantMessageId,
          options.variantId,
          options.stepId,
          "cancelled",
        );
        settleReject(
          new DOMException("Generation was cancelled.", "AbortError"),
        );
      };

      pendingUserInputRequestsRef.current[toolCall.id] = {
        kind: "tool_approval",
        toolCall,
        chatId: options.chatId,
        assistantMessageId: options.assistantMessageId,
        variantId: options.variantId,
        stepId: options.stepId,
        workspaceRoots: options.workspaceRoots ?? workspaceRoots,
        signal: options.signal,
        resolve: settleResolve,
        reject: settleReject,
        cleanup,
      };

      updateAssistantFileApprovalStepStatus(
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

  async function executeLoadSkillToolCall(
    toolCall: ChatToolCall,
    chatId: string,
    activeSkillNamesForRun: string[],
  ): Promise<ChatToolResult> {
    const argsText = toolCall.function.arguments.trim() || "{}";
    const args = JSON.parse(argsText);

    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("load_skill arguments must be a JSON object.");
    }

    const rawSkillName = (args as Record<string, unknown>).skillName;
    const skillName =
      typeof rawSkillName === "string" ? rawSkillName.trim() : "";
    if (!skillName) throw new Error("load_skill requires skillName.");

    const skill = availableSkillsByName.get(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);

    if (
      !modelSelectableSkillNames.includes(skillName) &&
      !activeSkillNamesForRun.includes(skillName)
    ) {
      throw new Error(
        `Skill is not available for model loading in this chat: ${skillName}`,
      );
    }

    const resultPayload = {
      ok: true,
      status: activeSkillNamesForRun.includes(skillName)
        ? "already_active"
        : "loaded",
      skillName,
      instructions: skill.instructions,
      recommendedToolNames: skill.recommendedToolNames ?? [],
      ...(skill.directoryPath ? { directoryPath: skill.directoryPath } : {}),
    };

    if (activeSkillNamesForRun.includes(skillName)) {
      return {
        toolCallId: toolCall.id,
        toolName: LOAD_SKILL_TOOL_NAME,
        content: JSON.stringify(resultPayload, null, 2),
        loadedSkillName: skillName,
        loadedSkillInstructions: skill.instructions,
        loadedSkillRecommendedToolNames: skill.recommendedToolNames ?? [],
      };
    }

    onSkillActivated(skillName, chatId);

    return {
      toolCallId: toolCall.id,
      toolName: LOAD_SKILL_TOOL_NAME,
      content: JSON.stringify(resultPayload, null, 2),
      loadedSkillName: skillName,
      loadedSkillInstructions: skill.instructions,
      loadedSkillRecommendedToolNames: skill.recommendedToolNames ?? [],
    };
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

  function appendTerminalOutput(value: string, delta: string) {
    const maxChars = 100_000;
    const next = value + delta;
    if (next.length <= maxChars) return next;
    return next.slice(next.length - maxChars);
  }

  function createTerminalStreamHandler(
    toolCall: ChatToolCall,
    options: {
      chatId: string;
      assistantMessageId: string;
      variantId: string;
      approvalStepId?: string;
      approvalResponse?: ToolApprovalResponse;
    },
  ) {
    const terminal: TerminalExecutionResult = {
      command: "",
      shell: "",
      cwd: "",
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      cancelled: false,
      durationMs: 0,
      warnings: [],
    };

    const publish = (status: ToolExecutionStatus) => {
      const content = JSON.stringify(
        {
          ok: status !== "failed",
          status,
          command: terminal.command,
          shell: terminal.shell,
          cwd: terminal.cwd,
          stdout: terminal.stdout,
          stderr: terminal.stderr,
          exitCode: terminal.exitCode,
          timedOut: terminal.timedOut,
          cancelled: terminal.cancelled,
          durationMs: terminal.durationMs,
          outputTruncated: terminal.outputTruncated,
          warnings: terminal.warnings,
        },
        null,
        2,
      );

      const toolResult: ChatToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        content,
        isError: status === "failed",
        terminal: { ...terminal },
      };

      updateAssistantToolCallPartialResult(
        options.chatId,
        options.assistantMessageId,
        options.variantId,
        toolCall.id,
        toolResult,
        status,
      );

      if (options.approvalStepId && options.approvalResponse) {
        updateAssistantToolApprovalPartialResult(
          options.chatId,
          options.assistantMessageId,
          options.variantId,
          options.approvalStepId,
          options.approvalResponse,
          toolResult,
          "complete",
        );
      }

      if (options.chatId === activeChatId) {
        scheduleStickyScrollToBottom({ settleFrames: 2 });
      }
    };

    return (event: TerminalStreamEvent) => {
      if (event.type === "started") {
        terminal.command = event.command;
        terminal.shell = event.shell;
        terminal.cwd = event.cwd;
        terminal.warnings = event.warnings ?? [];
        publish("running");
        return;
      }

      if (event.type === "stdout") {
        terminal.stdout = appendTerminalOutput(terminal.stdout, event.text);
        publish("running");
        return;
      }

      if (event.type === "stderr") {
        terminal.stderr = appendTerminalOutput(terminal.stderr, event.text);
        publish("running");
        return;
      }

      if (event.type === "finished") {
        terminal.exitCode = event.exitCode;
        terminal.timedOut = event.timedOut;
        terminal.cancelled = event.cancelled;
        terminal.durationMs = event.durationMs;
        terminal.outputTruncated = event.outputTruncated;
        publish(
          event.timedOut || event.cancelled || event.exitCode !== 0
            ? "failed"
            : "complete",
        );
      }
    };
  }

  async function executeExternalToolCall(
    toolCall: ChatToolCall,
    options: {
      chatId: string;
      assistantMessageId: string;
      variantId: string;
      stepId: string;
      workspaceRoots?: ChatWorkspaceRoot[];
      signal?: AbortSignal;
    },
  ): Promise<ChatToolResult> {
    const toolName = toolCall.function.name;
    const tool = loadedTools.find((candidate) => candidate.name === toolName);
    const argsText = toolCall.function.arguments.trim() || "{}";
    const args = JSON.parse(argsText);

    const result = await runQueuedTool(
      toolName,
      tool,
      () =>
        executeExternalTool(
          toolName,
          args,
          toolName === TERMINAL_EXEC_TOOL_NAME
            ? {
                workspaceRoots: options.workspaceRoots ?? workspaceRoots,
                signal: options.signal,
                onTerminalStreamEvent: createTerminalStreamHandler(toolCall, options),
              }
            : isFileToolName(toolName)
              ? {
                  workspaceRoots: options.workspaceRoots ?? workspaceRoots,
                  signal: options.signal,
                }
              : { signal: options.signal },
        ),
      (status) =>
        updateAssistantToolStepStatus(
          options.chatId,
          options.assistantMessageId,
          options.variantId,
          options.stepId,
          status,
        ),
      options.signal,
    );

    return {
      toolCallId: toolCall.id,
      toolName: result.toolName || toolName,
      content: result.content,
      isError: result.timedOut || result.exitCode !== 0,
      execution: result.execution,
      changePreview: result.changePreview,
      generatedFiles: result.generatedFiles,
      terminal: result.terminal,
    };
  }

  async function executeToolCall(
    toolCall: ChatToolCall,
    options: {
      chatId: string;
      assistantMessageId: string;
      variantId: string;
      stepId: string;
      signal?: AbortSignal;
      activeSkillNames?: string[];
      workspaceRoots?: ChatWorkspaceRoot[];
      fileToolAutoApproval?: ChatFileToolAutoApproval;
    },
  ): Promise<ChatToolResult> {
    const toolName = toolCall.function.name;

    try {
      if (toolName === ASK_USER_TOOL_NAME) {
        return await executeAskUserToolCall(toolCall, options);
      }

      if (isTaskToolName(toolName)) {
        return executeTaskTool(toolCall, options.chatId);
      }

      if (toolName === LOAD_SKILL_TOOL_NAME) {
        return await executeLoadSkillToolCall(
          toolCall,
          options.chatId,
          options.activeSkillNames ?? activeSkillNames,
        );
      }

      const customTool = loadedTools.find((candidate) => candidate.name === toolName);

      if (requiresToolApproval(toolName, customTool)) {
        const effectiveAutoApproval =
          options.fileToolAutoApproval ?? fileToolAutoApproval;
        const autoApproved =
          requiresFileToolApproval(toolName) &&
          isFileToolCallAutoApproved(toolName, effectiveAutoApproval);

        if (!autoApproved) {
          return await executeToolCallWithApproval(toolCall, options);
        }

        parseFileToolApprovalRequestFromToolCall(
          toolCall,
          options.workspaceRoots ?? workspaceRoots,
        );
      }

      return await executeExternalToolCall(toolCall, options);
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

  async function submitAskUserResponse(
    toolCall: ChatToolCall,
    request: AskUserRequest,
    response: AskUserResponse,
  ) {
    const pendingRequest = pendingUserInputRequestsRef.current[toolCall.id];
    if (!pendingRequest) {
      showError("This input request is no longer active.");
      return;
    }

    if (pendingRequest.kind !== "ask_user") {
      showError("This input request does not accept custom answers.");
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
      scheduleStickyScrollToBottom({
        force: true,
        settleFrames: askUserSettleFrames,
      });
    }
  }

  async function submitFileToolApprovalResponse(
    toolCall: ChatToolCall,
    response: ToolApprovalResponse,
  ) {
    const pendingRequest = pendingUserInputRequestsRef.current[toolCall.id];
    if (!pendingRequest) {
      showError("This approval request is no longer active.");
      return;
    }

    if (pendingRequest.kind !== "tool_approval") {
      showError("This approval request does not match the active input.");
      return;
    }

    try {
      let toolResult: ChatToolResult;

      if (!isFileToolApprovalResponseApproved(response)) {
        toolResult = createCancelledToolResult(toolCall);
      } else {
        const argsText = toolCall.function.arguments.trim() || "{}";
        const args = JSON.parse(argsText);

        if (toolCall.function.name === TERMINAL_EXEC_TOOL_NAME) {
          updateAssistantToolApprovalPartialResult(
            pendingRequest.chatId,
            pendingRequest.assistantMessageId,
            pendingRequest.variantId,
            pendingRequest.stepId,
            response,
            {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              content: "Terminal command approved. Waiting for execution to start.",
              isError: false,
            },
            "complete",
          );
        }

        const execution = await executeExternalTool(toolCall.function.name, args, {
          workspaceRoots: pendingRequest.workspaceRoots ?? workspaceRoots,
          signal: pendingRequest.signal,
          ...(toolCall.function.name === TERMINAL_EXEC_TOOL_NAME
            ? {
                onTerminalStreamEvent: createTerminalStreamHandler(toolCall, {
                  chatId: pendingRequest.chatId,
                  assistantMessageId: pendingRequest.assistantMessageId,
                  variantId: pendingRequest.variantId,
                  approvalStepId: pendingRequest.stepId,
                  approvalResponse: response,
                }),
              }
            : {}),
        });

        toolResult = {
          toolCallId: toolCall.id,
          toolName: execution.toolName || toolCall.function.name,
          content: execution.content,
          isError: execution.timedOut || execution.exitCode !== 0,
          execution: execution.execution,
          changePreview: execution.changePreview,
          generatedFiles: execution.generatedFiles,
          terminal: execution.terminal,
        };
      }

      completeAssistantFileApprovalStep(
        pendingRequest.chatId,
        pendingRequest.assistantMessageId,
        pendingRequest.variantId,
        pendingRequest.stepId,
        response,
        toolResult,
      );
      pendingRequest.resolve(toolResult);

      if (pendingRequest.chatId === activeChatId) {
        scheduleStickyScrollToBottom({
          force: true,
          settleFrames: askUserSettleFrames,
        });
      }
    } catch (error) {
      const toolResult: ChatToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        content: `Error: ${labelError(error)}`,
        isError: true,
      };

      completeAssistantFileApprovalStep(
        pendingRequest.chatId,
        pendingRequest.assistantMessageId,
        pendingRequest.variantId,
        pendingRequest.stepId,
        response,
        toolResult,
      );
      pendingRequest.resolve(toolResult);
    }
  }

  function cancelAskUserRequest(toolCallId: string) {
    const pendingRequest = pendingUserInputRequestsRef.current[toolCallId];
    if (!pendingRequest) {
      showError("This input request is no longer active.");
      return;
    }

    const updatePendingStatus =
      pendingRequest.kind === "tool_approval"
        ? updateAssistantFileApprovalStepStatus
        : updateAssistantUserInputStepStatus;

    updatePendingStatus(
      pendingRequest.chatId,
      pendingRequest.assistantMessageId,
      pendingRequest.variantId,
      pendingRequest.stepId,
      "cancelled",
    );

    abortChatGeneration(pendingRequest.chatId);
    pendingRequest.reject(
      new DOMException("Generation was cancelled.", "AbortError"),
    );
  }

  function canSubmitAskUserResponse(toolCallId: string) {
    return Boolean(pendingUserInputRequestsRef.current[toolCallId]);
  }

  return {
    executeToolCall,
    submitAskUserResponse,
    submitFileToolApprovalResponse,
    cancelAskUserRequest,
    canSubmitAskUserResponse,
  };
}
