import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));

describe("v0.36.26 input/header/font polish", () => {
  it("bundles JetBrains Mono through Fontsource and makes it the first mono face", () => {
    expect(packageJson.dependencies["@fontsource/jetbrains-mono"]).toBeTruthy();
    expect(styles).toContain('@import "@fontsource/jetbrains-mono/400.css";');
    expect(styles).toContain('@import "@fontsource/jetbrains-mono/700.css";');
    expect(styles).toContain('--app-font-mono: "JetBrains Mono", "Cascadia Code"');
  });

  it("uses the locally provisioned Miracode face for app and code typography", () => {
    expect(packageJson.scripts.prebuild).toContain("prepare-miracode.mjs");
    expect(packageJson.scripts.predev).toContain("prepare-miracode.mjs");
    expect(styles).toContain('font-family: "Miracode";');
    expect(styles).toContain('url("/fonts/Miracode.ttf")');
    expect(styles).toContain('--app-font-miracode: "Miracode"');
    expect(styles).toContain('html[data-app-font="miracode"] {');
    expect(styles).toContain('--app-font-code: var(--app-font-mono);');
    expect(styles).toMatch(/html\[data-app-font="miracode"\]\s*\{[^}]*--app-font-code:\s*var\(--app-font-miracode\)/);
    expect(styles).toContain('code, pre { font-family: var(--app-font-code); }');
  });

  it("marks direct ! / !! bash mode in the local composer only", () => {
    expect(appSource).toContain('input.trimStart().startsWith("!") ? "composer-bash-mode" : ""');
    expect(styles).toMatch(/\.composer\.composer-bash-mode,[\s\S]*?border-color:\s*var\(--pi-warning\)\s*!important;/);
  });

  it("hides header telemetry by chat-pane width and keeps semantic telemetry colors", () => {
    expect(styles).toContain("container-name: chat-pane;");
    expect(styles).toMatch(/@container chat-pane \(max-width:\s*760px\)[\s\S]*?\.header-context-control\s*\{[\s\S]*?display:\s*none;/);
    expect(styles).toContain("--header-telemetry-input: #2f6f9c;");
    expect(styles).toContain("--header-telemetry-output: #2d7f55;");
    expect(styles).toContain("--header-telemetry-cache: #7452b7;");
    expect(styles).toContain("--header-telemetry-hit: #9b6a1c;");
    expect(styles).toMatch(/\.chat-meta\.token-stats \.token-stat-input\s*\{\s*color:\s*var\(--header-telemetry-input\)\s*!important;/);
    expect(styles).toMatch(/\.chat-meta\.token-stats \.token-stat-cache\s*\{\s*color:\s*var\(--header-telemetry-cache\)\s*!important;/);
  });

  it("keeps enabled buttons pointer-shaped and gives the tiny context ring a real hover state", () => {
    expect(styles).toMatch(/button:not\(:disabled\)\s*\{[\s\S]*?cursor:\s*pointer;/);
    expect(styles).toMatch(/\.context-button:hover,[\s\S]*?box-shadow:\s*0 0 0 2px/);
  });

  it("softens the generic light button surface", () => {
    expect(styles).toContain("background: color-mix(in oklab, var(--card) 54%, transparent);");
    expect(styles).toContain('html[data-theme="light"] button:hover { background: var(--hover); }');
  });
});
