import { describe, expect, it } from "vitest";

import { buildSystemPromptWithActiveSkills } from "@/lib/ai-chat/request-builder";
import type { ChatWorkspaceRoot } from "@/lib/ai-chat/types";

function root(): ChatWorkspaceRoot {
  return {
    id: "root-1",
    name: "Project",
    path: "/work/project",
    createdAt: "2026-06-11T00:00:00.000Z",
  };
}

describe("buildSystemPromptWithActiveSkills project instructions", () => {
  it("injects AGENTS.md instructions after workspace context", () => {
    const prompt = buildSystemPromptWithActiveSkills({
      systemPrompt: "Base system prompt.",
      activeSkillNames: [],
      availableSkillsByName: new Map(),
      effectiveWorkspaceRoots: [root()],
      projectInstructions: {
        workspaceRoot: root(),
        path: "/work/project/AGENTS.md",
        content: "Always run focused tests.",
        sizeBytes: 25,
        mtimeMs: 100,
        loadedAt: "2026-06-11T00:00:00.000Z",
      },
    });

    expect(prompt).toContain("<workspace>");
    expect(prompt).toContain("<workspace_project_instructions source=\"/work/project/AGENTS.md\">");
    expect(prompt).toContain("Always run focused tests.");
    expect(prompt.indexOf("<workspace>")).toBeLessThan(
      prompt.indexOf("<workspace_project_instructions"),
    );
  });
});
