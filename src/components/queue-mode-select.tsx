import { memo } from "react";
import type { QueueDelivery } from "../core/message-queue";

type Props = { value: QueueDelivery; onChange: (next: QueueDelivery) => void };

/** Compact native selector, keyboard accessible without stealing Shift+Enter. */
export const QueueModeSelect = memo(function QueueModeSelect({ value, onChange }: Props) {
  return (
    <label className="composer-queue-mode" title={value === "steer" ? "Steer: redirect the current run" : "Follow-up: run after current work finishes"}>
      <select value={value} onChange={(event) => onChange(event.target.value as QueueDelivery)} aria-label="Message delivery mode">
        <option value="steer">Steer</option>
        <option value="followUp">Follow-up</option>
      </select>
    </label>
  );
});
