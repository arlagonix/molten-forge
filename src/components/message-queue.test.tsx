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
  it("uses a content-sized and keyboard-accessible trigger", () => {
    const steer = renderToStaticMarkup(createElement(QueueModeSelect, { value: "steer", onChange: () => {} }));
    const followUp = renderToStaticMarkup(createElement(QueueModeSelect, { value: "followUp", onChange: () => {} }));
    expect(steer).toContain('aria-haspopup="menu"');
    expect(steer).toContain('aria-label="Message delivery mode: Steer"');
    expect(followUp).toContain('aria-label="Message delivery mode: Follow-up"');
    expect(followUp).not.toContain('<select');
  });
});
