import { memo } from "react";
import { ListOrdered, RotateCcw } from "lucide-react";
import type { PiQueue } from "../core/message-queue";
import { parseAttachmentPrompt } from "../core/attachments";

type Props = { queue: PiQueue; onRetrieve: () => void };

/** Read-only projection of Pi's queue_update snapshot. Pi owns enqueue/dequeue. */
export const MessageQueue = memo(function MessageQueue({ queue, onRetrieve }: Props) {
  const items = [
    ...queue.steering.map((text, index) => ({ kind: "Steer", text, key: `steer-${index}` })),
    ...queue.followUp.map((text, index) => ({ kind: "Follow-up", text, key: `follow-up-${index}` })),
  ];
  if (!items.length) return null;
  return (
    <section className="composer-queue" aria-live="polite" aria-label={`${items.length} queued Pi messages`}>
      <div className="composer-queue-header">
        <span><ListOrdered size={14} aria-hidden="true" /> Queued ({items.length})</span>
        <button type="button" onClick={onRetrieve} title="Retrieve all queued messages for editing" aria-label="Retrieve queued messages">
          <RotateCcw size={14} aria-hidden="true" /> Retrieve
        </button>
      </div>
      <div className="composer-queue-items">
        {items.map((item) => {
          const visibleText = parseAttachmentPrompt(item.text).text;
          return (
            <div className="composer-queue-item" key={item.key} title={visibleText}>
              <span className="composer-queue-kind">{item.kind}</span>
              <span className="composer-queue-text">{visibleText}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
});
