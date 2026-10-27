export type HistoryRpcRequest = { type: "get_entries" | "get_messages" };
export type HistoryRpcOptions = { silent: true; history: true };

/** Pi's display transcript includes pre-compaction entries; model context does not. */
export async function requestFullHistory<R extends { success?: boolean; error?: unknown }>(
  send: (record: HistoryRpcRequest, options: HistoryRpcOptions, timeoutMs: number) => Promise<R>,
  timeoutMs: number,
  onCompatibilityFallback?: (reason: unknown) => void,
): Promise<R> {
  const response = await send({ type: "get_entries" }, { silent: true, history: true }, timeoutMs);
  if (response.success) return response;
  onCompatibilityFallback?.(response.error);
  return send({ type: "get_messages" }, { silent: true, history: true }, timeoutMs);
}
