import { describe, expect, it } from "vitest";
import { mergePiCommands, groupResourcesByScope } from "./pi-resources";
import type { CommandInfo } from "./chat-logic";

const commands: CommandInfo[] = [
  { name: "skill:review", source: "skill", description: "Review code", sourceInfo: { path: "C:\\repo\\.pi\\skills\\review\\SKILL.md", scope: "project" } },
  { name: "custom", source: "extension", sourceInfo: { path: "C:\\repo\\.pi\\extensions\\custom.ts", scope: "project" } },
];
describe("Pi commands and resource inventory", () => {
  it("matches a skill reported by Pi to the same on-disk skill", () => {
    const resources = mergePiCommands([{ name: "review", path: "C:/repo/.pi/skills/review/SKILL.md", scope: "Project", description: "", kind: "skill" }], commands, "skill");
    expect(resources).toHaveLength(1);
    expect(resources[0].runtimeCommand).toBe("/skill:review");
  });
  it("includes Pi command resources that the directory inventory missed", () => {
    const resources = mergePiCommands([], commands, "extension");
    expect(resources).toMatchObject([{ name: "custom", scope: "Project", runtimeCommand: "/custom" }]);
  });
  it("does not attach a runtime marker to merely discovered on-disk files", () => {
    expect(mergePiCommands([{ name: "unloaded", path: "/local/test.ts", scope: "Global", description: "", kind: "extension" }], [], "extension")[0].runtimeCommand).toBeUndefined();
  });
  it("does not confuse skills and extensions", () => {
    expect(mergePiCommands([], commands, "skill")).toHaveLength(1);
    expect(mergePiCommands([], commands, "extension")).toHaveLength(1);
  });
  it("groups resources into global and project sections and omits empty scopes", () => {
    const groups = groupResourcesByScope([
      { name: "a", path: "/project/a", scope: "Project", description: "", kind: "skill" },
      { name: "b", path: "/global/b", scope: "Global", description: "", kind: "skill" },
      { name: "c", path: "/project/c", scope: "Project", description: "", kind: "extension" },
    ]);
    expect(groups.map((group) => group.title)).toEqual(["Global", "Project"]);
    expect(groups[1].items.map((item) => item.name)).toEqual(["a", "c"]);
    expect(groupResourcesByScope([])).toEqual([]);
  });
  it("keeps nonstandard runtime scopes visible under Other", () => {
    expect(groupResourcesByScope([
      { name: "temporary", path: "/temp/a", scope: "Temporary", description: "", kind: "extension" },
    ]).map((group) => group.title)).toEqual(["Other"]);
  });
});
