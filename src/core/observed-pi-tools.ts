import type { TranscriptItem } from "./chat-logic";

/** Only tool invocations actually received from Pi. RPC cannot enumerate the
 * complete configured/active registry, so never present this as one. */
export type ObservedPiTool = { name: string; invocations: number; latestState: string };

export function observedPiTools(items: readonly TranscriptItem[]): ObservedPiTool[] {
  const tools = new Map<string, ObservedPiTool>();
  for (const item of items) {
    if (item.kind !== "tool" || item.runtimeRole === "session-maintenance") continue;
    const name = (item.title ?? "").trim();
    // Direct `!`/`!!` shell activity is not a Pi agent tool call.
    if (!name || name.toLowerCase() === "shell") continue;
    const key = name.toLowerCase();
    const current = tools.get(key);
    tools.set(key, {
      name: current?.name ?? name,
      invocations: (current?.invocations ?? 0) + 1,
      latestState: item.state ?? "unknown",
    });
  }
  return [...tools.values()].sort((a, b) => a.name.localeCompare(b.name));
}
