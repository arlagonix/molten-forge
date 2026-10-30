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
export const PROJECT_BATCH_SIZE = 12;

/**
 * Steps a "Show N more" list by whole batches and never below one batch.
 * Sessions and projects share this so both paginate identically.
 */
export function nextVisibleCount(current: number, total: number, direction: "more" | "less", batchSize: number): number {
  const normalized = Math.max(batchSize, Math.ceil(current / batchSize) * batchSize);
  return direction === "more"
    ? Math.min(total, normalized + batchSize)
    : Math.max(batchSize, normalized - batchSize);
}

export function nextVisibleSessionCount(current: number, total: number, direction: "more" | "less"): number {
  return nextVisibleCount(current, total, direction, SESSION_BATCH_SIZE);
}

export function nextVisibleProjectCount(current: number, total: number, direction: "more" | "less"): number {
  return nextVisibleCount(current, total, direction, PROJECT_BATCH_SIZE);
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

export type ProjectSummary = { cwd: string; activityTimestamp?: string | null; modifiedAt?: number; reachable?: boolean };

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

/**
 * Drops projects whose folder no longer exists. A deleted directory cannot host a
 * Pi session, so listing it only offers an action that cannot succeed. Sessions on
 * disk are untouched: restore the folder and the project reappears on next load.
 * The active project is always kept, because the user is already inside it.
 */
export function filterReachableProjects(
  paths: readonly string[], summaries: readonly ProjectSummary[], activeProject: string,
): string[] {
  const reachable = new Map(summaries.map((summary) => [projectKeyForSidebar(summary.cwd), summary.reachable !== false]));
  const activeKey = activeProject ? projectKeyForSidebar(activeProject) : "";
  return paths.filter((path) => {
    const key = projectKeyForSidebar(path);
    return key === activeKey || (reachable.get(key) ?? true);
  });
}

/**
 * Projects visible under "Show more". Mirrors the session list so both read the
 * same. The active project is always inside the page, because entering the app
 * must never hide where you are.
 */
export function visibleProjectPaths(
  paths: readonly string[], count: number, activeProject: string,
): string[] {
  const visible = paths.slice(0, Math.max(0, count));
  const activeKey = activeProject ? projectKeyForSidebar(activeProject) : "";
  if (!activeKey || visible.some((path) => projectKeyForSidebar(path) === activeKey)) return visible;
  const activePath = paths.find((path) => projectKeyForSidebar(path) === activeKey);
  return activePath === undefined ? visible : [...visible, activePath];
}
