import { defaultGenerationSettings, defaultProvider } from "./provider-presets";
import type {
  ChatAssistantMessage,
  ChatAssistantVariant,
  ChatMessage,
  ChatReasoningMetadata,
  ChatSession,
  ChatThinkingMode,
  ChatTitleMode,
  ChatTokenUsage,
  ProviderConfig,
  ProviderGenerationSettings,
  ProviderModelConfig,
} from "./types";

export const DEFAULT_CHAT_TITLE = "New chat";

export function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function labelForError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error.";
}

export function providerDisplayName(provider: Pick<ProviderConfig, "name">) {
  return provider.name.trim() || "New provider";
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

export function normalizeProviderModels(models: string[]) {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function isProviderEnabled(provider: Pick<ProviderConfig, "enabled">) {
  return provider.enabled !== false;
}

export function getProviderModelIds(provider: ProviderConfig) {
  return normalizeProviderModels([
    ...(provider.models ?? []),
    ...(provider.customModels ?? []),
  ]);
}

export function isCustomProviderModel(provider: ProviderConfig, model: string) {
  const normalizedModel = model.trim();
  return Boolean(
    normalizedModel &&
    normalizeProviderModels(provider.customModels ?? []).includes(
      normalizedModel,
    ),
  );
}

export function isModelShownInMenu(provider: ProviderConfig, model: string) {
  const normalizedModel = model.trim();
  if (!normalizedModel) return false;

  const config = provider.modelConfigs?.[normalizedModel];
  if (typeof config?.showInMenu === "boolean") return config.showInMenu;
  if (typeof config?.enabled === "boolean") return config.enabled;

  if (isCustomProviderModel(provider, normalizedModel)) return true;

  return normalizeProviderModels(provider.enabledModelIds ?? []).includes(
    normalizedModel,
  );
}

export function isModelEnabled(provider: ProviderConfig, model: string) {
  const normalizedModel = model.trim();
  if (!normalizedModel || !isModelShownInMenu(provider, normalizedModel))
    return false;

  const config = provider.modelConfigs?.[normalizedModel];
  if (typeof config?.enabled === "boolean") return config.enabled;

  if (isCustomProviderModel(provider, normalizedModel)) return true;

  return normalizeProviderModels(provider.enabledModelIds ?? []).includes(
    normalizedModel,
  );
}

export function getShownProviderModels(provider: ProviderConfig) {
  return getProviderModelIds(provider).filter((model) =>
    isModelShownInMenu(provider, model),
  );
}

export function getEnabledProviderModels(provider: ProviderConfig) {
  if (!isProviderEnabled(provider)) return [];

  return getShownProviderModels(provider).filter((model) =>
    isModelEnabled(provider, model),
  );
}

export function getProviderFallbackModel(provider: ProviderConfig) {
  const currentModel = provider.model.trim();
  if (
    currentModel &&
    isProviderEnabled(provider) &&
    isModelEnabled(provider, currentModel)
  ) {
    return currentModel;
  }

  return getEnabledProviderModels(provider)[0] || "";
}

export function providerLabel(provider: ProviderConfig) {
  const model =
    getProviderFallbackModel(provider) ||
    provider.model.trim() ||
    "No model selected";
  return `${providerDisplayName(provider)} · ${model}`;
}

export function getModelConfig(
  provider: ProviderConfig,
  model = provider.model,
) {
  const normalizedModel = model.trim();
  return normalizedModel ? provider.modelConfigs?.[normalizedModel] : undefined;
}

export function modelSupportsVision(provider: ProviderConfig, model = provider.model) {
  return getModelConfig(provider, model)?.supportsVision === true;
}

export function getEffectiveModelContext(
  provider: ProviderConfig,
  model = provider.model,
) {
  const context = getModelConfig(provider, model)?.context;
  const manual = context?.manualContextLength;
  const detected = context?.detectedContextLength;
  const speculated = context?.speculatedContextLength;

  if (manual !== undefined && Number.isFinite(manual) && manual > 0) {
    return { length: manual, source: "manual" as const };
  }

  if (detected !== undefined && Number.isFinite(detected) && detected > 0) {
    return { length: detected, source: "detected" as const };
  }

  if (
    speculated !== undefined &&
    Number.isFinite(speculated) &&
    speculated > 0
  ) {
    return { length: speculated, source: "speculated" as const };
  }

  return { length: undefined, source: "unknown" as const };
}

function normalizePositiveOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function normalizeProviderForState(
  provider: ProviderConfig,
): ProviderConfig {
  const legacyEnabledModelIds = normalizeProviderModels(
    provider.enabledModelIds ?? (provider.model ? [provider.model] : []),
  );
  const legacyDefaultSettings = {
    ...defaultGenerationSettings,
    ...(provider.defaultSettings ?? {}),
  };
  const legacyModelSettings = provider.modelSettings ?? {};
  const models = normalizeProviderModels(provider.models ?? []);
  const modelSet = new Set(models);
  const legacyCustomModels = normalizeProviderModels([
    ...legacyEnabledModelIds,
    provider.model ?? "",
    ...Object.keys(legacyModelSettings),
  ]).filter((model) => !modelSet.has(model));
  const customModels = normalizeProviderModels([
    ...(provider.customModels ?? []),
    ...legacyCustomModels,
  ]).filter((model) => !modelSet.has(model));
  const modelIds = normalizeProviderModels([...models, ...customModels]);
  const incomingModelConfigs = provider.modelConfigs ?? {};
  const modelConfigs: Record<string, ProviderModelConfig> = {};

  for (const model of modelIds) {
    const existing = incomingModelConfigs[model] ?? {};
    const legacySettings = legacyModelSettings[model] ?? {};
    const wasLegacyEnabled = legacyEnabledModelIds.includes(model);
    const isCustom = customModels.includes(model);
    const hasExplicitEnabled = typeof existing.enabled === "boolean";
    const hasExplicitShowInMenu = typeof existing.showInMenu === "boolean";
    const defaultEnabled = isCustom || wasLegacyEnabled;
    const enabled = hasExplicitEnabled ? existing.enabled : defaultEnabled;
    const showInMenu = hasExplicitShowInMenu
      ? existing.showInMenu
      : hasExplicitEnabled
        ? enabled
        : defaultEnabled;

    modelConfigs[model] = {
      ...sanitizeGenerationSettings({
        ...legacyDefaultSettings,
        ...legacySettings,
        ...existing,
      }),
      enabled,
      showInMenu,
      supportsVision:
        typeof existing.supportsVision === "boolean"
          ? existing.supportsVision
          : undefined,
      context: {
        ...(existing.context ?? {}),
        manualContextLength: normalizePositiveOptionalNumber(
          existing.context?.manualContextLength,
        ),
        detectedContextLength: normalizePositiveOptionalNumber(
          existing.context?.detectedContextLength,
        ),
        speculatedContextLength: normalizePositiveOptionalNumber(
          existing.context?.speculatedContextLength,
        ),
      },
    } satisfies ProviderModelConfig;
  }

  const preferredModel = provider.model?.trim() ?? "";
  const normalizedProvider: ProviderConfig = {
    ...provider,
    enabled: provider.enabled !== false,
    name: provider.name ?? "",
    baseUrl: provider.baseUrl ?? "",
    apiKey: provider.apiKey ?? "",
    model: preferredModel,
    models,
    customModels,
    modelConfigs,
    enabledModelIds: getEnabledProviderModels({
      ...provider,
      enabled: provider.enabled !== false,
      models,
      customModels,
      modelConfigs,
    }),
    headers: provider.headers ?? {},
    customHeaders: undefined,
    defaultSettings: legacyDefaultSettings,
    modelSettings: provider.modelSettings ?? {},
  };

  const fallbackModel = getProviderFallbackModel(normalizedProvider);
  return {
    ...normalizedProvider,
    model: fallbackModel || preferredModel,
  };
}

export function createProviderId() {
  return `provider-${createId()}`;
}

export function createNewProvider(): ProviderConfig {
  return normalizeProviderForState({
    ...defaultProvider,
    id: createProviderId(),
    name: "New provider",
    baseUrl: "",
    apiKey: "",
    model: "",
    models: [],
    customModels: [],
    enabled: true,
    modelConfigs: {},
    enabledModelIds: [],
    headers: {},
    defaultSettings: defaultGenerationSettings,
    modelSettings: {},
  });
}

export function estimateTokens(text: string) {
  const trimmedText = text.trim();
  if (!trimmedText) return 0;

  return Math.max(1, Math.ceil(trimmedText.length / 4));
}

export function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;

  return `${(durationMs / 1000).toFixed(2)}s`;
}

export function buildTokenMetrics({
  content,
  durationMs,
  usage,
  provider,
  finishReason,
}: {
  content: string;
  durationMs: number;
  usage?: ChatTokenUsage;
  provider: ProviderConfig;
  finishReason?: string;
}) {
  const exactOutputTokens = usage?.completionTokens;
  const outputTokens = exactOutputTokens ?? estimateTokens(content);
  const tokensPerSecond =
    outputTokens > 0 ? outputTokens / (durationMs / 1000) : 0;

  return {
    durationMs,
    tokenUsage: usage,
    outputTokens,
    tokensPerSecond,
    isApproximate: exactOutputTokens === undefined,
    providerName: providerDisplayName(provider),
    model: provider.model,
    finishReason,
  };
}

export function formatOptionalNumber(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? "" : String(value);
}

export function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveChatThinkingSettings(
  thinkingMode?: ChatThinkingMode,
): ProviderGenerationSettings | undefined {
  if (!thinkingMode || thinkingMode === "model_default") return undefined;

  if (thinkingMode === "off") {
    return { reasoningMode: "off", reasoningEffort: "low" };
  }

  return { reasoningMode: "enabled", reasoningEffort: thinkingMode };
}

export function sanitizeGenerationSettings(
  settings: ProviderGenerationSettings,
): ProviderGenerationSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => {
      if (value === undefined) return false;
      if (typeof value === "string") return value.trim().length > 0;
      return true;
    }),
  ) as ProviderGenerationSettings;
}

export function formatMetricDetails(
  metrics: NonNullable<ChatAssistantVariant["metrics"]>,
) {
  const rows = [
    [
      "Duration",
      metrics.durationMs !== undefined
        ? formatDuration(metrics.durationMs)
        : undefined,
    ],
    [
      "Speed",
      metrics.tokensPerSecond !== undefined
        ? `${metrics.isApproximate ? "~" : ""}${metrics.tokensPerSecond.toFixed(1)} tok/s`
        : undefined,
    ],
    [
      "Output tokens",
      metrics.outputTokens !== undefined
        ? `${metrics.isApproximate ? "~" : ""}${metrics.outputTokens}`
        : undefined,
    ],
    ["Prompt tokens", metrics.tokenUsage?.promptTokens],
    ["Completion tokens", metrics.tokenUsage?.completionTokens],
    ["Total tokens", metrics.tokenUsage?.totalTokens],
    ["Finish reason", metrics.finishReason],
    ["Provider", metrics.providerName],
    ["Model", metrics.model],
  ];

  return rows.filter(([, value]) => value !== undefined && value !== "");
}

export function formatTokenMetrics(
  metrics: NonNullable<ChatAssistantVariant["metrics"]>,
) {
  const approximatePrefix = metrics.isApproximate ? "~" : "";
  const outputTokens = metrics.outputTokens ?? 0;
  const tokensPerSecond = metrics.tokensPerSecond ?? 0;
  const totalTokens = metrics.tokenUsage?.totalTokens;

  return [
    `${approximatePrefix}${tokensPerSecond.toFixed(1)} tok/s`,
    formatDuration(metrics.durationMs ?? 0),
    `${approximatePrefix}${outputTokens} output tokens`,
    totalTokens !== undefined ? `${totalTokens} total tokens` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function getActiveVariant(message: ChatAssistantMessage) {
  return message.variants[message.activeVariantIndex] ?? message.variants[0];
}

export function getAssistantContent(message: ChatMessage) {
  if (message.role === "user") return message.content;

  return getActiveVariant(message)?.content ?? "";
}

export function getChatTitleMode(
  chat: Pick<ChatSession, "titleMode">,
): ChatTitleMode {
  return chat.titleMode ?? "manual";
}

export function isAutoTitledChat(chat: Pick<ChatSession, "titleMode">) {
  return getChatTitleMode(chat) === "auto";
}

export function normalizeManualChatTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}

export function titleFromMessage(message: string) {
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^#{1,6}\s+/, "")
    .replace(/^[-*•>]\s+/, "")
    .replace(/^[`'"“”‘’]+|[`'"“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!firstLine) return DEFAULT_CHAT_TITLE;

  const firstSentence = firstLine.match(/^(.{12,}?[.!?])\s+/)?.[1] ?? firstLine;
  const cleanTitle = firstSentence.replace(/[.!?]+$/g, "").trim();
  if (!cleanTitle) return DEFAULT_CHAT_TITLE;

  return cleanTitle.length > 44
    ? `${cleanTitle.slice(0, 44).trimEnd()}...`
    : cleanTitle;
}

function extractTitleFromJson(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      "title" in parsed &&
      typeof parsed.title === "string"
    ) {
      return parsed.title;
    }
  } catch {
    // Ignore non-JSON title responses.
  }

  return undefined;
}

export function cleanGeneratedChatTitle(title: string) {
  const withoutReasoning = title
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json|text|markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const jsonTitle = extractTitleFromJson(withoutReasoning);
  const rawTitle = jsonTitle ?? withoutReasoning;
  const firstUsefulLine = rawTitle
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .find(Boolean);

  if (!firstUsefulLine) return undefined;

  let cleanTitle = firstUsefulLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*•>\d.)\s]+/, "")
    .replace(/^(?:chat\s*)?(?:conversation\s*)?title\s*[:：\-–—]\s*/i, "")
    .replace(/^(?:the\s+)?title\s+(?:is|would\s+be)\s*[:：\-–—]?\s*/i, "")
    .replace(
      /^sure[,\s]+(?:here(?:'s| is)\s+)?(?:a\s+)?(?:concise\s+)?(?:title\s*)?[:：\-–—]?\s*/i,
      "",
    )
    .replace(/^[`'"“”‘’]+|[`'"“”‘’]+$/g, "")
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const titlePrefixMatch = cleanTitle.match(
    /^(?:.*?\btitle\b.*?)[:：]\s*(.+)$/i,
  );
  if (titlePrefixMatch?.[1]) {
    cleanTitle = titlePrefixMatch[1]
      .replace(/^[`'"“”‘’]+|[`'"“”‘’]+$/g, "")
      .replace(/[.!?。！？]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!cleanTitle) return undefined;

  return cleanTitle.length > 60
    ? `${cleanTitle.slice(0, 60).trimEnd()}...`
    : cleanTitle;
}

function getValidDateTime(value?: string) {
  if (!value) return undefined;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function getLatestDateValue(values: Array<string | undefined>) {
  let latestValue: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const time = getValidDateTime(value);
    if (time === undefined || time < latestTime) continue;

    latestValue = value;
    latestTime = time;
  }

  return latestValue;
}

function getMessageActivityDate(message: ChatMessage) {
  if (message.role === "user") return message.createdAt;

  return (
    getLatestDateValue([
      message.createdAt,
      ...message.variants.map((variant) => variant.createdAt),
    ]) ?? message.createdAt
  );
}

export function getChatActivityDate(chat: ChatSession) {
  let latestMessageActivity: string | undefined;
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const value = getMessageActivityDate(chat.messages[index]);
    if (getValidDateTime(value) !== undefined) {
      latestMessageActivity = value;
      break;
    }
  }

  return (
    getLatestDateValue([
      latestMessageActivity,
      chat.updatedAt,
      chat.createdAt,
    ]) ?? chat.updatedAt
  );
}

export function sortChatsByUpdatedAt(chats: ChatSession[]) {
  return [...chats].sort((left, right) => {
    const rightActivityTime = getValidDateTime(getChatActivityDate(right)) ?? 0;
    const leftActivityTime = getValidDateTime(getChatActivityDate(left)) ?? 0;

    return rightActivityTime - leftActivityTime;
  });
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="textbox"]',
    ),
  );
}

export function formatRelativeChatActivityDate(value: string, nowMs = Date.now()) {
  const time = getValidDateTime(value);
  if (time === undefined) return "";

  const elapsedMs = Math.max(0, nowMs - time);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;

  if (elapsedMs < hourMs) {
    return `${Math.max(1, Math.floor(elapsedMs / minuteMs))}m`;
  }

  if (elapsedMs < dayMs) {
    return `${Math.floor(elapsedMs / hourMs)}h`;
  }

  if (elapsedMs < weekMs) {
    return `${Math.floor(elapsedMs / dayMs)}d`;
  }

  if (elapsedMs < monthMs) {
    return `${Math.floor(elapsedMs / weekMs)}w`;
  }

  if (elapsedMs < yearMs) {
    return `${Math.max(1, Math.floor(elapsedMs / monthMs))}mo`;
  }

  return `${Math.max(1, Math.floor(elapsedMs / yearMs))}y`;
}

export function formatChatActivityDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

const CHAT_GROUP_MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getStartOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatChatGroupLabel(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "UNKNOWN DATE";

  if (isSameLocalDay(date, now)) return "TODAY";

  const yesterday = getStartOfLocalDay(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return "YESTERDAY";

  return `${date.getDate()} ${CHAT_GROUP_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export type ChatGroup = {
  label: string;
  chats: ChatSession[];
};

export type GroupedChatList = {
  pinnedChats: ChatSession[];
  groups: ChatGroup[];
};

export function groupChatsByActivityDate(chats: ChatSession[]) {
  const now = new Date();
  const groups: ChatGroup[] = [];

  for (const chat of chats) {
    const label = formatChatGroupLabel(getChatActivityDate(chat), now);
    const lastGroup = groups.at(-1);

    if (lastGroup?.label === label) {
      lastGroup.chats.push(chat);
    } else {
      groups.push({ label, chats: [chat] });
    }
  }

  return groups;
}

export function groupChatsByPinnedAndActivityDate(
  chats: ChatSession[],
): GroupedChatList {
  const sortedChats = sortChatsByUpdatedAt(chats);
  const pinnedChats = sortedChats.filter((chat) => chat.isPinned === true);
  const unpinnedChats = sortedChats.filter((chat) => chat.isPinned !== true);

  return {
    pinnedChats,
    groups: groupChatsByActivityDate(unpinnedChats),
  };
}
