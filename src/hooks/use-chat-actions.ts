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
  ChatMessage,
  ChatSession,
  LoadedSkillInfo,
  LoadedToolInfo,
} from "@/lib/ai-chat/types";

export function useChatActions({
  activeChat,
  activeChatId,
  availableTools,
  availableSkills,
  chats,
  globallyEnabledToolNames,
  globallyEnabledSkillNames,
  isSending,
  messageElementRefs,
  setActiveChatId,
  setChats,
  setCopiedMessageId,
  setEditingMessageId,
  resetChatScrollState,
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
  chats: ChatSession[];
  globallyEnabledToolNames: Set<string>;
  globallyEnabledSkillNames: Set<string>;
  isSending: boolean;
  messageElementRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  setActiveChatId: Dispatch<SetStateAction<string | undefined>>;
  setChats: Dispatch<SetStateAction<ChatSession[]>>;
  setCopiedMessageId: Dispatch<SetStateAction<string | null>>;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  resetChatScrollState: () => void;
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
  ) {
    if (!activeChat) return;
    if (isChatGenerating(activeChat.id)) return;

    const userMessage = editedContent.trim();
    if (!userMessage) {
      showError("Message is required.");
      return;
    }

    const userIndex = activeChat.messages.findIndex(
      (message) => message.id === messageId && message.role === "user",
    );
    const currentMessage = activeChat.messages[userIndex];

    if (userIndex < 0 || !currentMessage || currentMessage.role !== "user") {
      showError("Could not find the message to edit.");
      return;
    }

    updateChat(activeChat.id, (chat) => ({
      ...chat,
      title:
        userIndex === 0 && isAutoTitledChat(chat)
          ? titleFromMessage(userMessage)
          : chat.title,
      titleMode:
        userIndex === 0 && isAutoTitledChat(chat)
          ? "auto"
          : chat.titleMode,
      messages: chat.messages.map((message) =>
        message.id === messageId && message.role === "user"
          ? { ...message, content: userMessage }
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

  async function createNewChat() {
    const chat = createEmptyChat();
    setChats((currentChats) => [chat, ...currentChats]);
    setActiveChatId(chat.id);
    setEditingMessageId(null);
    resetChatScrollState();
    focusDraftTextarea();

    try {
      await saveChat(chat);
      await saveActiveChatId(chat.id);
    } catch (error) {
      console.error("Failed to save new chat:", error);
    }
  }

  async function switchChat(chatId: string) {
    setActiveChatId(chatId);
    setEditingMessageId(null);
    resetChatScrollState();
  }

  async function clearCurrentChat() {
    if (!activeChat) return;

    if (isChatGenerating(activeChat.id)) stopChatGeneration(activeChat.id);

    const now = new Date().toISOString();
    updateChat(activeChat.id, (chat) => ({
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

    const remainingChats = sortChatsByUpdatedAt(
      chats.filter((chat) => chat.id !== chatId),
    );
    const nextChats =
      remainingChats.length > 0 ? remainingChats : [createEmptyChat()];
    const nextActiveId =
      activeChatId === chatId
        ? nextChats[0].id
        : (activeChatId ?? nextChats[0].id);

    setChats(nextChats);
    setActiveChatId(nextActiveId);

    try {
      await deleteChat(chatId);
      if (remainingChats.length === 0) {
        await saveChat(nextChats[0]);
      }
      await saveActiveChatId(nextActiveId);
    } catch (error) {
      console.error("Failed to delete chat:", error);
    }
  }

  function cloneMessagesForBranch(messages: ChatMessage[], messageId: string) {
    const messageIndex = messages.findIndex((message) => message.id === messageId);
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
      activeSkillNames: activeChat.activeSkillNames
        ? [...activeChat.activeSkillNames]
        : undefined,
      createdAt: now,
      updatedAt: now,
    };

    setChats((currentChats) => [chat, ...currentChats]);
    setActiveChatId(chat.id);
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
    updateChat(chatId, (chat) => ({
      ...chat,
      isPinned: chat.isPinned !== true,
    }));
  }

  return {
    startEditingUserMessage,
    cancelEditingUserMessage,
    copyLinkHref,
    deleteMessage,
    copyMessageContent,
    saveEditedUserMessage,
    stopGeneration,
    createNewChat,
    switchChat,
    clearCurrentChat,
    removeChat,
    branchChatFromMessage,
    toggleActiveChatTool,
    toggleActiveChatSkill,
    renameChat,
    toggleChatPinned,
  };
}
