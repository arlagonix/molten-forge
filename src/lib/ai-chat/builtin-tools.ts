import type {
  AskUserQuestion,
  AskUserQuestionType,
  AskUserRequest,
  AskUserResponse,
  FileToolApprovalRequest,
  FileToolApprovalResponse,
  ChatToolCall,
  ChatToolResult,
  ChatWorkspaceRoot,
  ChecklistItem,
  ChecklistWriteRequest,
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
  checklistWriteEnabled: true,
  loadSkillEnabled: true,
  webFetchEnabled: false,
  fileReadEnabled: true,
  fileFindEnabled: true,
  fileSearchTextEnabled: true,
  fileReplaceTextEnabled: false,
  fileCreateEnabled: true,
  fileDeleteEnabled: false,
};

export const DEFAULT_SKILLS_SETTINGS: SkillsSettings = {
  enabled: true,
};

export const DEFAULT_AGENTS_SETTINGS: AgentsSettings = {
  enabled: true,
};

export const ASK_USER_TOOL_NAME = "ask_user";
export const CHECKLIST_WRITE_TOOL_NAME = "checklist_write";
export const LOAD_SKILL_TOOL_NAME = "load_skill";
export const WEB_FETCH_TOOL_NAME = "web_fetch";
export const FILE_READ_TOOL_NAME = "file_read";
export const FILE_FIND_TOOL_NAME = "file_find";
export const FILE_SEARCH_TEXT_TOOL_NAME = "file_search_text";
export const FILE_REPLACE_TEXT_TOOL_NAME = "file_replace_text";
export const FILE_CREATE_TOOL_NAME = "file_create";
export const FILE_DELETE_TOOL_NAME = "file_delete";
export const FILE_TOOL_NAMES = [
  FILE_READ_TOOL_NAME,
  FILE_FIND_TOOL_NAME,
  FILE_SEARCH_TEXT_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL_NAME,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL_NAME,
] as const;
export const CALL_AGENT_TOOL_NAME = "call_agent";
export const ASK_USER_CUSTOM_ANSWER_ID = "__custom__";

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOOL_MENTION_PATTERN = /(^|\s)@tool:([A-Za-z0-9_-]+)(?=$|\s)/g;
const SKILL_MENTION_PATTERN = /(^|\s)@skill:([A-Za-z0-9_-]+)(?=$|\s)/g;
const AGENT_MENTION_PATTERN = /(^|\s)@agent:([A-Za-z0-9_-]+)(?=$|\s)/g;
const MAX_ASK_USER_QUESTIONS = 5;
const MAX_ASK_USER_OPTIONS = 8;
const MAX_ASK_USER_TITLE_LENGTH = 120;
const MAX_ASK_USER_DESCRIPTION_LENGTH = 500;
const MAX_ASK_USER_QUESTION_LENGTH = 500;
const MAX_ASK_USER_OPTION_LABEL_LENGTH = 160;
const MAX_ASK_USER_OPTION_DESCRIPTION_LENGTH = 300;
const MAX_CHECKLIST_ITEMS = 10;
const MAX_CHECKLIST_CONTENT_LENGTH = 180;

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

export const CHECKLIST_WRITE_TOOL: LoadedToolInfo = {
  id: "builtin-checklist-write",
  name: CHECKLIST_WRITE_TOOL_NAME,
  enabled: true,
  description:
    "Create or update a visible checklist snapshot to track progress during complex multi-step work. Use this for substantial coding, debugging, research, or planning tasks. Keep items short. Each item must explicitly set done to true or false.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        description:
          "Checklist items. Include the full current checklist snapshot. Each item must explicitly set done to true or false.",
        minItems: 1,
        maxItems: MAX_CHECKLIST_ITEMS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: {
              type: "string",
              description: "Short user-visible checklist item.",
            },
            done: {
              type: "boolean",
              description:
                "Whether this item is completed. Always provide true or false.",
            },
          },
          required: ["content", "done"],
        },
      },
    },
    required: ["items"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

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

export const FILE_READ_TOOL: LoadedToolInfo = {
  id: "builtin-file-read",
  name: FILE_READ_TOOL_NAME,
  enabled: true,
  description:
    "Read a UTF-8 text file from one of the chat workspace folders. Use relative paths whenever possible. The tool cannot read outside approved workspace roots.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description:
          "File path to read. Prefer a path relative to the workspace root.",
      },
      rootId: {
        type: "string",
        description:
          "Optional workspace root id. Use this when the chat has multiple workspace roots.",
      },
      maxChars: {
        type: "number",
        description:
          "Optional maximum returned characters. Large files are truncated automatically.",
      },
    },
    required: ["path"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export const FILE_FIND_TOOL: LoadedToolInfo = {
  id: "builtin-file-find",
  name: FILE_FIND_TOOL_NAME,
  enabled: true,
  description:
    "Find files or folders by name/path inside the chat workspace. Use this before reading when you do not know the exact path.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description:
          "Case-insensitive text to match against file and folder names or relative paths. Omit or use an empty string to list top-level entries.",
      },
      rootId: {
        type: "string",
        description:
          "Optional workspace root id. Use this when the chat has multiple workspace roots.",
      },
      include: {
        type: "array",
        description:
          "Optional file extensions to include, such as .ts or .tsx.",
        items: { type: "string" },
      },
      exclude: {
        type: "array",
        description:
          "Optional relative path/name fragments to skip in addition to default excludes.",
        items: { type: "string" },
      },
      maxResults: { type: "number" },
    },
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export const FILE_SEARCH_TEXT_TOOL: LoadedToolInfo = {
  id: "builtin-file-search-text",
  name: FILE_SEARCH_TEXT_TOOL_NAME,
  enabled: true,
  description:
    "Search text file contents inside the chat workspace and return matching paths, line numbers, and snippets. Uses plain substring search, not regex.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "Plain text to search for in files.",
      },
      rootId: {
        type: "string",
        description:
          "Optional workspace root id. Use this when the chat has multiple workspace roots.",
      },
      include: {
        type: "array",
        description:
          "Optional file extensions to include, such as .ts or .tsx.",
        items: { type: "string" },
      },
      exclude: {
        type: "array",
        description:
          "Optional relative path/name fragments to skip in addition to default excludes.",
        items: { type: "string" },
      },
      caseSensitive: { type: "boolean" },
      maxResults: { type: "number" },
    },
    required: ["query"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export const FILE_REPLACE_TEXT_TOOL: LoadedToolInfo = {
  id: "builtin-file-replace-text",
  name: FILE_REPLACE_TEXT_TOOL_NAME,
  enabled: true,
  description:
    "Replace exact text in a UTF-8 text file inside the chat workspace. Requires user confirmation before writing. Use only after reading the target file or matching context.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description:
          "File path to update. Prefer a path relative to the workspace root.",
      },
      rootId: {
        type: "string",
        description:
          "Optional workspace root id. Use this when the chat has multiple workspace roots.",
      },
      oldText: {
        type: "string",
        description: "Exact text currently present in the file.",
      },
      newText: {
        type: "string",
        description: "Replacement text to write.",
      },
      expectedReplacements: {
        type: "number",
        description:
          "Optional exact number of replacements expected. The tool fails if the count differs.",
      },
    },
    required: ["path", "oldText", "newText"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export const FILE_CREATE_TOOL: LoadedToolInfo = {
  id: "builtin-file-create",
  name: FILE_CREATE_TOOL_NAME,
  enabled: true,
  description:
    "Create a new UTF-8 text file inside the chat workspace. Requires user confirmation before writing and fails if the file already exists.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description:
          "New file path to create. Prefer a path relative to the workspace root.",
      },
      rootId: {
        type: "string",
        description:
          "Optional workspace root id. Use this when the chat has multiple workspace roots.",
      },
      content: {
        type: "string",
        description: "UTF-8 text content to write to the new file.",
      },
      createParents: {
        type: "boolean",
        description:
          "Whether to create missing parent folders inside the workspace root. Defaults to false.",
      },
    },
    required: ["path", "content"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export const FILE_DELETE_TOOL: LoadedToolInfo = {
  id: "builtin-file-delete",
  name: FILE_DELETE_TOOL_NAME,
  enabled: true,
  description:
    "Move a workspace file to the operating system Trash. Requires user confirmation and only deletes files, not folders.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description:
          "File path to move to Trash. Prefer a path relative to the workspace root.",
      },
      rootId: {
        type: "string",
        description:
          "Optional workspace root id. Use this when the chat has multiple workspace roots.",
      },
    },
    required: ["path"],
  },
  command: "",
  args: [],
  input: "none",
  timeoutMs: 0,
};

export function createCallAgentTool(agents: LoadedAgentInfo[]): LoadedToolInfo | null {
  const enabledAgents = agents
    .filter((agent) => agent.enabled)
    .map((agent) => agent.name)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  if (enabledAgents.length === 0) return null;

  return {
    id: "builtin-call-agent",
    name: CALL_AGENT_TOOL_NAME,
    enabled: true,
    description:
      "Delegate a focused subtask to one configured agent. Use this when an agent's description closely matches a separable part of the user's request. The agent result will be returned so you can continue the final answer.",
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
    .filter((skill) => skill.name.trim() && skill.description.trim())
    .sort((left, right) => left.name.localeCompare(right.name));

  if (selectableSkills.length === 0) return null;

  const skillList = selectableSkills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");

  return {
    id: "builtin-load-skill",
    name: LOAD_SKILL_TOOL_NAME,
    enabled: true,
    description: [
      "Load the full instructions for one relevant skill and activate it for this chat.",
      "Use this when a skill would materially improve the answer. Do not load skills unnecessarily. Do not load a skill that is already active.",
      "Available skills:",
      skillList,
    ].join("\n"),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        skillName: {
          type: "string",
          description:
            "Exact skill name to load from the available skills list.",
          enum: selectableSkills.map((skill) => skill.name),
        },
      },
      required: ["skillName"],
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
    toolName === CHECKLIST_WRITE_TOOL_NAME ||
    toolName === LOAD_SKILL_TOOL_NAME ||
    toolName === WEB_FETCH_TOOL_NAME ||
    toolName === FILE_READ_TOOL_NAME ||
    toolName === FILE_FIND_TOOL_NAME ||
    toolName === FILE_SEARCH_TEXT_TOOL_NAME ||
    toolName === FILE_REPLACE_TEXT_TOOL_NAME ||
    toolName === FILE_CREATE_TOOL_NAME ||
    toolName === FILE_DELETE_TOOL_NAME ||
    toolName === CALL_AGENT_TOOL_NAME
  );
}

export function isFileToolName(toolName: string) {
  return FILE_TOOL_NAMES.includes(toolName as (typeof FILE_TOOL_NAMES)[number]);
}

export function requiresFileToolApproval(toolName: string) {
  return (
    toolName === FILE_REPLACE_TEXT_TOOL_NAME ||
    toolName === FILE_CREATE_TOOL_NAME ||
    toolName === FILE_DELETE_TOOL_NAME
  );
}

export function getFileToolApprovalAction(toolName: string) {
  if (toolName === FILE_REPLACE_TEXT_TOOL_NAME) return "replacement";
  if (toolName === FILE_CREATE_TOOL_NAME) return "creation";
  if (toolName === FILE_DELETE_TOOL_NAME) return "deletion";
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
  const rootId = readFileToolRootId(args);
  const filePath = resolveFileToolDisplayPath(
    requestedPath,
    rootId,
    workspaceRoots,
  );
  const source = args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};

  if (toolName === FILE_REPLACE_TEXT_TOOL_NAME) {
    const oldText = typeof source.oldText === "string" ? source.oldText : "";
    const newText = typeof source.newText === "string" ? source.newText : "";

    return {
      title: "Approve workspace file edit",
      description: "The model wants to replace text in an approved workspace file.",
      toolName,
      action: "replacement",
      path: filePath,
      details: [
        { label: "Old text length", value: String(oldText.length) },
        { label: "New text length", value: String(newText.length) },
        { label: "Scope", value: "Approved workspace folders only" },
      ],
    };
  }

  if (toolName === FILE_CREATE_TOOL_NAME) {
    const content = typeof source.content === "string" ? source.content : "";
    const createParents = source.createParents === true;

    return {
      title: "Approve workspace file creation",
      description: "The model wants to create a file in an approved workspace folder.",
      toolName,
      action: "creation",
      path: filePath,
      details: [
        { label: "Content length", value: String(content.length) },
        { label: "Create parent folders", value: createParents ? "Yes" : "No" },
        { label: "Scope", value: "Approved workspace folders only" },
      ],
    };
  }

  if (toolName === FILE_DELETE_TOOL_NAME) {
    return {
      title: "Approve workspace file deletion",
      description: "The model wants to move a workspace file to Trash. Folders are not deleted.",
      toolName,
      action: "deletion",
      path: filePath,
      details: [
        { label: "Deletion mode", value: "Move to Trash" },
        { label: "Scope", value: "Approved workspace folders only" },
      ],
    };
  }

  return {
    title: "Approve workspace file operation",
    description: "The model wants to run a workspace file operation.",
    toolName,
    action: "operation",
    path: filePath,
    details: [{ label: "Scope", value: "Approved workspace folders only" }],
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

export function createCancelledFileToolResult(
  toolCall: ChatToolCall,
  action = getFileToolApprovalAction(toolCall.function.name),
): ChatToolResult {
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    content: JSON.stringify(
      { ok: false, cancelled: true, message: `User cancelled file ${action}.` },
      null,
      2,
    ),
    isError: true,
  };
}

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

export function parseChecklistWriteRequest(
  args: unknown,
): ChecklistWriteRequest {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("checklist_write arguments must be a JSON object.");
  }

  const source = args as Record<string, unknown>;
  if (!Array.isArray(source.items) || source.items.length === 0) {
    throw new Error("checklist_write requires at least one checklist item.");
  }

  if (source.items.length > MAX_CHECKLIST_ITEMS) {
    throw new Error(
      `checklist_write supports at most ${MAX_CHECKLIST_ITEMS} items.`,
    );
  }

  const items: ChecklistItem[] = source.items.map((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new Error(`checklist_write item ${index + 1} must be an object.`);
    }

    const itemSource = rawItem as Record<string, unknown>;
    const content = readLimitedString(
      itemSource,
      "content",
      MAX_CHECKLIST_CONTENT_LENGTH,
      `checklist_write item ${index + 1} content`,
    );

    if (!content) {
      throw new Error(`checklist_write item ${index + 1} is missing content.`);
    }

    if (typeof itemSource.done !== "boolean") {
      throw new Error(
        `checklist_write item ${index + 1} must explicitly set done to true or false.`,
      );
    }

    return { content, done: itemSource.done };
  });

  return { items };
}

export function parseChecklistWriteRequestFromToolCall(toolCall: ChatToolCall) {
  return parseChecklistWriteRequest(
    parseToolArgumentsText(toolCall.function.arguments || "{}"),
  );
}

export function createChecklistWriteToolResult(
  toolCall: ChatToolCall,
  request: ChecklistWriteRequest,
): ChatToolResult {
  const done = request.items.filter((item) => item.done).length;

  return {
    toolCallId: toolCall.id,
    toolName: CHECKLIST_WRITE_TOOL_NAME,
    content: JSON.stringify(
      {
        ok: true,
        total: request.items.length,
        done,
      },
      null,
      2,
    ),
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
