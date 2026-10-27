import { piRuntimeSnapshot } from "./pi-rpc-lifecycle";

export const INTERRUPT_CLEAR_QUEUE_TIMEOUT_MS = 10_000;
export const INTERRUPT_ABORT_TIMEOUT_MS = 60_000;
export const INTERRUPT_SYNC_TIMEOUT_MS = 15_000;
export const INTERRUPT_IDLE_SETTLE_TIMEOUT_MS = 60_000;
export const INTERRUPT_COMPACTION_RESTART_TIMEOUT_MS = 180_000;
export const INTERRUPT_IDLE_POLL_INTERVAL_MS = 250;

export type InterruptRuntimeState = {
  busy: boolean;
  isCompacting: boolean;
  status: "Stopping" | "Stopping compaction…" | null;
};

export function queuedTextFromClearQueue(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const restored: string[] = [];
  for (const value of [record.steering, record.followUp]) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry !== "string") continue;
      const text = entry.trim();
      if (text) restored.push(text);
    }
  }
  return restored;
}

export function mergeRestoredQueuedText(currentDraft: string, restored: string[]): string {
  const queued = restored.map((entry) => entry.trim()).filter(Boolean).join("\n\n");
  if (!queued) return currentDraft;
  if (!currentDraft.trim()) return queued;
  return `${queued}\n\n${currentDraft}`;
}

export function runtimeStateAfterInterrupt(data: unknown): InterruptRuntimeState {
  const runtime = piRuntimeSnapshot(data);
  if (runtime.isCompacting) {
    return { busy: true, isCompacting: true, status: "Stopping compaction…" };
  }
  if (runtime.busy) return { busy: true, isCompacting: false, status: "Stopping" };
  return { busy: false, isCompacting: false, status: null };
}

export type ForkCandidate = { entryId: string; text: string };

export function latestForkCandidate(data: unknown): ForkCandidate | null {
  if (!data || typeof data !== "object") return null;
  const messages = (data as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    const entryId = typeof record.entryId === "string" ? record.entryId.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (entryId && text) return { entryId, text };
  }
  return null;
}

export function mergeRecoveredPrompt(currentDraft: string, recoveredPrompt: string): string {
  const recovered = recoveredPrompt.trim();
  if (!recovered) return currentDraft;
  const current = currentDraft.trim();
  if (!current) return recovered;
  if (current === recovered || current.startsWith(`${recovered}\n`)) return currentDraft;
  return `${recovered}\n\n${currentDraft}`;
}

export function unmatchedToolCallIds(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const pending = new Set<string>();
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role === "assistant" && Array.isArray(record.content)) {
      for (const part of record.content) {
        if (!part || typeof part !== "object") continue;
        const content = part as Record<string, unknown>;
        if (content.type !== "toolCall") continue;
        const id = typeof content.id === "string" ? content.id.trim() : "";
        if (id) pending.add(id);
      }
    } else if (record.role === "toolResult") {
      const id = typeof record.toolCallId === "string" ? record.toolCallId.trim() : "";
      if (id) pending.delete(id);
    }
  }
  return [...pending];
}
