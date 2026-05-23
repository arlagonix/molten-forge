import type {
  AskUserQuestion,
  AskUserQuestionType,
  AskUserRequest,
  AskUserResponse,
  ChatToolCall,
  ChatToolResult,
  ChecklistItem,
  ChecklistWriteRequest,
  LoadedSkillInfo,
  LoadedToolInfo,
  SkillsSettings,
  ToolsSettings,
} from "@/lib/ai-chat/types";

export const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  enabled: true,
  askUserEnabled: true,
  checklistWriteEnabled: true,
  loadSkillEnabled: true,
  webFetchEnabled: false,
};

export const DEFAULT_SKILLS_SETTINGS: SkillsSettings = {
  enabled: true,
};

export const ASK_USER_TOOL_NAME = "ask_user";
export const CHECKLIST_WRITE_TOOL_NAME = "checklist_write";
export const LOAD_SKILL_TOOL_NAME = "load_skill";
export const WEB_FETCH_TOOL_NAME = "web_fetch";
export const ASK_USER_CUSTOM_ANSWER_ID = "__custom__";

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOOL_MENTION_PATTERN = /(^|\s)@tool:([A-Za-z0-9_-]+)(?=$|\s)/g;
const SKILL_MENTION_PATTERN = /(^|\s)@skill:([A-Za-z0-9_-]+)(?=$|\s)/g;
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
    toolName === WEB_FETCH_TOOL_NAME
  );
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
