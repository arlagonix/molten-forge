import { describe, expect, it } from "vitest";
import { orderedProjectPaths, projectActivityTime, projectKeyForSidebar, nextVisibleSessionCount, sortSessionsByActivity, sortProjectPaths } from "./project-sidebar";

describe("project sidebar metadata", () => {
  it("keeps the active path once and preserves recent projects", () => {
    expect(orderedProjectPaths("C:\\Dev\\MF", ["c:\\dev\\mf\\", "C:\\Dev\\Other", "/home/a/"]))
      .toEqual(["C:\\Dev\\MF", "C:\\Dev\\Other", "/home/a/"]);
  });

  it("handles empty and duplicate paths without manufacturing projects", () => {
    expect(orderedProjectPaths("", [" ", "/one", "/one/"])).toEqual(["/one"]);
    expect(projectKeyForSidebar("C:\\WORK\\Pi\\")).toBe("c:\\work\\pi");
  });

  it("sorts by latest chat activity, not session creation time", () => {
    expect(projectActivityTime([
      { timestamp: "2026-01-01T00:00:00Z", activityTimestamp: "2026-10-20T18:00:00Z" },
      { timestamp: "2026-10-18T00:00:00Z", activityTimestamp: "2026-10-19T12:00:00Z" },
    ])).toBe(Date.parse("2026-10-20T18:00:00Z"));
    expect(projectActivityTime([])).toBe(0);
    expect(projectActivityTime()).toBe(0);
  });

  it("incrementally reveals and hides conversation batches", () => {
    expect(nextVisibleSessionCount(5, 81, "more")).toBe(10);
    expect(nextVisibleSessionCount(10, 81, "more")).toBe(15);
    expect(nextVisibleSessionCount(10, 81, "less")).toBe(5);
    expect(nextVisibleSessionCount(5, 81, "less")).toBe(5);
    expect(nextVisibleSessionCount(80, 81, "more")).toBe(81);
    expect(nextVisibleSessionCount(81, 81, "less")).toBe(80);
  });

  it("sorts sessions and projects by activity independently of opening order", () => {
    const sessions = [
      { path: "a", activityTimestamp: "2026-10-21T00:00:00Z" },
      { path: "b", activityTimestamp: "2026-10-22T00:00:00Z" },
    ];
    expect(sortSessionsByActivity(sessions).map((s) => s.path)).toEqual(["b", "a"]);
    expect(sessions[0].path).toBe("a");
    const summary = [
      { cwd: "/alpha", activityTimestamp: "2026-10-20T00:00:00Z" },
      { cwd: "/beta", activityTimestamp: "2026-10-22T00:00:00Z" },
    ];
    expect(sortProjectPaths(["/alpha", "/beta"], summary, "/alpha", [{ activityTimestamp: "2026-10-20T00:00:00Z" }])).toEqual(["/beta", "/alpha"]);
    expect(sortProjectPaths(["/alpha", "/beta"], summary, "/alpha", sessions)).toEqual(["/alpha", "/beta"]);
  });

  it("ignores malformed dates and uses file modification timestamp when needed", () => {
    expect(projectActivityTime([{ timestamp: "invalid", modifiedAt: 456 }])).toBe(456);
    expect(projectActivityTime([{ modifiedAt: 123 }, { modifiedAt: 345 }])).toBe(345);
  });
});


describe("project-switch preflight", () => {
  it("checks the selected cwd before stopping Pi and keeps stale paths visible", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    // The behavioral preflight (including rejecting a missing directory before
    // any interrupt/history lookup) is exercised with fake native responses in
    // project-switch-preflight.test.ts. Only native command registration is a
    // structural boundary here.
    const rust = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    expect(rust).toContain("fn project_directory_exists(path: String) -> bool");
    expect(rust).toContain("            project_directory_exists,");
  });
});
