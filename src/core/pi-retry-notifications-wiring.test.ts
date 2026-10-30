import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = fs.readFileSync(path.resolve("src/App.tsx"), "utf8");
const settings = fs.readFileSync(path.resolve("src/components/settings-view.tsx"), "utf8");
const rust = fs.readFileSync(path.resolve("src-tauri/src/lib.rs"), "utf8");
const caps = fs.readFileSync(path.resolve("src-tauri/capabilities/default.json"), "utf8");

describe("provider retry notice lifecycle", () => {
  it("dismisses transient notices when an assistant resumes or auto retry succeeds", () => {
    const reconnect = app.slice(app.indexOf('case "auto_retry_end"'), app.indexOf('case "summarization_retry_scheduled"'));
    expect(reconnect).toContain("if (success)");
    expect(reconnect).toContain("dismissRetryNotices()");
    const assistantResumption = app.slice(app.indexOf('case "message_start"'), app.indexOf('case "message_update"'));
    expect(assistantResumption).toContain("dismissRetryNotices()");
  });

  it("preserves a failed retry as an error and never boxes status into a runtime group", () => {
    expect(app).toContain('kind: "retry", title: "Retry failed"');
    expect(app).toContain('state: "error"');
  });
});

describe("native completion notification wiring", () => {
  it("is opt-in with a native permission request on enable", () => {
    expect(settings).toContain("Notify when a response finishes in the background");
    expect(app).toContain('getStoredBoolean(BACKGROUND_COMPLETION_NOTIFICATION_KEY, false)');
    expect(app).toContain("await requestPermission()");
  });

  it("checks actual window focus at the settled boundary, never on turn_end", () => {
    const handler = app.slice(app.indexOf('case "agent_settled"'), app.indexOf('case "message_start"'));
    expect(handler).toContain("getCurrentWindow().isFocused()");
    expect(handler).toContain("shouldNotifyForSettledRun");
    expect(handler).toContain("sendNotification(");
  });

  it("registers Tauri plugin with only necessary capabilities", () => {
    expect(rust).toContain(".plugin(tauri_plugin_notification::init())");
    expect(caps).toContain("notification:allow-notify");
    expect(caps).toContain("notification:allow-request-permission");
    expect(caps).not.toContain("notification:default");
  });
});
