import { describe, expect, it } from "vitest";

import {
  getEffectiveSkillPermission,
  getEffectiveWorkspaceRoots,
} from "./request-builder";
import type { ChatWorkspaceRoot, SkillsSettings } from "./types";

const oldDate = "2026-01-01T00:00:00.000Z";

function workspaceRoot(
  overrides: Partial<ChatWorkspaceRoot> = {},
): ChatWorkspaceRoot {
  return {
    id: "workspace-1",
    name: "Project A",
    path: "/work/project-a",
    createdAt: oldDate,
    ...overrides,
  };
}

describe("skills workspace and permission behavior", () => {
  it("keeps a normal chat workspace available for workspace skill creation", () => {
    expect(
      getEffectiveWorkspaceRoots({
        workspaceRoots: [workspaceRoot({ id: "chat", kind: "chat" })],
        activeSkillNames: [],
        availableSkillsByName: new Map(),
      }),
    ).toEqual([
      {
        ...workspaceRoot({ id: "chat", kind: "chat" }),
        kind: "manual",
        automatic: false,
      },
    ]);
  });

  it("ignores automatically injected skill folders as workspace roots", () => {
    expect(
      getEffectiveWorkspaceRoots({
        workspaceRoots: [
          workspaceRoot({ id: "skill:docs:0", kind: "skill", automatic: true }),
          workspaceRoot({ id: "workspace-2", path: "/work/project-b" }),
        ],
        activeSkillNames: [],
        availableSkillsByName: new Map(),
      }),
    ).toEqual([
      {
        ...workspaceRoot({ id: "workspace-2", path: "/work/project-b" }),
        kind: "manual",
        automatic: false,
      },
    ]);
  });

  it("defaults missing skill permissions to allow", () => {
    const settings: SkillsSettings = {
      enabled: true,
      skillsPermission: "custom",
      skillPermissions: {},
      permissionModelVersion: 2,
    };

    expect(
      getEffectiveSkillPermission({ skillName: "docs", skillsSettings: settings }),
    ).toBe("allow");
  });
});
