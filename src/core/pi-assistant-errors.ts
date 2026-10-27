export type PiAssistantMessageLike = {
  role?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
};

/**
 * Pi reports provider/model request failures and output-token truncation as
 * finalized assistant messages. message_end is authoritative: stopReason="error"
 * carries provider/runtime text, while stopReason="length" means Pi had to stop
 * before the response completed.
 *
 * Aborted messages are intentionally excluded. Stop/cancel is already a
 * first-class Molten Forge interaction and should not create an error row.
 */
export function assistantErrorMessage(message: unknown): string | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const candidate = message as PiAssistantMessageLike;
  if (candidate.role !== "assistant") return null;

  if (candidate.stopReason === "length") {
    return "Response was truncated before completion.";
  }
  if (candidate.stopReason !== "error") return null;

  const text = typeof candidate.errorMessage === "string"
    ? candidate.errorMessage.trim()
    : "";
  return text || "Assistant request failed.";
}


export function isProviderAbortMessage(message: unknown): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const candidate = message as PiAssistantMessageLike;
  if (candidate.role !== "assistant") return false;

  const error = typeof candidate.errorMessage === "string"
    ? candidate.errorMessage.trim()
    : "";

  return candidate.stopReason === "error"
    && /(?:provider\s+)?finish[_ -]?reason\s*[:=]\s*["']?abort(?:ed)?["']?/i.test(error);
}

export function isAssistantAbortTerminal(message: unknown): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const candidate = message as PiAssistantMessageLike;
  if (candidate.role !== "assistant") return false;
  return candidate.stopReason === "aborted" || isProviderAbortMessage(message);
}

/**
 * Raw Pi session history keeps failed retry attempts even after Pi omits those
 * attempts from future model context. A later assistant message before the next
 * user message means this error was superseded by Pi's retry/continuation path,
 * so it should not reappear as a terminal error when the desktop transcript is
 * restored.
 */
export function isSupersededAssistantError(messages: unknown[], index: number): boolean {
  if (!assistantErrorMessage(messages[index])) return false;

  for (let candidateIndex = index + 1; candidateIndex < messages.length; candidateIndex += 1) {
    const value = messages[candidateIndex];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const role = (value as { role?: unknown }).role;
    if (role === "user") return false;
    if (role === "assistant") return true;
  }

  return false;
}

export function historyAssistantErrorMessage(messages: unknown[], index: number): string | null {
  const error = assistantErrorMessage(messages[index]);
  if (!error || isSupersededAssistantError(messages, index)) return null;
  return error;
}

export function shouldSurfacePendingAssistantError(options: {
  retryActivityActive: boolean;
  interruptInFlight: boolean;
}): boolean {
  return !options.retryActivityActive && !options.interruptInFlight;
}
