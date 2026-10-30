export type SessionEntryLike = {
  type?: unknown;
  id?: unknown;
  parentId?: unknown;
  [key: string]: unknown;
};

/**
 * Return only the active root→leaf path from Pi's append-only session entries.
 * get_entries intentionally includes abandoned branches, so rendering append order
 * directly would mix alternate histories into the visible conversation.
 */
export function activeSessionBranch(entries: unknown, leafId: unknown): SessionEntryLike[] {
  if (!Array.isArray(entries) || typeof leafId !== "string" || !leafId) return [];

  const byId = new Map<string, SessionEntryLike>();
  for (const value of entries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as SessionEntryLike;
    if (typeof entry.id === "string" && entry.id) byId.set(entry.id, entry);
  }

  const reversed: SessionEntryLike[] = [];
  const visited = new Set<string>();
  let currentId: string | null = leafId;

  while (currentId) {
    if (visited.has(currentId)) return [];
    visited.add(currentId);

    const entry = byId.get(currentId);
    if (!entry) return [];
    reversed.push(entry);

    if (entry.parentId == null) {
      currentId = null;
      continue;
    }
    if (typeof entry.parentId !== "string" || !entry.parentId) return [];
    currentId = entry.parentId;
  }

  return reversed.reverse();
}

/**
 * Convert the active session-entry path into the message-like records consumed by
 * Molten Forge's existing history renderer. Top-level compaction/branch/custom
 * entries are represented explicitly so reopening a session can restore the same
 * visible runtime history instead of only Pi's post-compaction model context.
 */
export function historyRecordsFromSessionEntries(entries: unknown, leafId: unknown): unknown[] {
  const branch = activeSessionBranch(entries, leafId);
  const records: unknown[] = [];

  for (const entry of branch) {
    switch (entry.type) {
      case "message":
        if (entry.message && typeof entry.message === "object") records.push(entry.message);
        break;
      case "compaction":
        records.push({
          role: "__moltenForgeCompactionEntry",
          id: entry.id,
          summary: entry.summary,
          firstKeptEntryId: entry.firstKeptEntryId,
          tokensBefore: entry.tokensBefore,
          estimatedTokensAfter: entry.estimatedTokensAfter,
          details: entry.details,
          timestamp: entry.timestamp,
        });
        break;
      case "branch_summary":
        records.push({
          role: "branchSummary",
          summary: entry.summary,
          fromId: entry.fromId,
          timestamp: entry.timestamp,
        });
        break;
      case "custom_message":
        records.push({
          role: "custom",
          customType: entry.customType,
          content: entry.content,
          display: entry.display,
          details: entry.details,
          timestamp: entry.timestamp,
        });
        break;
      default:
        // model/thinking/settings/labels/custom state affect Pi state but are not
        // conversation rows. Keep them out of the transcript.
        break;
    }
  }

  return records;
}
