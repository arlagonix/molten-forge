import { BookOpen, Bot, Lock, Send, Square, Wrench } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
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

import {
  ContextUsageIndicator,
  type ContextUsageInfo,
} from "@/components/ai-chat/context-usage-indicator";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type ToolMentionOption = {
  name: string;
  description?: string;
  isBuiltin?: boolean;
};

type ActiveMention = {
  type: "tool" | "skill" | "agent";
  startIndex: number;
  endIndex: number;
  query: string;
};

type CaretMenuPosition = {
  left: number;
  top: number;
  placement: "top" | "bottom";
  maxHeight: number;
};

const CARET_MIRROR_PROPERTIES = [
  "box-sizing",
  "width",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-transform",
  "word-spacing",
  "line-height",
  "text-indent",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "white-space",
  "overflow-wrap",
  "word-break",
  "tab-size",
] as const;

function getTextareaCaretMenuPosition(
  textarea: HTMLTextAreaElement,
  cursorIndex: number,
): CaretMenuPosition {
  const computedStyle = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");

  mirror.style.position = "fixed";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";

  for (const property of CARET_MIRROR_PROPERTIES) {
    mirror.style.setProperty(
      property,
      computedStyle.getPropertyValue(property),
    );
  }

  mirror.textContent = textarea.value.slice(0, cursorIndex);
  marker.textContent =
    textarea.value.slice(cursorIndex, cursorIndex + 1) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const textareaRect = textarea.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 24;

  const left =
    markerRect.left - mirrorRect.left - textarea.scrollLeft + textareaRect.left;
  const lineTop =
    markerRect.top - mirrorRect.top - textarea.scrollTop + textareaRect.top;
  const lineBottom = lineTop + lineHeight;

  document.body.removeChild(mirror);

  const viewportGap = 12;
  const menuGap = 6;
  const preferredMaxHeight = 256;
  const minUsableHeight = 180;
  const availableBelow = Math.max(
    0,
    window.innerHeight - lineBottom - viewportGap,
  );
  const availableAbove = Math.max(0, lineTop - viewportGap);
  const placement =
    availableBelow < minUsableHeight && availableAbove > availableBelow
      ? "top"
      : "bottom";
  const availableSpace = placement === "top" ? availableAbove : availableBelow;
  const maxHeight = Math.max(48, Math.min(preferredMaxHeight, availableSpace));
  const top = placement === "top" ? lineTop - menuGap : lineBottom;

  const containerRect = textarea.offsetParent?.getBoundingClientRect();
  if (!containerRect) {
    return { left, top, placement, maxHeight };
  }

  return {
    left: Math.max(
      8,
      Math.min(left - containerRect.left, textarea.clientWidth - 16),
    ),
    top: top - containerRect.top,
    placement,
    maxHeight,
  };
}

export type ChatComposerHandle = {
  clear: () => void;
  focus: () => void;
};

function findActiveMention(
  content: string,
  cursorIndex: number,
): ActiveMention | null {
  const prefix = content.slice(0, cursorIndex);
  const match = /(^|\s)@(tool|skill|agent):?([A-Za-z0-9_-]*)$/.exec(prefix);

  if (!match) return null;

  const fullMatch = match[0] ?? "";
  const leadingWhitespace = match[1] ?? "";
  const type =
    match[2] === "skill" ? "skill" : match[2] === "agent" ? "agent" : "tool";
  const query = match[3] ?? "";
  const startIndex = cursorIndex - fullMatch.length + leadingWhitespace.length;

  return {
    type,
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
      skillMentionOptions?: ToolMentionOption[];
      agentMentionOptions?: ToolMentionOption[];
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
      skillMentionOptions = [],
      agentMentionOptions = [],
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const mentionMenuRef = useRef<HTMLDivElement | null>(null);
    const [localDraft, setLocalDraft] = useState(draft);
    const [activeMention, setActiveMention] = useState<ActiveMention | null>(
      null,
    );
    const [mentionMenuPosition, setMentionMenuPosition] =
      useState<CaretMenuPosition | null>(null);
    const [selectedMentionSuggestionIndex, setSelectedMentionSuggestionIndex] =
      useState(0);
    const trimmedDraft = localDraft.trim();
    const canSend = !disabled && !isSending && trimmedDraft.length > 0;

    const mentionSuggestions = useMemo<ToolMentionOption[]>(() => {
      if (!activeMention || disabled || isSending) return [];

      const options: ToolMentionOption[] =
        activeMention.type === "skill"
          ? skillMentionOptions
          : activeMention.type === "agent"
            ? agentMentionOptions
            : toolMentionOptions;
      const query = activeMention.query.trim().toLowerCase();
      const filteredOptions = query
        ? options.filter((option) =>
            `${option.name} ${option.description ?? ""}`
              .toLowerCase()
              .includes(query),
          )
        : options;

      return filteredOptions.slice(0, 12);
    }, [
      activeMention,
      disabled,
      isSending,
      agentMentionOptions,
      skillMentionOptions,
      toolMentionOptions,
    ]);

    const isMentionMenuOpen =
      Boolean(activeMention) && mentionSuggestions.length > 0;

    const updateActiveMention = useCallback(
      (value: string, cursorIndex: number | null) => {
        const resolvedCursorIndex = cursorIndex ?? value.length;
        const mention = findActiveMention(value, resolvedCursorIndex);
        setActiveMention(mention);

        const textarea = textareaRef.current;
        if (!mention || !textarea) {
          setMentionMenuPosition(null);
          return;
        }

        setMentionMenuPosition(
          getTextareaCaretMenuPosition(textarea, resolvedCursorIndex),
        );
      },
      [],
    );

    const applyMentionSuggestion = useCallback(
      (name: string) => {
        if (!activeMention) return;

        const suffix = localDraft.slice(activeMention.endIndex);
        const shouldAddTrailingSpace =
          suffix.length === 0 || !/^\s/.test(suffix);
        const replacement = `@${activeMention.type}:${name}${
          shouldAddTrailingSpace ? " " : ""
        }`;
        const nextDraft = `${localDraft.slice(
          0,
          activeMention.startIndex,
        )}${replacement}${suffix}`;
        const nextCursorIndex = activeMention.startIndex + replacement.length;

        setLocalDraft(nextDraft);
        onDraftChange(nextDraft);
        setActiveMention(null);
        setMentionMenuPosition(null);
        setSelectedMentionSuggestionIndex(0);

        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (!textarea) return;

          textarea.focus({ preventScroll: true });
          textarea.setSelectionRange(nextCursorIndex, nextCursorIndex);
        });
      },
      [activeMention, localDraft, onDraftChange],
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
          setActiveMention(null);
          setMentionMenuPosition(null);
          setSelectedMentionSuggestionIndex(0);
        },
        focus: focusTextarea,
      }),
      [focusTextarea, onDraftChange],
    );

    useEffect(() => {
      setLocalDraft(draft);
      setActiveMention(null);
      setMentionMenuPosition(null);
      setSelectedMentionSuggestionIndex(0);
    }, [draftKey, draft]);

    useEffect(() => {
      setSelectedMentionSuggestionIndex(0);
    }, [activeMention?.query, mentionSuggestions.length]);

    useLayoutEffect(() => {
      if (!isMentionMenuOpen) return;

      const selectedElement = mentionMenuRef.current?.querySelector(
        `[data-mention-suggestion-index="${selectedMentionSuggestionIndex}"]`,
      );
      selectedElement?.scrollIntoView({ block: "nearest" });
    }, [
      activeMention?.query,
      isMentionMenuOpen,
      selectedMentionSuggestionIndex,
      mentionSuggestions.length,
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
        setActiveMention(null);
        setMentionMenuPosition(null);
        setSelectedMentionSuggestionIndex(0);
      }
    }

    return (
      <form
        onSubmit={handleSubmit}
        className="bg-background py-3 md:py-4"
        data-draft-input
      >
        <div className="mx-auto w-full max-w-4xl border  bg-card p-3 pt-0 shadow-sm">
          <div className="mx-auto grid w-full gap-2">
            <div className="relative">
              {isMentionMenuOpen && mentionMenuPosition && (
                <div
                  ref={mentionMenuRef}
                  className="absolute z-20 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto  border bg-popover p-1 text-popover-foreground shadow-lg"
                  style={{
                    left: mentionMenuPosition.left,
                    top: mentionMenuPosition.top,
                    maxHeight: mentionMenuPosition.maxHeight,
                    transform:
                      mentionMenuPosition.placement === "top"
                        ? "translateY(calc(-100% - 0.35rem))"
                        : "translateY(0.35rem)",
                  }}
                >
                  {mentionSuggestions.map((option, index) => {
                    const isSelected = index === selectedMentionSuggestionIndex;
                    const Icon =
                      activeMention?.type === "skill"
                        ? BookOpen
                        : activeMention?.type === "agent"
                          ? Bot
                          : Wrench;

                    return (
                      <button
                        key={option.name}
                        type="button"
                        data-mention-suggestion-index={index}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyMentionSuggestion(option.name);
                        }}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-2  px-2 py-1.5 text-left text-sm",
                          isSelected && "bg-accent text-accent-foreground",
                        )}
                        title={option.description}
                      >
                        <Icon className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5 font-medium">
                            <span className="min-w-0 truncate">
                              {option.name}
                            </span>
                            {activeMention?.type === "tool" &&
                              option.isBuiltin && (
                                <Lock className="size-3 shrink-0 text-muted-foreground" />
                              )}
                          </span>
                          {option.description && (
                            <span className="mt-0.5 line-clamp-2 text-muted-foreground">
                              {option.description}
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
                  updateActiveMention(nextDraft, event.target.selectionStart);
                }}
                onClick={(event) => {
                  updateActiveMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onSelect={(event) => {
                  updateActiveMention(
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

                  updateActiveMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onKeyDown={(event) => {
                  if (isMentionMenuOpen) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setSelectedMentionSuggestionIndex((index) =>
                        Math.min(index + 1, mentionSuggestions.length - 1),
                      );
                      return;
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setSelectedMentionSuggestionIndex((index) =>
                        Math.max(index - 1, 0),
                      );
                      return;
                    }

                    if (event.key === "Enter" || event.key === "Tab") {
                      const selectedMention =
                        mentionSuggestions[selectedMentionSuggestionIndex];

                      if (selectedMention) {
                        event.preventDefault();
                        applyMentionSuggestion(selectedMention.name);
                        return;
                      }
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      setActiveMention(null);
                      setMentionMenuPosition(null);
                      setSelectedMentionSuggestionIndex(0);
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
                  className="shrink-0 "
                  title="Stop generation"
                >
                  <Square className="size-4" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!canSend}
                  className="shrink-0 "
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
