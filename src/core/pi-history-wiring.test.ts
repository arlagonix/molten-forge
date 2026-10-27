import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("Pi full-history RPC wiring", () => {
  // The display-history request sequence and active-branch projection now have
  // executable mocked-RPC coverage in pi-history-rpc.test.ts and
  // session-history.test.ts. Retain only this boundary contract until the
  // complete React Pi event handler has its own injected-RPC integration harness.

  it("keeps get_messages for interruption safety without using its compacted view as the restored transcript", () => {
    const start = app.indexOf("const interruptGeneration = useCallback");
    const end = app.indexOf("useEffect(() =>", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = app.slice(start, end);
    expect(body).toMatch(/sendRecordAndWait\(\{ type: "get_messages" \}, \{ silent: true \}/);
    const safetyMessages = body.indexOf('type: "get_messages"');
    const fullHistory = body.indexOf("requestHistorySnapshot(", safetyMessages);
    expect(safetyMessages).toBeGreaterThanOrEqual(0);
    expect(fullHistory).toBeGreaterThan(safetyMessages);
    expect(body).toContain("historyResponse");
    expect(body).toContain("unmatchedToolCallIds(messagesResponse.data?.messages)");
  });
});
