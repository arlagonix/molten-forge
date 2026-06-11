import { describe, expect, it } from "vitest";

import { normalizeAppSettings } from "./storage";
import type { AppSettings } from "./types";

const oldDate = "2026-01-01T00:00:00.000Z";

describe("chat storage normalization", () => {
  it("preserves a folder default workspace across app settings save/load", () => {
    const settings: AppSettings = {
      chatTitleGenerationMode: "local",
      fontFamily: "sans",
      thinkingAutoCollapse: false,
      chatFolders: [
        {
          id: "folder-1",
          name: "Project folder",
          createdAt: oldDate,
          updatedAt: oldDate,
          workspaceRoots: [
            {
              id: "workspace-1",
              name: "Project A",
              path: "/work/project-a",
              createdAt: oldDate,
              kind: "manual",
            },
          ],
        },
      ],
    };

    expect(
      normalizeAppSettings(settings).chatFolders[0]?.workspaceRoots,
    ).toEqual([
      {
        id: "workspace-1",
        name: "Project A",
        path: "/work/project-a",
        createdAt: oldDate,
        automatic: undefined,
        kind: "manual",
      },
    ]);
  });

  it("keeps only the first persisted folder workspace", () => {
    const normalized = normalizeAppSettings({
      chatTitleGenerationMode: "local",
      fontFamily: "sans",
      chatFolders: [
        {
          id: "folder-1",
          name: "Project folder",
          createdAt: oldDate,
          updatedAt: oldDate,
          workspaceRoots: [
            {
              id: "workspace-1",
              name: "Project A",
              path: "/work/project-a",
              createdAt: oldDate,
            },
            {
              id: "workspace-2",
              name: "Project B",
              path: "/work/project-b",
              createdAt: oldDate,
            },
          ],
        },
      ],
    });

    expect(normalized.chatFolders[0]?.workspaceRoots).toHaveLength(1);
    expect(normalized.chatFolders[0]?.workspaceRoots?.[0]?.path).toBe(
      "/work/project-a",
    );
  });

  it("normalizes persisted folder workspaces without removing the folder workspace option", () => {
    const normalized = normalizeAppSettings({
      chatTitleGenerationMode: "local",
      fontFamily: "sans",
      chatFolders: [
        {
          id: "folder-1",
          name: "Project folder",
          createdAt: oldDate,
          updatedAt: oldDate,
          workspaceRoots: [
            {
              id: "workspace-1",
              name: "  Project A  ",
              path: "  /work/project-a  ",
              createdAt: oldDate,
              kind: "manual",
            },
            {
              id: "workspace-empty",
              name: "Broken",
              path: "   ",
              createdAt: oldDate,
            },
          ],
        },
      ],
    });

    expect(normalized.chatFolders[0]?.workspaceRoots).toEqual([
      {
        id: "workspace-1",
        name: "Project A",
        path: "/work/project-a",
        createdAt: oldDate,
        automatic: undefined,
        kind: "manual",
      },
    ]);
  });

  it("defaults streaming Markdown rendering to enabled", () => {
    expect(normalizeAppSettings({}).renderMarkdownWhileStreaming).toBe(true);
  });

  it("preserves disabled streaming Markdown rendering", () => {
    expect(
      normalizeAppSettings({ renderMarkdownWhileStreaming: false })
        .renderMarkdownWhileStreaming,
    ).toBe(false);
  });

  it("preserves enabled streaming Markdown rendering", () => {
    expect(
      normalizeAppSettings({ renderMarkdownWhileStreaming: true })
        .renderMarkdownWhileStreaming,
    ).toBe(true);
  });

});
