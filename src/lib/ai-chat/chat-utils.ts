import { defaultGenerationSettings, defaultProvider } from "./provider-presets";
import type {
  ChatAssistantMessage,
  ChatAssistantVariant,
  ChatMessage,
  ChatSession,
  ChatTokenUsage,
  ProviderConfig,
  ProviderGenerationSettings,
  ProviderModelConfig,
} from "./types";

export function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function labelForError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error.";
}

export function providerDisplayName(provider: Pick<ProviderConfig, "name">) {
  return provider.name.trim() || "New provider";
}

export function normalizeProviderModels(models: string[]) {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function isProviderEnabled(provider: Pick<ProviderConfig, "enabled">) {
  return provider.enabled !== false;
}

export function isModelShownInMenu(provider: ProviderConfig, model: string) {
  const normalizedModel = model.trim();
  if (!normalizedModel) return false;

  const config = provider.modelConfigs?.[normalizedModel];
  if (typeof config?.showInMenu === "boolean") return config.showInMenu;
  if (typeof config?.enabled === "boolean") return config.enabled;

  return normalizeProviderModels(provider.enabledModelIds ?? []).includes(normalizedModel);
}

export function isModelEnabled(provider: ProviderConfig, model: string) {
  const normalizedModel = model.trim();
  if (!normalizedModel || !isModelShownInMenu(provider, normalizedModel)) return false;

  const config = provider.modelConfigs?.[normalizedModel];
  if (typeof config?.enabled === "boolean") return config.enabled;

  return normalizeProviderModels(provider.enabledModelIds ?? []).includes(normalizedModel);
}

export function getShownProviderModels(provider: ProviderConfig) {
  return normalizeProviderModels(provider.models ?? []).filter((model) =>
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
  if (currentModel && isProviderEnabled(provider) && isModelEnabled(provider, currentModel)) {
    return currentModel;
  }

  return getEnabledProviderModels(provider)[0] || "";
}

export function providerLabel(provider: ProviderConfig) {
  const model = getProviderFallbackModel(provider) || provider.model.trim() || "No model selected";
  return `${providerDisplayName(provider)} · ${model}`;
}

export function getModelConfig(provider: ProviderConfig, model = provider.model) {
  const normalizedModel = model.trim();
  return normalizedModel ? provider.modelConfigs?.[normalizedModel] : undefined;
}

export function getEffectiveModelContext(provider: ProviderConfig, model = provider.model) {
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

  if (speculated !== undefined && Number.isFinite(speculated) && speculated > 0) {
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
  const models = normalizeProviderModels([
    ...(provider.models ?? []),
    ...legacyEnabledModelIds,
    provider.model ?? "",
    ...Object.keys(provider.modelConfigs ?? {}),
    ...Object.keys(legacyModelSettings),
  ]);
  const modelConfigs = { ...(provider.modelConfigs ?? {}) };

  for (const model of models) {
    const existing = modelConfigs[model] ?? {};
    const legacySettings = legacyModelSettings[model] ?? {};
    const wasLegacyEnabled = legacyEnabledModelIds.includes(model);
    const hasExplicitEnabled = typeof existing.enabled === "boolean";
    const hasExplicitShowInMenu = typeof existing.showInMenu === "boolean";
    const showInMenu = hasExplicitShowInMenu
      ? existing.showInMenu
      : wasLegacyEnabled;

    modelConfigs[model] = {
      ...sanitizeGenerationSettings({
        ...legacyDefaultSettings,
        ...legacySettings,
        ...existing,
      }),
      enabled: hasExplicitEnabled ? existing.enabled : wasLegacyEnabled,
      showInMenu,
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
    modelConfigs,
    enabledModelIds: getEnabledProviderModels({
      ...provider,
      enabled: provider.enabled !== false,
      models,
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

export function titleFromMessage(message: string) {
  const firstLine = message.replace(/\s+/g, " ").trim();
  if (!firstLine) return "New chat";

  return firstLine.length > 44 ? `${firstLine.slice(0, 44)}...` : firstLine;
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
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const value = getMessageActivityDate(chat.messages[index]);
    if (getValidDateTime(value) !== undefined) return value;
  }

  if (getValidDateTime(chat.createdAt) !== undefined) return chat.createdAt;
  return chat.updatedAt;
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
