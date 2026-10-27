import {
  prepareProjectSwitch,
  type ProjectSwitchNative,
  type ProjectSwitchRequest,
  type ProjectSwitchSession,
} from "./project-switch-preflight";

/**
 * The project switch is one transaction. Pi remains authoritative: a folder is
 * validated before touching the active process, the old process must stop before
 * a new one starts, and a restored session must be synchronized before the
 * sidebar leaves its loading state.
 *
 * React owns the effects, native/RPC adapters and visible state. This shared
 * coordinator owns their order and their single, unconditional cleanup path.
 */
export type ProjectSwitchLifecycle<T extends ProjectSwitchSession> = {
  preflight: ProjectSwitchNative<T>;
  onMissing: (path: string) => void;
  onCancelled: () => void;
  beginInputBlock: () => void;
  endInputBlock: () => void;
  isStreaming: () => boolean;
  interruptGeneration: () => Promise<boolean>;
  cancelScheduledLiveContextRefresh: () => void;
  isDirectBashRunning: () => boolean;
  abortDirectBash: () => Promise<void>;
  stopPi: () => Promise<void>;
  resetAfterStop: () => void;
  setDirectory: (path: string) => void;
  connect: (path: string, initialSessions?: T[]) => Promise<boolean>;
  syncFreshSession: () => Promise<void>;
  rememberFreshSession: () => void;
  restoreSession: (sessionPath: string) => Promise<boolean>;
  onRestoreCancelled: () => void;
  onFailure: (error: unknown) => void;
  onFinish: () => void;
};

export async function executeProjectSwitch<T extends ProjectSwitchSession>(
  request: ProjectSwitchRequest<T> & { connected: boolean },
  actions: ProjectSwitchLifecycle<T>,
): Promise<void> {
  try {
    const prepared = await prepareProjectSwitch(request, actions.preflight);
    if (prepared.status !== "ready") {
      if (prepared.status === "missing") actions.onMissing(request.project);
      else actions.onCancelled();
      return;
    }

    if (request.connected) {
      actions.beginInputBlock();
      try {
        if (actions.isStreaming() && !(await actions.interruptGeneration())) return;
        actions.cancelScheduledLiveContextRefresh();
        if (actions.isDirectBashRunning()) await actions.abortDirectBash();

        // Do not clear the old conversation unless the native stop succeeds.
        await actions.stopPi();
        actions.resetAfterStop();
        actions.setDirectory(request.project);
        const started = await actions.connect(request.project, prepared.initialSessions);
        if (started && request.fresh) {
          await actions.syncFreshSession();
          actions.rememberFreshSession();
        }
        if (started && prepared.restore && !request.fresh) {
          const restored = await actions.restoreSession(prepared.restore.path);
          if (!restored) actions.onRestoreCancelled();
        }
      } finally {
        actions.endInputBlock();
      }
    } else {
      actions.setDirectory(request.project);
      const started = await actions.connect(request.project, prepared.initialSessions);
      if (started && prepared.restore && !request.fresh) {
        const restored = await actions.restoreSession(prepared.restore.path);
        if (!restored) actions.onRestoreCancelled();
      }
      if (started && request.fresh) await actions.syncFreshSession();
    }
  } catch (error) {
    actions.onFailure(error);
  } finally {
    // Exactly one owner clears the sidebar switch/loading flags, including
    // when preparation fails, the user cancels, Pi refuses to stop, or RPC fails.
    actions.onFinish();
  }
}
