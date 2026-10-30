import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(path.resolve("src/App.tsx"), "utf8");
const css = fs.readFileSync(path.resolve("src/styles.css"), "utf8");

describe("in-chat project empty state", () => {
  it("renders the normal workspace regardless of connection state", () => {
    expect(appSource).toContain('className={`workspace');
    expect(appSource).not.toContain("{!showWorkspace && (");
    expect(appSource).not.toContain('className="connect-panel"');
    expect(appSource).toContain('className="no-project-state"');
    expect(appSource).toContain("No project open");
    expect(css).toContain(".no-project-state {");
  });
  it("supports project selection and settings before Pi connects", () => {
    expect(appSource).toContain('onClick={() => void chooseFolder()}');
    expect(appSource).toContain('onClick={() => setSettingsOpen(true)}');
    // Disconnected project startup is exercised through executeProjectSwitch
    // in project-switch-lifecycle.test.ts, not by requiring inline App code.
  });
  it("restores last active project only once after initialization", () => {
    expect(appSource).toContain("startupRestoreStartedRef.current = true");
    expect(appSource).toContain("getStoredWorkingDirectory()");
    expect(appSource).toContain("void switchToProject(previousDirectory)");
  });
});
