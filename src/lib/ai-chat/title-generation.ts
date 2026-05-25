import { cleanGeneratedChatTitle, getAssistantContent } from "./chat-utils";
import { streamProviderChat } from "./direct-provider-client";
import type {
  ChatMessage,
  ProviderConfig,
  ProviderGenerationSettings,
} from "./types";

const TITLE_GENERATION_SYSTEM_PROMPT = `Generate a short, clear chat title for this conversation.

Rules:
- Return only the final title.
- 3 to 7 words.
- No quotes.
- No period.
- Do not mention "chat" or "conversation".
- Do not explain.
- Do not analyze.
- Do not think step by step.
- Do not output reasoning.
- Do not output a preface.`;

const TITLE_GENERATION_SETTINGS: ProviderGenerationSettings = {
  temperature: 0.2,
  topP: 1,
  maxTokens: 1000,
  reasoningMode: "off",
  reasoningEffort: "low",
};

const MANUAL_TITLE_CONTEXT_CHAR_LIMIT = 12_000;
const MESSAGE_CONTEXT_CHAR_LIMIT = 2_000;

function trimMessageContent(
  content: string,
  limit = MESSAGE_CONTEXT_CHAR_LIMIT,
) {
  const trimmed = content.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit).trimEnd()}...`;
}

function formatMessageForTitle(message: ChatMessage) {
  const role = message.role === "user" ? "User" : "Assistant";
  const content = trimMessageContent(getAssistantContent(message));
  if (!content) return undefined;

  return `${role}: ${content}`;
}

function capTitleContext(
  parts: string[],
  limit = MANUAL_TITLE_CONTEXT_CHAR_LIMIT,
) {
  const selected: string[] = [];
  let used = 0;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    const nextUsed = used + part.length + 2;
    if (selected.length > 0 && nextUsed > limit) break;
    selected.unshift(part);
    used = nextUsed;
  }

  return selected.join("\n\n");
}

function buildManualTitleContext(messages: ChatMessage[]) {
  const formattedMessages = messages
    .map(formatMessageForTitle)
    .filter((message): message is string => Boolean(message));

  if (!formattedMessages.length) return "";

  const firstMessage = formattedMessages[0];
  const recentContext = capTitleContext(formattedMessages);

  if (recentContext.includes(firstMessage)) return recentContext;

  return capTitleContext([firstMessage, "...", recentContext]);
}

function buildTitleUserMessage(content: string) {
  return `Generate a very short title for the content below:

${content}`;
}

async function requestGeneratedTitle({
  provider,
  userMessage,
}: {
  provider: ProviderConfig;
  userMessage: string;
}) {
  const chunks: string[] = [];

  const result = await streamProviderChat({
    provider,
    systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
    messages: [],
    userMessage: buildTitleUserMessage(userMessage),
    tools: [],
    settingsOverride: TITLE_GENERATION_SETTINGS,
    onContentDelta: (delta) => {
      chunks.push(delta);
    },
  });

  const content = chunks.join("") || result.content || "";
  const title = cleanGeneratedChatTitle(content);

  if (title) return title;

  // Some reasoning models may still spend the whole small request on hidden
  // reasoning. In that case, keep the existing/local title instead of using
  // reasoning text as a bad title like "Thinking Process".
  return undefined;
}

export async function generateTitleFromFirstExchange({
  provider,
  userMessage,
  assistantMessage,
}: {
  provider: ProviderConfig;
  userMessage: string;
  assistantMessage: string;
}) {
  return requestGeneratedTitle({
    provider,
    userMessage: `User message:
${trimMessageContent(userMessage, 4_000)}

Assistant response:
${trimMessageContent(assistantMessage, 4_000)}`,
  });
}

export async function generateTitleFromChatContext({
  provider,
  messages,
}: {
  provider: ProviderConfig;
  messages: ChatMessage[];
}) {
  const context = buildManualTitleContext(messages);
  if (!context) return undefined;

  return requestGeneratedTitle({
    provider,
    userMessage: `Conversation context:
${context}`,
  });
}
