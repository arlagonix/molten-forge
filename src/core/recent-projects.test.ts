import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_PROJECTS,
  RECENT_PROJECTS_STORAGE_KEY,
  normalizeRecentProjects,
  projectNameFromPath,
  readRecentProjects,
  rememberRecentProject,
  writeRecentProjects,
} from "./recent-projects";

describe("recent projects", () => {
  it("normalizes paths and retains all projects without the old eight-item cap", () => {
    const input = [
      " C:\\Prime\\Molten-Forge\\ ",
      "c:\\prime\\molten-forge",
      "/home/alex/work/one/",
      ...Array.from({ length: 12 }, (_, index) => `/work/${index}`),
    ];
    const result = normalizeRecentProjects(input);
    expect(result[0]).toBe("C:\\Prime\\Molten-Forge");
    expect(result[1]).toBe("/home/alex/work/one");
    expect(result).toHaveLength(14);
    expect(MAX_RECENT_PROJECTS).toBeGreaterThan(100);
  });

  it("moves an opened project to the front without duplicating it", () => {
    expect(rememberRecentProject(["C:\\A", "C:\\B"], "c:\\b\\")).toEqual([
      "c:\\b",
      "C:\\A",
    ]);
  });

  it("reads and writes through the storage boundary safely", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    writeRecentProjects(storage, ["/repo/a", "/repo/b"]);
    expect(values.get(RECENT_PROJECTS_STORAGE_KEY)).toBe('["/repo/a","/repo/b"]');
    expect(readRecentProjects(storage)).toEqual(["/repo/a", "/repo/b"]);
  });

  it("derives compact project labels for Windows and POSIX paths", () => {
    expect(projectNameFromPath("C:\\Prime\\GitHub\\molten-forge")).toBe("molten-forge");
    expect(projectNameFromPath("/home/alex/code/molten-forge/")).toBe("molten-forge");
    expect(projectNameFromPath("C:\\")).toBe("C:\\");
  });
});
