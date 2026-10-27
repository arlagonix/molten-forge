import { describe, expect, it, vi } from "vitest";
import { requestFullHistory } from "./pi-history-rpc";
import { historyRecordsFromSessionEntries } from "./session-history";

type Response = { success: boolean; data?: { entries?: unknown[]; leafId?: string; messages?: unknown[] }; error?: string };

describe("Pi full-history request, using a scripted RPC peer", () => {
  it("requests complete get_entries history and projects only the active branch", async () => {
    const entries = [
      { id: "user", type: "message", parentId: null, message: { role: "user", content: "hello" } },
      { id: "stale", type: "message", parentId: "user", message: { role: "assistant", content: "abandoned" } },
      { id: "compact", type: "compaction", parentId: "user", summary: "before", tokensBefore: 1200 },
      { id: "active", type: "message", parentId: "compact", message: { role: "assistant", content: "actual" } },
    ];
    const send = vi.fn(async () => ({ success: true, data: { entries, leafId: "active" } }));
    const response = await requestFullHistory(send, 2400);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "get_entries" }, { silent: true, history: true }, 2400);
    expect(historyRecordsFromSessionEntries(response.data?.entries, response.data?.leafId)).toEqual([
      { role: "user", content: "hello" },
      expect.objectContaining({ role: "__moltenForgeCompactionEntry", summary: "before" }),
      { role: "assistant", content: "actual" },
    ]);
  });

  it("falls back to get_messages only when Pi rejects get_entries", async () => {
    const failure: Response = { success: false, error: "unknown command" };
    const fallback: Response = { success: true, data: { messages: [{ role: "user", content: "legacy" }] } };
    const send = vi.fn().mockResolvedValueOnce(failure).mockResolvedValueOnce(fallback);
    const warn = vi.fn();
    const response = await requestFullHistory(send, 3500, warn);
    expect(response).toEqual(fallback);
    expect(send.mock.calls).toEqual([
      [{ type: "get_entries" }, { silent: true, history: true }, 3500],
      [{ type: "get_messages" }, { silent: true, history: true }, 3500],
    ]);
    expect(warn).toHaveBeenCalledWith("unknown command");
  });

  it("never silently falls back when get_entries throws or times out", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("RPC timeout"));
    await expect(requestFullHistory(send, 500)).rejects.toThrow("RPC timeout");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
