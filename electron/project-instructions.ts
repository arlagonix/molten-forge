import { promises as fs } from "node:fs";
import path from "node:path";

import type { ChatWorkspaceRoot } from "../src/lib/ai-chat/types";
import {
  PROJECT_INSTRUCTIONS_FILE_NAME,
  PROJECT_INSTRUCTIONS_SOFT_LIMIT_BYTES,
  type ProjectInstructionsReadResult,
} from "../src/lib/ai-chat/project-instructions";
import { isPlainObject, safeString } from "./tool-utils";

export type ProjectInstructionsReadRequest = {
  workspaceRoot: ChatWorkspaceRoot;
  approveOversized?: boolean;
};

function normalizeWorkspaceRoot(value: unknown): ChatWorkspaceRoot | undefined {
  if (!isPlainObject(value)) return undefined;

  const id = safeString(value.id).trim();
  const name = safeString(value.name).trim();
  const rootPath = safeString(value.path).trim();
  const createdAt = safeString(value.createdAt).trim();

  if (!id || !rootPath) return undefined;

  return {
    id,
    name: name || path.basename(rootPath) || rootPath,
    path: rootPath,
    createdAt: createdAt || new Date(0).toISOString(),
  };
}

export function normalizeProjectInstructionsRequest(
  request: unknown,
): ProjectInstructionsReadRequest {
  if (!isPlainObject(request)) {
    throw new Error("Project instructions request is required.");
  }

  const workspaceRoot = normalizeWorkspaceRoot(request.workspaceRoot);
  if (!workspaceRoot) {
    throw new Error("A workspace root is required to load AGENTS.md.");
  }

  return {
    workspaceRoot,
    approveOversized: request.approveOversized === true,
  };
}

export async function readProjectInstructionsForWorkspace(
  request: ProjectInstructionsReadRequest,
): Promise<ProjectInstructionsReadResult> {
  const workspacePath = request.workspaceRoot.path.trim();
  if (!workspacePath) {
    throw new Error("Workspace path is required.");
  }

  const instructionsPath = path.join(workspacePath, PROJECT_INSTRUCTIONS_FILE_NAME);

  try {
    const stat = await fs.stat(instructionsPath);
    if (!stat.isFile()) {
      return { status: "none", path: instructionsPath };
    }

    if (
      stat.size > PROJECT_INSTRUCTIONS_SOFT_LIMIT_BYTES &&
      !request.approveOversized
    ) {
      return {
        status: "approval_required",
        workspaceRoot: request.workspaceRoot,
        path: instructionsPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    }

    const content = await fs.readFile(instructionsPath, "utf8");
    return {
      status: "loaded",
      workspaceRoot: request.workspaceRoot,
      path: instructionsPath,
      content,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      loadedAt: new Date().toISOString(),
    };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { status: "none", path: instructionsPath };
    }

    return {
      status: "failed",
      workspaceRoot: request.workspaceRoot,
      path: instructionsPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
