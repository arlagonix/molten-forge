import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PROJECT_INSTRUCTIONS_SOFT_LIMIT_BYTES } from "../src/lib/ai-chat/project-instructions";
import type { ChatWorkspaceRoot } from "../src/lib/ai-chat/types";
import { readProjectInstructionsForWorkspace } from "./project-instructions";

const tempDirs: string[] = [];

async function createTempWorkspace() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "molten-forge-agents-md-"),
  );
  tempDirs.push(directory);
  const workspaceRoot: ChatWorkspaceRoot = {
    id: "root-1",
    name: "Project",
    path: directory,
    createdAt: "2026-06-11T00:00:00.000Z",
  };
  return { directory, workspaceRoot };
}

describe("readProjectInstructionsForWorkspace", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("returns none when AGENTS.md is missing", async () => {
    const { workspaceRoot } = await createTempWorkspace();
    const result = await readProjectInstructionsForWorkspace({ workspaceRoot });

    expect(result.status).toBe("none");
    expect(result.path.endsWith("AGENTS.md")).toBe(true);
  });

  it("loads root AGENTS.md content", async () => {
    const { directory, workspaceRoot } = await createTempWorkspace();
    await writeFile(
      path.join(directory, "AGENTS.md"),
      "# Rules\nRun tests.",
      "utf8",
    );

    const result = await readProjectInstructionsForWorkspace({ workspaceRoot });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.content).toContain("Run tests.");
    expect(result.workspaceRoot.path).toBe(directory);
  });

  it("supports loading oversized AGENTS.md when the caller explicitly approves it", async () => {
    const { directory, workspaceRoot } = await createTempWorkspace();
    const content = "x".repeat(PROJECT_INSTRUCTIONS_SOFT_LIMIT_BYTES + 1);
    await writeFile(path.join(directory, "AGENTS.md"), content, "utf8");

    const pending = await readProjectInstructionsForWorkspace({
      workspaceRoot,
    });
    expect(pending.status).toBe("approval_required");

    const approved = await readProjectInstructionsForWorkspace({
      workspaceRoot,
      approveOversized: true,
    });
    expect(approved.status).toBe("loaded");
    if (approved.status !== "loaded") return;
    expect(approved.content.length).toBe(content.length);
  });
});
