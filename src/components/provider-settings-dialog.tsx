"use client";

import {
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  MoreVertical,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  formatOptionalNumber,
  getModelConfig,
  getProviderModelIds,
  getShownProviderModels,
  isModelEnabled,
  isModelShownInMenu,
  isProviderEnabled,
  normalizeProviderForState,
  normalizeProviderModels,
  parseOptionalNumber,
  providerDisplayName,
  sanitizeGenerationSettings,
} from "@/lib/ai-chat/chat-utils";
import {
  getActiveModelSettings,
  loadProviderModels,
} from "@/lib/ai-chat/direct-provider-client";
import { defaultGenerationSettings } from "@/lib/ai-chat/provider-presets";
import { saveCachedProviderModels } from "@/lib/ai-chat/storage";
import type {
  ProviderConfig,
  ProviderGenerationSettings,
  ProviderModelConfig,
  ProvidersState,
} from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const EMPTY_MODEL_CONFIG: ProviderModelConfig = {};

type ModelLoadStatus = "idle" | "success" | "empty" | "error";

type ProviderSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderConfig[];
  activeProvider: ProviderConfig;
  onProvidersStateChange: (
    updater: (state: ProvidersState) => ProvidersState,
  ) => void;
  onProviderSettingChange: (patch: Partial<ProviderConfig>) => void;
  onAddProvider: () => void;
  onDuplicateProvider: (providerId: string) => void;
  onDeleteProvider: (providerId: string) => void;
  onSave: () => void;
  showSuccess: (message: string, description?: string) => void;
};

function modelConfigWithPatch(
  current: ProviderModelConfig | undefined,
  patch: Partial<ProviderModelConfig>,
): ProviderModelConfig {
  return {
    ...(current ?? EMPTY_MODEL_CONFIG),
    ...patch,
  };
}

export const ProviderSettingsDialog = memo(function ProviderSettingsDialog({
  open,
  onOpenChange,
  providers,
  activeProvider,
  onProvidersStateChange,
  onProviderSettingChange,
  onAddProvider,
  onDuplicateProvider,
  onDeleteProvider,
  onSave,
  showSuccess,
}: ProviderSettingsDialogProps) {
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelLoadStatus, setModelLoadStatus] =
    useState<ModelLoadStatus>("idle");
  const [expandedProviderIds, setExpandedProviderIds] = useState<
    Record<string, boolean>
  >({});
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
  const [customModelValue, setCustomModelValue] = useState("");
  const modelLoadStatusTimerRef = useRef<number | null>(null);
  const activeProviderModelIds = useMemo(
    () => getProviderModelIds(activeProvider),
    [activeProvider],
  );

  const selectedModel =
    selectedModelId && activeProviderModelIds.includes(selectedModelId)
      ? selectedModelId
      : undefined;
  const selectedModelSettings = useMemo(
    () =>
      selectedModel
        ? getActiveModelSettings({ ...activeProvider, model: selectedModel })
        : undefined,
    [activeProvider, selectedModel],
  );
  const selectedModelConfig = selectedModel
    ? getModelConfig(activeProvider, selectedModel)
    : undefined;
  useEffect(() => {
    return () => {
      if (modelLoadStatusTimerRef.current !== null) {
        window.clearTimeout(modelLoadStatusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedModelId && !activeProviderModelIds.includes(selectedModelId)) {
      setSelectedModelId(undefined);
    }
  }, [activeProvider.id, activeProviderModelIds, selectedModelId]);

  useEffect(() => {
    setCustomModelValue("");
  }, [activeProvider.id]);

  function setTemporaryModelLoadStatus(
    status: Exclude<ModelLoadStatus, "idle">,
  ) {
    setModelLoadStatus(status);

    if (modelLoadStatusTimerRef.current !== null) {
      window.clearTimeout(modelLoadStatusTimerRef.current);
    }

    modelLoadStatusTimerRef.current = window.setTimeout(() => {
      setModelLoadStatus("idle");
      modelLoadStatusTimerRef.current = null;
    }, 1800);
  }

  function getLoadModelsButtonLabel(provider = activeProvider) {
    if (isLoadingModels) return "Loading models...";
    if (modelLoadStatus === "success") {
      const count = provider.models?.length ?? 0;
      return `Loaded ${count} model${count === 1 ? "" : "s"}`;
    }
    if (modelLoadStatus === "empty") return "No models returned";
    if (modelLoadStatus === "error") return "Model lookup failed";

    return "Load models";
  }

  function selectProvider(providerId: string) {
    setSelectedModelId(undefined);
    onProvidersStateChange((currentState) => ({
      ...currentState,
      activeProviderId: providerId,
    }));
  }

  function selectModel(providerId: string, model: string) {
    setSelectedModelId(model);
    onProvidersStateChange((currentState) => ({
      ...currentState,
      activeProviderId: providerId,
    }));
  }

  function toggleProviderExpanded(providerId: string) {
    setExpandedProviderIds((current) => ({
      ...current,
      [providerId]: !(current[providerId] ?? true),
    }));
  }

  function updateProviderInState(
    providerId: string,
    updater: (provider: ProviderConfig) => ProviderConfig,
  ) {
    onProvidersStateChange((currentState) => ({
      ...currentState,
      providers: currentState.providers.map((provider) =>
        provider.id === providerId
          ? normalizeProviderForState(updater(provider))
          : provider,
      ),
    }));
  }

  function toggleProvider(providerId: string, checked: boolean) {
    updateProviderInState(providerId, (provider) => ({
      ...provider,
      enabled: checked,
    }));
  }

  function toggleModel(providerId: string, model: string, checked: boolean) {
    updateProviderInState(providerId, (provider) => {
      const currentConfig = provider.modelConfigs?.[model] ?? {};
      return {
        ...provider,
        modelConfigs: {
          ...(provider.modelConfigs ?? {}),
          [model]: modelConfigWithPatch(currentConfig, { enabled: checked }),
        },
      };
    });
  }

  function toggleModelShownInMenu(
    providerId: string,
    model: string,
    checked: boolean,
  ) {
    updateProviderInState(providerId, (provider) => {
      const currentConfig = provider.modelConfigs?.[model] ?? {};
      return {
        ...provider,
        modelConfigs: {
          ...(provider.modelConfigs ?? {}),
          [model]: modelConfigWithPatch(currentConfig, {
            enabled: checked,
            showInMenu: checked,
          }),
        },
      };
    });
  }

  async function loadModelsFromProvider(providerForLoad = activeProvider) {
    setIsLoadingModels(true);
    setModelLoadStatus("idle");

    if (modelLoadStatusTimerRef.current !== null) {
      window.clearTimeout(modelLoadStatusTimerRef.current);
      modelLoadStatusTimerRef.current = null;
    }

    try {
      const loadedModels = await loadProviderModels(providerForLoad);
      const loadedModelIds = normalizeProviderModels(
        loadedModels.map((model) => model.id),
      );
      await saveCachedProviderModels(providerForLoad, loadedModelIds);

      onProvidersStateChange((currentState) => ({
        ...currentState,
        providers: currentState.providers.map((provider) => {
          if (provider.id !== providerForLoad.id) return provider;

          const loadedModelIdSet = new Set(loadedModelIds);
          const loadedModelsById = new Map(
            loadedModels.map((loadedModel) => [loadedModel.id, loadedModel]),
          );
          const modelConfigs: Record<string, ProviderModelConfig> = {};

          for (const loadedModelId of loadedModelIds) {
            const loadedModel = loadedModelsById.get(loadedModelId);
            const currentConfig = provider.modelConfigs?.[loadedModelId] ?? {};
            const context = { ...(currentConfig.context ?? {}) };
            if (loadedModel?.contextLength !== undefined) {
              if (loadedModel.contextLengthSource === "detected") {
                context.detectedContextLength = loadedModel.contextLength;
              } else {
                context.speculatedContextLength = loadedModel.contextLength;
              }
            }

            const enabled =
              typeof currentConfig.enabled === "boolean"
                ? currentConfig.enabled
                : false;
            const showInMenu =
              typeof currentConfig.showInMenu === "boolean"
                ? currentConfig.showInMenu
                : false;

            modelConfigs[loadedModelId] = {
              ...currentConfig,
              enabled,
              showInMenu,
              context,
            };
          }

          const customModelIds = normalizeProviderModels(
            provider.customModels ?? [],
          ).filter((modelId) => !loadedModelIdSet.has(modelId));

          for (const customModelId of customModelIds) {
            const currentConfig = provider.modelConfigs?.[customModelId] ?? {};
            const enabled =
              typeof currentConfig.enabled === "boolean"
                ? currentConfig.enabled
                : true;
            const showInMenu =
              typeof currentConfig.showInMenu === "boolean"
                ? currentConfig.showInMenu
                : enabled;

            modelConfigs[customModelId] = {
              ...currentConfig,
              enabled,
              showInMenu,
            };
          }

          const availableModelIds = normalizeProviderModels([
            ...loadedModelIds,
            ...customModelIds,
          ]);
          const selectedModelStillExists = availableModelIds.includes(
            provider.model,
          );
          const fallbackModel =
            (selectedModelStillExists ? provider.model : "") ||
            availableModelIds.find((modelId) => {
              const config = modelConfigs[modelId];
              return config.enabled !== false && config.showInMenu !== false;
            }) ||
            provider.model ||
            "";

          return normalizeProviderForState({
            ...provider,
            model: fallbackModel,
            models: loadedModelIds,
            customModels: customModelIds,
            modelConfigs,
            enabledModelIds: [],
            modelSettings: {},
          });
        }),
      }));

      setExpandedProviderIds((current) => ({
        ...current,
        [providerForLoad.id]: true,
      }));
      setTemporaryModelLoadStatus(loadedModelIds.length ? "success" : "empty");
    } catch (error) {
      setTemporaryModelLoadStatus("error");
      console.error("Model lookup failed:", error);
    } finally {
      setIsLoadingModels(false);
    }
  }

  function addCustomModel() {
    const model = customModelValue.trim();
    if (!model) return;

    updateProviderInState(activeProvider.id, (provider) => {
      const loadedModels = normalizeProviderModels(provider.models ?? []);
      const customModels = normalizeProviderModels(provider.customModels ?? []);
      const isLoadedModel = loadedModels.includes(model);
      const nextCustomModels = isLoadedModel
        ? customModels
        : normalizeProviderModels([...customModels, model]);
      const currentConfig = provider.modelConfigs?.[model] ?? {};

      return {
        ...provider,
        customModels: nextCustomModels,
        modelConfigs: {
          ...(provider.modelConfigs ?? {}),
          [model]: modelConfigWithPatch(currentConfig, {
            enabled: true,
            showInMenu: true,
          }),
        },
      };
    });
    setCustomModelValue("");
  }

  function deleteCustomModel(model: string) {
    updateProviderInState(activeProvider.id, (provider) => {
      const normalizedModel = model.trim();
      const loadedModels = normalizeProviderModels(provider.models ?? []);
      const customModels = normalizeProviderModels(
        provider.customModels ?? [],
      ).filter((customModel) => customModel !== normalizedModel);
      const modelConfigs = { ...(provider.modelConfigs ?? {}) };

      if (!loadedModels.includes(normalizedModel)) {
        delete modelConfigs[normalizedModel];
      }

      return {
        ...provider,
        model: provider.model === normalizedModel ? "" : provider.model,
        customModels,
        modelConfigs,
      };
    });
  }

  function updateSelectedModelConfig(patch: Partial<ProviderModelConfig>) {
    if (!selectedModel) return;

    updateProviderInState(activeProvider.id, (provider) => {
      const currentConfig = provider.modelConfigs?.[selectedModel] ?? {};
      return {
        ...provider,
        modelConfigs: {
          ...(provider.modelConfigs ?? {}),
          [selectedModel]: modelConfigWithPatch(currentConfig, patch),
        },
      };
    });
  }

  function updateSelectedModelGenerationSettings(
    patch: ProviderGenerationSettings,
  ) {
    updateSelectedModelConfig(
      sanitizeGenerationSettings({
        ...(selectedModelSettings ?? defaultGenerationSettings),
        ...patch,
      }),
    );
  }

  function resetSelectedModelGenerationSettings() {
    if (!selectedModel) return;

    updateSelectedModelConfig({
      temperature: undefined,
      topP: undefined,
      maxTokens: undefined,
      reasoningMode: undefined,
      reasoningEffort: undefined,
      requestTimeoutMs: undefined,
    });
  }

  const selectedModelThinkingMode = (() => {
    if (selectedModelSettings?.reasoningMode === "off") return "off";
    if (selectedModelSettings?.reasoningMode === "enabled") {
      return selectedModelSettings.reasoningEffort ?? "medium";
    }
    return "auto";
  })();

  function updateSelectedModelThinkingMode(value: string) {
    if (value === "auto") {
      updateSelectedModelGenerationSettings({
        reasoningMode: "auto",
        reasoningEffort: undefined,
      });
      return;
    }

    if (value === "off") {
      updateSelectedModelGenerationSettings({
        reasoningMode: "off",
        reasoningEffort: "low",
      });
      return;
    }

    if (value === "low" || value === "medium" || value === "high") {
      updateSelectedModelGenerationSettings({
        reasoningMode: "enabled",
        reasoningEffort: value,
      });
    }
  }

  function updateSelectedModelManualContext(value: string) {
    if (!selectedModel) return;
    const manualContextLength = parseOptionalNumber(value);

    updateSelectedModelConfig({
      context: {
        ...(selectedModelConfig?.context ?? {}),
        manualContextLength,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(1000px,calc(100dvh-2rem))] max-h-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>Providers</DialogTitle>
          <DialogDescription>
            Manage provider connections and per-model settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b bg-card/70 p-3 md:border-b-0 md:border-r">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Label className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Providers
              </Label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7  px-2 text-sm"
                onClick={onAddProvider}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>

            <div className="grid gap-1.5">
              {providers.map((item) => {
                const isExpanded = expandedProviderIds[item.id] ?? true;
                const shownModels = getShownProviderModels(item);
                const modelCount = shownModels.length;
                const loadedModelCount = normalizeProviderModels(
                  item.models ?? [],
                ).length;
                const customModelCount = normalizeProviderModels(
                  item.customModels ?? [],
                ).length;
                const enabledModelCount = shownModels.filter((model) =>
                  isModelEnabled(item, model),
                ).length;
                const providerSelected =
                  item.id === activeProvider.id && !selectedModel;

                return (
                  <div key={item.id} className="grid gap-1">
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group flex min-w-0 cursor-pointer items-center gap-2  border px-2 py-2 outline-none",
                        providerSelected
                          ? "border-primary/30 bg-accent text-accent-foreground"
                          : "border-transparent hover:border-border hover:bg-muted/60",
                      )}
                      onClick={() => selectProvider(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectProvider(item.id);
                        }
                      }}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-7 w-7 shrink-0 "
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleProviderExpanded(item.id);
                        }}
                        title={isExpanded ? "Collapse models" : "Expand models"}
                      >
                        <ChevronRight
                          className={cn(
                            "size-4 transition-transform",
                            isExpanded && "rotate-90",
                          )}
                        />
                      </Button>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base leading-6">
                          {providerDisplayName(item)}
                        </div>
                        <div className="truncate text-sm leading-5 text-muted-foreground">
                          {enabledModelCount}/{modelCount} shown ·{" "}
                          {loadedModelCount} loaded
                          {customModelCount > 0
                            ? ` · ${customModelCount} custom`
                            : ""}{" "}
                          · {item.baseUrl || "No base URL"}
                        </div>
                      </div>

                      <Switch
                        checked={isProviderEnabled(item)}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) =>
                          toggleProvider(item.id, checked)
                        }
                        title={
                          isProviderEnabled(item)
                            ? "Disable provider"
                            : "Enable provider"
                        }
                      />
                    </div>

                    {isExpanded && (
                      <div className="ml-9 grid gap-1">
                        {modelCount > 0 ? (
                          shownModels.map((model) => {
                            const modelSelected =
                              item.id === activeProvider.id &&
                              selectedModel === model;
                            const checked = isModelEnabled(item, model);

                            return (
                              <div
                                key={`${item.id}:${model}`}
                                role="button"
                                tabIndex={0}
                                className={cn(
                                  "flex min-w-0 cursor-pointer items-center gap-2  border px-2 py-1.5 outline-none",
                                  modelSelected
                                    ? "border-primary/30 bg-accent text-accent-foreground"
                                    : "border-transparent hover:border-border hover:bg-muted/60",
                                )}
                                onClick={() => selectModel(item.id, model)}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    selectModel(item.id, model);
                                  }
                                }}
                                title={model}
                              >
                                <span className="min-w-0 flex-1 truncate text-sm leading-5">
                                  {model}
                                </span>
                                <Switch
                                  checked={checked}
                                  onClick={(event) => event.stopPropagation()}
                                  onCheckedChange={(nextChecked) =>
                                    toggleModel(item.id, model, nextChecked)
                                  }
                                  title={
                                    checked ? "Disable model" : "Enable model"
                                  }
                                />
                              </div>
                            );
                          })
                        ) : (
                          <p className=" px-2 py-2 text-sm leading-5 text-muted-foreground">
                            No models shown. Select models in provider settings.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
            {!selectedModel ? (
              <div className="grid gap-5 pb-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold leading-7">
                      {providerDisplayName(activeProvider)}
                    </h3>
                    <p className="text-sm leading-5 text-muted-foreground">
                      Provider connection settings.
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-8 w-8 shrink-0 "
                        title="Provider actions"
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="">
                      <DropdownMenuItem
                        onClick={() => onDuplicateProvider(activeProvider.id)}
                      >
                        <Copy className="size-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={providers.length <= 1}
                        onClick={() => onDeleteProvider(activeProvider.id)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="provider-name">Provider name</Label>
                    <Input
                      id="provider-name"
                      value={activeProvider.name}
                      onChange={(event) =>
                        onProviderSettingChange({ name: event.target.value })
                      }
                      placeholder="Provider name"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="provider-url">Base URL</Label>
                    <Input
                      id="provider-url"
                      value={activeProvider.baseUrl}
                      onChange={(event) =>
                        onProviderSettingChange({ baseUrl: event.target.value })
                      }
                      placeholder="http://localhost:1234/v1"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="provider-api-key">API key</Label>
                  <div className="relative">
                    <Input
                      id="provider-api-key"
                      value={activeProvider.apiKey}
                      onChange={(event) =>
                        onProviderSettingChange({ apiKey: event.target.value })
                      }
                      placeholder="Provider API key"
                      type={isApiKeyVisible ? "text" : "password"}
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2  text-muted-foreground"
                      onClick={() => setIsApiKeyVisible((current) => !current)}
                      title={isApiKeyVisible ? "Hide API key" : "Show API key"}
                    >
                      {isApiKeyVisible ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3  border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <Label>Loaded models</Label>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        Select which loaded models should appear in the left
                        menu. Newly loaded models stay hidden by default.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className=""
                      onClick={() => loadModelsFromProvider(activeProvider)}
                      disabled={
                        isLoadingModels || !activeProvider.baseUrl.trim()
                      }
                    >
                      <RefreshCcw
                        className={cn(
                          "size-4",
                          isLoadingModels && "animate-spin",
                        )}
                      />
                      {getLoadModelsButtonLabel(activeProvider)}
                    </Button>
                  </div>

                  {normalizeProviderModels(activeProvider.models ?? []).length >
                  0 ? (
                    <div className="grid max-h-80 gap-1 overflow-y-auto  border bg-background/60 p-2">
                      {normalizeProviderModels(activeProvider.models ?? []).map(
                        (model) => {
                          const checked = isModelShownInMenu(
                            activeProvider,
                            model,
                          );

                          return (
                            <label
                              key={`${activeProvider.id}:${model}:shown`}
                              className="flex min-w-0 cursor-pointer items-center gap-2  px-2 py-1.5 text-sm leading-5 hover:bg-muted/60"
                              title={model}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(nextChecked) =>
                                  toggleModelShownInMenu(
                                    activeProvider.id,
                                    model,
                                    nextChecked === true,
                                  )
                                }
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {model}
                              </span>
                            </label>
                          );
                        },
                      )}
                    </div>
                  ) : (
                    <p className=" border border-dashed px-3 py-4 text-sm leading-5 text-muted-foreground">
                      No models loaded yet. Load models from the provider first.
                    </p>
                  )}
                </div>

                <div className="grid gap-3  border bg-card p-3">
                  <div>
                    <Label>Custom models</Label>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      Add model IDs manually when they are not returned by the
                      provider. Custom models are shown immediately.
                    </p>
                  </div>

                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <Input
                      value={customModelValue}
                      onChange={(event) =>
                        setCustomModelValue(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addCustomModel();
                      }}
                      placeholder="openai/gpt-4.1-mini"
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0"
                      disabled={!customModelValue.trim()}
                      onClick={addCustomModel}
                    >
                      <Plus className="size-4" />
                      Add model
                    </Button>
                  </div>

                  {normalizeProviderModels(activeProvider.customModels ?? [])
                    .length > 0 ? (
                    <div className="grid max-h-64 gap-1 overflow-y-auto  border bg-background/60 p-2">
                      {normalizeProviderModels(
                        activeProvider.customModels ?? [],
                      ).map((model) => {
                        const checked = isModelShownInMenu(
                          activeProvider,
                          model,
                        );

                        return (
                          <div
                            key={`${activeProvider.id}:${model}:custom`}
                            className="flex min-w-0 items-center gap-2  px-2 py-1.5 text-sm leading-5 hover:bg-muted/60"
                            title={model}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) =>
                                toggleModelShownInMenu(
                                  activeProvider.id,
                                  model,
                                  nextChecked === true,
                                )
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {model}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteCustomModel(model)}
                              title="Delete custom model"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className=" border border-dashed px-3 py-4 text-sm leading-5 text-muted-foreground">
                      No custom models yet.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-5 pb-1">
                <div>
                  <h3 className="break-all text-lg font-semibold leading-7">
                    {selectedModel}
                  </h3>
                  <p className="text-sm leading-5 text-muted-foreground">
                    Per-model generation and context settings for{" "}
                    {providerDisplayName(activeProvider)}.
                  </p>
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Generation settings</Label>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        Applied only when this model is selected.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className=""
                      onClick={resetSelectedModelGenerationSettings}
                    >
                      Reset
                    </Button>
                  </div>

                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="generation-temperature">
                        Temperature
                      </Label>
                      <Input
                        id="generation-temperature"
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={formatOptionalNumber(
                          selectedModelSettings?.temperature,
                        )}
                        onChange={(event) =>
                          updateSelectedModelGenerationSettings({
                            temperature: parseOptionalNumber(
                              event.target.value,
                            ),
                          })
                        }
                        placeholder="Provider default"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="generation-top-p">Top P</Label>
                      <Input
                        id="generation-top-p"
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={formatOptionalNumber(
                          selectedModelSettings?.topP,
                        )}
                        onChange={(event) =>
                          updateSelectedModelGenerationSettings({
                            topP: parseOptionalNumber(event.target.value),
                          })
                        }
                        placeholder="Provider default"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="generation-max-tokens">
                        Max output tokens
                      </Label>
                      <Input
                        id="generation-max-tokens"
                        type="number"
                        min="1"
                        step="1"
                        value={formatOptionalNumber(
                          selectedModelSettings?.maxTokens,
                        )}
                        onChange={(event) =>
                          updateSelectedModelGenerationSettings({
                            maxTokens: parseOptionalNumber(event.target.value),
                          })
                        }
                        placeholder="Provider default"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="generation-thinking-mode">
                        Thinking mode
                      </Label>
                      <Select
                        value={selectedModelThinkingMode}
                        onValueChange={updateSelectedModelThinkingMode}
                      >
                        <SelectTrigger id="generation-thinking-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="off">No thinking</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="generation-timeout">
                        Request timeout, ms
                      </Label>
                      <Input
                        id="generation-timeout"
                        type="number"
                        min="1000"
                        step="1000"
                        value={formatOptionalNumber(
                          selectedModelSettings?.requestTimeoutMs,
                        )}
                        onChange={(event) =>
                          updateSelectedModelGenerationSettings({
                            requestTimeoutMs: parseOptionalNumber(
                              event.target.value,
                            ),
                          })
                        }
                        placeholder="30000"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor="model-supports-vision">Vision input</Label>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      Mark this model as able to receive image attachments.
                    </p>
                  </div>
                  <Switch
                    id="model-supports-vision"
                    checked={selectedModelConfig?.supportsVision === true}
                    onCheckedChange={(checked) =>
                      updateSelectedModelConfig({ supportsVision: checked })
                    }
                  />
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label htmlFor="manual-context-size">Context size</Label>
                  <Input
                    id="manual-context-size"
                    type="number"
                    min="1"
                    step="1"
                    className="w-full"
                    value={formatOptionalNumber(
                      selectedModelConfig?.context?.manualContextLength,
                    )}
                    onChange={(event) =>
                      updateSelectedModelManualContext(event.target.value)
                    }
                    placeholder="No manual override"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="h-[72px] shrink-0 items-center border-t px-5 py-3">
          <Button type="button" className="" onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
