export type ModelOption = {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: string[];
};

export type ModelProviderGroup = {
  provider: string;
  models: ModelOption[];
};

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

export function modelKey(model: ModelOption | null | undefined) {
  if (!model?.provider || !model?.id) return "";
  return `${model.provider}/${model.id}`;
}

export function isSameModel(a: ModelOption | null | undefined, b: ModelOption | null | undefined) {
  return Boolean(a && b && a.provider === b.provider && a.id === b.id);
}

export function createSetModelRecord(model: ModelOption) {
  return { type: "set_model", provider: model.provider, modelId: model.id } as const;
}

export function findModelMatch(models: ModelOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return undefined;

  return models.find((model) => {
    const full = modelKey(model).toLocaleLowerCase();
    return full === normalized
      || model.id.toLocaleLowerCase() === normalized
      || model.name?.toLocaleLowerCase() === normalized;
  });
}


export function filterModels(models: ModelOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return models;

  return models.filter((model) => {
    const provider = model.provider.toLocaleLowerCase();
    const id = model.id.toLocaleLowerCase();
    return provider.includes(normalized)
      || id.includes(normalized)
      || `${provider}/${id}`.includes(normalized);
  });
}

export function stepHighlightedModel(
  models: ModelOption[],
  highlightedKey: string | null,
  direction: -1 | 1,
) {
  if (models.length === 0) return undefined;

  const currentIndex = highlightedKey
    ? models.findIndex((model) => modelKey(model) === highlightedKey)
    : -1;
  const fallbackIndex = direction > 0 ? -1 : 0;
  const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
  const nextIndex = (baseIndex + direction + models.length) % models.length;
  return models[nextIndex];
}
export type VerticalRect = {
  top: number;
  bottom: number;
};

export function highlightedOptionScrollDelta(
  listRect: VerticalRect,
  optionRect: VerticalRect,
  stickyHeadingClearance = 30,
) {
  const visibleTop = listRect.top + Math.max(0, stickyHeadingClearance);
  if (optionRect.top < visibleTop) return optionRect.top - visibleTop;
  if (optionRect.bottom > listRect.bottom) return optionRect.bottom - listRect.bottom;
  return 0;
}

export function groupModelsByProvider(models: ModelOption[]): ModelProviderGroup[] {
  const unique = new Map<string, ModelOption>();
  for (const model of models) {
    if (!model?.provider?.trim() || !model?.id?.trim()) continue;
    const key = modelKey(model);
    if (!unique.has(key)) unique.set(key, model);
  }

  const byProvider = new Map<string, ModelOption[]>();
  for (const model of unique.values()) {
    const existing = byProvider.get(model.provider);
    if (existing) existing.push(model);
    else byProvider.set(model.provider, [model]);
  }

  return [...byProvider.entries()]
    .sort(([providerA], [providerB]) => compareText(providerA, providerB))
    .map(([provider, providerModels]) => ({
      provider,
      models: providerModels.slice().sort((a, b) => {
        const aLabel = a.name && a.name !== a.id ? a.name : a.id;
        const bLabel = b.name && b.name !== b.id ? b.name : b.id;
        return compareText(aLabel, bLabel) || compareText(a.id, b.id);
      }),
    }));
}
