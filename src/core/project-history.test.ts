import { describe, expect, it } from "vitest";
import { LAST_PROJECT_SESSIONS_KEY, readLastProjectSessions, rememberLastProjectSession, sessionToRestore, writeLastProjectSessions } from "./project-history";

describe("last selected conversation per project", () => {
  it("restores previously selected chat, not necessarily most recently active", () => {
    const chats = [{ path: "latest" }, { path: "earlier" }];
    const selected = rememberLastProjectSession({}, "C:\\Work\\A", "earlier");
    expect(sessionToRestore("c:\\work\\a\\", chats, selected)).toEqual(chats[1]);
    expect(sessionToRestore("/other", chats, selected)).toEqual(chats[0]);
    expect(sessionToRestore("/other", [], selected)).toBeUndefined();
  });
  it("persists safely and rejects corrupt storage", () => {
    const db = new Map<string, string>();
    const storage = { getItem: (key: string) => db.get(key) ?? null, setItem: (key: string, value: string) => void db.set(key, value) };
    const selected = rememberLastProjectSession({}, "/project", "/sessions/one.jsonl");
    writeLastProjectSessions(storage, selected);
    expect(JSON.parse(db.get(LAST_PROJECT_SESSIONS_KEY)!)).toEqual(selected);
    expect(readLastProjectSessions(storage)).toEqual(selected);
    db.set(LAST_PROJECT_SESSIONS_KEY, "invalid-json");
    expect(readLastProjectSessions(storage)).toEqual({});
  });
});
