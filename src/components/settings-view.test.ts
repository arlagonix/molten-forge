import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "./settings-view";

const source = fs.readFileSync(path.resolve("src/components/settings-view.tsx"), "utf8");
const css = fs.readFileSync(path.resolve("src/styles.css"), "utf8");

describe("settings workspace", () => {
  it("has separate General, Skills, Tools and Extensions sections", () => {
    expect(SETTINGS_SECTIONS).toEqual([
      { id: "general", label: "General" },
      { id: "skills", label: "Skills" },
      { id: "tools", label: "Tools" },
      { id: "extensions", label: "Extensions" },
    ]);
    expect(source).toContain('aria-label="Settings sections"');
    expect(source).toContain("SETTINGS_SECTIONS.map");
  });

  it("uses the old split settings layout instead of a modal", () => {
    expect(source).toContain('className="settings-workspace"');
    expect(source).toContain('className="settings-sidebar"');
    expect(source).toContain('className="settings-main"');
    expect(source).toContain("Back to chat");
    expect(css).toContain(".settings-workspace");
    expect(css).toContain("grid-template-columns: var(--settings-sidebar-width, 260px) minmax(0, 1fr)");
    expect(source).toContain('"--chat-width": `${contentWidth}px`');
  });

  it("exposes the sans, mono, and Miracode font choices in General", () => {
    expect(source).toContain('<option value="sans">Sans</option>');
    expect(source).toContain('<option value="mono">Mono</option>');
    expect(source).toContain('<option value="miracode">Miracode</option>');
  });

  it("offers opt-in background completion notifications", () => {
    expect(source).toContain("Notify when a response finishes in the background");
    expect(source).toContain("onNotifyWhenBackgroundChange(event.target.checked)");
    expect(source).toContain("checked={notifyWhenBackground}");
  });

  it("uses the app-wide 16px default for primary Settings controls", () => {
    expect(css).toMatch(/\.settings-row-copy strong\s*\{[\s\S]*?font-size:\s*16px;/);
    expect(css).toMatch(/\.settings-select\s*\{[\s\S]*?font-size:\s*16px;/);
    expect(css).toMatch(/\.settings-sidebar-row,[\s\S]*?\.settings-back-to-chat\s*\{[\s\S]*?font-size:\s*16px;/);
  });

  it("owns select chevron placement instead of relying on the cramped native arrow", () => {
    expect(source).toContain('className="settings-select-shell"');
    expect(source).toContain('className="settings-select-chevron"');
    expect(css).toMatch(/\.settings-select-shell \.settings-select\s*\{[\s\S]*?appearance:\s*none;/);
    expect(css).toMatch(/\.settings-select-chevron\s*\{[\s\S]*?right:\s*12px;/);
  });
});
