import { describe, expect, it } from "vitest";
import {
  BACKGROUND_IMAGES_ENABLED_STORAGE_KEY,
  DEFAULT_APPEARANCE_SETTINGS,
  THEME_STORAGE_KEY,
  backgroundExtension,
  backgroundImageAcceptValue,
  isSupportedBackgroundImage,
  normalizeThemePreference,
  parseStoredBoolean,
  readAppearanceSettings,
  resolveThemePreference,
  selectActiveBackgroundUrl,
  writeBackgroundImagesEnabled,
  writeThemePreference,
} from "./appearance";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("appearance settings", () => {
  it("normalizes unknown themes to system", () => {
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("system")).toBe("system");
    expect(normalizeThemePreference("sepia")).toBe("system");
    expect(normalizeThemePreference(null)).toBe("system");
  });

  it("resolves system theme without changing explicit choices", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });

  it("defaults background images to enabled", () => {
    const storage = new MemoryStorage();
    expect(readAppearanceSettings(storage)).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  it("restores persisted theme and background visibility", () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, "light");
    storage.setItem(BACKGROUND_IMAGES_ENABLED_STORAGE_KEY, "false");
    expect(readAppearanceSettings(storage)).toEqual({
      theme: "light",
      backgroundImagesEnabled: false,
    });
  });

  it("falls back safely for malformed persisted booleans", () => {
    expect(parseStoredBoolean("yes", true)).toBe(true);
    expect(parseStoredBoolean("yes", false)).toBe(false);
    expect(parseStoredBoolean("true", false)).toBe(true);
    expect(parseStoredBoolean("false", true)).toBe(false);
  });

  it("writes normalized appearance values", () => {
    const storage = new MemoryStorage();
    writeThemePreference(storage, "dark");
    writeBackgroundImagesEnabled(storage, false);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(storage.getItem(BACKGROUND_IMAGES_ENABLED_STORAGE_KEY)).toBe("false");
  });
});

describe("background image selection", () => {
  it("accepts the old Molten Forge background formats", () => {
    for (const [name, type] of [
      ["mountains.jpg", "image/jpeg"],
      ["mountains.png", "image/png"],
      ["mountains.webp", "image/webp"],
      ["mountains.avif", "image/avif"],
    ]) {
      expect(isSupportedBackgroundImage({ name, type })).toBe(true);
    }
  });

  it("uses the file extension when the browser leaves MIME type empty", () => {
    expect(isSupportedBackgroundImage({ name: "scene.JPEG", type: "" })).toBe(true);
    expect(isSupportedBackgroundImage({ name: "scene.webp", type: "" })).toBe(true);
    expect(backgroundExtension("scene.WEBP")).toBe(".webp");
  });

  it("rejects unsupported custom background files", () => {
    expect(isSupportedBackgroundImage({ name: "scene.svg", type: "image/svg+xml" })).toBe(false);
    expect(isSupportedBackgroundImage({ name: "scene.gif", type: "image/gif" })).toBe(false);
    expect(isSupportedBackgroundImage({ name: "notes.txt", type: "" })).toBe(false);
  });

  it("advertises every supported format in the picker", () => {
    const accept = backgroundImageAcceptValue();
    for (const value of ["image/jpeg", "image/png", "image/webp", "image/avif", ".jpg", ".png", ".webp", ".avif"]) {
      expect(accept).toContain(value);
    }
  });

  it("uses a custom image only for its matching resolved theme", () => {
    const defaults = { light: "default-light", dark: "default-dark" };
    const custom = { light: "custom-light" };
    expect(selectActiveBackgroundUrl(true, "light", custom, defaults)).toBe("custom-light");
    expect(selectActiveBackgroundUrl(true, "dark", custom, defaults)).toBe("default-dark");
  });

  it("returns no image when backgrounds are disabled", () => {
    expect(selectActiveBackgroundUrl(false, "dark", { dark: "custom" }, { light: "l", dark: "d" })).toBeNull();
  });
});
