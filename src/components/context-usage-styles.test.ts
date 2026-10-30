import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

describe("context usage visual contracts", () => {
  it("keeps compact header context percent as a normal telemetry item", () => {
    expect(styles).toMatch(/\.chat-meta\.token-stats \.token-stat-context-percent\s*\{/);
    expect(styles).toMatch(/\.chat-meta\.token-stats\s*\{[\s\S]*?gap:\s*10px;/);
  });

  it("renders the shared popover as a viewport-level portal surface", () => {
    expect(styles).toMatch(/\.context-popover\.context-popover-portal\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*100;/);
  });

  it("gives the details panel an internal vertical overflow boundary", () => {
    expect(styles).toMatch(/\.context-popover\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto;/);
  });

  it("defines a light-theme surface for the shared popover", () => {
    expect(styles).toMatch(/html\[data-theme="light"\] \.context-popover\s*\{/);
  });


  it("keeps the header telemetry focus ring around the full max-content stats row", () => {
    expect(styles).toMatch(/button\.context-telemetry-trigger,[\s\S]*?min-width:\s*max-content;[\s\S]*?overflow:\s*visible;/);
    expect(styles).toMatch(/button\.context-telemetry-trigger:focus-visible,[\s\S]*?outline:\s*1px solid[\s\S]*?outline-offset:\s*3px;/);
  });

  it("uses opaque context popovers without backdrop blur in both themes", () => {
    expect(styles).toMatch(/\.context-popover\.context-popover-portal\s*\{[^}]*background:\s*var\(--app-glass-card\);/);
    expect(styles).toMatch(/html\[data-theme="light"\] \.context-popover\.context-popover-portal\s*\{[^}]*background:\s*var\(--app-glass-card\);/);
    expect(styles).not.toMatch(/(?:-webkit-)?backdrop-filter\s*:/);
  });

  it("mirrors header telemetry colors onto usage values in the popover", () => {
    expect(styles).toMatch(/\.context-detail-rows \.context-usage-value-input\s*\{[^}]*var\(--header-telemetry-input\)/);
    expect(styles).toMatch(/\.context-detail-rows \.context-usage-value-output\s*\{[^}]*var\(--header-telemetry-output\)/);
    expect(styles).toMatch(/\.context-detail-rows \.context-usage-value-cache\s*\{[^}]*var\(--header-telemetry-cache\)/);
    expect(styles).toMatch(/\.context-detail-rows \.context-usage-value-hit\s*\{[^}]*var\(--header-telemetry-hit\)/);
  });
});
