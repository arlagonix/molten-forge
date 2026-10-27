export const RECENT_PROJECTS_STORAGE_KEY = "molten-forge-pi-recent-projects";
export const MAX_RECENT_PROJECTS = 10000;

function trimPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z]:[\\/]$/.test(trimmed) || trimmed === "/") return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

function projectKey(value: string): string {
  const normalized = trimPath(value);
  if (/^[A-Za-z]:[\\/]/.test(normalized) || normalized.includes("\\")) {
    return normalized.toLocaleLowerCase("en-US");
  }
  return normalized;
}

export function normalizeRecentProjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const path = trimPath(item);
    if (!path) continue;
    const key = projectKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
    if (result.length >= MAX_RECENT_PROJECTS) break;
  }
  return result;
}

export function rememberRecentProject(
  current: readonly string[],
  workingDirectory: string,
  max = MAX_RECENT_PROJECTS,
): string[] {
  const path = trimPath(workingDirectory);
  if (!path) return normalizeRecentProjects(current);
  const key = projectKey(path);
  return [path, ...normalizeRecentProjects(current).filter((item) => projectKey(item) !== key)].slice(0, Math.max(1, max));
}

export function readRecentProjects(storage: Pick<Storage, "getItem">): string[] {
  try {
    const raw = storage.getItem(RECENT_PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeRecentProjects(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeRecentProjects(
  storage: Pick<Storage, "setItem">,
  projects: readonly string[],
): void {
  try {
    storage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(normalizeRecentProjects(projects)));
  } catch {
    // Persistence is optional; the current app session can still show recents.
  }
}

export function projectNameFromPath(workingDirectory: string): string {
  const path = trimPath(workingDirectory);
  if (!path) return "Project";
  if (/^[A-Za-z]:[\\/]$/.test(path) || path === "/") return path;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}
