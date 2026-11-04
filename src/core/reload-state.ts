/** One-tab, reload-only UI recovery. Never use this to override Pi session data. */
export const RELOAD_VIEWPORT_KEY = "molten-forge-reload-viewport-v1";
export const RELOAD_DRAFT_KEY = "molten-forge-reload-draft-v1";
const MAX_AGE_MS = 15 * 60 * 1000;

export type ReloadViewport = {
  cwd: string;
  session: string | null;
  scrollTop: number;
  atBottom: boolean;
  savedAt: number;
};

type ReloadDraft = {
  cwd: string;
  session: string | null;
  value: string;
  savedAt: number;
};

type ReadWriteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function readSnapshot<T extends { cwd: string; savedAt: number }>(storage: ReadWriteStorage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record || typeof record.cwd !== "string" || !record.cwd.trim() ||
      !Number.isFinite(record.savedAt) || Date.now() - record.savedAt > MAX_AGE_MS || record.savedAt > Date.now()) {
      storage.removeItem(key);
      return null;
    }
    return record as T;
  } catch { return null; }
}

export function persistReloadViewport(
  storage: ReadWriteStorage, state: Omit<ReloadViewport, "savedAt">,
): void {
  if (!state.cwd || !Number.isFinite(state.scrollTop) || state.scrollTop < 0) return;
  try { storage.setItem(RELOAD_VIEWPORT_KEY, JSON.stringify({ ...state, savedAt: Date.now() })); } catch {}
}

export function readReloadViewport(storage: ReadWriteStorage): ReloadViewport | null {
  const state = readSnapshot<ReloadViewport>(storage, RELOAD_VIEWPORT_KEY);
  if (!state || !Number.isFinite(state.scrollTop) || state.scrollTop < 0 || typeof state.atBottom !== "boolean") return null;
  return state;
}

export function clearReloadViewport(storage: ReadWriteStorage): void {
  try { storage.removeItem(RELOAD_VIEWPORT_KEY); } catch {}
}

export function persistReloadDraft(
  storage: ReadWriteStorage, state: Omit<ReloadDraft, "savedAt">,
): void {
  if (!state.cwd) return;
  try { storage.setItem(RELOAD_DRAFT_KEY, JSON.stringify({ ...state, savedAt: Date.now() })); } catch {}
}

export function takeReloadDraft(storage: ReadWriteStorage, cwd: string, session: string | null): string {
  const state = readSnapshot<ReloadDraft>(storage, RELOAD_DRAFT_KEY);
  if (!state || state.cwd !== cwd || typeof state.value !== "string" ||
    (session && state.session && state.session !== session)) return "";
  try { storage.removeItem(RELOAD_DRAFT_KEY); } catch {}
  return state.value;
}

export function reloadViewportApplies(state: ReloadViewport | null, cwd: string, session: string | null): boolean {
  return Boolean(state && state.cwd === cwd && (!session || !state.session || state.session === session));
}
