import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = fs.readFileSync(path.resolve("src/App.tsx"), "utf8");
const selector = fs.readFileSync(path.resolve("src/components/queue-mode-select.tsx"), "utf8");
const css = fs.readFileSync(path.resolve("src/styles.css"), "utf8");

describe("Composer control placement and delivery mode design", () => {
  it("keeps the delivery control and model selection left, context and send controls right", () => {
    const actions = app.slice(app.indexOf('<div className="composer-actions">'), app.indexOf('</form>', app.indexOf('<div className="composer-actions">')));
    const left = actions.slice(actions.indexOf('<div className="composer-left-actions">'), actions.indexOf('<div className="composer-right-actions">'));
    const right = actions.slice(actions.indexOf('<div className="composer-right-actions">'));
    expect(left).toContain('<QueueModeSelect value={deliveryMode} onChange={setDeliveryMode} />');
    expect(left).toContain('{modelSelection}');
    expect(right).toContain('{contextControl}');
    expect(right).not.toContain('composer-enter-hint');
    expect(css).not.toContain('.composer-enter-hint');
    expect(right).toContain('aria-label="Send message"');
    expect(css).toMatch(/\.composer-right-actions\s*\{[\s\S]*?gap:\s*16px !important;/);
    expect(right).toContain('aria-label={isBashRunning ? "Stop shell command" : "Stop generation"}');
  });

  it("aligns queued messages to the measured composer geometry", () => {
    const queue = css.slice(css.indexOf('.composer-queue {'));
    expect(queue).toContain('width: calc(var(--chat-content-physical-width');
    expect(queue).toContain('left: var(--chat-content-center-offset, 0px)');
    expect(queue).toContain('margin: 0 auto 7px');
  });

  it("sizes the mode trigger to the selected label and uses the shared chevron style", () => {
    expect(selector).toContain('<ChevronDown size={12} strokeWidth={1.8}');
    expect(selector).toContain('aria-haspopup="menu"');
    expect(selector).toContain('aria-checked={value === mode.value}');
    expect(selector).toContain('event.key === "Escape"');
    expect(selector).toContain('event.key === "ArrowDown"');
    expect(css).toMatch(/\.composer-delivery-trigger,[\s\S]*?width: max-content;/);
    expect(css).toContain('.composer-delivery-menu');
    expect(css).toContain('html[data-theme="light"] .composer-delivery-menu button');
    expect(css).not.toContain('.composer-queue-mode select {');
  });
});
