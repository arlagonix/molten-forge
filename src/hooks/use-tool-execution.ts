import { useRef } from "react";

import {
  ASK_USER_TOOL_NAME,
  isTaskToolName,
  READ_TOOL_NAME,
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
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
  allowedExactFilePaths?: string[];
  allowedReadRoots?: ChatWorkspaceRoot[];
  activeSkillNames?: string[];
  signal?: AbortSignal;
  tool?: LoadedToolInfo;
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
      allowedExactFilePaths?: string[];
      allowedReadRoots?: ChatWorkspaceRoot[];
      signal?: AbortSignal;
      onTerminalStreamEvent?: (event: TerminalStreamEvent) => void;
      timeoutMs?: number;
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
      allowedExactFilePaths?: string[];
      allowedReadRoots?: ChatWorkspaceRoot[];
      fileToolAutoApproval?: ChatFileToolAutoApproval;
      activeSkillNames?: string[];
      tool?: LoadedToolInfo;
    },
  ): Promise<ChatToolResult> {
    const tool = options.tool ?? loadedTools.find((candidate) => candidate.name === toolCall.function.name);

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
        allowedExactFilePaths: options.allowedExactFilePaths,
        allowedReadRoots: options.allowedReadRoots,
        activeSkillNames: options.activeSkillNames,
        signal: options.signal,
        tool,
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

  function stripSkillFrontmatter(content: string) {
    const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
    const match = /^---\n[\s\S]*?\n---\n?/.exec(normalized);
    return (match ? normalized.slice(match[0].length) : normalized).trim();
  }

  function buildLoadedSkillInstructions(skill: LoadedSkillInfo) {
    const directory = skill.directoryPath || "";
    const location = skill.manifestPath || skill.directoryPath || skill.name;
    const body = stripSkillFrontmatter(skill.manifestContent || skill.instructions || "");

    return [
      `<skill name="${skill.name}" location="${location}">`,
      directory
        ? `References are relative to ${directory}.`
        : "References are relative to the skill directory.",
      "",
      body,
      "</skill>",
    ]
      .filter((part) => part !== undefined && part !== null && String(part).length > 0)
      .join("\n\n");
  }

  async function executeLoadSkillToolCall(
    toolCall: ChatToolCall,
    activeSkillNamesForCall: string[] = activeSkillNames,
  ): Promise<ChatToolResult> {
    const argsText = toolCall.function.arguments.trim() || "{}";
    const args = JSON.parse(argsText);

    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("skill arguments must be a JSON object.");
    }

    const rawSkillName = (args as Record<string, unknown>).name ?? (args as Record<string, unknown>).skillName;
    const skillName =
      typeof rawSkillName === "string" ? rawSkillName.trim() : "";
    if (!skillName) throw new Error("skill requires name.");

    const skill = availableSkillsByName.get(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);
    if (
      !modelSelectableSkillNames.includes(skillName) &&
      !activeSkillNamesForCall.includes(skillName)
    ) {
      throw new Error(`Skill is not available in this chat or mode: ${skillName}`);
    }

    const loadedInstructions = buildLoadedSkillInstructions(skill);
    const resultPayload = {
      ok: true,
      status: "loaded",
      name: skillName,
      skillName,
      location: skill.manifestPath ?? skill.directoryPath,
      directoryPath: skill.directoryPath,
      references: skill.directoryPath
        ? `References are relative to ${skill.directoryPath}.`
        : "References are relative to the skill directory.",
      instructions: loadedInstructions,
      recommendedToolNames: [],
    };

    return {
      toolCallId: toolCall.id,
      toolName: LOAD_SKILL_TOOL_NAME,
      content: JSON.stringify(resultPayload, null, 2),
      loadedSkillName: skillName,
      loadedSkillInstructions: loadedInstructions,
      loadedSkillRecommendedToolNames: [],
    };
  }


  function isFileToolCallAutoApproved(
    toolName: string,
    settings?: ChatFileToolAutoApproval,
  ) {
    if (toolName === READ_TOOL_NAME) return settings?.read === true;
    if (toolName === BASH_TOOL_NAME) return settings?.bash === true;
    if (toolName === EDIT_TOOL_NAME) return settings?.edit === true;
    if (toolName === WRITE_TOOL_NAME) return settings?.write === true;
    return false;
  }


  function appendTerminalOutput(value: string, delta: string) {
    if (!delta) return value;
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

    const THROTTLE_MS = 66;
    let lastPublishTime = 0;
    let pendingPublishTimer: ReturnType<typeof setTimeout> | null = null;
    let hasPendingPublish = false;

    const cancelPendingPublish = () => {
      if (pendingPublishTimer !== null) {
        clearTimeout(pendingPublishTimer);
        pendingPublishTimer = null;
      }
      hasPendingPublish = false;
    };

    const actuallyPublish = (status: ToolExecutionStatus) => {
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
    };

    const publish = (status: ToolExecutionStatus) => {
      if (status === "running") {
        const now = Date.now();
        const elapsed = now - lastPublishTime;

        if (elapsed < THROTTLE_MS) {
          hasPendingPublish = true;
          if (!pendingPublishTimer) {
            pendingPublishTimer = setTimeout(() => {
              pendingPublishTimer = null;
              if (hasPendingPublish) {
                hasPendingPublish = false;
                lastPublishTime = Date.now();
                actuallyPublish("running");
              }
            }, THROTTLE_MS - elapsed);
          }
          return;
        }
      }

      cancelPendingPublish();
      lastPublishTime = Date.now();
      actuallyPublish(status);
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
      allowedExactFilePaths?: string[];
      allowedReadRoots?: ChatWorkspaceRoot[];
      signal?: AbortSignal;
      tool?: LoadedToolInfo;
    },
  ): Promise<ChatToolResult> {
    const toolName = toolCall.function.name;
    const tool = options.tool ?? loadedTools.find((candidate) => candidate.name === toolName);
    const argsText = toolCall.function.arguments.trim() || "{}";
    const args = JSON.parse(argsText);

    const result = await runQueuedTool(
      toolName,
      tool,
      () =>
        executeExternalTool(
          toolName,
          args,
          toolName === BASH_TOOL_NAME
            ? {
                workspaceRoots: options.workspaceRoots ?? workspaceRoots,
                allowedExactFilePaths: options.allowedExactFilePaths,
                allowedReadRoots: options.allowedReadRoots,
                signal: options.signal,
                onTerminalStreamEvent: createTerminalStreamHandler(toolCall, options),
                timeoutMs: tool?.timeoutMs,
              }
            : isFileToolName(toolName)
              ? {
                  workspaceRoots: options.workspaceRoots ?? workspaceRoots,
                  allowedExactFilePaths: options.allowedExactFilePaths,
                  allowedReadRoots: options.allowedReadRoots,
                  signal: options.signal,
                  timeoutMs: tool?.timeoutMs,
                }
              : { signal: options.signal, timeoutMs: tool?.timeoutMs },
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
      allowedExactFilePaths?: string[];
      allowedReadRoots?: ChatWorkspaceRoot[];
      fileToolAutoApproval?: ChatFileToolAutoApproval;
      tool?: LoadedToolInfo;
      unavailableToolMessage?: string;
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

      const tool = options.tool;
      if (!tool) {
        return {
          toolCallId: toolCall.id,
          toolName,
          content:
            options.unavailableToolMessage ??
            `Error: Tool "${toolName}" is not available in this chat or mode.`,
          isError: true,
        };
      }

      const optionsWithTool = { ...options, tool };

      if (requiresToolApproval(toolName, tool)) {
        return await executeToolCallWithApproval(toolCall, optionsWithTool);
      }

      if (toolName === LOAD_SKILL_TOOL_NAME) {
        return await executeLoadSkillToolCall(
          toolCall,
          options.activeSkillNames ?? activeSkillNames,
        );
      }

      return await executeExternalToolCall(toolCall, optionsWithTool);
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
        const tool = pendingRequest.tool ?? loadedTools.find((candidate) => candidate.name === toolCall.function.name);

        if (toolCall.function.name === BASH_TOOL_NAME) {
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

        if (toolCall.function.name === LOAD_SKILL_TOOL_NAME) {
          toolResult = await executeLoadSkillToolCall(
            toolCall,
            pendingRequest.activeSkillNames ?? activeSkillNames,
          );
        } else {
          const execution = await executeExternalTool(toolCall.function.name, args, {
            workspaceRoots: pendingRequest.workspaceRoots ?? workspaceRoots,
            allowedExactFilePaths: pendingRequest.allowedExactFilePaths,
            allowedReadRoots: pendingRequest.allowedReadRoots,
            signal: pendingRequest.signal,
            timeoutMs: tool?.timeoutMs,
            ...(toolCall.function.name === BASH_TOOL_NAME
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
