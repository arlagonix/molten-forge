import { describe, expect, it } from "vitest";
import { isStoredBackgroundImage, loadStoredBackground } from "./background-store";

describe("stored background image validation", () => {
  it("accepts complete light and dark records", () => {
    const blob = new Blob(["image"], { type: "image/png" });
    expect(isStoredBackgroundImage({ theme: "light", name: "light.png", type: "image/png", blob, updatedAt: 1 })).toBe(true);
    expect(isStoredBackgroundImage({ theme: "dark", name: "dark.png", type: "image/png", blob, updatedAt: 2 })).toBe(true);
  });

  it("rejects corrupted IndexedDB values instead of applying them", () => {
    const blob = new Blob(["image"], { type: "image/png" });
    expect(isStoredBackgroundImage(null)).toBe(false);
    expect(isStoredBackgroundImage({ theme: "sepia", name: "x.png", type: "image/png", blob, updatedAt: 1 })).toBe(false);
    expect(isStoredBackgroundImage({ theme: "light", name: "", type: "image/png", blob, updatedAt: 1 })).toBe(false);
    expect(isStoredBackgroundImage({ theme: "light", name: "x.png", type: "image/png", blob: {}, updatedAt: 1 })).toBe(false);
    expect(isStoredBackgroundImage({ theme: "light", name: "x.png", type: "image/png", blob, updatedAt: Number.NaN })).toBe(false);
  });
});


describe("background image storage availability", () => {
  it("fails explicitly when IndexedDB is unavailable instead of pretending persistence worked", async () => {
    const previous = globalThis.indexedDB;
    try {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
      await expect(loadStoredBackground("light")).rejects.toThrow("IndexedDB is unavailable");
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previous });
    }
  });
});
