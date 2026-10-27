import { describe, expect, it } from "vitest";
import {
  APP_FONT_FAMILY_STORAGE_KEY,
  normalizeAppFontFamily,
  readAppFontFamily,
  writeAppFontFamily,
} from "./ui-preferences";

describe("UI preferences", () => {
  it("normalizes the app font family to the supported choices", () => {
    expect(normalizeAppFontFamily("mono")).toBe("mono");
    expect(normalizeAppFontFamily("sans")).toBe("sans");
    expect(normalizeAppFontFamily("computer-modern")).toBe("miracode");
    expect(normalizeAppFontFamily("monocraft")).toBe("miracode");
    expect(normalizeAppFontFamily("miracode")).toBe("miracode");
    expect(normalizeAppFontFamily("unknown")).toBe("sans");
    expect(normalizeAppFontFamily(null)).toBe("sans");
  });

  it("reads and writes the font preference without depending on browser storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };

    expect(readAppFontFamily(storage)).toBe("sans");
    writeAppFontFamily(storage, "mono");
    expect(values.get(APP_FONT_FAMILY_STORAGE_KEY)).toBe("mono");
    expect(readAppFontFamily(storage)).toBe("mono");
    writeAppFontFamily(storage, "miracode");
    expect(values.get(APP_FONT_FAMILY_STORAGE_KEY)).toBe("miracode");
    expect(readAppFontFamily(storage)).toBe("miracode");
    values.set(APP_FONT_FAMILY_STORAGE_KEY, "computer-modern");
    expect(readAppFontFamily(storage)).toBe("miracode");
    values.set(APP_FONT_FAMILY_STORAGE_KEY, "monocraft");
    expect(readAppFontFamily(storage)).toBe("miracode");
  });
});
