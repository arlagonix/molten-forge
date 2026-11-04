import { describe, expect, it } from "vitest";
import {
  RELOAD_DRAFT_KEY, RELOAD_VIEWPORT_KEY,
  clearReloadViewport, persistReloadDraft, persistReloadViewport,
  readReloadViewport, reloadViewportApplies, takeReloadDraft,
} from "./reload-state";

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe("Ctrl+R state recovery", () => {
  it("persists the numeric reader position for the same project and session", () => {
    const s = storage();
    persistReloadViewport(s, { cwd: "C:\\work", session: "one", scrollTop: 2468, atBottom: false });
    const state = readReloadViewport(s);
    expect(state).toMatchObject({ cwd: "C:\\work", session: "one", scrollTop: 2468, atBottom: false });
    expect(reloadViewportApplies(state, "C:\\work", "one")).toBe(true);
    expect(reloadViewportApplies(state, "C:\\other", "one")).toBe(false);
    expect(reloadViewportApplies(state, "C:\\work", "different")).toBe(false);
    clearReloadViewport(s);
    expect(readReloadViewport(s)).toBeNull();
  });

  it("preserves a draft once and never leaks it into another project or session", () => {
    const s = storage();
    persistReloadDraft(s, { cwd: "/repo", session: "a", value: "unsent\ntext" });
    expect(takeReloadDraft(s, "/other", "a")).toBe("");
    expect(takeReloadDraft(s, "/repo", "b")).toBe("");
    expect(takeReloadDraft(s, "/repo", "a")).toBe("unsent\ntext");
    expect(takeReloadDraft(s, "/repo", "a")).toBe("");
  });

  it("rejects expired, corrupted, or invalid scroll state", () => {
    const s = storage();
    persistReloadViewport(s, { cwd: "/repo", session: null, scrollTop: 10, atBottom: false });
    const record = JSON.parse(s.data.get(RELOAD_VIEWPORT_KEY)!);
    s.data.set(RELOAD_VIEWPORT_KEY, JSON.stringify({ ...record, savedAt: Date.now() - 20 * 60_000 }));
    expect(readReloadViewport(s)).toBeNull();
    s.data.set(RELOAD_VIEWPORT_KEY, "broken");
    expect(readReloadViewport(s)).toBeNull();
    s.data.set(RELOAD_DRAFT_KEY, JSON.stringify({ cwd: "/repo", value: "old", savedAt: Date.now() - 20 * 60_000 }));
    expect(takeReloadDraft(s, "/repo", null)).toBe("");
    persistReloadViewport(s, { cwd: "/repo", session: null, scrollTop: -10, atBottom: false });
    expect(readReloadViewport(s)).toBeNull();
  });
});
