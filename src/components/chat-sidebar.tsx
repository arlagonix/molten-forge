import {
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  Folder,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { DragEvent, UIEvent as ReactUIEvent } from "react";
import { memo, useEffect, useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupHeading } from "@/components/ui/group-heading";
import { Input } from "@/components/ui/input";
import {
  formatChatActivityDate,
  formatRelativeChatActivityDate,
  getChatActivityDate,
  sortChatsByUpdatedAt,
} from "@/lib/ai-chat/chat-utils";
import type { ChatFolder, ChatSession } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const CHAT_LIST_BATCH_SIZE = 40;
const CHAT_LIST_SCROLL_THRESHOLD_PX = 96;
const FOLDER_BATCH_SIZE = 5;
const FOLDER_CHAT_BATCH_SIZE = 5;

function getFolderActivityTime(folder: ChatFolder, folderChats: ChatSession[]) {
  const latestChat = sortChatsByUpdatedAt(folderChats)[0];
  const createdTime = new Date(folder.createdAt).getTime();
  const latestChatTime = latestChat
    ? new Date(getChatActivityDate(latestChat)).getTime()
    : 0;

  return Math.max(
    Number.isFinite(createdTime) ? createdTime : 0,
    Number.isFinite(latestChatTime) ? latestChatTime : 0,
  );
}

type SidebarFolder = {
  folder: ChatFolder;
  chats: ChatSession[];
  activityTime: number;
};

type DeleteFolderMode = "move" | "delete";

type ChatSidebarProps = {
  appName: string;
  appVersionLabel: string;
  chats: ChatSession[];
  folders: ChatFolder[];
  activeChatId?: string;
  isCollapsed: boolean;
  generatingChatIds: string[];
  completedGenerationChatIds: string[];
  titleGenerationChatIds: string[];
  onCollapsedChange: (isCollapsed: boolean) => void;
  onSwitchChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onToggleChatPinned: (chatId: string) => void;
  onGenerateChatTitle: (chatId: string) => void;
  onRemoveChat: (chatId: string) => void;
  onCreateNewChat: () => void;
  onCreateChatInFolder: (folderId: string) => void;
  onCreateChatWithSameSettings: (chatId: string) => void;
  onOpenSettings: () => void;
  onClearChat: (chatId: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string, mode: DeleteFolderMode) => void;
  onMoveChatToFolder: (chatId: string, folderId: string) => void;
  onRemoveChatFromFolder: (chatId: string) => void;
};

type FolderNameInputProps = {
  initialName?: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

const FolderNameInput = memo(function FolderNameInput({
  initialName = "",
  placeholder,
  onSubmit,
  onCancel,
}: FolderNameInputProps) {
  const [name, setName] = useState(initialName);

  function commit() {
    const nextName = name.trim();
    if (!nextName) return;
    onSubmit(nextName);
  }

  return (
    <Input
      value={name}
      autoFocus
      placeholder={placeholder}
      className="h-7 min-w-0 flex-1 px-2 py-1 text-base leading-6"
      onChange={(event) => setName(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={onCancel}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
});

type NewFolderDraftRowProps = {
  onCreate: (name: string) => void;
  onCancel: () => void;
};

const NewFolderDraftRow = memo(function NewFolderDraftRow({
  onCreate,
  onCancel,
}: NewFolderDraftRowProps) {
  return (
    <section className="grid gap-1 rounded-none">
      <div className="flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ChevronDown className="size-3.5 shrink-0" />
          <FolderOpen className="size-4 shrink-0" />
          <FolderNameInput
            placeholder="Folder name"
            onSubmit={onCreate}
            onCancel={onCancel}
          />
        </div>
      </div>
      <div className="grid gap-[1px] pb-1 pl-5">
        <div className="px-2 py-1 text-base leading-6 text-muted-foreground">
          No chats
        </div>
      </div>
    </section>
  );
});

export const ChatSidebar = memo(function ChatSidebar({
  appName,
  appVersionLabel,
  chats,
  folders,
  activeChatId,
  isCollapsed,
  generatingChatIds,
  completedGenerationChatIds,
  titleGenerationChatIds,
  onCollapsedChange,
  onSwitchChat,
  onRenameChat,
  onToggleChatPinned,
  onGenerateChatTitle,
  onRemoveChat,
  onCreateNewChat,
  onCreateChatInFolder,
  onCreateChatWithSameSettings,
  onOpenSettings,
  onClearChat,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveChatToFolder,
  onRemoveChatFromFolder,
}: ChatSidebarProps) {
  const activeChatFolderId = activeChatId
    ? chats.find((chat) => chat.id === activeChatId)?.folderId
    : undefined;

  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [openChatOptionsChatId, setOpenChatOptionsChatId] = useState<
    string | null
  >(null);
  const [focusedChatOptionsChatId, setFocusedChatOptionsChatId] = useState<
    string | null
  >(null);
  const [openFolderOptionsFolderId, setOpenFolderOptionsFolderId] = useState<
    string | null
  >(null);
  const [visibleChatLimit, setVisibleChatLimit] =
    useState(CHAT_LIST_BATCH_SIZE);
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  const [visibleFolderLimit, setVisibleFolderLimit] =
    useState(FOLDER_BATCH_SIZE);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<
    Record<string, boolean>
  >(() =>
    Object.fromEntries(
      folders
        .filter((folder) => folder.id !== activeChatFolderId)
        .map((folder) => [folder.id, true]),
    ),
  );
  const [folderChatLimits, setFolderChatLimits] = useState<
    Record<string, number>
  >({});
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [isRootChatsDragOver, setIsRootChatsDragOver] = useState(false);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<ChatFolder | null>(null);
  const normalizedChatSearchQuery = chatSearchQuery.trim().toLocaleLowerCase();
  const isSearching = normalizedChatSearchQuery.length > 0;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRelativeTimeNow(Date.now());
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setRelativeTimeNow(Date.now());
  }, [chats]);

  useEffect(() => {
    if (!activeChatFolderId) return;

    setCollapsedFolderIds((current) => {
      if (current[activeChatFolderId] !== true) return current;
      const next = { ...current };
      delete next[activeChatFolderId];
      return next;
    });
    setFolderChatLimits((current) => ({
      ...current,
      [activeChatFolderId]:
        current[activeChatFolderId] ?? FOLDER_CHAT_BATCH_SIZE,
    }));
  }, [activeChatFolderId]);

  const filteredChatList = useMemo(() => {
    const matchesSearch = (chat: ChatSession) =>
      !normalizedChatSearchQuery ||
      chat.title.toLocaleLowerCase().includes(normalizedChatSearchQuery);

    const sortedChats = sortChatsByUpdatedAt(chats);
    const validFolderIds = new Set(folders.map((folder) => folder.id));
    const sortedFolders: SidebarFolder[] = folders
      .map((folder) => {
        const folderChats = sortChatsByUpdatedAt(
          sortedChats.filter((chat) => chat.folderId === folder.id),
        );

        return {
          folder,
          chats: folderChats.filter(matchesSearch),
          activityTime: getFolderActivityTime(folder, folderChats),
        };
      })
      .filter((folder) => !isSearching || folder.chats.length > 0)
      .sort((left, right) => right.activityTime - left.activityTime);

    const rootChats = sortedChats.filter(
      (chat) => !chat.folderId || !validFolderIds.has(chat.folderId),
    );
    const pinnedChats = rootChats.filter(
      (chat) => chat.isPinned === true && matchesSearch(chat),
    );
    const unpinnedRootChats = rootChats.filter(
      (chat) => chat.isPinned !== true && matchesSearch(chat),
    );
    const filteredChats = [
      ...sortedFolders.flatMap((folder) => folder.chats),
      ...pinnedChats,
      ...unpinnedRootChats,
    ];
    const activeChatIndex = activeChatId
      ? filteredChats.findIndex((chat) => chat.id === activeChatId)
      : -1;
    const effectiveVisibleChatLimit = isSearching
      ? Number.POSITIVE_INFINITY
      : Math.max(
          visibleChatLimit,
          activeChatIndex >= 0 ? activeChatIndex + 1 : 0,
        );
    let remainingChats = effectiveVisibleChatLimit;
    const visiblePinnedChats = pinnedChats.slice(0, remainingChats);
    remainingChats = Math.max(0, remainingChats - visiblePinnedChats.length);
    const visibleRootChats = unpinnedRootChats.slice(0, remainingChats);

    return {
      filteredChatCount: filteredChats.length,
      visibleChatCount:
        visiblePinnedChats.length +
        visibleRootChats.length +
        sortedFolders.reduce((total, folder) => total + folder.chats.length, 0),
      folders: sortedFolders,
      pinnedChats: visiblePinnedChats,
      rootChats: visibleRootChats,
    };
  }, [
    activeChatId,
    chats,
    folders,
    isSearching,
    normalizedChatSearchQuery,
    visibleChatLimit,
  ]);

  const visibleFolders = isSearching
    ? filteredChatList.folders
    : filteredChatList.folders.slice(0, visibleFolderLimit);
  const hasMoreFolders =
    !isSearching && visibleFolders.length < filteredChatList.folders.length;
  const hasMoreChats =
    !isSearching &&
    filteredChatList.visibleChatCount < filteredChatList.filteredChatCount;

  useEffect(() => {
    setVisibleChatLimit(CHAT_LIST_BATCH_SIZE);
  }, [normalizedChatSearchQuery]);

  function handleChatListScroll(event: ReactUIEvent<HTMLDivElement>) {
    if (!hasMoreChats) return;

    const element = event.currentTarget;
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    if (distanceFromBottom <= CHAT_LIST_SCROLL_THRESHOLD_PX) {
      setVisibleChatLimit((current) => current + CHAT_LIST_BATCH_SIZE);
    }
  }

  function startRenamingChat(chat: ChatSession) {
    setRenamingChatId(chat.id);
    setRenameValue(chat.title);
  }

  function cancelRenamingChat() {
    setRenamingChatId(null);
    setRenameValue("");
  }

  function commitRenamingChat(chatId: string) {
    const nextTitle = renameValue.trim();
    if (nextTitle) {
      onRenameChat(chatId, nextTitle);
    }
    cancelRenamingChat();
  }

  function startCreatingFolder() {
    setIsCreatingFolder(true);
  }

  function cancelCreatingFolder() {
    setIsCreatingFolder(false);
  }

  function commitCreatingFolder(name: string) {
    onCreateFolder(name);
    cancelCreatingFolder();
  }

  function startRenamingFolder(folder: ChatFolder) {
    setRenamingFolderId(folder.id);
  }

  function cancelRenamingFolder() {
    setRenamingFolderId(null);
  }

  function commitRenamingFolder(folderId: string, name: string) {
    const nextName = name.trim();
    if (nextName) {
      onRenameFolder(folderId, nextName);
    }
    cancelRenamingFolder();
  }

  function toggleFolder(folderId: string) {
    setCollapsedFolderIds((current) => {
      const isCollapsedNow = current[folderId] === true;
      if (isCollapsedNow) {
        setFolderChatLimits((limits) => ({
          ...limits,
          [folderId]: FOLDER_CHAT_BATCH_SIZE,
        }));
        const next = { ...current };
        delete next[folderId];
        return next;
      }

      return { ...current, [folderId]: true };
    });
  }

  function showMoreFolderChats(folderId: string) {
    setFolderChatLimits((current) => ({
      ...current,
      [folderId]:
        (current[folderId] ?? FOLDER_CHAT_BATCH_SIZE) + FOLDER_CHAT_BATCH_SIZE,
    }));
  }

  function handleChatDragStart(
    event: DragEvent<HTMLDivElement>,
    chat: ChatSession,
  ) {
    if (renamingChatId === chat.id) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-chat-forge-chat-id", chat.id);
  }

  function isChatDragEvent(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes(
      "application/x-chat-forge-chat-id",
    );
  }

  function getDraggedChatId(event: DragEvent<HTMLElement>) {
    return event.dataTransfer
      .getData("application/x-chat-forge-chat-id")
      .trim();
  }

  function handleFolderDrop(event: DragEvent<HTMLElement>, folderId: string) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderId(null);
    if (!isChatDragEvent(event)) return;
    const chatId = getDraggedChatId(event);
    if (!chatId) return;
    const chat = chats.find((item) => item.id === chatId);
    if (!chat || chat.folderId === folderId) return;
    onMoveChatToFolder(chatId, folderId);
  }

  function handleRootChatsDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsRootChatsDragOver(false);
    if (!isChatDragEvent(event)) return;
    const chatId = getDraggedChatId(event);
    if (!chatId) return;
    const chat = chats.find((item) => item.id === chatId);
    if (!chat?.folderId) return;
    onRemoveChatFromFolder(chatId);
  }

  function renderSettingsButton(triggerClassName?: string) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={triggerClassName}
        onClick={onOpenSettings}
        title="Settings"
      >
        <Settings className="size-4" />
      </Button>
    );
  }

  function renderMoveToFolderItems(chat: ChatSession) {
    const targetFolders = folders.filter(
      (folder) => folder.id !== chat.folderId,
    );
    if (targetFolders.length === 0) return null;

    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Folder className="size-4" />
          Move to folder
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          sideOffset={2}
          alignOffset={0}
          className="max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] min-w-52 overflow-y-auto"
        >
          {targetFolders.map((folder) => (
            <DropdownMenuItem
              key={folder.id}
              onClick={(event) => {
                event.stopPropagation();
                onMoveChatToFolder(chat.id, folder.id);
              }}
            >
              <Folder className="size-4" />
              <span className="truncate">{folder.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  function renderChatRow(chat: ChatSession) {
    const isActive = chat.id === activeChatId;
    const isRenaming = renamingChatId === chat.id;
    const isGenerating = generatingChatIds.includes(chat.id);
    const hasCompletedGeneration =
      !isActive && completedGenerationChatIds.includes(chat.id);
    const isGeneratingTitle = titleGenerationChatIds.includes(chat.id);
    const isChatOptionsOpen = openChatOptionsChatId === chat.id;
    const isChatOptionsFocused = focusedChatOptionsChatId === chat.id;
    const isChatOptionsActive = isChatOptionsOpen || isChatOptionsFocused;
    const showStatusIndicator =
      !isChatOptionsActive && (isGenerating || hasCompletedGeneration);
    const relativeTimeLabel = formatRelativeChatActivityDate(
      getChatActivityDate(chat),
      relativeTimeNow,
    );
    const fullDateLabel = formatChatActivityDate(getChatActivityDate(chat));

    return (
      <div
        key={chat.id}
        role="button"
        tabIndex={0}
        draggable={!isRenaming}
        className={cn(
          "group flex min-w-0 cursor-pointer items-center gap-1 border px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive
            ? "border-primary/30 bg-accent text-accent-foreground"
            : "border-transparent hover:border-border hover:bg-muted/60",
        )}
        onClick={() => {
          if (!isRenaming) onSwitchChat(chat.id);
        }}
        onKeyDown={(event) => {
          if (isRenaming) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSwitchChat(chat.id);
          }
        }}
        onDragStart={(event) => handleChatDragStart(event, chat)}
        title={chat.title}
      >
        <div className="min-w-0 flex-1 text-left">
          {isRenaming ? (
            <Input
              value={renameValue}
              autoFocus
              className="h-7 px-2 py-1 text-base leading-6"
              onChange={(event) => setRenameValue(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={() => commitRenamingChat(chat.id)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRenamingChat(chat.id);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRenamingChat();
                }
              }}
            />
          ) : (
            <div className="truncate text-base leading-6">{chat.title}</div>
          )}
        </div>

        {!isRenaming ? (
          <div className="relative h-7 w-9 shrink-0">
            {showStatusIndicator && isGenerating ? (
              <Loader2 className="pointer-events-none absolute left-[calc(50%+4px)] top-1/2 z-0 size-3.5 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground transition-none group-hover:opacity-0" />
            ) : showStatusIndicator && hasCompletedGeneration ? (
              <span className="pointer-events-none absolute left-1/2 top-1/2 z-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-none group-hover:opacity-0" />
            ) : !isChatOptionsActive ? (
              <span
                className="pointer-events-none absolute right-1 top-1/2 z-0 -translate-y-1/2 text-sm leading-none text-muted-foreground/50 transition-none group-hover:opacity-0"
                title={fullDateLabel}
              >
                {relativeTimeLabel}
              </span>
            ) : null}
            <DropdownMenu
              open={isChatOptionsOpen}
              onOpenChange={(open) =>
                setOpenChatOptionsChatId(open ? chat.id : null)
              }
            >
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-0 top-0 z-10 h-7 w-7 shrink-0 opacity-0 transition-none hover:bg-muted group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 data-[state=open]:bg-muted data-[state=open]:opacity-100"
                  onFocus={() => setFocusedChatOptionsChatId(chat.id)}
                  onBlur={() =>
                    setFocusedChatOptionsChatId((current) =>
                      current === chat.id ? null : current,
                    )
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  title="Chat options"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="bottom"
                align="start"
                sideOffset={0}
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    startRenamingChat(chat);
                  }}
                >
                  <Edit3 className="size-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    isGenerating ||
                    isGeneratingTitle ||
                    chat.messages.length === 0
                  }
                  onSelect={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onGenerateChatTitle(chat.id);
                  }}
                >
                  {isGeneratingTitle ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Generate title
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateChatWithSameSettings(chat.id);
                  }}
                >
                  <Copy className="size-4" />
                  New with same settings
                </DropdownMenuItem>
                {renderMoveToFolderItems(chat)}
                {chat.folderId ? (
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveChatFromFolder(chat.id);
                    }}
                  >
                    <FolderOpen className="size-4" />
                    Remove from folder
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleChatPinned(chat.id);
                    }}
                  >
                    {chat.isPinned ? (
                      <PinOff className="size-4" />
                    ) : (
                      <Pin className="size-4" />
                    )}
                    {chat.isPinned ? "Unpin" : "Pin"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={
                    chat.messages.length === 0 && !chat.activeSkillNames?.length
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    onClearChat(chat.id);
                  }}
                >
                  <Trash2 className="size-4" />
                  Clear chat
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveChat(chat.id);
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    );
  }

  function renderFolder(folderInfo: SidebarFolder) {
    const { folder, chats: folderChats } = folderInfo;
    const isFolderCollapsed =
      !isSearching && collapsedFolderIds[folder.id] === true;
    const isRenamingFolder = renamingFolderId === folder.id;
    const chatLimit = isSearching
      ? Number.POSITIVE_INFINITY
      : (folderChatLimits[folder.id] ?? FOLDER_CHAT_BATCH_SIZE);
    const visibleChats = folderChats.slice(0, chatLimit);
    const hasMoreFolderChats =
      !isSearching && visibleChats.length < folderChats.length;
    const isFolderOptionsOpen = openFolderOptionsFolderId === folder.id;
    const isDragOverFolder = dragOverFolderId === folder.id;

    return (
      <section
        key={folder.id}
        className={cn(
          "grid gap-1 rounded-none transition-none",
          isDragOverFolder ? "bg-accent/60 ring-1 ring-primary/30" : undefined,
        )}
        onDragEnter={(event) => {
          if (!isChatDragEvent(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDragOverFolderId(folder.id);
        }}
        onDragOver={(event) => {
          if (!isChatDragEvent(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDragOverFolderId(folder.id);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null))
            return;
          setDragOverFolderId((current) =>
            current === folder.id ? null : current,
          );
        }}
        onDrop={(event) => handleFolderDrop(event, folder.id)}
      >
        <div
          className={cn(
            "group/folder flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-muted-foreground transition-none hover:bg-muted/60 hover:text-foreground",
            isDragOverFolder
              ? "rounded-none bg-accent text-accent-foreground"
              : undefined,
          )}
        >
          {isRenamingFolder ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {isFolderCollapsed ? (
                <ChevronRight className="size-3.5 shrink-0" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0" />
              )}
              {isFolderCollapsed ? (
                <Folder className="size-4 shrink-0" />
              ) : (
                <FolderOpen className="size-4 shrink-0" />
              )}
              <FolderNameInput
                key={folder.id}
                initialName={folder.name}
                placeholder="Folder name"
                onSubmit={(name) => commitRenamingFolder(folder.id, name)}
                onCancel={cancelRenamingFolder}
              />
            </div>
          ) : (
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none transition-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => toggleFolder(folder.id)}
              title={folder.name}
            >
              {isFolderCollapsed ? (
                <ChevronRight className="size-3.5 shrink-0" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0" />
              )}
              {isFolderCollapsed ? (
                <Folder className="size-4 shrink-0" />
              ) : (
                <FolderOpen className="size-4 shrink-0" />
              )}
              <span className="truncate text-base leading-6">
                {folder.name}
              </span>
            </button>
          )}
          {!isRenamingFolder ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 shrink-0 opacity-0 transition-none hover:bg-muted hover:text-foreground group-hover/folder:opacity-100 focus-visible:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateChatInFolder(folder.id);
                }}
                title="New chat in folder"
              >
                <Plus className="size-3.5" />
              </Button>
              <DropdownMenu
                open={isFolderOptionsOpen}
                onOpenChange={(open) =>
                  setOpenFolderOptionsFolderId(open ? folder.id : null)
                }
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 shrink-0 opacity-0 transition-none hover:bg-muted hover:text-foreground group-hover/folder:opacity-100 focus-visible:opacity-100 data-[state=open]:bg-muted data-[state=open]:text-foreground data-[state=open]:opacity-100"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    title="Folder options"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  sideOffset={0}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpenFolderOptionsFolderId(null);
                      startRenamingFolder(folder);
                    }}
                  >
                    <Edit3 className="size-4" />
                    Rename folder
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteFolderTarget(folder)}
                  >
                    <Trash2 className="size-4" />
                    Delete folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </div>

        {!isFolderCollapsed ? (
          <div className="grid gap-[1px] pb-1 pl-5">
            {visibleChats.map(renderChatRow)}
            {folderChats.length === 0 && !isSearching ? (
              <div className="px-2 py-1 text-base leading-6 text-muted-foreground">
                No chats
              </div>
            ) : null}
            {hasMoreFolderChats ? (
              <button
                type="button"
                className="px-2 py-1 text-left text-base leading-6 text-muted-foreground transition-none hover:bg-muted/60 hover:text-foreground"
                onClick={() => showMoreFolderChats(folder.id)}
              >
                Show more
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  function renderChatSection(
    label: string,
    sectionChats: ChatSession[],
    options?: { droppable?: boolean },
  ) {
    if (sectionChats.length === 0 && (!options?.droppable || isSearching))
      return null;

    return (
      <section
        key={label}
        className={cn(
          "grid gap-1.5 rounded-none transition-none",
          options?.droppable && isRootChatsDragOver
            ? "bg-accent/60 ring-1 ring-primary/30"
            : undefined,
        )}
        onDragEnter={
          options?.droppable
            ? (event) => {
                if (!isChatDragEvent(event)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setIsRootChatsDragOver(true);
              }
            : undefined
        }
        onDragOver={
          options?.droppable
            ? (event) => {
                if (!isChatDragEvent(event)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setIsRootChatsDragOver(true);
              }
            : undefined
        }
        onDragLeave={
          options?.droppable
            ? (event) => {
                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  return;
                setIsRootChatsDragOver(false);
              }
            : undefined
        }
        onDrop={options?.droppable ? handleRootChatsDrop : undefined}
      >
        <GroupHeading className="mt-0 pt-1">{label}</GroupHeading>
        <div className="grid gap-[1px]">
          {sectionChats.map(renderChatRow)}
          {sectionChats.length === 0 ? (
            <div className="px-2 py-1 text-base leading-6 text-muted-foreground">
              No chats
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <>
      <aside
        data-sidebar
        className={cn(
          "w-80 shrink-0 flex-col border-r bg-card/80",
          isCollapsed ? "flex md:hidden" : "flex",
        )}
      >
        <div className="py-3 pl-3 pr-2">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 md:inline-flex"
              onClick={() => onCollapsedChange(true)}
              title="Hide sidebar"
            >
              <PanelLeftClose className="size-4" />
            </Button>

            <div className="min-w-0 flex-1">
              <h1 className="flex min-w-0 items-baseline gap-1 truncate text-base font-semibold leading-6">
                <span className="truncate">{appName}</span>
                <span className="shrink-0 text-muted-foreground">
                  {appVersionLabel}
                </span>
              </h1>
            </div>

            {renderSettingsButton("shrink-0")}
          </div>
        </div>

        <div className="border-y p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={chatSearchQuery}
              onChange={(event) => setChatSearchQuery(event.target.value)}
              placeholder="Search chats"
              className="h-8 pl-7 pr-8 text-sm"
            />
            {chatSearchQuery ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setChatSearchQuery("")}
                title="Clear search"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-2 chat-scrollbar"
          onScroll={handleChatListScroll}
        >
          <div className="grid gap-3">
            {filteredChatList.folders.length > 0 || !isSearching ? (
              <section className="grid gap-1.5">
                <GroupHeading
                  className="mt-0 pt-1"
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 shrink-0 transition-none hover:bg-muted hover:text-foreground"
                      onClick={startCreatingFolder}
                      title="New folder"
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  }
                >
                  Folders
                </GroupHeading>

                <div className="grid gap-1">
                  {isCreatingFolder ? (
                    <NewFolderDraftRow
                      onCreate={commitCreatingFolder}
                      onCancel={cancelCreatingFolder}
                    />
                  ) : null}
                  {visibleFolders.map(renderFolder)}
                  {filteredChatList.folders.length === 0 &&
                  !isSearching &&
                  !isCreatingFolder ? (
                    <div className="px-2 py-1 text-base leading-6 text-muted-foreground">
                      No folders
                    </div>
                  ) : null}
                  {hasMoreFolders ? (
                    <button
                      type="button"
                      className="px-2 py-1 text-left text-base leading-6 text-muted-foreground transition-none hover:bg-muted/60 hover:text-foreground"
                      onClick={() =>
                        setVisibleFolderLimit(
                          (current) => current + FOLDER_BATCH_SIZE,
                        )
                      }
                    >
                      Show more
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {renderChatSection("Pinned", filteredChatList.pinnedChats)}
            {renderChatSection("Chats", filteredChatList.rootChats, {
              droppable: true,
            })}
            {filteredChatList.filteredChatCount === 0 ? (
              <div className="px-2 py-6 text-center text-sm leading-5 text-muted-foreground">
                No chats found.
              </div>
            ) : null}
            {hasMoreChats ? (
              <div className="px-2 pb-1 text-center text-sm leading-5 text-muted-foreground">
                Scroll to load more chats
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 border-t p-3">
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-center"
            onClick={onCreateNewChat}
            title="New chat (Ctrl+N)"
          >
            <Plus className="size-4" />
            New chat
          </Button>
        </div>
      </aside>

      {isCollapsed ? (
        <div className="absolute left-2 top-2 z-30 hidden items-center gap-1 border bg-card/95 p-1 shadow-sm md:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onCollapsedChange(false)}
            title="Show sidebar"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCreateNewChat}
            title="New chat (Ctrl+N)"
          >
            <Plus className="size-4" />
          </Button>
          {renderSettingsButton()}
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(deleteFolderTarget)}
        onOpenChange={(open) => !open && setDeleteFolderTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose what should happen to chats inside “
              {deleteFolderTarget?.name ?? "this folder"}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={() => {
                if (deleteFolderTarget)
                  onDeleteFolder(deleteFolderTarget.id, "move");
                setDeleteFolderTarget(null);
              }}
            >
              Move chats to Chats
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteFolderTarget)
                  onDeleteFolder(deleteFolderTarget.id, "delete");
                setDeleteFolderTarget(null);
              }}
            >
              Delete all chats
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
