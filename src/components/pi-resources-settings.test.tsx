import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PiResourcesSettings } from "./pi-resources-settings";
import { PiSkillsSettings } from "./pi-skills-settings";

const extensionsSource = fs.readFileSync(path.resolve("src/components/pi-resources-settings.tsx"), "utf8");
const skillsSource = fs.readFileSync(path.resolve("src/components/pi-skills-settings.tsx"), "utf8");
const settingsSource = fs.readFileSync(path.resolve("src/components/settings-view.tsx"), "utf8");
const css = fs.readFileSync(path.resolve("src/styles.css"), "utf8");

describe("Pi Skills Settings visual structure", () => {
  it("mounts the original-style Skills workspace instead of a centered General Settings card", () => {
    const html = renderToStaticMarkup(<PiSkillsSettings cwd="" commands={[]} />);
    expect(html).toContain("pi-skills-workspace");
    expect(html).toContain("pi-skills-list-pane");
    expect(html).toContain("pi-skills-search-header");
    expect(html).toContain("pi-skills-list-footer");
    expect(html).toContain("pi-skill-detail-pane");
    expect(html).not.toContain("settings-page-content");
    expect(settingsSource).toContain('activeSection === "skills" ? <PiSkillsSettings');
    expect(css).toMatch(/\.pi-skills-workspace\s*\{[^}]*grid-template-columns:\s*var\(--settings-sidebar-width, 260px\) minmax\(0, 1fr\)/);
  });
  it("keeps both panes independent and full-height, with the old separate header", () => {
    expect(css).toContain(".pi-skills-list-scroll { flex: 1;");
    expect(css).toContain(".pi-skill-detail-scroll {");
    expect(css).toContain(".pi-skill-detail-header {");
    expect(skillsSource).toContain("pi-skill-detail-fields");
    expect(skillsSource).toContain("pi-skills-list-item-copy");
    expect(skillsSource).toContain("pi-skills-group");
    expect(skillsSource).toContain("groupResourcesByScope(skills)");
  });
  it("shows skill contents directly in a read-only CodeMirror viewer with line numbers", () => {
    expect(skillsSource).toContain('invoke<string>("read_pi_skill"');
    expect(skillsSource).toContain('language="markdown" wrapped lineNumbers');
    expect(skillsSource).toContain("ReadOnlyCodeViewer");
    expect(skillsSource).toContain("View skill");
    expect(skillsSource).toContain("Open global skills folder");
    expect(skillsSource).toContain("open_pi_resource_root");
    for (const disallowed of ["Create skill", "Enable skills globally", "Clone", "Delete", "Save skill"]) expect(skillsSource).not.toContain(disallowed);
  });
  it("matches the sibling Settings sidebar widths and header/footer heights", () => {
    expect(css).toMatch(/\.settings-workspace\s*\{[\s\S]*?grid-template-columns: var\(--settings-sidebar-width, 260px\) minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.pi-skills-search-header\s*\{[^}]*height: 41px;/);
    expect(css).toMatch(/\.pi-skill-detail-header\s*\{[^}]*height: 41px;/);
    expect(css).toMatch(/\.pi-skills-list-footer\s*\{[^}]*height: 48px;/);
    expect(css).toMatch(/\.pi-skill-detail-fields\s*\{[^}]*width: min\(800px, 100%\)/);
  });
  it("renders compact, accessible footer actions and a proper full-window read-only viewer", () => {
    const html = renderToStaticMarkup(<PiSkillsSettings cwd="" commands={[]} />);
    expect(html).toContain('aria-label="Open global skills folder"');
    expect(html).toContain('aria-label="Reload skills"');
    expect(html).not.toContain("<span>Open global folder</span>");
    expect(skillsSource).toContain('createPortal(<div className="pi-skill-view-overlay"');
    expect(skillsSource).toContain('document.body)');
    expect(skillsSource).toContain('aria-label="Close skill viewer"');
    expect(skillsSource).toContain('className="pi-skill-code-viewer"');
    expect(css).toMatch(/\.pi-skill-view-overlay\s*\{[^}]*position: fixed;/);
    expect(css).toMatch(/\.pi-skill-code-viewer \.cm-scroller\s*\{[^}]*overflow-x: hidden;/);
    expect(css).toMatch(/\.pi-skill-code-viewer \.cm-content\s*\{[^}]*min-width: 0;/);
    expect(css).toMatch(/\.pi-skill-code-viewer \.cm-line\s*\{[^}]*overflow-wrap: anywhere;/);
  });
  it("keeps the Skills search focus ring inside its input (matching the original picker)", () => {
    expect(css).toMatch(/\.pi-skills-search-box:focus-within\s*\{[^}]*box-shadow: none;/);
    expect(css).toMatch(/\.pi-skills-search-box input:focus-visible\s*\{[^}]*box-shadow: none;/);
    expect(css).toMatch(/\.pi-skills-search-box input\s*\{[^}]*padding: 0;/);
  });
  it("centers both footer icons in equal-width buttons and aligns the location action", () => {
    expect(css).toMatch(/\.pi-skills-list-footer button\s*\{[^}]*flex: 1 1 0;/);
    expect(css).toMatch(/\.pi-skills-list-footer button\s*\{[^}]*justify-content: center;/);
    expect(css).toMatch(/\.pi-skill-icon-button\s*\{[^}]*align-self: stretch;/);
    expect(css).toMatch(/\.pi-skill-icon-button\s*\{[^}]*padding: 0;/);
    expect(css).toMatch(/\.pi-skill-icon-button svg\s*\{[^}]*display: block;/);
  });
  it("gives the description more height and fits the read-only dialog to viewport minus 16px per side", () => {
    expect(css).toMatch(/\.pi-skill-description\s*\{[^}]*min-height: 112px;[^}]*max-height: 158px;/);
    expect(css).toMatch(/\.pi-skill-view-overlay\s*\{[^}]*padding: 16px;/);
    expect(css).toMatch(/\.pi-skill-view-dialog\s*\{[^}]*height: calc\(100dvh - 32px\);/);
  });
  it("preserves dark/light tint and bounded glass panels", () => {
    expect(css).toContain("background: var(--app-glass-card);");
    // The strong surface is still a real token used by foreground chrome such as
    // the scroll-to-bottom button, so assert the declaration rather than one
    // specific consumer. Settings chrome itself now uses --app-chrome-tint.
    expect(css).toMatch(/--app-glass-strong:\s*#[a-f\d]+;/i);
    expect(css).toContain("background: var(--code-bg);");
    expect(css).toMatch(/\.pi-skill-editor-frame\s*\{[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.pi-skill-code-viewer \.cm-scroller\s*\{[^}]*overflow-x: hidden;/);
  });
});

describe("Pi Extensions inventory", () => {
  it("remains in the compact General-style cards independent of Skills", () => {
    const html = renderToStaticMarkup(<PiResourcesSettings cwd="" commands={[]} />);
    expect(html).toContain("settings-page-content");
    expect(extensionsSource).toContain("settings-resource-list");
    expect(extensionsSource).toContain("mergePiCommands(data?.extensions");
    expect(extensionsSource).toContain("open_resource_folder");
  });
});
