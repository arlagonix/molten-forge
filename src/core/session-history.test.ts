import { describe, expect, it } from "vitest";
import { activeSessionBranch, historyRecordsFromSessionEntries } from "./session-history";

describe("activeSessionBranch", () => {
  it("returns only the current root-to-leaf path and excludes abandoned branches", () => {
    const entries = [
      { type: "message", id: "a", parentId: null, message: { role: "user", content: "root" } },
      { type: "message", id: "b", parentId: "a", message: { role: "assistant", content: [] } },
      { type: "message", id: "old", parentId: "b", message: { role: "user", content: "abandoned" } },
      { type: "branch_summary", id: "c", parentId: "b", fromId: "old", summary: "other branch" },
      { type: "message", id: "d", parentId: "c", message: { role: "user", content: "active" } },
    ];

    expect(activeSessionBranch(entries, "d").map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty branch for an empty session", () => {
    expect(activeSessionBranch([], null)).toEqual([]);
  });

  it("fails closed when the leaf chain is missing or cyclic", () => {
    expect(activeSessionBranch([{ type: "message", id: "a", parentId: "missing" }], "a")).toEqual([]);
    expect(activeSessionBranch([
      { type: "message", id: "a", parentId: "b" },
      { type: "message", id: "b", parentId: "a" },
    ], "a")).toEqual([]);
  });
});

describe("historyRecordsFromSessionEntries", () => {
  it("restores pre-compaction messages and top-level compaction entries on the active branch", () => {
    const records = historyRecordsFromSessionEntries([
      { type: "message", id: "a", parentId: null, message: { role: "user", content: "before" } },
      { type: "message", id: "b", parentId: "a", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
      { type: "compaction", id: "c", parentId: "b", summary: "summary", firstKeptEntryId: "b", tokensBefore: 120000, estimatedTokensAfter: 42000 },
      { type: "message", id: "d", parentId: "c", message: { role: "user", content: "after" } },
    ], "d") as Array<Record<string, unknown>>;

    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({ role: "user", content: "before" });
    expect(records[2]).toMatchObject({ role: "__moltenForgeCompactionEntry", tokensBefore: 120000, estimatedTokensAfter: 42000 });
    expect(records[3]).toMatchObject({ role: "user", content: "after" });
  });

  it("does not leak entries from an abandoned branch", () => {
    const records = historyRecordsFromSessionEntries([
      { type: "message", id: "a", parentId: null, message: { role: "user", content: "root" } },
      { type: "message", id: "old", parentId: "a", message: { role: "user", content: "abandoned" } },
      { type: "message", id: "active", parentId: "a", message: { role: "user", content: "active" } },
    ], "active") as Array<Record<string, unknown>>;

    expect(records.map((record) => record.content)).toEqual(["root", "active"]);
  });
});
