import {
  MessageSquareText,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sun,
  Trash2,
  Wrench,
} from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatSession } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

type ChatSidebarGroup = {
  label: string;
  chats: ChatSession[];
};

type ChatSidebarProps = {
  appName: string;
  appVersionLabel: string;
  groupedChats: ChatSidebarGroup[];
  activeChatId?: string;
  isCollapsed: boolean;
  resolvedTheme: "light" | "dark";
  onCollapsedChange: (isCollapsed: boolean) => void;
  onSwitchChat: (chatId: string) => void;
  onRemoveChat: (chatId: string) => void;
  onCreateNewChat: () => void;
  onOpenProviders: () => void;
  onOpenTools: () => void;
  onOpenSystemPrompt: () => void;
  onSetTheme: (theme: "light" | "dark") => void;
  onClearCurrentChat: () => void;
};

export const ChatSidebar = memo(function ChatSidebar({
  appName,
  appVersionLabel,
  groupedChats,
  activeChatId,
  isCollapsed,
  resolvedTheme,
  onCollapsedChange,
  onSwitchChat,
  onRemoveChat,
  onCreateNewChat,
  onOpenProviders,
  onOpenTools,
  onOpenSystemPrompt,
  onSetTheme,
  onClearCurrentChat,
}: ChatSidebarProps) {
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
          <DropdownMenuItem onClick={onOpenSystemPrompt}>
            <MessageSquareText className="size-4" />
            System prompt
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
            {groupedChats.map((group) => (
              <section key={group.label} className="grid gap-1.5">
                <div className="px-2 pt-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                <div className="grid gap-[1px]">
                  {group.chats.map((chat) => (
                    <div
                      key={chat.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group flex min-w-0 cursor-pointer items-center gap-1 border rounded-lg px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        chat.id === activeChatId
                          ? "border-primary/30 bg-accent text-accent-foreground"
                          : "border-transparent hover:border-border hover:bg-muted/60",
                      )}
                      onClick={() => onSwitchChat(chat.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSwitchChat(chat.id);
                        }
                      }}
                      title={chat.title}
                    >
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-base leading-6 ">
                          {chat.title}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-7 w-7 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveChat(chat.id);
                        }}
                        title="Delete chat"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
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
