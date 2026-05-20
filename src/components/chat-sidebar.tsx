import {
  Edit3,
  Loader2,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Wrench,
  BookOpen,
} from "lucide-react";
import { memo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ChatSession, ChatTitleGenerationMode } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

type ChatSidebarGroup = {
  label: string;
  chats: ChatSession[];
};

type ChatSidebarProps = {
  appName: string;
  appVersionLabel: string;
  pinnedChats: ChatSession[];
  groupedChats: ChatSidebarGroup[];
  activeChatId?: string;
  isCollapsed: boolean;
  chatTitleGenerationMode: ChatTitleGenerationMode;
  generatingChatIds: string[];
  titleGenerationChatIds: string[];
  resolvedTheme: "light" | "dark";
  onCollapsedChange: (isCollapsed: boolean) => void;
  onSwitchChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onToggleChatPinned: (chatId: string) => void;
  onGenerateChatTitle: (chatId: string) => void;
  onRemoveChat: (chatId: string) => void;
  onCreateNewChat: () => void;
  onOpenProviders: () => void;
  onOpenTools: () => void;
  onOpenSkills: () => void;
  onOpenSystemPrompt: () => void;
  onToggleAiTitleGeneration: (checked: boolean) => void;
  onSetTheme: (theme: "light" | "dark") => void;
  onClearCurrentChat: () => void;
};

export const ChatSidebar = memo(function ChatSidebar({
  appName,
  appVersionLabel,
  pinnedChats,
  groupedChats,
  activeChatId,
  isCollapsed,
  chatTitleGenerationMode,
  generatingChatIds,
  titleGenerationChatIds,
  resolvedTheme,
  onCollapsedChange,
  onSwitchChat,
  onRenameChat,
  onToggleChatPinned,
  onGenerateChatTitle,
  onRemoveChat,
  onCreateNewChat,
  onOpenProviders,
  onOpenTools,
  onOpenSkills,
  onOpenSystemPrompt,
  onToggleAiTitleGeneration,
  onSetTheme,
  onClearCurrentChat,
}: ChatSidebarProps) {
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  function renderAppOptionsMenu(triggerClassName?: string) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={triggerClassName}
            title="Menu"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="rounded-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => {
              (document.activeElement as HTMLElement | null)?.blur();
            });
          }}
        >
          <DropdownMenuItem onClick={onOpenProviders}>
            <Settings className="size-4" />
            Providers
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenTools}>
            <Wrench className="size-4" />
            Tools
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenSkills}>
            <BookOpen className="size-4" />
            Skills
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenSystemPrompt}>
            <MessageSquareText className="size-4" />
            System prompt
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              onToggleAiTitleGeneration(chatTitleGenerationMode !== "ai")
            }
          >
            <Checkbox
              checked={chatTitleGenerationMode === "ai"}
              aria-hidden="true"
              tabIndex={-1}
              className="pointer-events-none"
            />
            Generate title
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              onSetTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            {resolvedTheme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
            {resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onClearCurrentChat}>
            <Trash2 className="size-4" />
            <span className="flex-1">Clear current chat</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function renderChatRow(chat: ChatSession) {
    const isActive = chat.id === activeChatId;
    const isRenaming = renamingChatId === chat.id;
    const isGenerating = generatingChatIds.includes(chat.id);
    const isGeneratingTitle = titleGenerationChatIds.includes(chat.id);

    return (
      <div
        key={chat.id}
        role="button"
        tabIndex={0}
        className={cn(
          "group flex min-w-0 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
        title={chat.title}
      >
        <div className="min-w-0 flex-1 text-left">
          {isRenaming ? (
            <Input
              value={renameValue}
              autoFocus
              className="h-7 rounded-md px-2 py-1 text-base leading-6"
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                onClick={(event) => event.stopPropagation()}
                title="Chat options"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="rounded-lg"
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
              <DropdownMenuSeparator />
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
        ) : null}
      </div>
    );
  }

  function renderChatSection(label: string, chats: ChatSession[]) {
    return (
      <section key={label} className="grid gap-1.5">
        <div className="px-2 pt-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="grid gap-[1px]">{chats.map(renderChatRow)}</div>
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
        <div className="border-b py-3 pl-3 pr-2">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 rounded-lg md:inline-flex"
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

            {renderAppOptionsMenu("shrink-0 rounded-lg")}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 chat-scrollbar">
          <div className="grid gap-3">
            {pinnedChats.length > 0
              ? renderChatSection("PINNED", pinnedChats)
              : null}
            {groupedChats.map((group) =>
              renderChatSection(group.label, group.chats),
            )}
          </div>
        </div>

        <div className="grid gap-2 border-t p-3">
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-center rounded-lg"
            onClick={onCreateNewChat}
            title="New chat (Ctrl+N)"
          >
            <Plus className="size-4" />
            New chat
          </Button>
        </div>
      </aside>

      {isCollapsed ? (
        <div className="absolute left-2 top-2 z-30 hidden items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-sm md:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg"
            onClick={() => onCollapsedChange(false)}
            title="Show sidebar"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="rounded-lg"
            onClick={onCreateNewChat}
            title="New chat (Ctrl+N)"
          >
            <Plus className="size-4" />
          </Button>
          {renderAppOptionsMenu("rounded-lg")}
        </div>
      ) : null}
    </>
  );
});
