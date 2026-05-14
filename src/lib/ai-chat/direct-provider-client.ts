import type {
  ApiChatMessage,
  ChatMessage,
  ChatTokenUsage,
  ChatToolCall,
  ChatToolResult,
  LoadedToolInfo,
  ProviderConfig,
  ProviderGenerationSettings,
} from "./types";
import { defaultGenerationSettings } from "./provider-presets";

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

function buildApiMessages({
  systemPrompt,
  messages,
  userMessage,
}: {
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage?: string;
}): ApiChatMessage[] {
  const apiMessages: ApiChatMessage[] = [
    ...(systemPrompt.trim()
      ? [{ role: "system" as const, content: systemPrompt.trim() }]
      : []),
  ];

  for (const message of messages) {
    if (message.role === "user") {
      apiMessages.push({ role: "user", content: message.content });
      continue;
    }

    const variant = getActiveAssistantVariant(message);
    if (!variant) continue;

    apiMessages.push({
      role: "assistant",
      content: variant.content,
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

  if (userMessage?.trim()) {
    apiMessages.push({
      role: "user",
      content: userMessage.trim(),
    });
  }

  return apiMessages;
}

export function getActiveModelSettings(provider: ProviderConfig): ProviderGenerationSettings {
  return {
    ...defaultGenerationSettings,
    ...(provider.defaultSettings ?? {}),
    ...(provider.modelSettings?.[provider.model] ?? {}),
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

function shouldSendReasoningControls(provider: ProviderConfig, settings: ProviderGenerationSettings) {
  if (settings.reasoningMode === "off") return false;
  if (settings.reasoningMode === "enabled") return true;
  return modelLooksReasoningCapable(provider.model);
}

function buildReasoningPayload(provider: ProviderConfig, settings: ProviderGenerationSettings) {
  if (!shouldSendReasoningControls(provider, settings)) return {};

  const model = provider.model.toLowerCase();
  const effort = settings.reasoningEffort ?? "medium";

  if (
    model.includes("gpt-oss") ||
    model.includes("openai/") ||
    /(^|[/:-])o[134](?:-|$)/.test(model)
  ) {
    return { reasoning_effort: effort };
  }

  return {
    reasoning: true,
    reasoning_effort: effort,
  };
}

function buildPayload({
  provider,
  systemPrompt,
  messages,
  userMessage,
  stream,
  tools,
}: {
  provider: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage?: string;
  stream: boolean;
  tools?: LoadedToolInfo[];
}) {
  const settings = getActiveModelSettings(provider);
  const temperature = normalizeOptionalNumber(settings.temperature, 0, 2);
  const topP = normalizeOptionalNumber(settings.topP, 0, 1);
  const maxTokens = normalizeOptionalNumber(settings.maxTokens, 1, 1048576);

  return {
    model: provider.model,
    messages: buildApiMessages({ systemPrompt, messages, userMessage }),
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
};

function getModelId(model: ModelLike) {
  if (typeof model.id === "string" && model.id.trim()) return model.id;
  if (typeof model.name === "string" && model.name.trim()) return model.name.replace(/^models\//, "");
  if (typeof model.display_name === "string" && model.display_name.trim()) return model.display_name;
  return undefined;
}

function normalizeModelList(data: unknown) {
  const source = (() => {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && "data" in data && Array.isArray(data.data)) return data.data;
    if (data && typeof data === "object" && "models" in data && Array.isArray(data.models)) return data.models;
    return [];
  })();

  const normalized = source
    .map((model: unknown) => {
      if (typeof model === "string") return model;
      if (!model || typeof model !== "object") return undefined;
      return getModelId(model as ModelLike);
    })
    .filter((model: unknown): model is string => typeof model === "string" && model.trim().length > 0);

  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
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

export async function loadProviderModels(provider: ProviderConfig): Promise<string[]> {
  if (!provider.baseUrl.trim()) {
    throw new Error("Provider base URL is required.");
  }

  const data = await assertElectronBridge().loadModels({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.headers,
  });

  return normalizeModelList(data);
}

export async function sendProviderChat({
  provider,
  systemPrompt,
  messages,
  userMessage,
}: {
  provider: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage: string;
}): Promise<string> {
  if (!provider.baseUrl.trim()) {
    throw new Error("Provider base URL is required.");
  }

  if (!provider.model.trim()) {
    throw new Error("Model name is required.");
  }

  if (!userMessage?.trim() && messages.length === 0) {
    throw new Error("Message is required.");
  }

  const data = await assertElectronBridge().sendChat({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    headers: provider.headers,
    payload: buildPayload({ provider, systemPrompt, messages, userMessage, stream: false }),
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
  toolCalls?: ChatToolCall[];
};

export async function streamProviderChat({
  provider,
  systemPrompt,
  messages,
  userMessage,
  signal,
  tools,
  onContentDelta,
  onReasoningDelta,
}: {
  provider: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  userMessage?: string;
  signal?: AbortSignal;
  tools?: LoadedToolInfo[];
  onContentDelta: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}): Promise<StreamProviderChatResult> {
  if (!provider.baseUrl.trim()) {
    throw new Error("Provider base URL is required.");
  }

  if (!provider.model.trim()) {
    throw new Error("Model name is required.");
  }

  if (!userMessage?.trim() && messages.length === 0) {
    throw new Error("Message is required.");
  }

  let streamedContent = "";
  let streamedReasoning = "";

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
    payload: buildPayload({ provider, systemPrompt, messages, userMessage, stream: true, tools }),
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
      } else if (event.type === "raw") {
        const reasoningDelta = readReasoningDelta(event.data);
        if (reasoningDelta) emitReasoningDelta(reasoningDelta);

        const contentDelta = readContentDelta(event.data);
        if (contentDelta) tagParser.push(contentDelta);
      }
    });

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

    return {
      usage: result.usage ?? undefined,
      finishReason: result.finishReason ?? undefined,
      content: finalContent || undefined,
      reasoning: finalReasoning || undefined,
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
