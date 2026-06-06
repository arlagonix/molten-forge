import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { toast } from "sonner";

import {
  createEmptyChat,
  deleteChat,
  saveActiveChatId,
  saveChat,
} from "@/lib/ai-chat/storage";
import {
  getActiveVariant,
  isAutoTitledChat,
  normalizeManualChatTitle,
  sortChatsByUpdatedAt,
  titleFromMessage,
} from "@/lib/ai-chat/chat-utils";
import type {
  ChatAttachment,
  ChatFileToolAutoApproval,
  ChatMessage,
  ChatSession,
  ChatThinkingMode,
  LoadedAgentInfo,
  LoadedSkillInfo,
  LoadedToolInfo,
} from "@/lib/ai-chat/types";

function collectGeneratedFileStoragePathsFromMessage(message: ChatMessage) {
  if (message.role !== "assistant") return [];

  const paths = new Set<string>();
  for (const variant of message.variants) {
    for (const toolResult of variant.toolResults ?? []) {
      for (const generatedFile of toolResult.generatedFiles ?? []) {
        if (generatedFile.storagePath) paths.add(generatedFile.storagePath);
      }
    }

    for (const step of variant.processSteps ?? []) {
      if (!("toolResult" in step) || !step.toolResult) continue;
      for (const generatedFile of step.toolResult.generatedFiles ?? []) {
        if (generatedFile.storagePath) paths.add(generatedFile.storagePath);
      }
    }
  }

  return Array.from(paths);
}

function cleanupDeletedMessageWorkspace(chatId: string, message: ChatMessage) {
  void window.codeForgeAI
    ?.cleanupChatMessageWorkspace?.({
      chatId,
      messageId: message.id,
      generatedFileStoragePaths: collectGeneratedFileStoragePathsFromMessage(message),
    })
    .catch((error) => {
      console.error("Failed to clean up deleted message workspace files:", error);
    });
}

export function useChatActions({
  activeChat,
  activeChatId,
  availableTools,
  availableSkills,
  availableAgents,
  chats,
  globallyEnabledToolNames,
  globallyEnabledSkillNames,
  globallyEnabledAgentNames,
  fileToolAutoApprovalDefaults,
  isSending,
  messageElementRefs,
  setActiveChatId,
  setChats,
  setIsNewChatDraft,
  setCopiedMessageId,
  setEditingMessageId,
  resetChatScrollState,
  saveCurrentChatScrollSnapshot,
  forgetChatScrollSnapshot,
  focusDraftTextarea,
  isChatGenerating,
  stopChatGeneration,
  showError,
  showInfo,
  showSuccess,
  updateActiveChatMessages,
  updateChat,
}: {
  activeChat?: ChatSession;
  activeChatId?: string;
  availableTools: LoadedToolInfo[];
  availableSkills: LoadedSkillInfo[];
  availableAgents: LoadedAgentInfo[];
  chats: ChatSession[];
  globallyEnabledToolNames: Set<string>;
  globallyEnabledSkillNames: Set<string>;
  globallyEnabledAgentNames: Set<string>;
  fileToolAutoApprovalDefaults: ChatFileToolAutoApproval;
  isSending: boolean;
  messageElementRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  setActiveChatId: Dispatch<SetStateAction<string | undefined>>;
  setChats: Dispatch<SetStateAction<ChatSession[]>>;
  setIsNewChatDraft: Dispatch<SetStateAction<boolean>>;
  setCopiedMessageId: Dispatch<SetStateAction<string | null>>;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  resetChatScrollState: () => void;
  saveCurrentChatScrollSnapshot: () => void;
  forgetChatScrollSnapshot: (chatId: string) => void;
  focusDraftTextarea: () => void;
  isChatGenerating: (chatId: string) => boolean;
  stopChatGeneration: (chatId: string) => void;
  showError: (message: string, description?: string) => void;
  showInfo: (message: string, description?: string) => void;
  showSuccess: (message: string, description?: string) => void;
  updateActiveChatMessages: (
    updater: (messages: ChatMessage[]) => ChatMessage[],
    options?: { touch?: boolean },
  ) => void;
  updateChat: (
    chatId: string,
    updater: (chat: ChatSession) => ChatSession,
  ) => void;
}) {
  function startEditingUserMessage(messageId: string) {
    if (isSending) {
      showInfo("Wait until generation finishes before editing messages.");
      return;
    }

    setEditingMessageId(messageId);
  }

  function cancelEditingUserMessage() {
    setEditingMessageId(null);
  }

  async function copyLinkHref(href: string | null) {
    if (!href) return;

    try {
      await navigator.clipboard.writeText(href);
      showSuccess("Link copied.");
    } catch (error) {
      console.error("Failed to copy link:", error);
      toast.error("Failed to copy link.");
    }
  }

  function deleteMessage(messageId: string) {
    if (!activeChat) return;

    if (isChatGenerating(activeChat.id)) {
      showInfo("Wait until generation finishes before deleting messages.");
      return;
    }

    const deletedMessage = activeChat.messages.find(
      (message) => message.id === messageId,
    );
    if (deletedMessage) cleanupDeletedMessageWorkspace(activeChat.id, deletedMessage);

    updateActiveChatMessages((currentMessages) =>
      currentMessages.filter((message) => message.id !== messageId),
    );

    setEditingMessageId((currentMessageId) =>
      currentMessageId === messageId ? null : currentMessageId,
    );
    setCopiedMessageId((currentMessageId) =>
      currentMessageId === messageId ? null : currentMessageId,
    );
    messageElementRefs.current.delete(messageId);
    showSuccess("Message deleted.");
  }

  async function copyMessageContent(messageId: string, content: string) {
    if (!content.trim()) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((currentMessageId) =>
          currentMessageId === messageId ? null : currentMessageId,
        );
      }, 1200);
    } catch (error) {
      console.error("Failed to copy message:", error);
      toast.error("Failed to copy message.");
    }
  }


  async function saveEditedUserMessage(
    messageId: string,
    editedContent: string,
    editedAttachments?: ChatAttachment[],
  ) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const userMessage = editedContent.trim();

    const userIndex = activeChat.messages.findIndex(
      (message) => message.id === messageId && message.role === "user",
    );
    const currentMessage = activeChat.messages[userIndex];

    if (userIndex < 0 || !currentMessage || currentMessage.role !== "user") {
      showError("Could not find the message to edit.");
      return;
    }

    const finalAttachments = editedAttachments ?? currentMessage.attachments ?? [];
    if (!userMessage && finalAttachments.length === 0) {
      showError("Message is required.");
      return;
    }

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title:
        userIndex === 0 && isAutoTitledChat(chat)
          ? titleFromMessage(userMessage || finalAttachments[0]?.name || "Attached files")
          : chat.title,
      titleMode:
        userIndex === 0 && isAutoTitledChat(chat) ? "auto" : chat.titleMode,
      messages: chat.messages.map((message) =>
        message.id === messageId && message.role === "user"
          ? {
              ...message,
              content: userMessage,
              ...(finalAttachments.length
                ? { attachments: finalAttachments }
                : { attachments: undefined }),
            }
          : message,
      ),
    }));

    setEditingMessageId(null);
    showSuccess("Message saved.");
  }

  function stopGeneration() {
    if (!activeChat) return;
    stopChatGeneration(activeChat.id);
  }

  function createNewChat() {
    // Don't persist a chat here — enter the unsaved "New chat" draft state.
    // The real chat is created on first send (see handleComposerSend in App).
    saveCurrentChatScrollSnapshot();
    setIsNewChatDraft(true);
    setActiveChatId(undefined);
    setEditingMessageId(null);
    resetChatScrollState();
    focusDraftTextarea();
  }

  async function createChatWithSameSettings(chatId: string) {
    const sourceChat = chats.find((chat) => chat.id === chatId);
    if (!sourceChat) return;

    const now = new Date().toISOString();
    const chat: ChatSession = {
      ...createEmptyChat(),
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
      fileToolAutoApproval: sourceChat.fileToolAutoApproval
        ? { ...sourceChat.fileToolAutoApproval }
        : undefined,
      thinkingMode: sourceChat.thinkingMode,
      createdAt: now,
      updatedAt: now,
    };

    saveCurrentChatScrollSnapshot();
    setChats((currentChats) => [chat, ...currentChats]);
    setActiveChatId(chat.id);
    setIsNewChatDraft(false);
    setEditingMessageId(null);
    resetChatScrollState();
    focusDraftTextarea();

    try {
      await saveChat(chat);
      await saveActiveChatId(chat.id);
      showSuccess("Chat created with same settings.");
    } catch (error) {
      console.error("Failed to save chat with same settings:", error);
    }
  }

  async function switchChat(chatId: string) {
    if (chatId === activeChatId) {
      setIsNewChatDraft(false);
      setEditingMessageId(null);
      return;
    }

    saveCurrentChatScrollSnapshot();
    setIsNewChatDraft(false);
    setActiveChatId(chatId);
    setEditingMessageId(null);
  }

  async function clearChat(chatId: string) {
    if (isChatGenerating(chatId)) stopChatGeneration(chatId);

    forgetChatScrollSnapshot(chatId);
    if (chatId === activeChatId) resetChatScrollState();

    const now = new Date().toISOString();
    updateChat(chatId, (chat) => ({
      ...chat,
      title: "New chat",
      titleMode: "auto",
      messages: [],
      activeSkillNames: [],
      updatedAt: now,
    }));
    showSuccess("Chat cleared.");
  }

  async function removeChat(chatId: string) {
    if (isChatGenerating(chatId)) stopChatGeneration(chatId);

    if (chatId === activeChatId) saveCurrentChatScrollSnapshot();
    forgetChatScrollSnapshot(chatId);

    const remainingChats = sortChatsByUpdatedAt(
      chats.filter((chat) => chat.id !== chatId),
    );

    // When the last chat is removed, fall back to the unsaved "New chat"
    // draft state rather than auto-creating an empty chat.
    if (remainingChats.length === 0) {
      setChats([]);
      setActiveChatId(undefined);
      setIsNewChatDraft(true);
      resetChatScrollState();

      try {
        await deleteChat(chatId);
      } catch (error) {
        console.error("Failed to delete chat:", error);
      }
      return;
    }

    const nextActiveId =
      activeChatId === chatId
        ? remainingChats[0].id
        : (activeChatId ?? remainingChats[0].id);

    setChats(remainingChats);
    setActiveChatId(nextActiveId);

    try {
      await deleteChat(chatId);
      await saveActiveChatId(nextActiveId);
    } catch (error) {
      console.error("Failed to delete chat:", error);
    }
  }

  function cloneMessagesForBranch(messages: ChatMessage[], messageId: string) {
    const messageIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (messageIndex < 0) return undefined;

    return messages.slice(0, messageIndex + 1).map((message) => {
      if (message.role === "user") return { ...message };

      const activeVariant = getActiveVariant(message);
      return {
        ...message,
        variants: activeVariant ? [{ ...activeVariant }] : [],
        activeVariantIndex: 0,
      };
    });
  }

  async function branchChatFromMessage(messageId: string) {
    if (!activeChat) return;

    if (isChatGenerating(activeChat.id)) {
      showInfo("Wait until generation finishes before branching messages.");
      return;
    }

    const branchedMessages = cloneMessagesForBranch(
      activeChat.messages,
      messageId,
    );

    if (!branchedMessages?.length) {
      showError("Could not find the message to branch from.");
      return;
    }

    const now = new Date().toISOString();
    const baseTitle = normalizeManualChatTitle(activeChat.title) || "New chat";
    const chat: ChatSession = {
      ...createEmptyChat(),
      title: `${baseTitle} (branch)`,
      titleMode: "manual",
      messages: branchedMessages,
      modeId: activeChat.modeId,
      enabledToolNames: activeChat.enabledToolNames
        ? [...activeChat.enabledToolNames]
        : undefined,
      disabledToolNames: activeChat.disabledToolNames
        ? [...activeChat.disabledToolNames]
        : undefined,
      enabledSkillNames: activeChat.enabledSkillNames
        ? [...activeChat.enabledSkillNames]
        : undefined,
      disabledSkillNames: activeChat.disabledSkillNames
        ? [...activeChat.disabledSkillNames]
        : undefined,
      enabledAgentNames: activeChat.enabledAgentNames
        ? [...activeChat.enabledAgentNames]
        : undefined,
      disabledAgentNames: activeChat.disabledAgentNames
        ? [...activeChat.disabledAgentNames]
        : undefined,
      activeSkillNames: activeChat.activeSkillNames
        ? [...activeChat.activeSkillNames]
        : undefined,
      workspaceRoots: activeChat.workspaceRoots
        ? activeChat.workspaceRoots.map((root) => ({ ...root }))
        : undefined,
      fileToolAutoApproval: activeChat.fileToolAutoApproval
        ? { ...activeChat.fileToolAutoApproval }
        : { ...fileToolAutoApprovalDefaults },
      thinkingMode: activeChat.thinkingMode,
      createdAt: now,
      updatedAt: now,
    };

    saveCurrentChatScrollSnapshot();
    setChats((currentChats) => [chat, ...currentChats]);
    setActiveChatId(chat.id);
    setIsNewChatDraft(false);
    setEditingMessageId(null);
    resetChatScrollState();

    try {
      await saveChat(chat);
      await saveActiveChatId(chat.id);
      showSuccess("Branch created.");
    } catch (error) {
      console.error("Failed to save branched chat:", error);
    }
  }

  function toggleActiveChatTool(toolName: string) {
    if (!activeChat) return;

    const isGloballyEnabled = globallyEnabledToolNames.has(toolName);

    updateChat(activeChat.id, (chat) => {
      const chatEnabled = new Set(chat.enabledToolNames ?? []);
      const chatDisabled = new Set(chat.disabledToolNames ?? []);
      const isCurrentlyEnabled =
        !chatDisabled.has(toolName) &&
        (isGloballyEnabled || chatEnabled.has(toolName));

      if (isCurrentlyEnabled) {
        chatEnabled.delete(toolName);

        if (isGloballyEnabled) chatDisabled.add(toolName);
        else chatDisabled.delete(toolName);
      } else {
        chatDisabled.delete(toolName);

        if (isGloballyEnabled) chatEnabled.delete(toolName);
        else chatEnabled.add(toolName);
      }

      const enabledToolNames = availableTools
        .map((tool) => tool.name)
        .filter((name) => chatEnabled.has(name));
      const disabledToolNames = availableTools
        .map((tool) => tool.name)
        .filter((name) => chatDisabled.has(name));

      return {
        ...chat,
        enabledToolNames,
        disabledToolNames,
      };
    });
  }

  function toggleActiveChatFileToolAutoApproval(
    key: keyof ChatFileToolAutoApproval,
  ) {
    if (!activeChat) return;

    updateChat(activeChat.id, (chat) => {
      const currentSettings = chat.fileToolAutoApproval ?? {};

      return {
        ...chat,
        fileToolAutoApproval: {
          ...currentSettings,
          [key]: currentSettings[key] !== true,
        },
      };
    });
  }

  function setActiveChatThinkingMode(thinkingMode: ChatThinkingMode) {
    if (!activeChat) return;

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      thinkingMode,
    }));
  }

  function toggleActiveChatSkill(skillName: string) {
    if (!activeChat) return;

    const isGloballyEnabled = globallyEnabledSkillNames.has(skillName);

    updateChat(activeChat.id, (chat) => {
      const chatEnabled = new Set(chat.enabledSkillNames ?? []);
      const chatDisabled = new Set(chat.disabledSkillNames ?? []);
      const isCurrentlyEnabled =
        !chatDisabled.has(skillName) &&
        (isGloballyEnabled || chatEnabled.has(skillName));

      if (isCurrentlyEnabled) {
        chatEnabled.delete(skillName);

        if (isGloballyEnabled) chatDisabled.add(skillName);
        else chatDisabled.delete(skillName);
      } else {
        chatDisabled.delete(skillName);

        if (isGloballyEnabled) chatEnabled.delete(skillName);
        else chatEnabled.add(skillName);
      }

      const enabledSkillNames = availableSkills
        .map((skill) => skill.name)
        .filter((name) => chatEnabled.has(name));
      const disabledSkillNames = availableSkills
        .map((skill) => skill.name)
        .filter((name) => chatDisabled.has(name));

      return {
        ...chat,
        enabledSkillNames,
        disabledSkillNames,
      };
    });
  }

  function toggleActiveChatAgent(agentName: string) {
    if (!activeChat) return;

    const isGloballyEnabled = globallyEnabledAgentNames.has(agentName);

    updateChat(activeChat.id, (chat) => {
      const chatEnabled = new Set(chat.enabledAgentNames ?? []);
      const chatDisabled = new Set(chat.disabledAgentNames ?? []);
      const isCurrentlyEnabled =
        !chatDisabled.has(agentName) &&
        (isGloballyEnabled || chatEnabled.has(agentName));

      if (isCurrentlyEnabled) {
        chatEnabled.delete(agentName);

        if (isGloballyEnabled) chatDisabled.add(agentName);
        else chatDisabled.delete(agentName);
      } else {
        chatDisabled.delete(agentName);

        if (isGloballyEnabled) chatEnabled.delete(agentName);
        else chatEnabled.add(agentName);
      }

      const enabledAgentNames = availableAgents
        .map((agent) => agent.name)
        .filter((name) => chatEnabled.has(name));
      const disabledAgentNames = availableAgents
        .map((agent) => agent.name)
        .filter((name) => chatDisabled.has(name));

      return {
        ...chat,
        enabledAgentNames,
        disabledAgentNames,
      };
    });
  }

  function renameChat(chatId: string, title: string) {
    const nextTitle = normalizeManualChatTitle(title);
    if (!nextTitle) return;

    updateChat(chatId, (chat) => ({
      ...chat,
      title: nextTitle,
      titleMode: "manual",
      updatedAt: new Date().toISOString(),
    }));
  }

  function toggleChatPinned(chatId: string) {
    updateChat(chatId, (chat) => {
      if (chat.folderId) return chat;

      return {
        ...chat,
        isPinned: chat.isPinned !== true,
      };
    });
  }

  return {
    // chat action handlers
    startEditingUserMessage,
    cancelEditingUserMessage,
    copyLinkHref,
    deleteMessage,
    copyMessageContent,
    saveEditedUserMessage,
    stopGeneration,
    createNewChat,
    createChatWithSameSettings,
    switchChat,
    clearChat,
    removeChat,
    branchChatFromMessage,
    toggleActiveChatTool,
    toggleActiveChatFileToolAutoApproval,
    setActiveChatThinkingMode,
    toggleActiveChatSkill,
    toggleActiveChatAgent,
    renameChat,
    toggleChatPinned,
  };
}
