import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import { Lock, Send, Square, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ContextUsageIndicator, type ContextUsageInfo } from "@/components/ai-chat/context-usage-indicator";

export type ToolMentionOption = {
  name: string;
  description?: string;
  isBuiltin?: boolean;
};

type ActiveToolMention = {
  startIndex: number;
  endIndex: number;
  query: string;
};

export type ChatComposerHandle = {
  clear: () => void;
  focus: () => void;
};

function findActiveToolMention(
  content: string,
  cursorIndex: number,
): ActiveToolMention | null {
  const prefix = content.slice(0, cursorIndex);
  const match = /(^|\s)@tool:([A-Za-z0-9_-]*)$/.exec(prefix);

  if (!match) return null;

  const fullMatch = match[0] ?? "";
  const leadingWhitespace = match[1] ?? "";
  const query = match[2] ?? "";
  const startIndex = cursorIndex - fullMatch.length + leadingWhitespace.length;

  return {
    startIndex,
    endIndex: cursorIndex,
    query,
  };
}

export const ChatComposer = memo(
  forwardRef<
    ChatComposerHandle,
    {
      disabled: boolean;
      isSending: boolean;
      draftKey: string;
      draft: string;
      onDraftChange: (draft: string) => void;
      onSend: (content: string) => Promise<boolean> | boolean;
      onStop: () => void;
      footerStart?: ReactNode;
      contextUsage?: ContextUsageInfo;
      toolMentionOptions?: ToolMentionOption[];
    }
  >(function ChatComposer(
    {
      disabled,
      isSending,
      draftKey,
      draft,
      onDraftChange,
      onSend,
      onStop,
      footerStart,
      contextUsage,
      toolMentionOptions = [],
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const toolMentionMenuRef = useRef<HTMLDivElement | null>(null);
    const [localDraft, setLocalDraft] = useState(draft);
    const [activeToolMention, setActiveToolMention] =
      useState<ActiveToolMention | null>(null);
    const [selectedToolSuggestionIndex, setSelectedToolSuggestionIndex] =
      useState(0);
    const trimmedDraft = localDraft.trim();
    const canSend = !disabled && !isSending && trimmedDraft.length > 0;

    const toolMentionSuggestions = useMemo(() => {
      if (!activeToolMention || disabled || isSending) return [];

      const query = activeToolMention.query.trim().toLowerCase();
      const filteredOptions = query
        ? toolMentionOptions.filter((tool) =>
            `${tool.name} ${tool.description ?? ""}`
              .toLowerCase()
              .includes(query),
          )
        : toolMentionOptions;

      return filteredOptions.slice(0, 8);
    }, [activeToolMention, disabled, isSending, toolMentionOptions]);

    const isToolMentionMenuOpen =
      Boolean(activeToolMention) && toolMentionSuggestions.length > 0;

    const updateActiveToolMention = useCallback(
      (value: string, cursorIndex: number | null) => {
        setActiveToolMention(
          findActiveToolMention(value, cursorIndex ?? value.length),
        );
      },
      [],
    );

    const applyToolMentionSuggestion = useCallback(
      (toolName: string) => {
        if (!activeToolMention) return;

        const suffix = localDraft.slice(activeToolMention.endIndex);
        const shouldAddTrailingSpace =
          suffix.length === 0 || !/^\s/.test(suffix);
        const replacement = `@tool:${toolName}${
          shouldAddTrailingSpace ? " " : ""
        }`;
        const nextDraft = `${localDraft.slice(
          0,
          activeToolMention.startIndex,
        )}${replacement}${suffix}`;
        const nextCursorIndex =
          activeToolMention.startIndex + replacement.length;

        setLocalDraft(nextDraft);
        onDraftChange(nextDraft);
        setActiveToolMention(null);
        setSelectedToolSuggestionIndex(0);

        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (!textarea) return;

          textarea.focus({ preventScroll: true });
          textarea.setSelectionRange(nextCursorIndex, nextCursorIndex);
        });
      },
      [activeToolMention, localDraft, onDraftChange],
    );

    const focusTextarea = useCallback(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (!textarea) return;

          textarea.focus({ preventScroll: true });

          const cursorPosition = textarea.value.length;
          textarea.setSelectionRange(cursorPosition, cursorPosition);
        });
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          setLocalDraft("");
          onDraftChange("");
          setActiveToolMention(null);
          setSelectedToolSuggestionIndex(0);
        },
        focus: focusTextarea,
      }),
      [focusTextarea, onDraftChange],
    );

    useEffect(() => {
      setLocalDraft(draft);
      setActiveToolMention(null);
      setSelectedToolSuggestionIndex(0);
    }, [draftKey, draft]);

    useEffect(() => {
      setSelectedToolSuggestionIndex(0);
    }, [activeToolMention?.query, toolMentionSuggestions.length]);

    useLayoutEffect(() => {
      if (!isToolMentionMenuOpen) return;

      const selectedElement = toolMentionMenuRef.current?.querySelector(
        `[data-tool-suggestion-index="${selectedToolSuggestionIndex}"]`,
      );
      selectedElement?.scrollIntoView({ block: "nearest" });
    }, [
      activeToolMention?.query,
      isToolMentionMenuOpen,
      selectedToolSuggestionIndex,
      toolMentionSuggestions.length,
    ]);

    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.style.height = "auto";

      const computedStyle = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;
      const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
      const maxHeight = lineHeight * 11 + paddingTop + paddingBottom;

      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [localDraft]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!canSend) return;

      const wasSent = await onSend(localDraft);
      if (wasSent) {
        setLocalDraft("");
        onDraftChange("");
        setActiveToolMention(null);
        setSelectedToolSuggestionIndex(0);
      }
    }

    return (
      <form
        onSubmit={handleSubmit}
        className="bg-background px-3 py-3 md:px-4 md:py-4"
        data-draft-input
      >
        <div className="mx-auto w-full max-w-3xl border rounded-lg bg-card p-3 pt-0 shadow-sm">
          <div className="mx-auto grid w-full gap-2">
            <div className="relative">
              {isToolMentionMenuOpen && (
                <div
                  ref={toolMentionMenuRef}
                  className="absolute bottom-full left-1/2 z-20 mb-2 max-h-64 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
                >
                  {toolMentionSuggestions.map((tool, index) => {
                    const isSelected = index === selectedToolSuggestionIndex;

                    return (
                      <button
                        key={tool.name}
                        type="button"
                        data-tool-suggestion-index={index}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyToolMentionSuggestion(tool.name);
                        }}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                          isSelected && "bg-accent text-accent-foreground",
                        )}
                        title={tool.description}
                      >
                        <Wrench className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5 font-medium">
                            <span className="min-w-0 truncate">
                              {tool.name}
                            </span>
                            {tool.isBuiltin && (
                              <Lock className="size-3 shrink-0 text-muted-foreground" />
                            )}
                          </span>
                          {tool.description && (
                            <span className="mt-0.5 line-clamp-1 text-muted-foreground">
                              {tool.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <Textarea
                ref={textareaRef}
                value={localDraft}
                rows={3}
                onChange={(event) => {
                  const nextDraft = event.target.value;
                  setLocalDraft(nextDraft);
                  onDraftChange(nextDraft);
                  updateActiveToolMention(
                    nextDraft,
                    event.target.selectionStart,
                  );
                }}
                onClick={(event) => {
                  updateActiveToolMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onSelect={(event) => {
                  updateActiveToolMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onKeyUp={(event) => {
                  if (
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                      "Home",
                      "End",
                      "PageUp",
                      "PageDown",
                    ].includes(event.key)
                  ) {
                    return;
                  }

                  updateActiveToolMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onKeyDown={(event) => {
                  if (isToolMentionMenuOpen) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setSelectedToolSuggestionIndex((index) =>
                        Math.min(index + 1, toolMentionSuggestions.length - 1),
                      );
                      return;
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setSelectedToolSuggestionIndex((index) =>
                        Math.max(index - 1, 0),
                      );
                      return;
                    }

                    if (event.key === "Enter" || event.key === "Tab") {
                      const selectedTool =
                        toolMentionSuggestions[selectedToolSuggestionIndex];

                      if (selectedTool) {
                        event.preventDefault();
                        applyToolMentionSuggestion(selectedTool.name);
                        return;
                      }
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      setActiveToolMention(null);
                      setSelectedToolSuggestionIndex(0);
                      return;
                    }
                  }

                  if (event.key !== "Enter") return;

                  if (event.shiftKey) return;

                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                placeholder="Type a message..."
                className="min-h-[5.5rem] resize-none border-0 !bg-transparent px-1 leading-6 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">{footerStart}</div>
              <ContextUsageIndicator usage={contextUsage ?? {}} />
              {isSending ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onStop}
                  className="shrink-0 rounded-lg"
                  title="Stop generation"
                >
                  <Square className="size-4" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!canSend}
                  className="shrink-0 rounded-lg"
                  title="Send message"
                >
                  <Send className="size-4" />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    );
  }),
);
