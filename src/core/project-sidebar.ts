type DatedSession = { activityTimestamp?: string | null; timestamp?: string | null; modifiedAt?: number };

export function projectKeyForSidebar(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.includes("\\")
    ? trimmed.toLowerCase()
    : trimmed;
}

export function orderedProjectPaths(activePath: string, recent: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of [activePath, ...recent]) {
    if (!path.trim()) continue;
    const key = projectKeyForSidebar(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

export function projectActivityTime(sessions?: readonly DatedSession[]): number {
  if (!sessions?.length) return 0;
  return sessions.reduce((latest, session) => {
    const date = session.activityTimestamp ?? session.timestamp;
    const parsed = date ? new Date(date).getTime() : 0;
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : (session.modifiedAt ?? 0);
    return Math.max(latest, value);
  }, 0);
}


export const SESSION_BATCH_SIZE = 5;
export const PROJECT_PAGE_SIZE = 25;

export function nextVisibleSessionCount(current: number, total: number, direction: "more" | "less"): number {
  const normalized = Math.max(SESSION_BATCH_SIZE, Math.ceil(current / SESSION_BATCH_SIZE) * SESSION_BATCH_SIZE);
  return direction === "more"
    ? Math.min(total, normalized + SESSION_BATCH_SIZE)
    : Math.max(SESSION_BATCH_SIZE, normalized - SESSION_BATCH_SIZE);
}

type SortableSession = DatedSession & { path: string };
export function sessionActivityTime(session: DatedSession): number {
  const timestamp = session.activityTimestamp ?? session.timestamp;
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : (session.modifiedAt ?? 0);
}
export function sortSessionsByActivity<T extends SortableSession>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => sessionActivityTime(b) - sessionActivityTime(a) || a.path.localeCompare(b.path));
}

export type ProjectSummary = { cwd: string; activityTimestamp?: string | null; modifiedAt?: number };
export function sortProjectPaths(
  paths: readonly string[], summaries: readonly ProjectSummary[],
  activeProject: string, activeSessions: readonly DatedSession[],
): string[] {
  const activity = new Map(summaries.map((summary) => [projectKeyForSidebar(summary.cwd), sessionActivityTime(summary)]));
  if (activeProject) activity.set(projectKeyForSidebar(activeProject), Math.max(
    activity.get(projectKeyForSidebar(activeProject)) ?? 0, projectActivityTime(activeSessions),
  ));
  return [...paths].sort((a, b) => (activity.get(projectKeyForSidebar(b)) ?? 0) - (activity.get(projectKeyForSidebar(a)) ?? 0));
}
