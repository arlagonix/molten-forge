/**
 * Molten Forge AI generation adapter.
 *
 * This module is the single execution layer for all model generation in the
 * app. It hides the Vercel AI SDK Core (`ai`) and the
 * `@ai-sdk/openai-compatible` provider behind Molten Forge's own
 * provider/generation interface so the rest of the app keeps talking to the
 * existing IPC contract.
 *
 * Design notes:
 * - The renderer still builds a complete OpenAI-compatible request `payload`
 *   (messages with reasoning history, tools, reasoning controls, sampling
 *   settings, local-model-only fields such as `enable_thinking`,
 *   `chat_template_kwargs`, `reasoning_effort`, ...). We must not lose any of
 *   it. We therefore feed that exact body to the provider through the official
 *   `transformRequestBody` hook, while the AI SDK handles the HTTP request,
 *   SSE parsing, tool-call assembly, usage/finish reporting, cancellation and
 *   error normalization.
 * - Reasoning is normalized at the adapter level from the raw provider chunks
 *   (`includeRawChunks`) exactly the way the previous direct client did, so
 *   `reasoning_content`, `reasoning`, `thinking`, and `reasoning_details` from
 *   local models keep working and the existing reasoning UI is preserved.
 * - Tools are converted to AI SDK tool definitions WITHOUT an `execute`
 *   function so the SDK never auto-runs them. Molten Forge remains in full
 *   control of approval, display, and tool-result continuation.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  generateText,
  jsonSchema,
  streamText,
  tool,
  type ToolSet,
} from "ai";

export type ChatTokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatReasoningMetadata = {
  reasoningContent?: string;
  reasoningDetails?: unknown[];
};

export type AdapterToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type AdapterStreamResult = {
  usage?: ChatTokenUsage;
  finishReason?: string;
  content?: string;
  reasoning?: string;
  reasoningMetadata?: ChatReasoningMetadata;
  toolCalls?: AdapterToolCall[];
};

export type AdapterStreamEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reasoning_metadata"; delta: ChatReasoningMetadata }
  | { type: "tool_call_delta"; toolCalls: AdapterToolCall[] };

export type ChatCompletionResponse = {
  choices: Array<{ message: { content: string } }>;
};

type ProviderCallInput = {
  baseURL: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDeltaText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof (item as { text: unknown }).text === "string"
        ) {
          return (item as { text: string }).text;
        }
        if (
          item &&
          typeof item === "object" &&
          "content" in item &&
          typeof (item as { content: unknown }).content === "string"
        ) {
          return (item as { content: string }).content;
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

export function mergeReasoningMetadata(
  current?: ChatReasoningMetadata,
  delta?: ChatReasoningMetadata,
): ChatReasoningMetadata | undefined {
  if (!delta?.reasoningContent && !delta?.reasoningDetails?.length) {
    return current;
  }

  const reasoningContent = `${current?.reasoningContent ?? ""}${
    delta.reasoningContent ?? ""
  }`;
  const reasoningDetails = [
    ...(current?.reasoningDetails ?? []),
    ...(delta.reasoningDetails ?? []),
  ];

  if (!reasoningContent && reasoningDetails.length === 0) return undefined;

  return {
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(reasoningDetails.length ? { reasoningDetails } : {}),
  };
}

function readChoiceDelta(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const choices =
    "choices" in data ? (data as { choices: unknown }).choices : undefined;
  if (!Array.isArray(choices)) return undefined;
  const delta = choices[0]?.delta;
  return isPlainObject(delta) ? delta : undefined;
}

function readReasoningMetadataDelta(
  data: unknown,
): ChatReasoningMetadata | undefined {
  const delta = readChoiceDelta(data);
  if (!delta) return undefined;

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

function readReasoningDelta(data: unknown): string {
  const delta = readChoiceDelta(data);
  if (!delta) return "";
  return (
    getDeltaText(
      "reasoning_content" in delta ? delta.reasoning_content : undefined,
    ) ||
    getDeltaText("reasoning" in delta ? delta.reasoning : undefined) ||
    getDeltaText("thinking" in delta ? delta.thinking : undefined) ||
    getDeltaText(
      "reasoning_details" in delta ? delta.reasoning_details : undefined,
    )
  );
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

type AiSdkUsage =
  | {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }
  | undefined;

function mapUsage(usage: AiSdkUsage): ChatTokenUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = readNumber(usage.inputTokens);
  const completionTokens = readNumber(usage.outputTokens);
  const totalTokens = readNumber(usage.totalTokens);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return { promptTokens, completionTokens, totalTokens };
}

function mapFinishReason(finishReason: string | undefined): string | undefined {
  if (!finishReason) return undefined;
  // Normalize the AI SDK's hyphenated value back to the OpenAI-style value the
  // rest of the app already understands.
  if (finishReason === "tool-calls") return "tool_calls";
  return finishReason;
}

/**
 * Convert the OpenAI-style tool list carried in the request payload into AI SDK
 * tool definitions. We intentionally omit `execute` so the SDK surfaces tool
 * calls without running them: Molten Forge keeps full control over approval,
 * display, and continuation.
 */
function buildToolSet(payload: Record<string, unknown>): ToolSet | undefined {
  const rawTools = payload.tools;
  if (!Array.isArray(rawTools) || rawTools.length === 0) return undefined;

  const tools: ToolSet = {};
  for (const candidate of rawTools) {
    if (!isPlainObject(candidate)) continue;
    const fn = isPlainObject(candidate.function)
      ? candidate.function
      : undefined;
    const name = typeof fn?.name === "string" ? fn.name.trim() : "";
    if (!name) continue;

    const description =
      typeof fn?.description === "string" ? fn.description : undefined;
    const parameters = isPlainObject(fn?.parameters)
      ? fn?.parameters
      : { type: "object", properties: {} };

    tools[name] = tool({
      description,
      inputSchema: jsonSchema(parameters as Record<string, unknown>),
    });
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}

function getModelId(payload: Record<string, unknown>): string {
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  if (!model) throw new Error("Model name is required.");
  return model;
}

/**
 * Build a provider whose request body is replaced with Molten Forge's fully
 * formed OpenAI-compatible payload. The AI SDK still owns the transport and
 * response parsing; we only guarantee the request body keeps every field the
 * app built (including non-standard local-model fields).
 */
function createProvider({ baseURL, headers, payload }: ProviderCallInput) {
  return createOpenAICompatible({
    name: "molten-forge",
    baseURL,
    headers,
    includeUsage: true,
    transformRequestBody: (args) => ({ ...args, ...payload }),
  });
}

/**
 * Translate AI SDK / provider errors into short, readable messages instead of
 * leaking raw stack traces into the chat UI.
 */
export function normalizeProviderError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") {
    return error as unknown as Error;
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const body =
      typeof error.responseBody === "string" ? error.responseBody.trim() : "";

    if (status === 401 || status === 403) {
      return new Error(
        "The provider rejected the request (unauthorized). Check the API key.",
      );
    }
    if (status === 404) {
      return new Error(
        body ||
          "The provider returned 404. The model or endpoint was not found.",
      );
    }
    if (typeof status === "number" && status >= 400) {
      return new Error(body || `Provider returned HTTP ${status}.`);
    }

    const cause = error.cause;
    const code =
      isPlainObject(cause) && typeof cause.code === "string" ? cause.code : "";
    if (
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ENOTFOUND"
    ) {
      return new Error(
        "Could not connect to the provider. Make sure the server (e.g. LM Studio) is running and the base URL is correct.",
      );
    }

    return new Error(body || error.message || "Provider request failed.");
  }

  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const code =
      isPlainObject(cause) && typeof cause.code === "string" ? cause.code : "";
    if (
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ENOTFOUND"
    ) {
      return new Error(
        "Could not connect to the provider. Make sure the server (e.g. LM Studio) is running and the base URL is correct.",
      );
    }
    return error;
  }

  return new Error(
    typeof error === "string" ? error : "Provider request failed.",
  );
}

/**
 * Non-streaming generation. Returns the minimal OpenAI-style response shape the
 * renderer already reads (`choices[0].message.content`).
 */
export async function runChatCompletion(
  input: ProviderCallInput,
): Promise<ChatCompletionResponse> {
  const provider = createProvider(input);
  const modelId = getModelId(input.payload);
  const tools = buildToolSet(input.payload);

  try {
    const result = await generateText({
      model: provider(modelId),
      ...(tools ? { tools } : {}),
      prompt: ".",
      maxRetries: 0,
    });

    return { choices: [{ message: { content: result.text ?? "" } }] };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

/**
 * Streaming generation. Drives the AI SDK stream and normalizes its parts into
 * the existing app stream-event shape via `onEvent`, returning the same
 * aggregate result the previous direct client returned.
 */
export async function streamChatCompletion({
  baseURL,
  headers,
  payload,
  signal,
  onEvent,
}: ProviderCallInput & {
  signal: AbortSignal;
  onEvent: (event: AdapterStreamEvent) => void;
}): Promise<AdapterStreamResult> {
  const provider = createProvider({ baseURL, headers, payload });
  const modelId = getModelId(payload);
  const tools = buildToolSet(payload);

  let content = "";
  let reasoning = "";
  let usage: ChatTokenUsage | undefined;
  let finishReason: string | undefined;
  let reasoningMetadata: ChatReasoningMetadata | undefined;

  const toolCallOrder: string[] = [];
  const toolCallsById = new Map<string, AdapterToolCall>();

  const collectToolCalls = () =>
    toolCallOrder
      .map((id) => toolCallsById.get(id))
      .filter((call): call is AdapterToolCall => Boolean(call));

  const emitToolCalls = () => {
    onEvent({ type: "tool_call_delta", toolCalls: collectToolCalls() });
  };

  const upsertToolCall = (
    id: string,
    update: (call: AdapterToolCall) => void,
  ) => {
    let call = toolCallsById.get(id);
    if (!call) {
      call = { id, type: "function", function: { name: "", arguments: "" } };
      toolCallsById.set(id, call);
      toolCallOrder.push(id);
    }
    update(call);
  };

  try {
    const result = streamText({
      model: provider(modelId),
      ...(tools ? { tools } : {}),
      prompt: ".",
      abortSignal: signal,
      includeRawChunks: true,
      maxRetries: 0,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          const delta = part.text;
          if (delta) {
            content += delta;
            onEvent({ type: "content", delta });
          }
          break;
        }
        // Reasoning (display + history metadata) is normalized from the raw
        // provider chunks below, exactly like the previous direct client, so
        // `reasoning_content`, `reasoning`, `thinking` and `reasoning_details`
        // all keep working. We deliberately ignore the SDK's typed
        // `reasoning-delta` parts to avoid double-counting reasoning text.
        case "raw": {
          const data = part.rawValue;

          const metadataDelta = readReasoningMetadataDelta(data);
          if (metadataDelta) {
            reasoningMetadata = mergeReasoningMetadata(
              reasoningMetadata,
              metadataDelta,
            );
            onEvent({ type: "reasoning_metadata", delta: metadataDelta });
          }

          const reasoningDelta = readReasoningDelta(data);
          if (reasoningDelta) {
            reasoning += reasoningDelta;
            onEvent({ type: "reasoning", delta: reasoningDelta });
          }
          break;
        }
        case "tool-input-start": {
          upsertToolCall(part.id, (call) => {
            call.function.name = part.toolName;
          });
          emitToolCalls();
          break;
        }
        case "tool-input-delta": {
          upsertToolCall(part.id, (call) => {
            call.function.arguments += part.delta;
          });
          emitToolCalls();
          break;
        }
        case "tool-call": {
          const id = part.toolCallId;
          const args =
            typeof part.input === "string"
              ? part.input
              : JSON.stringify(part.input ?? {});
          upsertToolCall(id, (call) => {
            call.function.name = part.toolName;
            call.function.arguments = args;
          });
          emitToolCalls();
          break;
        }
        case "finish": {
          finishReason = mapFinishReason(part.finishReason);
          usage = mapUsage(part.totalUsage);
          break;
        }
        case "abort": {
          // Cancellation requested; stop consuming and return partial output.
          break;
        }
        case "error": {
          throw normalizeProviderError(part.error);
        }
        default:
          break;
      }
    }

    return {
      usage,
      finishReason,
      content: content || undefined,
      reasoning: reasoning || undefined,
      reasoningMetadata,
      toolCalls: collectToolCalls().filter(
        (call) => call.id && call.function.name,
      ),
    };
  } catch (error) {
    if (signal.aborted) {
      return {
        usage,
        finishReason: finishReason ?? "cancelled",
        content: content || undefined,
        reasoning: reasoning || undefined,
        reasoningMetadata,
        toolCalls: [],
      };
    }
    throw normalizeProviderError(error);
  }
}
