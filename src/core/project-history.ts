import { projectKeyForSidebar } from "./project-sidebar";

export const LAST_PROJECT_SESSIONS_KEY = "molten-forge-pi-last-project-sessions";

export function readLastProjectSessions(storage: Pick<Storage, "getItem">): Record<string, string> {
  try {
    const raw = JSON.parse(storage.getItem(LAST_PROJECT_SESSIONS_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.length > 0 && typeof value === "string" && value.trim()) result[key] = value;
    }
    return result;
  } catch { return {}; }
}

export function rememberLastProjectSession(
  selections: Record<string, string>, project: string, sessionPath: string,
): Record<string, string> {
  if (!project.trim() || !sessionPath.trim()) return selections;
  return { ...selections, [projectKeyForSidebar(project)]: sessionPath };
}

export function writeLastProjectSessions(storage: Pick<Storage, "setItem">, selections: Record<string, string>): void {
  try { storage.setItem(LAST_PROJECT_SESSIONS_KEY, JSON.stringify(selections)); } catch { /* optional persistence */ }
}

export function sessionToRestore<T extends { path: string }>(
  project: string, sessions: readonly T[], lastSelected: Record<string, string>,
): T | undefined {
  const path = lastSelected[projectKeyForSidebar(project)];
  return sessions.find((session) => session.path === path) ?? sessions[0];
}
