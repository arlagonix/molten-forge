import {
  READ_TOOL_NAME,
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  FILE_TOOL_NAMES,
  isFileToolName,
  isLegacyFileToolName,
  requiresFileToolApproval,
} from "@/lib/ai-chat/file-tool-names";
import { TERMINAL_EXEC_TOOL_NAME } from "@/lib/ai-chat/terminal-tool";
import type {
  AskUserQuestion,
  AskUserQuestionType,
  AskUserRequest,
  AskUserResponse,
  FileToolApprovalRequest,
  FileToolApprovalResponse,
  ChatFileToolAutoApproval,
  ChatToolCall,
  ChatToolResult,
  ChatWorkspaceRoot,
  AgentTask,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
  AgentsSettings,
  SkillsSettings,
  ToolsSettings,
} from "@/lib/ai-chat/types";

export const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  enabled: true,
  askUserEnabled: true,
  taskToolsEnabled: true,
  loadSkillEnabled: true,
  webFetchEnabled: false,
  readEnabled: true,
  bashEnabled: true,
  editEnabled: true,
  writeEnabled: true,
  readAutoApproveEnabled: false,
  bashAutoApproveEnabled: false,
  editAutoApproveEnabled: false,
  writeAutoApproveEnabled: false,
  toolsPermission: "custom",
  permissionModelVersion: 2,
  toolPermissions: {
    ask_user: "allow",
    update_tasks: "allow",
    skill: "ask",
    web_fetch: "deny",
    read: "ask",
    bash: "ask",
    edit: "ask",
    write: "ask",
    call_agent: "ask",
  },
};

export function buildFileToolAutoApprovalFromToolsSettings(
  settings: ToolsSettings,
): ChatFileToolAutoApproval {
  return {
    read: settings.readAutoApproveEnabled === true,
    bash: settings.bashAutoApproveEnabled === true,
    edit: settings.editAutoApproveEnabled === true,
    write: settings.writeAutoApproveEnabled === true,
  };
}

export const DEFAULT_SKILLS_SETTINGS: SkillsSettings = {
  enabled: true,
  skillsPermission: "custom",
  permissionModelVersion: 2,
  skillPermissions: {},
};

export const DEFAULT_AGENTS_SETTINGS: AgentsSettings = {
  enabled: true,
  agentsPermission: "custom",
  permissionModelVersion: 2,
  agentPermissions: {},
  builtInAgentMaxNestingDepths: {},
};

export const ASK_USER_TOOL_NAME = "ask_user";
export const TASK_UPDATE_TOOL_NAME = "update_tasks";
export const TASK_TOOL_NAMES = [TASK_UPDATE_TOOL_NAME] as const;

// Old tool names kept only so historical saved chats still parse/render.
// These are not exposed to the model.
const LEGACY_TASK_TOOL_NAMES = [
  "add_tasks",
  "delete_tasks",
  "complete_tasks",
  "get_tasks_list",
  "clear_tasks_list",
] as const;
export const LOAD_SKILL_TOOL_NAME = "skill";
export const WEB_FETCH_TOOL_NAME = "web_fetch";
export const CALL_AGENT_TOOL_NAME = "call_agent";
export const ASK_USER_CUSTOM_ANSWER_ID = "__custom__";

export const CALL_AGENT_TOOL: LoadedToolInfo = {
  id: "builtin-call-agent",
  name: CALL_AGENT_TOOL_NAME,
  enabled: true,
  description:
    "Delegates a focused subtask to one enabled agent. The runtime schema is rebuilt per chat so agentName is limited to currently available agents.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      agentName: {
        type: "string",
        description: "Name of the configured agent to call.",
      },
      task: {
        type: "string",
        description:
          "Focused task for the agent. Include all important constraints and what output you need back.",
      },
    },
    required: ["agentName", "task"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export {
  READ_TOOL_NAME,
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  FILE_TOOL_NAMES,
  isFileToolName,
  requiresFileToolApproval,
};


const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOOL_MENTION_PATTERN = /a^/g;
const SKILL_MENTION_PATTERN = /a^/g;
const AGENT_MENTION_PATTERN = /a^/g;
const MAX_ASK_USER_QUESTIONS = 5;
const MAX_ASK_USER_OPTIONS = 8;
const MAX_ASK_USER_TITLE_LENGTH = 120;
const MAX_ASK_USER_DESCRIPTION_LENGTH = 500;
const MAX_ASK_USER_QUESTION_LENGTH = 500;
const MAX_ASK_USER_OPTION_LABEL_LENGTH = 160;
const MAX_ASK_USER_OPTION_DESCRIPTION_LENGTH = 300;
const MAX_TASKS = 50;
const MAX_TASK_SUBJECT_LENGTH = 180;

export const ASK_USER_TOOL: LoadedToolInfo = {
  id: "builtin-ask-user",
  name: ASK_USER_TOOL_NAME,
  enabled: true,
  description:
    "Pause and ask the user focused clarification questions, then continue the same response. Supports single_choice, multi_select, and text questions. Use text when the user must provide a custom value such as a number, name, or range. For choice questions, use concise option labels and strongly prefer one-sentence option descriptions. Use only when the answer materially changes the next step.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description: "Short heading for the question form.",
      },
      description: {
        type: "string",
        description: "Optional short explanation of why this input is needed.",
      },
      questions: {
        type: "array",
        description:
          "One to five questions. Each question must set type to single_choice, multi_select, or text.",
        minItems: 1,
        maxItems: MAX_ASK_USER_QUESTIONS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: {
              type: "string",
              description: "Stable snake_case answer key.",
            },
            type: {
              type: "string",
              enum: ["single_choice", "multi_select", "text"],
              description:
                "Use single_choice for one option, multi_select for several options, and text for custom-only user input.",
            },
            question: { type: "string" },
            description: { type: "string" },
            options: {
              type: "array",
              description:
                "Required for single_choice and multi_select. Use concise labels and strongly prefer one-sentence gray-helper descriptions. Do not include Other/custom; Chat Forge adds a custom typed answer option automatically for choice questions.",
              minItems: 2,
              maxItems: MAX_ASK_USER_OPTIONS,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  label: {
                    type: "string",
                    description: "Short option label, usually 1-5 words.",
                  },
                  description: {
                    type: "string",
                    description:
                      "Strongly recommended one-sentence explanation shown below the label.",
                  },
                },
                required: ["id", "label"],
              },
            },
          },
          required: ["id", "type", "question"],
        },
      },
    },
    required: ["questions"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export const TASK_UPDATE_TOOL: LoadedToolInfo = {
  id: "builtin-update-tasks",
  name: TASK_UPDATE_TOOL_NAME,
  enabled: true,
  description:
    "Updates the visible task checklist for the current chat. Always provide the full desired current task list (both done and not-done items that should stay visible). Send an empty array to clear it.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      tasks: {
        type: "array",
        description:
          "The full desired current checklist. Include both incomplete and completed tasks that should remain visible. Send [] to clear the list.",
        maxItems: MAX_TASKS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject: {
              type: "string",
              description: "Short user-visible task subject.",
              maxLength: MAX_TASK_SUBJECT_LENGTH,
            },
            done: {
              type: "boolean",
              description: "Whether the task is complete.",
            },
          },
          required: ["subject", "done"],
        },
      },
    },
    required: ["tasks"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export const TASK_TOOLS = [TASK_UPDATE_TOOL] as const;

export const WEB_FETCH_TOOL: LoadedToolInfo = {
  id: "builtin-web-fetch",
  name: WEB_FETCH_TOOL_NAME,
  enabled: true,
  description:
    "Fetch readable text from a specific HTTP/HTTPS URL. Use this when the user provides a URL or when an exact official documentation URL is known. This tool does not search the web.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        description:
          "The exact HTTP or HTTPS URL to fetch. URL fragments like #section are supported for documentation anchors.",
      },
    },
    required: ["url"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export const READ_TOOL: LoadedToolInfo = {
  id: "builtin-read",
  name: READ_TOOL_NAME,
  enabled: true,
  description:
    "Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are returned as data URLs. For text files, output is truncated to 2000 lines or 128KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read (relative to the selected workspace or absolute).",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-indexed).",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read.",
      },
    },
    required: ["path"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
  requiresApproval: true,
};

export const BASH_TOOL: LoadedToolInfo = {
  id: "builtin-bash",
  name: BASH_TOOL_NAME,
  enabled: true,
  description:
    "Execute a bash command in the selected workspace. Returns stdout and stderr. Output is truncated to the last 2000 lines or 128KB (whichever is hit first). Optionally provide a timeout in seconds.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: {
        type: "string",
        description: "Bash command to execute.",
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds (optional, no default timeout).",
      },
    },
    required: ["command"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
  requiresApproval: true,
};

export const EDIT_TOOL: LoadedToolInfo = {
  id: "builtin-edit",
  name: EDIT_TOOL_NAME,
  enabled: true,
  description:
    "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit (relative to the selected workspace or absolute).",
      },
      edits: {
        type: "array",
        description:
          "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            oldText: {
              type: "string",
              description:
                "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
            },
            newText: {
              type: "string",
              description: "Replacement text for this targeted edit.",
            },
          },
          required: ["oldText", "newText"],
        },
      },
    },
    required: ["path", "edits"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
  requiresApproval: true,
};

export const WRITE_TOOL: LoadedToolInfo = {
  id: "builtin-write",
  name: WRITE_TOOL_NAME,
  enabled: true,
  description:
    "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write (relative to the selected workspace or absolute).",
      },
      content: {
        type: "string",
        description: "Content to write to the file.",
      },
    },
    required: ["path", "content"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
  requiresApproval: true,
};

export function createCallAgentTool(agents: LoadedAgentInfo[]): LoadedToolInfo | null {
  const enabledAgentList = agents
    .filter((agent) => agent.enabled && agent.name.trim())
    .sort((left, right) => left.name.localeCompare(right.name));
  const enabledAgents = enabledAgentList.map((agent) => agent.name);

  if (enabledAgents.length === 0) return null;

  const agentDescriptions = enabledAgentList
    .map((agent) => `- ${agent.name}: ${agent.description || "No description."}`)
    .join("\n");

  return {
    id: "builtin-call-agent",
    name: CALL_AGENT_TOOL_NAME,
    enabled: true,
    description: [
      "Delegate a focused subtask to one configured agent. Use this when an agent's description closely matches a separable part of the user's request. The agent result will be returned so you can continue the final answer.",
      "Built-in defaults: general is task-only and best for focused subtasks; general_full receives the full chat context and is best when the whole conversation matters.",
      "Available agents:",
      agentDescriptions,
    ].join("\n"),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentName: {
          type: "string",
          enum: enabledAgents,
          description: "Name of the configured agent to call.",
        },
        task: {
          type: "string",
          description:
            "Focused task for the agent. Include all important constraints and what output you need back.",
        },
      },
      required: ["agentName", "task"],
    },
    command: "",
    args: [],
    input: "none",
    timeoutMs: 0,
  };
}

export function createLoadSkillTool(
  availableSkills: LoadedSkillInfo[],
): LoadedToolInfo | null {
  const selectableSkills = availableSkills
    .filter(
      (skill) =>
        skill.name.trim() &&
        skill.description.trim(),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  if (selectableSkills.length === 0) return null;

  const skillList = selectableSkills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");

  return {
    id: "builtin-skill",
    name: LOAD_SKILL_TOOL_NAME,
    enabled: true,
    description: [
      "Load the full instructions for one relevant skill by name.",
      "Use this when a skill would materially improve the task. Loading a skill returns its SKILL.md content and tells you how to resolve relative references. You may load the same skill again if the previous load may no longer be in context.",
      "Available skills:",
      skillList,
    ].join("\n"),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description:
            "Exact skill name to load from the available skills list.",
          enum: selectableSkills.map((skill) => skill.name),
        },
      },
      required: ["name"],
    },
    command: "",
    args: [],
    input: "none",
    timeoutMs: 0,
  };
}

export function isValidToolName(toolName: string) {
  return TOOL_NAME_PATTERN.test(toolName);
}

export function isBuiltInToolName(toolName: string) {
  return (
    toolName === ASK_USER_TOOL_NAME ||
    isTaskToolName(toolName) ||
    toolName === LOAD_SKILL_TOOL_NAME ||
    toolName === WEB_FETCH_TOOL_NAME ||
    isFileToolName(toolName) ||
    isLegacyFileToolName(toolName) ||
    toolName === TERMINAL_EXEC_TOOL_NAME ||
    toolName === CALL_AGENT_TOOL_NAME
  );
}


export function isTaskToolName(toolName: string) {
  return (
    toolName === TASK_UPDATE_TOOL_NAME ||
    LEGACY_TASK_TOOL_NAMES.includes(
      toolName as (typeof LEGACY_TASK_TOOL_NAMES)[number],
    )
  );
}

function getToolArgValue(args: unknown, key: string) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    !(key in args)
  ) {
    throw new Error(`Missing required tool argument: ${key}`);
  }

  return (args as Record<string, unknown>)[key];
}

function stringifyCommandArgValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function materializeCommandArgs(templateArgs: string[], modelArgs: unknown) {
  const templatePattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

  return templateArgs.map((templateArg) =>
    templateArg.replace(templatePattern, (_full, key: string) =>
      stringifyCommandArgValue(getToolArgValue(modelArgs, key)),
    ),
  );
}

function quoteCommandPreviewPart(value: string) {
  if (!value) return '""';
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function formatCommandPreview(command: string, args: string[]) {
  return [command, ...args].map(quoteCommandPreviewPart).join(" ");
}

function buildCustomToolApprovalCommand(
  toolCall: ChatToolCall,
  tool?: Pick<LoadedToolInfo, "command" | "args">,
) {
  const command = tool?.command?.trim();
  if (!command) return undefined;

  try {
    const modelArgs = parseToolArgumentsText(toolCall.function.arguments || "{}");
    return formatCommandPreview(
      command,
      materializeCommandArgs(tool?.args ?? [], modelArgs),
    );
  } catch {
    return formatCommandPreview(command, tool?.args ?? []);
  }
}

export function createToolApprovalRequest(
  toolCall: ChatToolCall,
  tool?: Pick<LoadedToolInfo, "name" | "description" | "command" | "args" | "source" | "displayName" | "mcp">,
): FileToolApprovalRequest {
  const description = tool?.description?.trim();
  const command = buildCustomToolApprovalCommand(toolCall, tool);
  const sourceLabel = tool?.source === "mcp" ? "MCP tool" : "custom tool";

  if (isFileToolName(toolCall.function.name)) {
    return parseFileToolApprovalRequestFromToolCall(toolCall);
  }

  return {
    title: "Approve tool execution",
    description: `The model wants to run a ${sourceLabel} \`${toolCall.function.name}\`.`,
    toolName: toolCall.function.name,
    action: "operation",
    details: [
      ...(tool?.displayName ? [{ label: "Tool", value: tool.displayName }] : []),
      ...(tool?.mcp?.serverName ? [{ label: "MCP server", value: tool.mcp.serverName }] : []),
      ...(description ? [{ label: "Description", value: description }] : []),
      ...(command ? [{ label: "Command", value: command }] : []),
      { label: "Approval mode", value: "Manual user approval required" },
    ],
  };
}


export function requiresToolApproval(
  toolName: string,
  tool?: Pick<LoadedToolInfo, "requiresApproval">,
) {
  if (tool?.requiresApproval === false) return false;
  return (
    toolName === TERMINAL_EXEC_TOOL_NAME ||
    requiresFileToolApproval(toolName) ||
    tool?.requiresApproval === true
  );
}

export function getFileToolApprovalAction(toolName: string) {
  if (toolName === EDIT_TOOL_NAME) return "edit";
  if (toolName === WRITE_TOOL_NAME) return "write";
  if (toolName === BASH_TOOL_NAME) return "command";
  if (toolName === READ_TOOL_NAME) return "read";
  return "operation";
}


function readFileToolPath(args: unknown) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return "unknown file";
  }

  const value = (args as Record<string, unknown>).path;
  return typeof value === "string" && value.trim() ? value.trim() : "unknown file";
}

function readFileToolRootId(args: unknown) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }

  const value = (args as Record<string, unknown>).rootId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAbsoluteLikePath(value: string) {
  return (
    /^[/\\]/.test(value) ||
    /^[a-zA-Z]:[/\\]/.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/.test(value)
  );
}

function joinWorkspacePath(rootPath: string, requestedPath: string) {
  const trimmedRoot = rootPath.replace(/[\\/]+$/, "");
  const trimmedPath = requestedPath.replace(/^[\\/]+/, "");
  const separator = /\\|^[a-zA-Z]:/.test(rootPath) ? "\\" : "/";
  return `${trimmedRoot}${separator}${trimmedPath}`;
}

function resolveFileToolDisplayPath(
  requestedPath: string,
  rootId: string | undefined,
  workspaceRoots?: ChatWorkspaceRoot[],
) {
  if (!requestedPath || requestedPath === "unknown file") return requestedPath;
  if (isAbsoluteLikePath(requestedPath)) return requestedPath;

  const roots = workspaceRoots ?? [];
  const root = rootId
    ? roots.find((candidate) => candidate.id === rootId)
    : roots.length === 1
      ? roots[0]
      : undefined;

  return root ? joinWorkspacePath(root.path, requestedPath) : requestedPath;
}

export function createFileToolApprovalRequest(
  toolName: string,
  args: unknown,
  workspaceRoots?: ChatWorkspaceRoot[],
): FileToolApprovalRequest {
  const requestedPath = readFileToolPath(args);
  const filePath = resolveFileToolDisplayPath(requestedPath, undefined, workspaceRoots);
  const source = args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};

  if (toolName === BASH_TOOL_NAME) {
    const commandValue = typeof source.command === "string" ? source.command.trim() : "";
    const timeoutValue = typeof source.timeout === "number" && Number.isFinite(source.timeout)
      ? `${Math.round(source.timeout)} s`
      : "No timeout";

    return {
      title: "Approve bash command",
      description: "The model wants to run a bash command inside the selected workspace.",
      toolName,
      action: "operation",
      details: [
        { label: "Command", value: commandValue || "Missing command" },
        { label: "Workspace", value: workspaceRoots?.[0]?.path ?? "No workspace selected" },
        { label: "Timeout", value: timeoutValue },
        { label: "Approval mode", value: "Manual user approval required" },
      ],
    };
  }

  if (toolName === EDIT_TOOL_NAME) {
    const edits = Array.isArray(source.edits) ? source.edits : [];
    return {
      title: "Approve file edit",
      description: "The model wants to edit a file in the selected workspace.",
      toolName,
      action: "replacement",
      path: filePath,
      details: [
        { label: "Edit count", value: String(edits.length) },
        { label: "Scope", value: "Selected workspace" },
      ],
    };
  }

  if (toolName === WRITE_TOOL_NAME) {
    const content = typeof source.content === "string" ? source.content : "";
    return {
      title: "Approve file write",
      description: "The model wants to create or overwrite a file in the selected workspace.",
      toolName,
      action: "creation",
      path: filePath,
      details: [
        { label: "Content length", value: String(content.length) },
        { label: "Parent folders", value: "Created automatically" },
        { label: "Scope", value: "Selected workspace" },
      ],
    };
  }

  return {
    title: "Approve file read",
    description: "The model wants to read a file from the selected workspace.",
    toolName,
    action: "operation",
    path: filePath,
    details: [{ label: "Scope", value: "Selected workspace" }],
  };
}


export function parseFileToolApprovalRequestFromToolCall(
  toolCall: ChatToolCall,
  workspaceRoots?: ChatWorkspaceRoot[],
) {
  return createFileToolApprovalRequest(
    toolCall.function.name,
    parseToolArgumentsText(toolCall.function.arguments || "{}"),
    workspaceRoots,
  );
}

export function isFileToolApprovalResponseApproved(
  response: FileToolApprovalResponse,
) {
  return response.approved;
}

export function createCancelledToolResult(
  toolCall: ChatToolCall,
  action = getFileToolApprovalAction(toolCall.function.name),
): ChatToolResult {
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    content: JSON.stringify(
      { ok: false, cancelled: true, message: `User cancelled ${action}.` },
      null,
      2,
    ),
    isError: true,
  };
}

export const createCancelledFileToolResult = createCancelledToolResult;

export function compareToolsByDisplayOrder(
  left: Pick<LoadedToolInfo, "name">,
  right: Pick<LoadedToolInfo, "name">,
) {
  const leftIsBuiltIn = isBuiltInToolName(left.name);
  const rightIsBuiltIn = isBuiltInToolName(right.name);

  if (leftIsBuiltIn !== rightIsBuiltIn) return leftIsBuiltIn ? -1 : 1;

  return left.name.localeCompare(right.name);
}

function parseMentionNames(content: string, sourcePattern: RegExp) {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(sourcePattern);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const name = match[2]?.trim();
    if (!name || seen.has(name)) continue;

    seen.add(name);
    names.push(name);
  }

  return names;
}

export function parseToolMentionNames(content: string) {
  return parseMentionNames(content, TOOL_MENTION_PATTERN);
}

export function parseSkillMentionNames(content: string) {
  return parseMentionNames(content, SKILL_MENTION_PATTERN);
}

export function parseAgentMentionNames(content: string) {
  return parseMentionNames(content, AGENT_MENTION_PATTERN);
}

export function parseCallAgentRequestFromToolCall(toolCall: ChatToolCall) {
  const args = parseToolArgumentsText(toolCall.function.arguments || "{}");
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("call_agent arguments must be a JSON object.");
  }

  const source = args as Record<string, unknown>;
  const agentName = typeof source.agentName === "string" ? source.agentName.trim() : "";
  const task = typeof source.task === "string" ? source.task.trim() : "";

  if (!agentName) throw new Error("call_agent requires agentName.");
  if (!task) throw new Error("call_agent requires task.");

  return { agentName, task };
}

export function createAgentToolResult({
  toolCall,
  agentName,
  output,
  isError = false,
}: {
  toolCall: ChatToolCall;
  agentName: string;
  output: string;
  isError?: boolean;
}): ChatToolResult {
  return {
    toolCallId: toolCall.id,
    toolName: CALL_AGENT_TOOL_NAME,
    content: JSON.stringify(
      {
        ok: !isError,
        agentName,
        output,
      },
      null,
      2,
    ),
    isError,
  };
}

export function getAskUserQuestionType(
  question: AskUserQuestion,
): AskUserQuestionType {
  if (
    question.type === "multi_select" ||
    question.type === "text" ||
    question.type === "single_choice"
  ) {
    return question.type;
  }

  return "single_choice";
}

export function parseToolArgumentsText(value: string) {
  return value.trim() ? JSON.parse(value) : {};
}

function readTrimmedString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readLimitedString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
  label: string,
) {
  const value = readTrimmedString(source, key);
  if (value && value.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or less.`);
  }
  return value;
}

function readAskUserQuestionType(
  source: Record<string, unknown>,
): AskUserQuestionType {
  const value = readTrimmedString(source, "type");
  if (
    value === "single_choice" ||
    value === "multi_select" ||
    value === "text"
  ) {
    return value;
  }

  return "single_choice";
}

export function parseAskUserRequest(args: unknown): AskUserRequest {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("ask_user arguments must be a JSON object.");
  }

  const source = args as Record<string, unknown>;
  const rawQuestions = Array.isArray(source.questions)
    ? source.questions
    : typeof source.question === "string" && Array.isArray(source.options)
      ? [
          {
            id: readTrimmedString(source, "id") ?? "answer",
            question: source.question,
            description: source.description,
            options: source.options,
          },
        ]
      : undefined;

  if (!rawQuestions?.length) {
    throw new Error("ask_user requires at least one question.");
  }

  if (rawQuestions.length > MAX_ASK_USER_QUESTIONS) {
    throw new Error(
      `ask_user supports at most ${MAX_ASK_USER_QUESTIONS} questions.`,
    );
  }

  const questionIds = new Set<string>();
  const questions = rawQuestions.map((rawQuestion, questionIndex) => {
    if (
      !rawQuestion ||
      typeof rawQuestion !== "object" ||
      Array.isArray(rawQuestion)
    ) {
      throw new Error("Each ask_user question must be an object.");
    }

    const questionSource = rawQuestion as Record<string, unknown>;
    const id =
      readTrimmedString(questionSource, "id") ??
      `question_${questionIndex + 1}`;
    const question = readLimitedString(
      questionSource,
      "question",
      MAX_ASK_USER_QUESTION_LENGTH,
      `ask_user question ${id}`,
    );

    if (!question) {
      throw new Error(`ask_user question ${id} is missing text.`);
    }

    if (questionIds.has(id)) {
      throw new Error(`Duplicate ask_user question id: ${id}.`);
    }
    questionIds.add(id);

    const type = readAskUserQuestionType(questionSource);
    const rawOptions = questionSource.options;
    const options = (() => {
      if (type === "text") return [];

      if (!Array.isArray(rawOptions) || rawOptions.length < 2) {
        throw new Error(
          `ask_user ${type} question ${id} requires at least two options.`,
        );
      }

      if (rawOptions.length > MAX_ASK_USER_OPTIONS) {
        throw new Error(
          `ask_user question ${id} supports at most ${MAX_ASK_USER_OPTIONS} options.`,
        );
      }

      const optionIds = new Set<string>();
      return rawOptions.map((rawOption, optionIndex) => {
        if (
          !rawOption ||
          typeof rawOption !== "object" ||
          Array.isArray(rawOption)
        ) {
          throw new Error(
            `ask_user option ${optionIndex + 1} must be an object.`,
          );
        }

        const optionSource = rawOption as Record<string, unknown>;
        const optionId =
          readTrimmedString(optionSource, "id") ?? `option_${optionIndex + 1}`;
        const label = readLimitedString(
          optionSource,
          "label",
          MAX_ASK_USER_OPTION_LABEL_LENGTH,
          `ask_user option ${optionId} label`,
        );

        if (!label) {
          throw new Error(`ask_user option ${optionId} is missing a label.`);
        }

        if (optionId === ASK_USER_CUSTOM_ANSWER_ID) {
          throw new Error(
            `ask_user option id ${ASK_USER_CUSTOM_ANSWER_ID} is reserved for custom answers.`,
          );
        }

        if (optionIds.has(optionId)) {
          throw new Error(
            `Duplicate ask_user option id ${optionId} in question ${id}.`,
          );
        }
        optionIds.add(optionId);

        return {
          id: optionId,
          label,
          description: readLimitedString(
            optionSource,
            "description",
            MAX_ASK_USER_OPTION_DESCRIPTION_LENGTH,
            `ask_user option ${optionId} description`,
          ),
        };
      });
    })();

    return {
      id,
      type,
      question,
      description: readLimitedString(
        questionSource,
        "description",
        MAX_ASK_USER_DESCRIPTION_LENGTH,
        `ask_user question ${id} description`,
      ),
      options,
    };
  });

  return {
    title: readLimitedString(
      source,
      "title",
      MAX_ASK_USER_TITLE_LENGTH,
      "ask_user title",
    ),
    description: readLimitedString(
      source,
      "description",
      MAX_ASK_USER_DESCRIPTION_LENGTH,
      "ask_user description",
    ),
    questions,
  };
}

export function parseAskUserRequestFromToolCall(toolCall: ChatToolCall) {
  return parseAskUserRequest(
    parseToolArgumentsText(toolCall.function.arguments || "{}"),
  );
}

export function parseTaskUpdateRequest(args: unknown): { tasks: AgentTask[] } {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`${TASK_UPDATE_TOOL_NAME} arguments must be a JSON object.`);
  }

  const source = args as Record<string, unknown>;
  if (!Array.isArray(source.tasks)) {
    throw new Error(`${TASK_UPDATE_TOOL_NAME} requires a tasks array.`);
  }

  if (source.tasks.length > MAX_TASKS) {
    throw new Error(`${TASK_UPDATE_TOOL_NAME} supports at most ${MAX_TASKS} tasks.`);
  }

  const seen = new Set<string>();
  const tasks: AgentTask[] = [];

  for (const raw of source.tasks) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.subject !== "string") continue;

    const subject = item.subject.trim().replace(/\s+/g, " ");
    if (!subject) continue;
    if (subject.length > MAX_TASK_SUBJECT_LENGTH) {
      throw new Error(
        `${TASK_UPDATE_TOOL_NAME} subject must be ${MAX_TASK_SUBJECT_LENGTH} characters or less.`,
      );
    }

    const key = subject.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    tasks.push({ subject, done: item.done === true });
  }

  return { tasks };
}

export function parseTaskToolRequestFromToolCall(toolCall: ChatToolCall) {
  return parseTaskUpdateRequest(
    parseToolArgumentsText(toolCall.function.arguments || "{}"),
  );
}

export function createTaskToolResult({
  toolCall,
  tasks,
}: {
  toolCall: ChatToolCall;
  tasks: AgentTask[];
}): ChatToolResult {
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    content: JSON.stringify({ tasks }, null, 2),
  };
}

export function createAskUserToolResult(
  toolCall: ChatToolCall,
  request: AskUserRequest,
  response: AskUserResponse,
): ChatToolResult {
  const answers = Object.fromEntries(
    request.questions.map((question) => {
      const questionType = getAskUserQuestionType(question);

      if (questionType === "text") {
        const answer = response.answers[question.id] ?? "";
        return [
          question.id,
          {
            question: question.question,
            answer_type: "text",
            answer,
          },
        ];
      }

      if (questionType === "multi_select") {
        const selectedOptionIds = response.multiAnswers?.[question.id] ?? [];
        const selectedOptionLabels = selectedOptionIds.map((optionId) => {
          if (optionId === ASK_USER_CUSTOM_ANSWER_ID) {
            return response.customAnswers?.[question.id]?.trim() ?? "";
          }

          return (
            question.options.find((option) => option.id === optionId)?.label ??
            optionId
          );
        });
        const customAnswer = selectedOptionIds.includes(
          ASK_USER_CUSTOM_ANSWER_ID,
        )
          ? response.customAnswers?.[question.id]?.trim()
          : undefined;

        return [
          question.id,
          {
            question: question.question,
            answer_type: "multi_select",
            selected_option_ids: selectedOptionIds,
            selected_option_labels: selectedOptionLabels,
            ...(customAnswer ? { custom_answer: customAnswer } : {}),
          },
        ];
      }

      const selectedOptionId = response.answers[question.id] ?? "";
      const selectedOption = question.options.find(
        (option) => option.id === selectedOptionId,
      );
      const customAnswer =
        selectedOptionId === ASK_USER_CUSTOM_ANSWER_ID
          ? response.customAnswers?.[question.id]?.trim()
          : undefined;

      return [
        question.id,
        {
          question: question.question,
          answer_type: customAnswer ? "custom" : "option",
          selected_option_id: selectedOptionId,
          selected_option_label:
            response.answerLabels?.[question.id] ??
            customAnswer ??
            selectedOption?.label ??
            selectedOptionId,
          ...(customAnswer ? { custom_answer: customAnswer } : {}),
        },
      ];
    }),
  );

  return {
    toolCallId: toolCall.id,
    toolName: ASK_USER_TOOL_NAME,
    content: JSON.stringify(
      {
        answered_at: response.answeredAt,
        answers,
      },
      null,
      2,
    ),
  };
}
