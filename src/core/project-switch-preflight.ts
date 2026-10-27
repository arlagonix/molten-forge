import { sessionToRestore } from "./project-history";

export type ProjectSwitchSession = {
  path: string;
  activityTimestamp?: string | null;
  timestamp?: string | null;
  modifiedAt: number;
};

export type ProjectSwitchRequest<T extends ProjectSwitchSession> = {
  project: string;
  busy: boolean;
  fresh: boolean;
  targetSession?: T;
  lastSelected: Record<string, string>;
};

export type ProjectSwitchNative<T extends ProjectSwitchSession> = {
  directoryExists: (project: string) => Promise<boolean>;
  confirmStop: () => boolean;
  listSessions: (project: string) => Promise<T[]>;
  beginSwitch?: () => void;
};

export type ProjectSwitchPreparation<T extends ProjectSwitchSession> =
  | { status: "missing" | "cancelled" }
  | { status: "ready"; restore: T | undefined; initialSessions: T[] | undefined };

/**
 * Preflight must not stop Pi or mutate the current chat. Verify the target
 * directory before asking permission to interrupt, then discover history only
 * when we actually intend to restore an existing conversation.
 */
export async function prepareProjectSwitch<T extends ProjectSwitchSession>(
  request: ProjectSwitchRequest<T>,
  native: ProjectSwitchNative<T>,
): Promise<ProjectSwitchPreparation<T>> {
  if (!(await native.directoryExists(request.project))) return { status: "missing" };
  if (request.busy && !native.confirmStop()) return { status: "cancelled" };

  // The caller owns UI state, but it must start loading before the potentially
  // slow list_sessions RPC, never when the user refused or the folder is gone.
  native.beginSwitch?.();

  let restore = request.targetSession;
  let initialSessions: T[] | undefined;
  if (!request.fresh && !restore) {
    initialSessions = await native.listSessions(request.project);
    const ordered = [...initialSessions].sort((a, b) => {
      const aTime = Date.parse(a.activityTimestamp ?? a.timestamp ?? "") || a.modifiedAt;
      const bTime = Date.parse(b.activityTimestamp ?? b.timestamp ?? "") || b.modifiedAt;
      return bTime - aTime;
    });
    restore = sessionToRestore(request.project, ordered, request.lastSelected);
  }
  return { status: "ready", restore: request.fresh ? undefined : restore, initialSessions };
}
