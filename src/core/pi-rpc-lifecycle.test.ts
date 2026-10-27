import { describe, expect, it } from "vitest";
import { extensionUiBlocksAgent, normalizeExtensionWidget, piRuntimeSnapshot } from "./pi-rpc-lifecycle";

describe("Pi RPC lifecycle helpers", () => {
  it("treats streaming as busy", () => expect(piRuntimeSnapshot({ isStreaming: true })).toMatchObject({ busy: true, isStreaming: true }));
  it("treats compaction as busy", () => expect(piRuntimeSnapshot({ isCompacting: true })).toMatchObject({ busy: true, isCompacting: true }));
  it("treats queued messages as busy even when streaming is false", () => expect(piRuntimeSnapshot({ pendingMessageCount: 2 })).toMatchObject({ busy: true, pendingMessageCount: 2 }));
  it("normalizes numeric pending-message strings", () => expect(piRuntimeSnapshot({ pendingMessageCount: "3" }).pendingMessageCount).toBe(3));
  it("clamps invalid negative pending counts", () => expect(piRuntimeSnapshot({ pendingMessageCount: -2 }).pendingMessageCount).toBe(0));
  it("defaults malformed state to idle", () => expect(piRuntimeSnapshot(null).busy).toBe(false));
  it.each(["select", "confirm", "input", "editor"])("marks %s extension UI as blocking", (method) => expect(extensionUiBlocksAgent(method)).toBe(true));
  it.each(["notify", "setStatus", "setTitle", "setWidget", "set_editor_text"])("keeps %s extension UI non-blocking", (method) => expect(extensionUiBlocksAgent(method)).toBe(false));
  it("normalizes an above-editor widget", () => expect(normalizeExtensionWidget({ widgetKey: "usage", widgetLines: ["one", "two"] })).toEqual({ key: "usage", placement: "aboveEditor", lines: ["one", "two"] }));
  it("keeps below-editor placement", () => expect(normalizeExtensionWidget({ widgetKey: "usage", widgetPlacement: "belowEditor", widgetLines: ["one"] })?.placement).toBe("belowEditor"));
  it("uses missing lines as widget removal", () => expect(normalizeExtensionWidget({ widgetKey: "usage" })?.lines).toBeNull());
  it("rejects missing widget keys", () => expect(normalizeExtensionWidget({ widgetLines: ["one"] })).toBeNull());
});
