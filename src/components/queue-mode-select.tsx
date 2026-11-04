import { Check, ChevronDown } from "lucide-react";
import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { QueueDelivery } from "../core/message-queue";

type Props = { value: QueueDelivery; onChange: (next: QueueDelivery) => void };

const modes: { value: QueueDelivery; label: string; hint: string }[] = [
  { value: "steer", label: "Steer", hint: "Redirect the current run" },
  { value: "followUp", label: "Follow-up", hint: "Run after the current work finishes" },
];

/** Content-width trigger and a themed, keyboard-accessible replacement for the
 * platform select menu. State stays local to the composer control. */
export const QueueModeSelect = memo(function QueueModeSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = modes.findIndex((mode) => mode.value === value);
  const current = modes[selectedIndex] ?? modes[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    const frame = requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, selectedIndex]);

  const choose = (next: QueueDelivery) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      optionRefs.current[(index + offset + modes.length) % modes.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      optionRefs.current[event.key === "Home" ? 0 : modes.length - 1]?.focus();
    }
  };

  return (
    <div className="composer-queue-mode" ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
      <button
        type="button"
        ref={triggerRef}
        className={`composer-delivery-trigger${open ? " active" : ""}`}
        title={`${current.label}: ${current.hint}`}
        aria-label={`Message delivery mode: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{current.label}</span>
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div className="composer-delivery-menu" role="menu" aria-label="Message delivery mode">
          {modes.map((mode, index) => (
            <button key={mode.value} type="button" role="menuitemradio"
              ref={(element) => { optionRefs.current[index] = element; }}
              aria-checked={value === mode.value}
              onClick={() => choose(mode.value)}
              onKeyDown={(event) => navigate(event, index)}
              className={value === mode.value ? "selected" : ""}>
              <span>{mode.label}</span>
              {value === mode.value && <Check size={14} strokeWidth={2} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
