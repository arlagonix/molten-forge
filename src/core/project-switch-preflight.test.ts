import { describe, expect, it, vi } from "vitest";
import { prepareProjectSwitch } from "./project-switch-preflight";
import { rememberLastProjectSession } from "./project-history";

type Session = { path: string; activityTimestamp?: string; modifiedAt: number };
const earlier: Session = { path: "/sessions/earlier.jsonl", activityTimestamp: "2026-10-20T10:00:00Z", modifiedAt: 1 };
const latest: Session = { path: "/sessions/latest.jsonl", activityTimestamp: "2026-10-22T10:00:00Z", modifiedAt: 2 };

function fakePi(options: { exists?: boolean; confirm?: boolean; sessions?: Session[] } = {}) {
  return {
    directoryExists: vi.fn(async (_path: string) => options.exists ?? true),
    confirmStop: vi.fn(() => options.confirm ?? true),
    listSessions: vi.fn(async (_project: string) => options.sessions ?? [earlier, latest]),
    beginSwitch: vi.fn(),
  };
}

describe("project switch preparation against fake native responses", () => {
  it("rejects a renamed/missing folder before interruption or listing sessions", async () => {
    const pi = fakePi({ exists: false });
    const result = await prepareProjectSwitch({ project: "C:\\old-folder", busy: true, fresh: false, lastSelected: {} }, pi);
    expect(result).toEqual({ status: "missing" });
    expect(pi.directoryExists).toHaveBeenCalledWith("C:\\old-folder");
    expect(pi.confirmStop).not.toHaveBeenCalled();
    expect(pi.listSessions).not.toHaveBeenCalled();
    expect(pi.beginSwitch).not.toHaveBeenCalled();
  });

  it("cancels a busy project switch without loading or restoring a conversation", async () => {
    const pi = fakePi({ confirm: false });
    expect(await prepareProjectSwitch({ project: "/other", busy: true, fresh: false, lastSelected: {} }, pi))
      .toEqual({ status: "cancelled" });
    expect(pi.confirmStop).toHaveBeenCalledTimes(1);
    expect(pi.listSessions).not.toHaveBeenCalled();
    expect(pi.beginSwitch).not.toHaveBeenCalled();
  });

  it("restores the last selected session, rather than the most recently active session", async () => {
    const pi = fakePi();
    const selected = rememberLastProjectSession({}, "/work/project", earlier.path);
    const result = await prepareProjectSwitch({ project: "/work/project", busy: false, fresh: false, lastSelected: selected }, pi);
    expect(result).toEqual({ status: "ready", initialSessions: [earlier, latest], restore: earlier });
    expect(pi.confirmStop).not.toHaveBeenCalled();
    expect(pi.listSessions).toHaveBeenCalledTimes(1);
    expect(pi.beginSwitch).toHaveBeenCalledTimes(1);
    expect(pi.beginSwitch.mock.invocationCallOrder[0]).toBeLessThan(pi.listSessions.mock.invocationCallOrder[0]);
  });

  it("uses the most recent session when no prior selection exists", async () => {
    const result = await prepareProjectSwitch({ project: "/other", busy: false, fresh: false, lastSelected: {} }, fakePi());
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.restore?.path).toBe(latest.path);
  });

  it("skips history lookup and restoration when creating a fresh session", async () => {
    const pi = fakePi();
    const result = await prepareProjectSwitch({ project: "/other", busy: false, fresh: true, lastSelected: {} }, pi);
    expect(result).toEqual({ status: "ready", restore: undefined, initialSessions: undefined });
    expect(pi.listSessions).not.toHaveBeenCalled();
  });

  it("opens an explicitly chosen conversation without querying a project list", async () => {
    const pi = fakePi();
    const result = await prepareProjectSwitch({ project: "/other", busy: false, fresh: false, targetSession: earlier, lastSelected: {} }, pi);
    expect(result).toEqual({ status: "ready", restore: earlier, initialSessions: undefined });
    expect(pi.listSessions).not.toHaveBeenCalled();
  });

  it("propagates native discovery errors rather than pretending the project has no history", async () => {
    const pi = fakePi();
    pi.listSessions.mockRejectedValueOnce(new Error("disk not available"));
    await expect(prepareProjectSwitch({ project: "/other", busy: false, fresh: false, lastSelected: {} }, pi))
      .rejects.toThrow("disk not available");
  });
});
