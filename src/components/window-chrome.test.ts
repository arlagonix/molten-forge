import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const loadingScreen = readFileSync(new URL("./loading-screen.tsx", import.meta.url), "utf8");
const windowControls = readFileSync(new URL("./window-controls.tsx", import.meta.url), "utf8");
const tauriConfig = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const capability = JSON.parse(readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

describe("frameless Molten Forge window chrome", () => {
  it("disables the native title bar and grants only the window actions used by the custom chrome", () => {
    expect(tauriConfig.app.windows[0].decorations).toBe(false);
    expect(capability.permissions).toEqual(expect.arrayContaining([
      "core:window:default",
      "core:window:allow-close",
      "core:window:allow-minimize",
      "core:window:allow-toggle-maximize",
      "core:window:allow-start-dragging",
    ]));
  });

  it("reuses the existing top rows as drag regions instead of adding another title bar", () => {
    expect(app).not.toContain('<header className="launch-topbar"');
    expect(app).toMatch(/<div className="sidebar-titlebar" data-tauri-drag-region>/);
    expect(app).toMatch(/<header className="chat-header" data-tauri-drag-region>/);
    expect(styles).toMatch(/\.window-controls\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*4px;/);
  });

  it("keeps top-bar buttons outside the draggable region", () => {
    expect(styles).toMatch(/\[data-tauri-drag-region\] button,[\s\S]*?app-region:\s*no-drag;/);
  });

  it("wires minimize, maximize/restore, and close through Tauri window APIs", () => {
    expect(windowControls).toContain("getCurrentWindow().minimize()");
    expect(windowControls).toContain("getCurrentWindow().toggleMaximize()");
    expect(windowControls).toContain("getCurrentWindow().close()");
  });

  it("keeps all custom window controls visibly interactive", () => {
    expect(styles).toMatch(/\.window-control-button\s*\{[\s\S]*?cursor:\s*pointer\s*!important;/);
    expect(styles).toMatch(/\.window-control-button svg\s*\{[\s\S]*?pointer-events:\s*none;/);
  });
});

describe("Molten Forge startup loading screen", () => {
  it("preloads the active theme background and only fades it in after the image settles", () => {
    expect(loadingScreen).toContain("new Image()");
    expect(loadingScreen).toContain("backgroundVisible");
    expect(loadingScreen).toContain("theme-${theme}");
  });

  it("uses the old theme-aware loading treatment over a blurred background", () => {
    expect(styles).toMatch(/\.app-loading-background\s*\{[\s\S]*?filter:\s*blur\(18px\);/);
    expect(styles).toMatch(/\.app-loading-screen\.theme-dark \.molten-forge-loading-text\s*\{[\s\S]*?linear-gradient[\s\S]*?molten-forge-loading-lava/);
    expect(styles).toMatch(/\.app-loading-screen\.theme-light \.molten-forge-loading-text\s*\{[\s\S]*?molten-forge-loading-pulse/);
    expect(styles).toContain(".app-loading-screen.theme-light .app-loading-overlay");
  });

  it("holds the startup screen until initialization, background hydration, and the final selected image have settled", () => {
    expect(app).toContain("appInitializing || !backgroundsHydrated || !loadingVisualReady");
    expect(app).toContain("bridgeInitialized && piChecked");
    expect(app).toContain("setBackgroundsHydrated(true)");
    expect(app).toContain("loadingVisualReadyUrl === loadingBackgroundUrl");
    expect(loadingScreen).toContain("onVisualReady?.(backgroundUrl)");
  });
});
