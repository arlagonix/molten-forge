import { Check, ChevronDown, Search } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const filteredModels = useMemo(() => filterModels(models, query), [models, query]);
  // Recent models appear once: in Recent rather than duplicated under a provider.
  const [recentKeys, setRecentKeys] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("molten-forge-recent-models") ?? "[]");
      return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string").slice(0, 6) : [];
    } catch { return []; }
  });
  const groups = useMemo(() => {
    const recentOrder = [...new Set([modelKey(currentModel), ...recentKeys].filter(Boolean))];
    const recentModels = recentOrder.map((key) => filteredModels.find((model) => modelKey(model) === key)).filter((model): model is ModelOption => Boolean(model));
    const recentSet = new Set(recentModels.map(modelKey));
    const grouped = groupModelsByProvider(filteredModels.filter((model) => !recentSet.has(modelKey(model))));
    return recentModels.length ? [{ provider: "Recent", models: recentModels }, ...grouped] : grouped;
  }, [currentModel, filteredModels, recentKeys]);
  const visibleModels = useMemo(() => groups.flatMap((group) => group.models), [groups]);

  useEffect(() => {
    if (!open && wasOpenRef.current) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (event.key === "Tab") {
        // Keep focus inside the modal instead of letting it reach the composer.
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
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
    const nextVisible = filterModels(models, value);
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
      const nextRecent = [key, ...recentKeys.filter((recent) => recent !== key)].slice(0, 6);
      setRecentKeys(nextRecent);
      try { window.localStorage.setItem("molten-forge-recent-models", JSON.stringify(nextRecent)); } catch { /* Optional UX history. */ }
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
    <div className="model-switcher">
      <button
        className={`composer-model model-switcher-trigger ${open ? "active" : ""}`}
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={!connected}
        title={(currentModel?.name ?? modelKey(currentModel)) || "Select model"}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{currentModel?.id ?? "Model"}</span>
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div className="model-dialog-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <div className="model-popover model-dialog" role="dialog" aria-modal="true" aria-label="Select model" ref={dialogRef}>
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
        </div>, document.body
      )}
    </div>
  );
});
