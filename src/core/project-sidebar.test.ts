import { describe, expect, it } from "vitest";
import {
  PROJECT_BATCH_SIZE, filterReachableProjects, nextVisibleSessionCount, orderedProjectPaths, projectActivityTime,
  projectKeyForSidebar, nextVisibleProjectCount, sortProjectPaths, sortSessionsByActivity,
  visibleProjectPaths,
} from "./project-sidebar";

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

describe("project reachability filter", () => {
  const summaries = [
    { cwd: "/live", reachable: true },
    { cwd: "/gone", reachable: false },
    { cwd: "/unknown" },
  ];

  it("hides projects whose folder is gone", () => {
    // A deleted folder cannot host a Pi session, so listing it only offers the
    // user an action that cannot succeed. The sidebar must not show it at all.
    expect(filterReachableProjects(["/gone", "/live", "/unknown"], summaries, ""))
      .toEqual(["/live", "/unknown"]);
  });

  it("treats projects with no summary as reachable instead of guessing", () => {
    expect(filterReachableProjects(["/recent-only", "/gone"], summaries, "")).toEqual(["/recent-only"]);
  });

  it("keeps the active project even when its folder is gone", () => {
    // The user is already inside it; removing the row would strand them with no
    // indication of where the open conversation lives.
    expect(filterReachableProjects(["/live", "/gone"], summaries, "/gone")).toEqual(["/live", "/gone"]);
  });

  it("compares paths case-insensitively so the active project is recognized", () => {
    expect(filterReachableProjects(["C:\Live", "C:\Gone"], [{ cwd: "c:\gone", reachable: false }], "c:\live"))
      .toEqual(["C:\Live", "C:\Gone"]);
  });

  it("preserves incoming order and drops only the unreachable entries", () => {
    expect(filterReachableProjects(["/a", "/gone1", "/b", "/gone2"], [
      { cwd: "/gone1", reachable: false }, { cwd: "/gone2", reachable: false },
    ], "")).toEqual(["/a", "/b"]);
  });

  it("returns an empty list instead of inventing projects", () => {
    expect(filterReachableProjects([], summaries, "")).toEqual([]);
    expect(filterReachableProjects(["/gone"], summaries, "")).toEqual([]);
  });
});

describe("project pagination", () => {
  const many = Array.from({ length: 30 }, (_, index) => `/p${index}`);

  it("pages projects in the same batches as sessions", () => {
    // Uniformity contract: projects use the same step/label shape as the
    // session list inside an expanded project.
    expect(PROJECT_BATCH_SIZE).toBe(12);
    expect(nextVisibleProjectCount(PROJECT_BATCH_SIZE, 30, "more")).toBe(PROJECT_BATCH_SIZE * 2);
    expect(nextVisibleProjectCount(PROJECT_BATCH_SIZE * 2, 30, "more")).toBe(30);
    expect(nextVisibleProjectCount(30, 30, "more")).toBe(30);
  });

  it("never pages below one batch on the way back", () => {
    // 12 → 24 → 30 → 24, so a round trip lands where it started.
    expect(nextVisibleProjectCount(30, 30, "less")).toBe(PROJECT_BATCH_SIZE * 2);
    expect(nextVisibleProjectCount(PROJECT_BATCH_SIZE * 2, 30, "less")).toBe(PROJECT_BATCH_SIZE);
    expect(nextVisibleProjectCount(PROJECT_BATCH_SIZE, 30, "less")).toBe(PROJECT_BATCH_SIZE);
  });

  it("normalizes an out-of-step count before stepping", () => {
    expect(nextVisibleProjectCount(7, 30, "more")).toBe(PROJECT_BATCH_SIZE * 2);
    expect(nextVisibleProjectCount(0, 30, "more")).toBe(PROJECT_BATCH_SIZE * 2);
  });

  it("slices projects without inventing or duplicating any", () => {
    expect(visibleProjectPaths(many, PROJECT_BATCH_SIZE, "/p0")).toEqual(many.slice(0, PROJECT_BATCH_SIZE));
    expect(visibleProjectPaths(many, 30, "/p0")).toEqual(many);
    expect(visibleProjectPaths(many, 100, "/p0")).toEqual(many);
    expect(visibleProjectPaths([], PROJECT_BATCH_SIZE, "")).toEqual([]);
  });

  it("always keeps the active project inside the visible page", () => {
    // The user is inside a project that sorts past the page; hiding it would
    // leave the sidebar with no indication of where they are.
    const visible = visibleProjectPaths(many, PROJECT_BATCH_SIZE, "/p25");
    expect(visible).toHaveLength(PROJECT_BATCH_SIZE + 1);
    expect(visible).toContain("/p25");
  });

  it("does not duplicate the active project when it is already visible", () => {
    const visible = visibleProjectPaths(many, PROJECT_BATCH_SIZE, "/p3");
    expect(visible.filter((path) => path === "/p3")).toHaveLength(1);
    expect(visible).toHaveLength(PROJECT_BATCH_SIZE);
  });

  it("matches the active project case-insensitively on Windows", () => {
    expect(visibleProjectPaths(["C:\\Dev\\MF"], PROJECT_BATCH_SIZE, "c:\\dev\\mf\\")).toEqual(["C:\\Dev\\MF"]);
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
