import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type WindowControlsProps = {
  className?: string;
  onCloseRequest?: () => void | Promise<void>;
};

export function WindowControls({ className = "", onCloseRequest }: WindowControlsProps) {
  const closeWindow = async () => {
    if (onCloseRequest) await onCloseRequest();
    await getCurrentWindow().close();
  };

  return (
    <div className={`window-controls ${className}`.trim()} aria-label="Window controls">
      <button
        type="button"
        className="window-control-button"
        onClick={() => void getCurrentWindow().minimize()}
        title="Minimize"
        aria-label="Minimize"
      >
        <Minus size={14} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        className="window-control-button"
        onClick={() => void getCurrentWindow().toggleMaximize()}
        title="Maximize or restore"
        aria-label="Maximize or restore"
      >
        <Square size={11} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        className="window-control-button close"
        onClick={() => void closeWindow()}
        title="Close"
        aria-label="Close"
      >
        <X size={14} strokeWidth={1.6} />
      </button>
    </div>
  );
}
