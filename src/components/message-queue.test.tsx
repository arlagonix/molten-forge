import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageQueue } from "./message-queue";
import { QueueModeSelect } from "./queue-mode-select";

describe("Pi queued message controls", () => {
  it("keeps the queue strip absent when Pi has no pending inputs", () => {
    expect(renderToStaticMarkup(createElement(MessageQueue, {
      queue: { steering: [], followUp: [] }, onRetrieve: () => {},
    }))).toBe("");
  });
  it("shows both queue classes and a labelled retrieval action", () => {
    const html = renderToStaticMarkup(createElement(MessageQueue, {
      queue: { steering: ["Change direction"], followUp: ["Test afterward"] }, onRetrieve: () => {},
    }));
    expect(html).toContain("Queued (2)");
    expect(html).toContain("Change direction");
    expect(html).toContain("Test afterward");
    expect(html).toContain('aria-label="Retrieve queued messages"');
  });
  it("exposes both choices in a native keyboard-accessible selector", () => {
    const html = renderToStaticMarkup(createElement(QueueModeSelect, { value: "followUp", onChange: () => {} }));
    expect(html).toContain('<option value="followUp" selected="">Follow-up</option>');
    expect(html).toContain('<option value="steer">Steer</option>');
    expect(html).toContain('aria-label="Message delivery mode"');
  });
});
