import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PiToolsSettings } from "./pi-tools-settings";

describe("tools Settings", () => {
  it("shows the RPC limitation instead of pretending it has the active registry", () => {
    const html = renderToStaticMarkup(<PiToolsSettings items={[]} />);
    expect(html).toContain("Pi RPC does not expose a complete inventory");
    expect(html).toContain("No Pi tool calls observed");
  });
  it("renders observed tool details without mutation actions", () => {
    const html = renderToStaticMarkup(<PiToolsSettings items={[{ id: "1", kind: "tool", title: "read", text: "", state: "done" }]} />);
    expect(html).toContain("Invocations in this conversation");
    expect(html).toContain("read");
    expect(html).not.toContain("Edit tool");
  });
});
