import { describe, expect, it } from "vitest";

import {
  applyNewChatDraftSettings,
  buildClonedChat,
  buildNewChatDraftSettings,
  getFolderDefaultWorkspaceRoots,
  renameChatWithoutActivityUpdate,
} from "./chat-session-actions";
import type { ChatFolder, ChatSession } from "./types";

const oldDate = "2026-01-01T00:00:00.000Z";
const cloneDate = "2026-02-01T00:00:00.000Z";

function createSourceChat(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "source-chat",
    title: "Source chat",
    titleMode: "manual",
    isPinned: true,
    messages: [],
    createdAt: oldDate,
    updatedAt: oldDate,
    ...overrides,
  };
}

function createBaseChat(): ChatSession {
  return {
    id: "cloned-chat",
    title: "New chat",
    titleMode: "auto",
    isPinned: false,
    messages: [],
    createdAt: cloneDate,
    updatedAt: cloneDate,
  };
}

describe("chat session actions", () => {
  it("uses the first folder workspace as the new-chat default", () => {
    const folder: ChatFolder = {
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
    };

    const roots = getFolderDefaultWorkspaceRoots(folder);

    expect(roots).toEqual([folder.workspaceRoots?.[0]]);
    expect(roots).not.toBe(folder.workspaceRoots);
    expect(roots[0]).not.toBe(folder.workspaceRoots?.[0]);
  });

  it("returns no default workspace when a folder has none", () => {
    expect(getFolderDefaultWorkspaceRoots()).toEqual([]);
    expect(
      getFolderDefaultWorkspaceRoots({
        id: "folder-1",
        name: "Empty folder",
        createdAt: oldDate,
        updatedAt: oldDate,
      }),
    ).toEqual([]);
  });

  it("opens a same-settings chat as an unsaved empty draft configuration instead of a clone", () => {
    const sourceChat = createSourceChat({
      folderId: "folder-1",
      providerId: "provider-1",
      model: "model-1",
      modeId: "mode-1",
      enabledToolNames: ["read"],
      disabledToolNames: ["write"],
      enabledSkillNames: ["docs"],
      disabledSkillNames: ["legacy"],
      enabledAgentNames: ["reviewer"],
      disabledAgentNames: ["runner"],
      activeSkillNames: ["docs"],
      workspaceRoots: [
        {
          id: "workspace-1",
          name: "Project A",
          path: "/work/project-a",
          createdAt: oldDate,
        },
      ],
      fileToolAutoApproval: { read: true, write: false },
      thinkingMode: "low",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "Do not copy this into a same-settings draft",
          createdAt: oldDate,
        },
      ],
    });

    const draftSettings = buildNewChatDraftSettings(sourceChat);
    const newChat = applyNewChatDraftSettings({
      baseChat: createBaseChat(),
      draftSettings,
      modeId: draftSettings.modeId ?? "default",
      folderId: draftSettings.folderId,
      workspaceRoots: draftSettings.workspaceRoots ?? [],
      fileToolAutoApprovalDefaults: { bash: false, edit: false, write: false },
    });

    expect(newChat.id).toBe("cloned-chat");
    expect(newChat.title).toBe("New chat");
    expect(newChat.titleMode).toBe("auto");
    expect(newChat.createdAt).toBe(cloneDate);
    expect(newChat.updatedAt).toBe(cloneDate);
    expect(newChat.messages).toEqual([]);
    expect(newChat.folderId).toBe(sourceChat.folderId);
    expect(newChat.providerId).toBe(sourceChat.providerId);
    expect(newChat.model).toBe(sourceChat.model);
    expect(newChat.modeId).toBe(sourceChat.modeId);
    expect(newChat.enabledToolNames).toEqual(sourceChat.enabledToolNames);
    expect(newChat.disabledToolNames).toEqual(sourceChat.disabledToolNames);
    expect(newChat.enabledSkillNames).toEqual(sourceChat.enabledSkillNames);
    expect(newChat.disabledSkillNames).toEqual(sourceChat.disabledSkillNames);
    expect(newChat.enabledAgentNames).toEqual(sourceChat.enabledAgentNames);
    expect(newChat.disabledAgentNames).toEqual(sourceChat.disabledAgentNames);
    expect(newChat.activeSkillNames).toEqual(sourceChat.activeSkillNames);
    expect(newChat.workspaceRoots).toEqual(sourceChat.workspaceRoots);
    expect(newChat.workspaceRoots).not.toBe(sourceChat.workspaceRoots);
    expect(newChat.fileToolAutoApproval).toEqual(
      sourceChat.fileToolAutoApproval,
    );
    expect(newChat.thinkingMode).toBe(sourceChat.thinkingMode);
  });

  it("builds a cloned chat with copied settings, messages, and fresh dates", () => {
    const sourceChat = createSourceChat({
      folderId: "folder-1",
      providerId: "provider-1",
      model: "model-1",
      modeId: "mode-1",
      enabledToolNames: ["read"],
      disabledToolNames: ["write"],
      enabledSkillNames: ["docs"],
      disabledSkillNames: ["legacy"],
      enabledAgentNames: ["reviewer"],
      disabledAgentNames: ["runner"],
      activeSkillNames: ["docs"],
      workspaceRoots: [
        {
          id: "workspace-1",
          name: "Project A",
          path: "/work/project-a",
          createdAt: oldDate,
        },
      ],
      fileToolAutoApproval: { read: true, write: false },
      thinkingMode: "low",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "Use this file",
          createdAt: oldDate,
          attachments: [
            {
              id: "attachment-1",
              name: "notes.txt",
              kind: "text",
              mimeType: "text/plain",
              sizeBytes: 128,
              storageMode: "managed",
              storagePath: "/tmp/molten-forge/attachments/notes.txt",
            },
          ],
        },
      ],
    });

    const clonedChat = buildClonedChat(sourceChat, createBaseChat(), cloneDate);

    expect(clonedChat.id).toBe("cloned-chat");
    expect(clonedChat.title).toBe("Source chat copy");
    expect(clonedChat.titleMode).toBe("manual");
    expect(clonedChat.createdAt).toBe(cloneDate);
    expect(clonedChat.updatedAt).toBe(cloneDate);
    expect(clonedChat.folderId).toBe(sourceChat.folderId);
    expect(clonedChat.isPinned).toBe(false);
    expect(clonedChat.providerId).toBe(sourceChat.providerId);
    expect(clonedChat.model).toBe(sourceChat.model);
    expect(clonedChat.modeId).toBe(sourceChat.modeId);
    expect(clonedChat.enabledToolNames).toEqual(sourceChat.enabledToolNames);
    expect(clonedChat.disabledToolNames).toEqual(sourceChat.disabledToolNames);
    expect(clonedChat.enabledSkillNames).toEqual(sourceChat.enabledSkillNames);
    expect(clonedChat.disabledSkillNames).toEqual(
      sourceChat.disabledSkillNames,
    );
    expect(clonedChat.enabledAgentNames).toEqual(sourceChat.enabledAgentNames);
    expect(clonedChat.disabledAgentNames).toEqual(
      sourceChat.disabledAgentNames,
    );
    expect(clonedChat.activeSkillNames).toEqual(sourceChat.activeSkillNames);
    expect(clonedChat.workspaceRoots).toEqual(sourceChat.workspaceRoots);
    expect(clonedChat.fileToolAutoApproval).toEqual(
      sourceChat.fileToolAutoApproval,
    );
    expect(clonedChat.thinkingMode).toBe(sourceChat.thinkingMode);

    expect(clonedChat.messages).toEqual(sourceChat.messages);
    expect(clonedChat.messages).not.toBe(sourceChat.messages);

    const clonedUserMessage = clonedChat.messages[0];
    const sourceUserMessage = sourceChat.messages[0];
    expect(clonedUserMessage).not.toBe(sourceUserMessage);
    if (
      clonedUserMessage.role !== "user" ||
      sourceUserMessage.role !== "user"
    ) {
      throw new Error("Expected user messages");
    }

    expect(clonedUserMessage.attachments).toEqual(
      sourceUserMessage.attachments,
    );
    expect(clonedUserMessage.attachments).not.toBe(
      sourceUserMessage.attachments,
    );
    expect(clonedUserMessage.attachments?.[0]?.storagePath).toBe(
      sourceUserMessage.attachments?.[0]?.storagePath,
    );
  });

  it("keeps pinned state when cloning a chat outside folders", () => {
    const clonedChat = buildClonedChat(
      createSourceChat({ folderId: undefined, isPinned: true }),
      createBaseChat(),
      cloneDate,
    );

    expect(clonedChat.isPinned).toBe(true);
  });

  it("renames a chat without changing its activity dates", () => {
    const sourceChat = createSourceChat({
      title: "Old title",
      createdAt: "2026-01-01T01:00:00.000Z",
      updatedAt: "2026-01-02T01:00:00.000Z",
    });

    const renamedChat = renameChatWithoutActivityUpdate(
      sourceChat,
      "  Better   title  ",
    );

    expect(renamedChat.title).toBe("Better title");
    expect(renamedChat.titleMode).toBe("manual");
    expect(renamedChat.createdAt).toBe(sourceChat.createdAt);
    expect(renamedChat.updatedAt).toBe(sourceChat.updatedAt);
  });

  it("ignores empty chat rename requests", () => {
    const sourceChat = createSourceChat({ title: "Old title" });

    expect(renameChatWithoutActivityUpdate(sourceChat, "   ")).toBe(sourceChat);
  });
});
