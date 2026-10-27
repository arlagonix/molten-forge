import { describe, expect, it } from "vitest";
import { observedPiTools } from "./observed-pi-tools";
import type { TranscriptItem } from "./chat-logic";

const item = (title: string, state: TranscriptItem["state"] = "done"): TranscriptItem => ({ id: `${title}-${state}`, kind: "tool", title, text: "", state });

describe("observed Pi tools", () => {
  it("does not invent tools for an empty conversation", () => {
    expect(observedPiTools([])).toEqual([]);
  });
  it("counts repeated actual agent calls and retains latest state", () => {
    expect(observedPiTools([item("write"), item("read"), item("READ", "running")])).toEqual([
      { name: "read", invocations: 2, latestState: "running" },
      { name: "write", invocations: 1, latestState: "done" },
    ]);
  });
  it("filters session maintenance, direct bash, non-tools, and missing names", () => {
    expect(observedPiTools([
      { ...item("compact"), runtimeRole: "session-maintenance" },
      item("shell"), item(""),
      { id: "answer", kind: "assistant", text: "bash" },
      item("grep", "error"),
    ])).toEqual([{ name: "grep", invocations: 1, latestState: "error" }]);
  });
});
