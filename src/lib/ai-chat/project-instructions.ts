import type { ChatWorkspaceRoot } from "@/lib/ai-chat/types";

export const PROJECT_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
export const PROJECT_INSTRUCTIONS_SOFT_LIMIT_BYTES = 32 * 1024;

export type ProjectInstructionsSnapshot = {
  workspaceRoot: ChatWorkspaceRoot;
  path: string;
  content: string;
  sizeBytes: number;
  mtimeMs: number;
  loadedAt: string;
};

export type ProjectInstructionsStatus =
  | "none"
  | "loaded"
  | "approval_required"
  | "skipped"
  | "failed";

export type ProjectInstructionsEvent =
  | "loaded"
  | "updated"
  | "discarded"
  | "approval_required"
  | "skipped"
  | "failed";

export type ProjectInstructionsState =
  | {
      status: "none";
      workspacePath?: string;
      event?: undefined;
    }
  | ({
      status: "loaded";
      event: "loaded" | "updated";
      replacedPath?: string;
    } & ProjectInstructionsSnapshot)
  | {
      status: "approval_required";
      event: "approval_required";
      workspaceRoot: ChatWorkspaceRoot;
      path: string;
      sizeBytes: number;
      mtimeMs: number;
    }
  | {
      status: "skipped";
      event: "skipped";
      workspaceRoot: ChatWorkspaceRoot;
      path: string;
      reason: "too_large" | "user_rejected";
      sizeBytes: number;
      mtimeMs: number;
    }
  | {
      status: "failed";
      event: "failed";
      workspaceRoot: ChatWorkspaceRoot;
      path: string;
      error: string;
    }
  | {
      status: "none";
      event: "discarded";
      workspacePath?: string;
      discardedPath: string;
    };

export type ProjectInstructionsReadResult =
  | {
      status: "none";
      path: string;
    }
  | ({
      status: "loaded";
    } & ProjectInstructionsSnapshot)
  | {
      status: "approval_required";
      workspaceRoot: ChatWorkspaceRoot;
      path: string;
      sizeBytes: number;
      mtimeMs: number;
    }
  | {
      status: "failed";
      workspaceRoot: ChatWorkspaceRoot;
      path: string;
      error: string;
    };

export function createProjectInstructionsContextBlock(
  snapshot: ProjectInstructionsSnapshot,
) {
  const source = escapeProjectInstructionsAttribute(snapshot.path);
  const content = snapshot.content.trim();
  if (!content) return "";

  return [
    `<workspace_project_instructions source="${source}">`,
    "These are project instructions loaded from the workspace AGENTS.md file. Follow them unless they conflict with higher-priority system/developer instructions or the user's explicit current request.",
    "",
    content,
    "</workspace_project_instructions>",
  ].join("\n");
}

export function getProjectInstructionsSnapshot(
  state: ProjectInstructionsState | undefined,
): ProjectInstructionsSnapshot | undefined {
  return state?.status === "loaded" ? state : undefined;
}

export function shouldRefreshProjectInstructions(
  state: ProjectInstructionsState | undefined,
  workspaceRoot: ChatWorkspaceRoot | undefined,
) {
  if (!workspaceRoot?.path.trim()) return false;
  if (!state) return true;
  if (state.status === "none" && !state.event) return true;
  if ("workspaceRoot" in state) {
    return state.workspaceRoot.path !== workspaceRoot.path;
  }
  return state.workspacePath !== workspaceRoot.path;
}

function escapeProjectInstructionsAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
