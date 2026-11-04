import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsInlineSelect } from "./settings-inline-select";

const css = fs.readFileSync(path.resolve("src/styles.css"), "utf8");

describe("OpenCode-style inline Settings pickers", () => {
  it("renders a semantic content-sized trigger with the selected label", () => {
    const html = renderToStaticMarkup(<SettingsInlineSelect
      label="Timeline detail" value="semi-compact"
      options={[{ value: "compact", label: "Compact" }, { value: "semi-compact", label: "Semi Compact" }]}
      onChange={() => {}}
    />);
    expect(html).toContain('aria-label="Timeline detail"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Semi Compact");
    expect(css).toContain(".settings-inline-select { position: relative;");
    expect(css).toMatch(/\.settings-inline-trigger,[\s\S]*?width:\s*max-content;/);
    expect(css).toContain("max-width: none;");
    expect(css).toContain("border: 0 !important;");
  });
});
