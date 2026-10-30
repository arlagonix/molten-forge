import { Check, ChevronDown, Search } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  filterModels,
  groupModelsByProvider,
  isSameModel,
  highlightedOptionScrollDelta,
  modelKey,
  stepHighlightedModel,
  type ModelOption,
} from "../core/model-switcher";

type ModelSwitcherProps = {
  models: ModelOption[];
  currentModel: ModelOption | null;
  connected: boolean;
  onRefreshModels: () => void | Promise<void>;
  onSelectModel: (model: ModelOption) => void | Promise<void>;
};

export const ModelSwitcher = memo(function ModelSwitcher({
  models,
  currentModel,
  connected,
  onRefreshModels,
  onSelectModel,
}: ModelSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const filteredModels = useMemo(() => filterModels(models, query), [models, query]);
  const groups = useMemo(() => groupModelsByProvider(filteredModels), [filteredModels]);
  const visibleModels = useMemo(() => groups.flatMap((group) => group.models), [groups]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (query) setQuery("");
      if (highlightedKey) setHighlightedKey(null);
      return;
    }

    if (highlightedKey && visibleModels.some((model) => modelKey(model) === highlightedKey)) return;
    const current = visibleModels.find((model) => isSameModel(model, currentModel));
    setHighlightedKey(modelKey(current ?? visibleModels[0]) || null);
  }, [currentModel, highlightedKey, open, query, visibleModels]);

  const toggle = () => {
    if (!connected) return;
    const next = !open;
    setOpen(next);
    setError(null);
    if (next) void onRefreshModels();
  };

  const setSearchQuery = (value: string) => {
    setQuery(value);
    const nextVisible = groupModelsByProvider(filterModels(models, value)).flatMap((group) => group.models);
    setHighlightedKey(modelKey(nextVisible[0]) || null);
  };

  const moveHighlight = (direction: -1 | 1) => {
    const next = stepHighlightedModel(visibleModels, highlightedKey, direction);
    const nextKey = modelKey(next) || null;
    setHighlightedKey(nextKey);
    if (!nextKey) return;

    requestAnimationFrame(() => {
      const list = listRef.current;
      const option = optionRefs.current.get(nextKey);
      if (!list || !option) return;

      const delta = highlightedOptionScrollDelta(
        list.getBoundingClientRect(),
        option.getBoundingClientRect(),
      );
      if (delta !== 0) list.scrollTop += delta;
    });
  };

  const selectModel = async (model: ModelOption) => {
    if (!connected || isSameModel(model, currentModel)) {
      setOpen(false);
      return;
    }

    const key = modelKey(model);
    setPendingKey(key);
    setError(null);
    try {
      await onSelectModel(model);
      setOpen(false);
    } catch (selectionError) {
      setError(String(selectionError));
    } finally {
      setPendingKey(null);
    }
  };

  const selectHighlighted = () => {
    const highlighted = visibleModels.find((model) => modelKey(model) === highlightedKey);
    if (highlighted && !pendingKey) void selectModel(highlighted);
  };

  return (
    <div className="model-switcher" ref={rootRef}>
      <button
        className={`composer-model model-switcher-trigger ${open ? "active" : ""}`}
        type="button"
        onClick={toggle}
        disabled={!connected || !currentModel}
        title={(currentModel?.name ?? modelKey(currentModel)) || "Select model"}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{currentModel?.id ?? "Model"}</span>
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open && (
        <div className="model-popover" role="dialog" aria-label="Select model">
          <div className="model-search-wrap">
            <Search size={14} strokeWidth={1.8} aria-hidden="true" />
            <input
              ref={searchRef}
              className="model-search-input"
              type="search"
              value={query}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveHighlight(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveHighlight(-1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  selectHighlighted();
                }
              }}
              placeholder="Search models"
              aria-label="Search models"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="model-popover-list chat-message-scrollbar" ref={listRef}>
            {groups.length === 0 ? (
              <div className="model-popover-empty">
                {models.length === 0 ? "No configured models." : "No matching models."}
              </div>
            ) : (
              groups.map((group) => (
                <section className="model-provider-group" key={group.provider}>
                  <div className="model-provider-heading">{group.provider}</div>
                  {group.models.map((model) => {
                    const key = modelKey(model);
                    const selected = isSameModel(model, currentModel);
                    const pending = pendingKey === key;
                    const highlighted = highlightedKey === key;
                    return (
                      <button
                        key={key}
                        ref={(element) => {
                          if (element) optionRefs.current.set(key, element);
                          else optionRefs.current.delete(key);
                        }}
                        className={`model-option ${selected ? "selected" : ""} ${highlighted ? "highlighted" : ""}`}
                        type="button"
                        onClick={() => void selectModel(model)}
                        onMouseEnter={() => setHighlightedKey(key)}
                        disabled={Boolean(pendingKey)}
                        aria-pressed={selected}
                        title={key}
                      >
                        <span className="model-option-id">{model.id}</span>
                        <span className="model-option-state" aria-hidden="true">
                          {pending ? "…" : selected ? <Check size={14} strokeWidth={2} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </section>
              ))
            )}
          </div>
          {error && <div className="model-popover-error">{error}</div>}
        </div>
      )}
    </div>
  );
});
