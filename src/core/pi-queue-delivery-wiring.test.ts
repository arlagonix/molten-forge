import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

describe("Pi user message delivery wiring", () => {
  it("renders Pi-delivered user turns instead of dropping steer/follow-up messages", () => {
    const handler = app.slice(app.indexOf('case "message_start"'), app.indexOf('case "message_update"'));
    expect(handler).toContain('record.message?.role === "user"');
    expect(handler).toContain("userMessageDeliveryRef.current.shouldAppendDeliveredMessage()");
    expect(handler).toContain('append({ kind: "user", ...delivered })');
  });
  it("registers the optimistic initial prompt so Pi's echo cannot appear twice", () => {
    const initial = app.slice(app.indexOf("async function submitPrompt("), app.indexOf("async function submitRaw("));
    expect(initial).toContain("userMessageDeliveryRef.current.noteLocallyRenderedPrompt()");
    expect(initial).toContain('append({ kind: "user", text: raw, attachments })');
    expect(initial).toContain("userMessageDeliveryRef.current.reset()");
  });
});
