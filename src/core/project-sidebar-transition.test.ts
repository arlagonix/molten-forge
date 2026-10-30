import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../components/project-session-sidebar.tsx", import.meta.url), "utf8");

// These assertions cover the cross-component loading/transition boundaries.
// Rendering tests in project-session-sidebar.test.tsx check the actual markup.
describe("project/session transition regression", () => {
  it("does not turn session-to-session history restoration into a project loading flash", () => {
    const resync = app.slice(app.indexOf("const resyncActiveSession"), app.indexOf("const restorePreferredModel"));
    expect(resync).not.toContain("setSessionsLoading(true)");
    expect(resync).toContain("setHistoryLoading(true)");
  });

  it("does not let session refreshes clear an in-flight project loading phase", () => {
    // The full switch/restore/cleanup sequence is tested by executing the
    // production coordinator in project-switch-lifecycle.test.ts.
    expect(app).toContain("if (!projectSwitchInFlightRef.current) setSessionsLoading(false)");
    const refresh = app.slice(app.indexOf("const refreshSessions"), app.indexOf("const refreshCommands"));
    expect(refresh).toContain("!projectSwitchInFlightRef.current");
  });

  it("keeps leaving rows mounted for a collapse and waits for a frame to open the ready project", () => {
    expect(sidebar).toContain("previous.current.key !== activeKey");
    expect(sidebar).toContain("requestAnimationFrame(() => setOpenedKey(activeKey))");
    expect(sidebar).toContain("departing.sessions");
  });

  it("uses the whole session row as the highlighted surface", () => {
    expect(css).toMatch(/\.project-session-children \{ padding: 0 0 5px; \}/);
    expect(css).toMatch(/\.project-session-row \{[^}]*width: 100%;[^}]*padding: 4px 9px 4px 32px;/);
    expect(css).not.toContain("@starting-style");
  });
});
