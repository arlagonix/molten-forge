/** Keep high-frequency Pi text/thinking deltas off the React hot path.
 * Non-delta RPC messages always act as ordering barriers and are delivered
 * synchronously (not on the 50ms timer).
 */
export const PI_DELTA_FLUSH_MS = 50;

type PiRecord = Record<string, any>;
type DeltaKind = "text_delta" | "thinking_delta";

type PendingDelta = {
  record: PiRecord;
  kind: DeltaKind;
  contentIndex: unknown;
  messageId: unknown;
};

function asPendingDelta(record: PiRecord): PendingDelta | null {
  if (record.type !== "message_update") return null;
  const event = record.assistantMessageEvent;
  if (!event || (event.type !== "text_delta" && event.type !== "thinking_delta") || typeof event.delta !== "string") return null;
  return {
    record,
    kind: event.type,
    contentIndex: event.contentIndex,
    messageId: record.message?.id,
  };
}

export function createPiDeltaCoalescer(emit: (record: PiRecord) => void, delay = PI_DELTA_FLUSH_MS) {
  let pending: PendingDelta | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const next = pending;
    pending = null;
    if (!disposed && next) emit(next.record);
  }

  function push(record: PiRecord) {
    if (disposed) return;
    const next = asPendingDelta(record);
    if (!next) {
      flush();
      emit(record);
      return;
    }
    if (pending && pending.kind === next.kind && pending.contentIndex === next.contentIndex && pending.messageId === next.messageId) {
      // Preserve the first record's envelope and concatenate only its payload.
      // This leaves adjacent non-text events and message_end content authoritative.
      pending.record = {
        ...pending.record,
        assistantMessageEvent: {
          ...pending.record.assistantMessageEvent,
          delta: pending.record.assistantMessageEvent.delta + next.record.assistantMessageEvent.delta,
        },
      };
      return;
    }
    flush();
    pending = next;
    timer = setTimeout(flush, delay);
  }

  function dispose() {
    disposed = true;
    pending = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return { push, flush, dispose };
}
