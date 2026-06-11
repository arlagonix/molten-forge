import { describe, expect, it } from "vitest";

import {
  createProjectInstructionsContextBlock,
  getProjectInstructionsSnapshot,
  shouldRefreshProjectInstructions,
  type ProjectInstructionsState,
} from "@/lib/ai-chat/project-instructions";
import type { ChatWorkspaceRoot } from "@/lib/ai-chat/types";

function root(path: string): ChatWorkspaceRoot {
  return {
    id: "root-1",
    name: "Project",
    path,
    createdAt: "2026-06-11T00:00:00.000Z",
  };
}

describe("project instructions", () => {
  it("wraps loaded AGENTS.md content in a hidden context block", () => {
    const block = createProjectInstructionsContextBlock({
      workspaceRoot: root("/work/project"),
      path: '/work/project/AGENTS.md?x="1"',
      content: "## Rules\nUse tests.",
      sizeBytes: 19,
      mtimeMs: 100,
      loadedAt: "2026-06-11T00:00:00.000Z",
    });

    expect(block).toContain("<workspace_project_instructions");
    expect(block).toContain("source=\"/work/project/AGENTS.md?x=&quot;1&quot;\"");
    expect(block).toContain("## Rules\nUse tests.");
    expect(block).toContain("higher-priority system/developer instructions");
  });

  it("does not create a block for empty instructions", () => {
    expect(
      createProjectInstructionsContextBlock({
        workspaceRoot: root("/work/project"),
        path: "/work/project/AGENTS.md",
        content: "   ",
        sizeBytes: 3,
        mtimeMs: 100,
        loadedAt: "2026-06-11T00:00:00.000Z",
      }),
    ).toBe("");
  });

  it("only exposes a model snapshot for loaded state", () => {
    const loaded: ProjectInstructionsState = {
      status: "loaded",
      event: "loaded",
      workspaceRoot: root("/work/project"),
      path: "/work/project/AGENTS.md",
      content: "rules",
      sizeBytes: 5,
      mtimeMs: 100,
      loadedAt: "2026-06-11T00:00:00.000Z",
    };

    expect(getProjectInstructionsSnapshot(loaded)?.content).toBe("rules");
    expect(
      getProjectInstructionsSnapshot({ status: "none", workspacePath: "/work/project" }),
    ).toBeUndefined();
  });

  it("refreshes when the selected workspace changes", () => {
    const state: ProjectInstructionsState = {
      status: "loaded",
      event: "loaded",
      workspaceRoot: root("/work/old"),
      path: "/work/old/AGENTS.md",
      content: "old",
      sizeBytes: 3,
      mtimeMs: 100,
      loadedAt: "2026-06-11T00:00:00.000Z",
    };

    expect(shouldRefreshProjectInstructions(state, root("/work/old"))).toBe(false);
    expect(shouldRefreshProjectInstructions(state, root("/work/new"))).toBe(true);
  });
});
