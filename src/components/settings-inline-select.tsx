import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
};

/** OpenCode-style inline settings picker: the selected label sets trigger width. */
export function SettingsInlineSelect({ label, value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  };

  const handleKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open || !options.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlight(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlight(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(highlight);
    }
  };

  return (
    <div className="settings-inline-select" ref={root} onKeyDown={handleKeys}>
      <button
        ref={trigger}
        type="button"
        className={`settings-inline-trigger${open ? " open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!open) setHighlight(selectedIndex);
          setOpen((previous) => !previous);
        }}
      >
        <span>{options[selectedIndex]?.label ?? value}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="settings-inline-menu" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={highlight === index ? "highlighted" : ""}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {value === option.value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
