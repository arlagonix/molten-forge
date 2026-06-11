import {
  DEFAULT_CHAT_TITLE,
  normalizeManualChatTitle,
} from "./chat-utils";
import type {
  ChatFileToolAutoApproval,
  ChatFolder,
  ChatMessage,
  ChatSession,
  ChatThinkingMode,
  ChatWorkspaceRoot,
} from "./types";

export function cloneWorkspaceRoots(roots?: ChatWorkspaceRoot[]) {
  return roots?.map((root) => ({ ...root })) ?? [];
}

export function getFolderDefaultWorkspaceRoots(
  folder?: Pick<ChatFolder, "workspaceRoots">,
) {
  return cloneWorkspaceRoots(folder?.workspaceRoots).slice(0, 1);
}

export type NewChatDraftSettings = {
  providerId?: string;
  model?: string;
  modeId?: string;
  folderId?: string;
  enabledToolNames?: string[];
  disabledToolNames?: string[];
  enabledSkillNames?: string[];
  disabledSkillNames?: string[];
  enabledAgentNames?: string[];
  disabledAgentNames?: string[];
  activeSkillNames?: string[];
  workspaceRoots?: ChatWorkspaceRoot[];
  fileToolAutoApproval?: ChatFileToolAutoApproval;
  thinkingMode?: ChatThinkingMode;
};

function cloneStringArray(values?: string[]) {
  return values ? [...values] : undefined;
}

export function buildNewChatDraftSettings(
  sourceChat: ChatSession,
): NewChatDraftSettings {
  return {
    providerId: sourceChat.providerId,
    model: sourceChat.model,
    modeId: sourceChat.modeId,
    folderId: sourceChat.folderId,
    enabledToolNames: cloneStringArray(sourceChat.enabledToolNames),
    disabledToolNames: cloneStringArray(sourceChat.disabledToolNames),
    enabledSkillNames: cloneStringArray(sourceChat.enabledSkillNames),
    disabledSkillNames: cloneStringArray(sourceChat.disabledSkillNames),
    enabledAgentNames: cloneStringArray(sourceChat.enabledAgentNames),
    disabledAgentNames: cloneStringArray(sourceChat.disabledAgentNames),
    activeSkillNames: cloneStringArray(sourceChat.activeSkillNames),
    workspaceRoots: sourceChat.workspaceRoots
      ? cloneWorkspaceRoots(sourceChat.workspaceRoots).slice(0, 1)
      : undefined,
    fileToolAutoApproval: sourceChat.fileToolAutoApproval
      ? { ...sourceChat.fileToolAutoApproval }
      : undefined,
    thinkingMode: sourceChat.thinkingMode,
  };
}

export function applyNewChatDraftSettings({
  baseChat,
  draftSettings,
  modeId,
  folderId,
  workspaceRoots,
  fileToolAutoApprovalDefaults,
}: {
  baseChat: ChatSession;
  draftSettings?: NewChatDraftSettings;
  modeId: string;
  folderId?: string;
  workspaceRoots: ChatWorkspaceRoot[];
  fileToolAutoApprovalDefaults: ChatFileToolAutoApproval;
}): ChatSession {
  return {
    ...baseChat,
    providerId: draftSettings?.providerId,
    model: draftSettings?.model,
    modeId,
    folderId,
    enabledToolNames: cloneStringArray(draftSettings?.enabledToolNames),
    disabledToolNames: cloneStringArray(draftSettings?.disabledToolNames),
    enabledSkillNames: cloneStringArray(draftSettings?.enabledSkillNames),
    disabledSkillNames: cloneStringArray(draftSettings?.disabledSkillNames),
    enabledAgentNames: cloneStringArray(draftSettings?.enabledAgentNames),
    disabledAgentNames: cloneStringArray(draftSettings?.disabledAgentNames),
    activeSkillNames: cloneStringArray(draftSettings?.activeSkillNames),
    workspaceRoots: workspaceRoots.length ? cloneWorkspaceRoots(workspaceRoots) : undefined,
    fileToolAutoApproval: draftSettings?.fileToolAutoApproval
      ? { ...draftSettings.fileToolAutoApproval }
      : { ...fileToolAutoApprovalDefaults },
    thinkingMode: draftSettings?.thinkingMode,
  };
}

export function cloneChatMessages(messages: ChatMessage[]) {
  if (typeof structuredClone === "function") {
    return structuredClone(messages) as ChatMessage[];
  }

  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

export function getClonedChatTitle(title: string) {
  const baseTitle = normalizeManualChatTitle(title) || DEFAULT_CHAT_TITLE;
  return `${baseTitle} copy`;
}

export function buildClonedChat(
  sourceChat: ChatSession,
  baseChat: ChatSession,
  now: string,
): ChatSession {
  return {
    ...baseChat,
    title: getClonedChatTitle(sourceChat.title),
    titleMode: "manual",
    isPinned: sourceChat.folderId ? false : sourceChat.isPinned,
    folderId: sourceChat.folderId,
    messages: cloneChatMessages(sourceChat.messages),
    providerId: sourceChat.providerId,
    model: sourceChat.model,
    modeId: sourceChat.modeId,
    enabledToolNames: sourceChat.enabledToolNames
      ? [...sourceChat.enabledToolNames]
      : undefined,
    disabledToolNames: sourceChat.disabledToolNames
      ? [...sourceChat.disabledToolNames]
      : undefined,
    enabledSkillNames: sourceChat.enabledSkillNames
      ? [...sourceChat.enabledSkillNames]
      : undefined,
    disabledSkillNames: sourceChat.disabledSkillNames
      ? [...sourceChat.disabledSkillNames]
      : undefined,
    enabledAgentNames: sourceChat.enabledAgentNames
      ? [...sourceChat.enabledAgentNames]
      : undefined,
    disabledAgentNames: sourceChat.disabledAgentNames
      ? [...sourceChat.disabledAgentNames]
      : undefined,
    activeSkillNames: sourceChat.activeSkillNames
      ? [...sourceChat.activeSkillNames]
      : undefined,
    workspaceRoots: sourceChat.workspaceRoots
      ? cloneWorkspaceRoots(sourceChat.workspaceRoots)
      : undefined,
    fileToolAutoApproval: sourceChat.fileToolAutoApproval
      ? { ...sourceChat.fileToolAutoApproval }
      : undefined,
    thinkingMode: sourceChat.thinkingMode,
    createdAt: now,
    updatedAt: now,
  };
}

export function renameChatWithoutActivityUpdate(
  chat: ChatSession,
  title: string,
) {
  const nextTitle = normalizeManualChatTitle(title);
  if (!nextTitle) return chat;

  return {
    ...chat,
    title: nextTitle,
    titleMode: "manual" as const,
  };
}
