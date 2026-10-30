import { describe, expect, it, vi } from "vitest";
import { executeProjectSwitch, type ProjectSwitchLifecycle } from "./project-switch-lifecycle";

type Session = { path: string; activityTimestamp: string; modifiedAt: number };
const previous = { path: "/old/session.jsonl", activityTimestamp: "2026-10-20T09:00:00Z", modifiedAt: 1 };
const selected = { path: "/new/selected.jsonl", activityTimestamp: "2026-10-22T09:00:00Z", modifiedAt: 2 };

function harness(options: {
  connected?: boolean;
  folderExists?: boolean;
  confirm?: boolean;
  busy?: boolean;
  directBash?: boolean;
  stopFails?: boolean;
  connectSucceeds?: boolean;
  restoreSucceeds?: boolean;
  interruptSucceeds?: boolean;
  discoveryFails?: boolean;
  restoreFails?: boolean;
} = {}) {
  const events: string[] = [];
  const state = {
    project: "/old",
    session: previous.path as string | null,
    loading: false,
    switching: false,
    inputBlocked: false,
    piConnected: options.connected ?? true,
    error: null as string | null,
    missing: null as string | null,
  };
  const trace = (event: string) => { events.push(event); };
  const ops: ProjectSwitchLifecycle<Session> = {
    preflight: {
      directoryExists: vi.fn(async () => { trace("validate"); return options.folderExists ?? true; }),
      confirmStop: vi.fn(() => { trace("confirm"); return options.confirm ?? true; }),
      listSessions: vi.fn(async () => {
        trace("list");
        if (options.discoveryFails) throw new Error("session discovery failed");
        return [selected];
      }),
      beginSwitch: () => { trace("loading:start"); state.loading = true; state.switching = true; },
    },
    onMissing: (path) => { trace("missing"); state.missing = path; },
    onCancelled: () => { trace("cancelled"); state.missing = null; },
    beginInputBlock: () => { trace("input:block"); state.inputBlocked = true; },
    endInputBlock: () => { trace("input:unblock"); state.inputBlocked = false; },
    isStreaming: () => options.busy ?? false,
    interruptGeneration: async () => { trace("interrupt"); return options.interruptSucceeds ?? true; },
    cancelScheduledLiveContextRefresh: () => trace("cancel:stats"),
    isDirectBashRunning: () => options.directBash ?? false,
    abortDirectBash: async () => trace("abort:bash"),
    stopPi: async () => {
      trace("stop");
      if (options.stopFails) throw new Error("stop failed");
      state.piConnected = false;
    },
    resetAfterStop: () => { trace("reset:old"); state.session = null; },
    setDirectory: (path) => { trace("select:" + path); state.project = path; },
    connect: async () => {
      trace("connect");
      if (options.connectSucceeds === false) { state.piConnected = false; return false; }
      state.piConnected = true;
      return true;
    },
    syncFreshSession: async () => { trace("sync:fresh"); state.session = null; },
    rememberFreshSession: () => trace("remember:fresh"),
    restoreSession: async (path) => {
      trace("restore:" + path);
      if (options.restoreFails) throw new Error("restore RPC failed");
      if (options.restoreSucceeds === false) return false;
      state.session = path;
      return true;
    },
    onRestoreCancelled: () => { trace("restore:cancelled"); state.error = "Pi cancelled restoring the selected conversation."; },
    onFailure: (error) => { trace("error"); state.error = `Could not switch project: ${String(error)}`; },
    onFinish: () => { trace("loading:end"); state.loading = false; state.switching = false; },
  };
  return { state, events, ops };
}

const request = (connected = true, extra: Partial<{ busy: boolean; fresh: boolean }> = {}) => ({
  project: "/new", connected, busy: extra.busy ?? false, fresh: extra.fresh ?? false,
  lastSelected: { "/new": selected.path },
});

describe("real project switch coordinator with a scripted Pi runtime", () => {
  it("validates missing folders without mutating the current session or stopping Pi", async () => {
    const { ops, state, events } = harness({ folderExists: false });
    await executeProjectSwitch(request(), ops);
    expect(state).toMatchObject({ project: "/old", session: previous.path, piConnected: true, missing: "/new", loading: false, switching: false, inputBlocked: false });
    expect(events).toEqual(["validate", "missing", "loading:end"]);
  });

  it("preserves the active Pi and releases all controls after declining interruption", async () => {
    const { ops, state, events } = harness({ busy: true, confirm: false });
    await executeProjectSwitch(request(true, { busy: true }), ops);
    expect(state).toMatchObject({ project: "/old", session: previous.path, piConnected: true, loading: false, inputBlocked: false });
    expect(events).toEqual(["validate", "confirm", "cancelled", "loading:end"]);
  });

  it("stops the old runtime before connecting, then restores the requested session before completing loading", async () => {
    const { ops, state, events } = harness();
    await executeProjectSwitch(request(), ops);
    expect(state).toMatchObject({ project: "/new", session: selected.path, piConnected: true, loading: false, switching: false, inputBlocked: false, error: null });
    expect(events).toEqual(["validate", "loading:start", "list", "input:block", "cancel:stats", "stop", "reset:old", "select:/new", "connect", `restore:${selected.path}`, "input:unblock", "loading:end"]);
  });

  it("a stop failure leaves the previous connected session intact and unblocks input", async () => {
    const { ops, state, events } = harness({ stopFails: true });
    await executeProjectSwitch(request(), ops);
    expect(state).toMatchObject({ project: "/old", session: previous.path, piConnected: true, loading: false, inputBlocked: false });
    expect(state.error).toContain("stop failed");
    expect(events).not.toContain("connect");
    expect(events).not.toContain("reset:old");
    expect(events.slice(-3)).toEqual(["input:unblock", "error", "loading:end"]);
  });

  it("a refused interrupt does not call stop or discard the active chat", async () => {
    const { ops, state, events } = harness({ busy: true, interruptSucceeds: false });
    await executeProjectSwitch(request(true, { busy: true }), ops);
    expect(state).toMatchObject({ project: "/old", session: previous.path, piConnected: true, loading: false, inputBlocked: false });
    expect(events).toContain("interrupt");
    expect(events).not.toContain("stop");
    expect(events.slice(-2)).toEqual(["input:unblock", "loading:end"]);
  });

  it("waits for direct Bash to abort before stopping the Pi process", async () => {
    const { ops, events } = harness({ directBash: true });
    await executeProjectSwitch(request(true, { busy: true }), ops);
    expect(events.indexOf("abort:bash")).toBeLessThan(events.indexOf("stop"));
  });

  it("keeps project loading visible until an asynchronous Pi restoration actually completes", async () => {
    const { ops, state, events } = harness();
    let finishRestore!: (restored: boolean) => void;
    ops.restoreSession = (path) => {
      events.push("restore:waiting:" + path);
      return new Promise<boolean>((resolve) => { finishRestore = resolve; });
    };
    const switching = executeProjectSwitch(request(), ops);
    // Advance through the preflight, native stop, connect and pending RPC.
    for (let i = 0; i < 15 && !events.some((event) => event.startsWith("restore:waiting:")); i++) await Promise.resolve();
    expect(events).toContain(`restore:waiting:${selected.path}`);
    expect(state).toMatchObject({ loading: true, switching: true, inputBlocked: true });
    finishRestore(true);
    await switching;
    expect(state).toMatchObject({ loading: false, switching: false, inputBlocked: false });
    expect(events.slice(-2)).toEqual(["input:unblock", "loading:end"]);
  });

  it("reports a failed reconnect and clears both loading and blocked input", async () => {
    const { ops, state, events } = harness({ connectSucceeds: false });
    await executeProjectSwitch(request(), ops);
    expect(state).toMatchObject({ project: "/new", session: null, piConnected: false, loading: false, switching: false, inputBlocked: false });
    expect(events).not.toContain(`restore:${selected.path}`);
    expect(events.slice(-2)).toEqual(["input:unblock", "loading:end"]);
  });

  it("surfaces a cancelled restoration and still completes the transition", async () => {
    const { ops, state } = harness({ restoreSucceeds: false });
    await executeProjectSwitch(request(), ops);
    expect(state).toMatchObject({ project: "/new", piConnected: true, loading: false, inputBlocked: false, error: "Pi cancelled restoring the selected conversation." });
  });

  it("reports a restoration RPC rejection and unblocks the UI", async () => {
    const { ops, state, events } = harness({ restoreFails: true });
    await executeProjectSwitch(request(), ops);
    expect(state.error).toContain("restore RPC failed");
    expect(state).toMatchObject({ loading: false, switching: false, inputBlocked: false });
    expect(events.slice(-3)).toEqual(["input:unblock", "error", "loading:end"]);
  });

  it("handles session discovery failures without ever stopping the old runtime", async () => {
    const { ops, state, events } = harness({ discoveryFails: true });
    await executeProjectSwitch(request(), ops);
    expect(state).toMatchObject({ project: "/old", session: previous.path, piConnected: true, loading: false, inputBlocked: false });
    expect(state.error).toContain("session discovery failed");
    expect(events).not.toContain("stop");
    expect(events.slice(-2)).toEqual(["error", "loading:end"]);
  });

  it("starts a fresh session without restoring history and clears previous selection", async () => {
    const { ops, events, state } = harness();
    await executeProjectSwitch(request(true, { fresh: true }), ops);
    expect(state).toMatchObject({ project: "/new", session: null, piConnected: true, loading: false });
    expect(events).toContain("sync:fresh");
    expect(events).toContain("remember:fresh");
    expect(events).not.toContain("list");
    expect(events.some((event) => event.startsWith("restore:"))).toBe(false);
  });

  it("restores a selected conversation from a disconnected launch without stop/input blocking", async () => {
    const { ops, events, state } = harness({ connected: false });
    await executeProjectSwitch(request(false), ops);
    expect(state).toMatchObject({ project: "/new", session: selected.path, piConnected: true, loading: false, inputBlocked: false });
    expect(events).not.toContain("stop");
    expect(events).not.toContain("input:block");
    expect(events).toContain(`restore:${selected.path}`);
  });
});
