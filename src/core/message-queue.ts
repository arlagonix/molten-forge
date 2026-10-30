/** Pi owns the queue; every queue_update is a complete snapshot. */
export type QueueDelivery = "steer" | "followUp";
export type PiQueue = { steering: string[]; followUp: string[] };
export const EMPTY_PI_QUEUE: PiQueue = { steering: [], followUp: [] };

export function normalizePiQueue(record: { steering?: unknown; followUp?: unknown }): PiQueue {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return { steering: strings(record.steering), followUp: strings(record.followUp) };
}

/** No streamingBehavior is needed (or desirable) when Pi is idle. */
export function sendBehavior(running: boolean, selected: QueueDelivery): QueueDelivery | undefined {
  return running ? selected : undefined;
}

/** An idle prompt is rendered optimistically, while queued messages must only
 * appear after Pi emits their user message_start. Consume exactly one echo for
 * each locally rendered idle prompt, even when Pi expands the prompt text.
 */
export function createPiUserMessageDelivery() {
  let awaitingInitialEcho = false;
  return {
    noteLocallyRenderedPrompt() { awaitingInitialEcho = true; },
    shouldAppendDeliveredMessage() {
      if (awaitingInitialEcho) {
        awaitingInitialEcho = false;
        return false;
      }
      return true;
    },
    reset() { awaitingInitialEcho = false; },
  };
}

/** Reserve enough room to scroll the last message above the overlay. */
export function composerOverlayClearance(transcriptBottom: number, composerTop: number): number {
  return Math.max(190, Math.ceil(transcriptBottom - composerTop) + 16);
}

/** The fade follows the *visible* composer top, not the minimum transcript
 * clearance (190px). Otherwise short editors create a premature fade horizon.
 */
export function composerFadeInset(transcriptBottom: number, composerTop: number): number {
  return Math.max(0, Math.ceil(transcriptBottom - composerTop));
}

/** Never allow a tall draft to occupy most of a short chat window. */
export function textareaHeightLimit(paneHeight: number, lineHeight: number, topPadding: number, bottomPadding: number): number {
  const configuredMax = lineHeight * 11 + topPadding + bottomPadding;
  return Math.min(configuredMax, Math.max(lineHeight * 3 + topPadding + bottomPadding, Math.floor(paneHeight * 0.35)));
}
