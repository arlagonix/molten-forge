import type {
  ApiChatMessage,
  ApiContentPart,
  ChatAttachment,
  ChatMessage,
  ChatReasoningMetadata,
  ChatTokenUsage,
  ChatToolCall,
  ChatToolResult,
  LoadedToolInfo,
  ProviderConfig,
  ProviderGenerationSettings,
} from "./types";
import { defaultGenerationSettings } from "./provider-presets";
import { mergeReasoningMetadata } from "./chat-utils";

function getActiveAssistantContent(message: ChatMessage) {
  if (message.role !== "assistant") return message.content;

  const variant = message.variants[message.activeVariantIndex];
  return variant?.content ?? "";
}

function getDeltaText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        if (item && typeof item === "object" && "content" in item && typeof item.content === "string") {
          return item.content;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function getReasoningDetails(value: unknown): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value : [value];
}

function readReasoningMetadataDelta(
  data: unknown,
): ChatReasoningMetadata | undefined {
  if (!data || typeof data !== "object") return undefined;
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return undefined;
  const delta = choices[0]?.delta;
  if (!delta || typeof delta !== "object") return undefined;

  const reasoningContent =
    getDeltaText(
      "reasoning_content" in delta ? delta.reasoning_content : undefined,
    ) || getDeltaText("reasoning" in delta ? delta.reasoning : undefined);
  const reasoningDetails = getReasoningDetails(
    "reasoning_details" in delta ? delta.reasoning_details : undefined,
  );

  if (!reasoningContent && !reasoningDetails?.length) return undefined;

  return {
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(reasoningDetails?.length ? { reasoningDetails } : {}),
  };
}

function readContentDelta(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return "";
  const delta = choices[0]?.delta;
  if (!delta || typeof delta !== "object") return "";
  return getDeltaText("content" in delta ? delta.content : undefined);
}

function readReasoningDelta(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return "";
  const delta = choices[0]?.delta;
  if (!delta || typeof delta !== "object") return "";
  return (
    getDeltaText("reasoning_content" in delta ? delta.reasoning_content : undefined) ||
    getDeltaText("reasoning" in delta ? delta.reasoning : undefined) ||
    getDeltaText("thinking" in delta ? delta.thinking : undefined) ||
    getDeltaText("reasoning_details" in delta ? delta.reasoning_details : undefined)
  );
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readUsage(data: unknown): ChatTokenUsage | undefined {
  if (!data || typeof data !== "object" || !("usage" in data)) return undefined;

  const usage = data.usage;
  if (!usage || typeof usage !== "object") return undefined;

  const promptTokens = readNumber("prompt_tokens" in usage ? usage.prompt_tokens : undefined);
  const completionTokens = readNumber(
    "completion_tokens" in usage ? usage.completion_tokens : undefined,
  );
  const totalTokens = readNumber("total_tokens" in usage ? usage.total_tokens : undefined);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function readFinishReason(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const choices = "choices" in data ? data.choices : undefined;
  if (!Array.isArray(choices)) return undefined;
  const finishReason = choices[0]?.finish_reason;
  return typeof finishReason === "string" ? finishReason : undefined;
}

function getActiveAssistantVariant(message: ChatMessage) {
  if (message.role !== "assistant") return undefined;
  return message.variants[message.activeVariantIndex];
}


function getAttachmentDisplayText(attachment: ChatAttachment) {
  const notices = [
    attachment.error ? `[attachment note: ${attachment.error}]` : "",
    attachment.truncated ? "[truncated]" : "",
  ].filter(Boolean);
  return notices.length ? `\n${notices.join("\n")}` : "";
}

function getAttachmentManifestLine(attachment: ChatAttachment) {
  const workspaceLocation = attachment.workspacePath
    ? `workspacePath: ${attachment.workspacePath}`
    : "workspacePath: unavailable";
  const rootId = attachment.workspaceRootId
    ? `rootId: ${attachment.workspaceRootId}`
    : "rootId: unavailable";
  const size = `${attachment.sizeBytes} bytes`;
  const notes = getAttachmentDisplayText(attachment).trim();
  return `- ${attachment.name} (${attachment.kind}, ${size}; ${rootId}; ${workspaceLocation})${notes ? ` ${notes}` : ""}`;
}

function buildAttachmentManifestBlock(attachments: ChatAttachment[]) {
  const lines: string[] = [];
  const visit = (attachment: ChatAttachment, prefix = "") => {
    lines.push(`${prefix}${getAttachmentManifestLine(attachment)}`);
    for (const child of attachment.children ?? []) visit(child, `${prefix}  `);
  };

  for (const attachment of attachments) visit(attachment);
  if (!lines.length) return "";

  return [
    "The user attached files. If a selected workspace contains these files, use read to inspect them. Otherwise rely on the attachment content already sent in the message.",
    "The available coding tools are read, bash, edit, and write. They do not use rootId.",
    "Attached files:",
    ...lines,
  ].join("\n");
}

async function buildUserApiContent(
  text: string,
  attachments: ChatAttachment[] | undefined,
): Promise<string | ApiContentPart[]> {
  if (!attachments?.length) return text;

  const imageParts: ApiContentPart[] = [];
  const textBlocks: string[] = [];

  const visit = async (attachment: ChatAttachment): Promise<void> => {
    if (attachment.kind !== "image") return;

    try {
      if (attachment.storagePath) {
        const dataUrl = await assertElectronBridge().readAttachmentDataUrl({
          storagePath: attachment.storagePath,
          mimeType: attachment.mimeType,
        });
        imageParts.push({ type: "image_url", image_url: { url: dataUrl } });
      } else if (attachment.thumbnailDataUrl) {
        imageParts.push({
          type: "image_url",
          image_url: { url: attachment.thumbnailDataUrl },
        });
      } else {
        textBlocks.push(
          `\n\n----- Attached image: ${attachment.name} -----\n[attachment missing: image data is unavailable]`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "image file is unavailable";
      textBlocks.push(
        `\n\n----- Attached image: ${attachment.name} -----\n[attachment missing: ${message}]`,
      );
    }
    if (attachment.error) {
      textBlocks.push(
        `\n\n----- Attached image: ${attachment.name} -----${getAttachmentDisplayText(attachment)}`,
      );
    }
  };

  for (const attachment of attachments) {
    await visit(attachment);
  }

  const manifest = buildAttachmentManifestBlock(attachments);
  const combinedText = [text, manifest ? `\n\n${manifest}` : "", ...textBlocks]
    .filter(Boolean)
    .join("");
  return [
    { type: "text", text: combinedText || "Please analyze the attached files." },
    ...imageParts,
  ];
}

async function buildApiMessages({
  provider,
  systemPrompt,
  messages,
  userMessage,
  userAttachments,
  settings,
}: {
  provider: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage?: string;
  userAttachments?: ChatAttachment[];
  settings: ProviderGenerationSettings;
}): Promise<ApiChatMessage[]> {
  const apiMessages: ApiChatMessage[] = [
    ...(systemPrompt.trim()
      ? [{ role: "system" as const, content: systemPrompt.trim() }]
      : []),
  ];

  for (const message of messages) {
    if (message.role === "user") {
      apiMessages.push({
        role: "user",
        content: await buildUserApiContent(message.content, message.attachments),
      });
      continue;
    }

    const variant = getActiveAssistantVariant(message);
    if (!variant) continue;

    const reasoningMetadata = variant.reasoningMetadata;
    const legacyReasoningContent =
      variant.toolCalls?.length &&
      variant.reasoning &&
      modelLooksReasoningCapable(provider.model)
        ? variant.reasoning
        : undefined;
    const reasoningContent =
      reasoningMetadata?.reasoningContent ?? legacyReasoningContent;

    apiMessages.push({
      role: "assistant",
      content: variant.content,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      ...(reasoningMetadata?.reasoningDetails?.length
        ? { reasoning_details: reasoningMetadata.reasoningDetails }
        : {}),
      ...(variant.toolCalls?.length ? { tool_calls: variant.toolCalls } : {}),
    });

    for (const result of variant.toolResults ?? []) {
      apiMessages.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: result.content,
      });
    }
  }

  const finalUserMessage = appendThinkingControlPrompt(
    userMessage?.trim() ?? "",
    provider,
    settings,
  );

  if (finalUserMessage || userAttachments?.length) {
    apiMessages.push({
      role: "user",
      content: await buildUserApiContent(finalUserMessage, userAttachments),
    });
  }

  return apiMessages;
}

export function getActiveModelSettings(provider: ProviderConfig): ProviderGenerationSettings {
  return {
    ...defaultGenerationSettings,
    ...(provider.defaultSettings ?? {}),
    ...(provider.modelSettings?.[provider.model] ?? {}),
    ...(provider.modelConfigs?.[provider.model] ?? {}),
  };
}

function normalizeOptionalNumber(value: number | undefined, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(value, min), max);
}

function modelLooksReasoningCapable(model: string) {
  const normalized = model.toLowerCase();

  return [
    "deepseek-r1",
    "deepseek-reasoner",
    "qwq",
    "qwen3",
    "qwen-3",
    "qwen/qwen3",
    "reason",
    "thinking",
    "think",
    "gpt-oss",
    "o1",
    "o3",
    "o4",
  ].some((marker) => normalized.includes(marker));
}

function isLocalOpenAiCompatibleProvider(provider: ProviderConfig) {
  try {
    const url = new URL(provider.baseUrl);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    const baseUrl = provider.baseUrl.toLowerCase();
    return baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
  }
}

function modelUsesOpenAiReasoningEffort(model: string) {
  const normalized = model.toLowerCase();
  return (
    normalized.includes("gpt-oss") ||
    normalized.includes("openai/") ||
    /(^|[/:-])o[134](?:-|$)/.test(normalized)
  );
}

function modelSupportsQwenSoftSwitch(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.includes("qwen3.5") || normalized.includes("qwen-3.5")) {
    return false;
  }

  return (
    normalized.includes("qwen3") ||
    normalized.includes("qwen-3") ||
    normalized.includes("qwen/qwen3")
  );
}

function shouldSendReasoningControls(
  provider: ProviderConfig,
  settings: ProviderGenerationSettings,
) {
  if (
    settings.reasoningMode !== "off" &&
    settings.reasoningMode !== "enabled"
  ) {
    return false;
  }

  return modelLooksReasoningCapable(provider.model);
}

function buildReasoningPayload(
  provider: ProviderConfig,
  settings: ProviderGenerationSettings,
) {
  if (!shouldSendReasoningControls(provider, settings)) return {};

  const effort = settings.reasoningEffort ?? "medium";
  const isLocalProvider = isLocalOpenAiCompatibleProvider(provider);

  if (settings.reasoningMode === "off") {
    return {
      reasoning_effort: "none",
      ...(isLocalProvider
        ? {
            enable_thinking: false,
            chat_template_kwargs: { enable_thinking: false },
          }
        : {}),
    };
  }

  if (modelUsesOpenAiReasoningEffort(provider.model)) {
    return { reasoning_effort: effort };
  }

  return {
    reasoning: true,
    reasoning_effort: effort,
    ...(isLocalProvider
      ? {
          enable_thinking: true,
          chat_template_kwargs: { enable_thinking: true },
        }
      : {}),
  };
}

function appendThinkingControlPrompt(
  content: string,
  provider: ProviderConfig,
  settings: ProviderGenerationSettings,
) {
  if (!content || !modelSupportsQwenSoftSwitch(provider.model)) return content;

  if (settings.reasoningMode === "off") {
    return `${content}\n/no_think`;
  }

  if (settings.reasoningMode === "enabled") {
    return `${content}\n/think`;
  }

  return content;
}

async function buildPayload({
  provider,
  systemPrompt,
  messages,
  userMessage,
  userAttachments,
  stream,
  tools,
  settingsOverride,
}: {
  provider: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage?: string;
  userAttachments?: ChatAttachment[];
  stream: boolean;
  tools?: LoadedToolInfo[];
  settingsOverride?: ProviderGenerationSettings;
}) {
  const settings = {
    ...getActiveModelSettings(provider),
    ...(settingsOverride ?? {}),
  };
  const temperature = normalizeOptionalNumber(settings.temperature, 0, 2);
  const topP = normalizeOptionalNumber(settings.topP, 0, 1);
  const maxTokens = normalizeOptionalNumber(settings.maxTokens, 1, 1048576);

  return {
    model: provider.model,
    messages: await buildApiMessages({
      provider,
      systemPrompt,
      messages,
      userMessage,
      userAttachments,
      settings,
    }),
    stream,
    ...(tools?.length
      ? {
          tools: tools.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: "auto",
        }
      : {}),
    ...(stream
      ? {
          stream_options: {
            include_usage: true,
          },
        }
      : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...buildReasoningPayload(provider, settings),
  };
}

type ModelLike = {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  [key: string]: unknown;
};

export type LoadedProviderModel = {
  id: string;
  contextLength?: number;
  contextLengthSource?: "detected" | "speculated";
};

function getModelId(model: ModelLike) {
  if (typeof model.id === "string" && model.id.trim()) return model.id;
  if (typeof model.name === "string" && model.name.trim()) return model.name.replace(/^models\//, "");
  if (typeof model.display_name === "string" && model.display_name.trim()) return model.display_name;
  return undefined;
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function readNestedContextLength(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return readPositiveNumber(current);
}

function getModelContextMetadata(model: ModelLike): Pick<LoadedProviderModel, "contextLength" | "contextLengthSource"> {
  const loadedInstances = Array.isArray(model.loaded_instances)
    ? model.loaded_instances
    : [];

  for (const instance of loadedInstances) {
    const detected =
      readNestedContextLength(instance, ["config", "context_length"]) ??
      readNestedContextLength(instance, ["config", "contextLength"]) ??
      readNestedContextLength(instance, ["config", "max_context_length"]) ??
      readNestedContextLength(instance, ["config", "maxContextLength"]);
    if (detected !== undefined) {
      return { contextLength: detected, contextLengthSource: "detected" };
    }
  }

  const detected =
    readNestedContextLength(model, ["top_provider", "context_length"]) ??
    readNestedContextLength(model, ["topProvider", "contextLength"]);
  if (detected !== undefined) {
    return { contextLength: detected, contextLengthSource: "detected" };
  }

  const speculated =
    readPositiveNumber(model.context_length) ??
    readPositiveNumber(model.contextLength) ??
    readPositiveNumber(model.max_context_length) ??
    readPositiveNumber(model.maxContextLength) ??
    readNestedContextLength(model, ["limits", "context"]) ??
    readNestedContextLength(model, ["limit", "context"]);

  if (speculated !== undefined) {
    return { contextLength: speculated, contextLengthSource: "speculated" };
  }

  return {};
}

function normalizeLoadedModelList(data: unknown): LoadedProviderModel[] {
  const source = (() => {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && "data" in data && Array.isArray(data.data)) return data.data;
    if (data && typeof data === "object" && "models" in data && Array.isArray(data.models)) return data.models;
    return [];
  })();

  const byId = new Map<string, LoadedProviderModel>();

  for (const item of source) {
    if (typeof item === "string") {
      const id = item.trim();
      if (id && !byId.has(id)) byId.set(id, { id });
      continue;
    }

    if (!item || typeof item !== "object") continue;
    const id = getModelId(item as ModelLike)?.trim();
    if (!id) continue;

    const context = getModelContextMetadata(item as ModelLike);
    const existing = byId.get(id);
    byId.set(id, {
      id,
      contextLength: existing?.contextLength ?? context.contextLength,
      contextLengthSource: existing?.contextLengthSource ?? context.contextLengthSource,
    });
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function createReasoningTagParser({
  onContentDelta,
  onReasoningDelta,
}: {
  onContentDelta: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}) {
  let mode: "content" | "reasoning" = "content";
  let pending = "";
  const openTag = /<(think|thinking|reasoning|reason|thought)>/i;
  const closeTag = /<\/(think|thinking|reasoning|reason|thought)>/i;
  const longestTagLength = "</reasoning>".length;

  function emitSafely(text: string, emit: (delta: string) => void, keepTagType: "open" | "close") {
    if (!text) return "";

    const lower = text.toLowerCase();
    const possibleTags = keepTagType === "open"
      ? ["<think>", "<thinking>", "<reasoning>", "<reason>", "<thought>"]
      : ["</think>", "</thinking>", "</reasoning>", "</reason>", "</thought>"];

    let keepLength = 0;
    const maxKeep = Math.min(longestTagLength - 1, text.length);
    for (let length = 1; length <= maxKeep; length += 1) {
      const suffix = lower.slice(-length);
      if (possibleTags.some((tag) => tag.startsWith(suffix))) {
        keepLength = length;
      }
    }

    const emitText = keepLength ? text.slice(0, -keepLength) : text;
    if (emitText) emit(emitText);
    return keepLength ? text.slice(-keepLength) : "";
  }

  function push(delta: string) {
    pending += delta;

    while (pending) {
      if (mode === "content") {
        const match = pending.match(openTag);
        if (!match || match.index === undefined) {
          pending = emitSafely(pending, onContentDelta, "open");
          return;
        }

        const before = pending.slice(0, match.index);
        if (before) onContentDelta(before);
        pending = pending.slice(match.index + match[0].length);
        mode = "reasoning";
      } else {
        const match = pending.match(closeTag);
        if (!match || match.index === undefined) {
          pending = emitSafely(pending, (text) => onReasoningDelta?.(text), "close");
          return;
        }

        const before = pending.slice(0, match.index);
        if (before) onReasoningDelta?.(before);
        pending = pending.slice(match.index + match[0].length);
        mode = "content";
      }
    }
  }

  function flush() {
    if (!pending) return;
    if (mode === "reasoning") onReasoningDelta?.(pending);
    else onContentDelta(pending);
    pending = "";
  }

  return { push, flush };
}

function assertElectronBridge() {
  if (!window.codeForgeAI) {
    throw new Error("Electron AI bridge is not available.");
  }
  return window.codeForgeAI;
}

export async function loadProviderModels(provider: ProviderConfig): Promise<LoadedProviderModel[]> {
  if (!provider.baseUrl.trim()) {
    throw new Error("Provider base URL is required.");
  }

  const data = await assertElectronBridge().loadModels({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.headers,
  });

  return normalizeLoadedModelList(data);
}

export async function sendProviderChat({
  provider,
  systemPrompt,
  messages,
  userMessage,
  userAttachments,
  settingsOverride,
}: {
  provider: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage: string;
  userAttachments?: ChatAttachment[];
  settingsOverride?: ProviderGenerationSettings;
}): Promise<string> {
  if (!provider.baseUrl.trim()) {
    throw new Error("Provider base URL is required.");
  }

  if (!provider.model.trim()) {
    throw new Error("Model name is required.");
  }

  if (!userMessage?.trim() && !userAttachments?.length && messages.length === 0) {
    throw new Error("Message is required.");
  }

  const data = await assertElectronBridge().sendChat({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.headers,
    payload: await buildPayload({ provider, systemPrompt, messages, userMessage, userAttachments, stream: false, settingsOverride }),
  });

  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("Provider response did not include choices[0].message.content.");
  }

  return content;
}

export type StreamProviderChatResult = {
  usage?: ChatTokenUsage;
  finishReason?: string;
  content?: string;
  reasoning?: string;
  reasoningMetadata?: ChatReasoningMetadata;
  toolCalls?: ChatToolCall[];
};

export async function streamProviderChat({
  provider,
  systemPrompt,
  messages,
  userMessage,
  userAttachments,
  signal,
  tools,
  settingsOverride,
  onContentDelta,
  onReasoningDelta,
  onToolCallDelta,
}: {
  provider: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage?: string;
  userAttachments?: ChatAttachment[];
  signal?: AbortSignal;
  tools?: LoadedToolInfo[];
  settingsOverride?: ProviderGenerationSettings;
  onContentDelta: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onToolCallDelta?: (toolCalls: ChatToolCall[]) => void;
}): Promise<StreamProviderChatResult> {
  if (!provider.baseUrl.trim()) {
    throw new Error("Provider base URL is required.");
  }

  if (!provider.model.trim()) {
    throw new Error("Model name is required.");
  }

  if (!userMessage?.trim() && !userAttachments?.length && messages.length === 0) {
    throw new Error("Message is required.");
  }

  let streamedContent = "";
  let streamedReasoning = "";
  let reasoningMetadata: ChatReasoningMetadata | undefined;
  let receivedReasoningMetadataEvent = false;

  const emitContentDelta = (delta: string) => {
    streamedContent += delta;
    onContentDelta(delta);
  };

  const emitReasoningDelta = (delta: string) => {
    streamedReasoning += delta;
    onReasoningDelta?.(delta);
  };

  const tagParser = createReasoningTagParser({
    onContentDelta: emitContentDelta,
    onReasoningDelta: emitReasoningDelta,
  });

  const stream = assertElectronBridge().streamChat({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.headers,
    payload: await buildPayload({ provider, systemPrompt, messages, userMessage, userAttachments, stream: true, tools, settingsOverride }),
  });

  const abortHandler = () => {
    stream.cancel();
  };

  if (signal) {
    if (signal.aborted) {
      stream.cancel();
      throw new DOMException("Generation was cancelled.", "AbortError");
    }
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    const result = await stream.result((event) => {
      if (event.type === "content") {
        tagParser.push(event.delta);
      } else if (event.type === "reasoning") {
        emitReasoningDelta(event.delta);
      } else if (event.type === "reasoning_metadata") {
        receivedReasoningMetadataEvent = true;
        reasoningMetadata = mergeReasoningMetadata(
          reasoningMetadata,
          event.delta,
        );
      } else if (event.type === "tool_call_delta") {
        onToolCallDelta?.(event.toolCalls);
      } else if (event.type === "raw") {
        reasoningMetadata = mergeReasoningMetadata(
          reasoningMetadata,
          readReasoningMetadataDelta(event.data),
        );

        const reasoningDelta = readReasoningDelta(event.data);
        if (reasoningDelta) emitReasoningDelta(reasoningDelta);

        const contentDelta = readContentDelta(event.data);
        if (contentDelta) tagParser.push(contentDelta);
      }
    });

    if (signal?.aborted) {
      throw new DOMException("Generation was cancelled.", "AbortError");
    }

    tagParser.flush();

    const finalRawContent = typeof result.content === "string" ? result.content : "";
    const finalRawReasoning = typeof result.reasoning === "string" ? result.reasoning : "";
    let finalParsedContent = "";
    let finalParsedReasoning = "";

    if (finalRawContent) {
      const finalParser = createReasoningTagParser({
        onContentDelta: (delta) => {
          finalParsedContent += delta;
        },
        onReasoningDelta: (delta) => {
          finalParsedReasoning += delta;
        },
      });
      finalParser.push(finalRawContent);
      finalParser.flush();
    }

    const finalContent = finalParsedContent || finalRawContent;
    const finalReasoning = `${finalRawReasoning}${finalParsedReasoning}`;

    if (finalContent && !streamedContent) {
      emitContentDelta(finalContent);
    }

    if (finalReasoning && !streamedReasoning) {
      emitReasoningDelta(finalReasoning);
    }

    reasoningMetadata = mergeReasoningMetadata(
      reasoningMetadata,
      receivedReasoningMetadataEvent ? undefined : result.reasoningMetadata,
    );

    return {
      usage: result.usage ?? undefined,
      finishReason: result.finishReason ?? undefined,
      content: finalContent || undefined,
      reasoning: finalReasoning || undefined,
      reasoningMetadata,
      toolCalls: result.toolCalls ?? undefined,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException("Generation was cancelled.", "AbortError");
    }
    throw error;
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

export const __electronRendererParsers = {
  readUsage,
  readFinishReason,
};
