import type { ProviderConfig, ProviderGenerationSettings } from "./types";

export const defaultGenerationSettings: ProviderGenerationSettings = {
  reasoningMode: "off",
  reasoningEffort: "medium",
  requestTimeoutMs: 30000,
};

export const defaultProvider: ProviderConfig = {
  id: "lmstudio",
  name: "LM Studio",
  baseUrl: "http://localhost:1234/v1",
  apiKey: "not-needed",
  model: "",
  models: [],
  customModels: [],
  enabled: true,
  modelConfigs: {},
  enabledModelIds: [],
  headers: {},
  defaultSettings: defaultGenerationSettings,
  modelSettings: {},
};

/** Deprecated: provider presets are no longer shown in settings. */
export const providerPresets: ProviderConfig[] = [defaultProvider];
