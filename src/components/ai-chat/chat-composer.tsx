import {
  AlertTriangle,
  BookOpen,
  Bot,
  Paperclip,
  Send,
  Square,
} from "lucide-react";
import type { ClipboardEvent, DragEvent, FormEvent, ReactNode } from "react";
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

import { AttachmentChips } from "@/components/ai-chat/attachment-chips";
import {
  ContextUsageIndicator,
  type ContextUsageInfo,
} from "@/components/ai-chat/context-usage-indicator";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteTemporaryAttachments,
  findAttachmentById,
} from "@/lib/ai-chat/attachment-cleanup";
import type { ChatAttachment } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type ToolMentionOption = {
  name: string;
  description?: string;
  isBuiltin?: boolean;
};

type AttachmentInput =
  | { name: string; path: string; mimeType?: string }
  | {
      name: string;
      bytes: Uint8Array | number[] | ArrayBuffer;
      mimeType?: string;
    };

type ActiveMention = {
  type: "skill" | "agent";
  command: "skill" | "s" | "agent" | "a";
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
  const match = /^\s*\/(skill|s|agent|a):?([A-Za-z0-9_-]*)$/.exec(prefix);

  if (!match) return null;

  const slashIndex = prefix.indexOf("/");
  if (slashIndex < 0) return null;

  const command = match[1] as "skill" | "s" | "agent" | "a";
  const type = command === "agent" || command === "a" ? "agent" : "skill";
  const query = match[2] ?? "";
  const startIndex = slashIndex;

  return {
    type,
    command,
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
      attachments: ChatAttachment[];
      onAttachmentsChange: (attachments: ChatAttachment[]) => void;
      onSend: (
        content: string,
        attachments: ChatAttachment[],
      ) => Promise<boolean> | boolean;
      onStop: () => void;
      footerStart?: ReactNode;
      contextUsage?: ContextUsageInfo;
      supportsVision?: boolean;
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
      attachments,
      onAttachmentsChange,
      onSend,
      onStop,
      footerStart,
      contextUsage,
      supportsVision = false,
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
    const [isProcessingAttachments, setIsProcessingAttachments] =
      useState(false);
    const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);
    const trimmedDraft = localDraft.trim();
    const canSend =
      !disabled &&
      !isSending &&
      !isProcessingAttachments &&
      (trimmedDraft.length > 0 || attachments.length > 0);
    const hasImageAttachments = attachments.some(
      (attachment) =>
        attachment.kind === "image" ||
        attachment.children?.some((child) => child.kind === "image"),
    );

    const mentionSuggestions = useMemo<ToolMentionOption[]>(() => {
      if (!activeMention || disabled || isSending) return [];

      const options: ToolMentionOption[] =
        activeMention.type === "skill"
          ? skillMentionOptions
          : agentMentionOptions;
      const query = activeMention.query.trim().toLowerCase();
      const filteredOptions = query
        ? options.filter((option) => option.name.toLowerCase().includes(query))
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
        const replacement = `/${activeMention.command}:${name}${
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
          onAttachmentsChange([]);
          setActiveMention(null);
          setMentionMenuPosition(null);
          setSelectedMentionSuggestionIndex(0);
        },
        focus: focusTextarea,
      }),
      [focusTextarea, onAttachmentsChange, onDraftChange],
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

    async function addFiles(inputs: AttachmentInput[]) {
      if (!inputs.length) return;
      if (!window.moltenForgeAI?.processAttachments) {
        toast.error("Attachment processing is not available.");
        return;
      }

      setIsProcessingAttachments(true);
      try {
        const result = await window.moltenForgeAI.processAttachments(inputs);
        onAttachmentsChange([...attachments, ...result.attachments]);
        for (const warning of result.warnings ?? []) {
          toast.warning(warning);
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to process attachments.",
        );
      } finally {
        setIsProcessingAttachments(false);
      }
    }

    async function handlePickAttachments() {
      if (!window.moltenForgeAI?.pickAttachments) {
        toast.error("File picker is not available.");
        return;
      }
      const picked = await window.moltenForgeAI.pickAttachments();
      await addFiles(picked);
    }

    function handleRemoveAttachment(attachmentId: string) {
      const removedAttachment = findAttachmentById(attachments, attachmentId);
      if (removedAttachment) deleteTemporaryAttachments([removedAttachment]);
      onAttachmentsChange(
        attachments.filter((attachment) => attachment.id !== attachmentId),
      );
    }

    function getFileSystemPath(file: File) {
      return (
        window.moltenForgeAI?.getPathForFile?.(file) ||
        (file as File & { path?: string }).path ||
        ""
      );
    }

    async function fileToAttachmentInput(
      file: File,
      fallbackPrefix: string,
    ): Promise<AttachmentInput> {
      const filePath = getFileSystemPath(file);
      const name = file.name || `${fallbackPrefix}-${Date.now()}`;
      if (filePath) {
        return { name, path: filePath, mimeType: file.type };
      }

      const buffer = await file.arrayBuffer();
      return {
        name,
        bytes: new Uint8Array(buffer),
        mimeType: file.type,
      };
    }

    function getUniqueClipboardFiles(
      event: ClipboardEvent<HTMLTextAreaElement>,
    ) {
      const items = Array.from(event.clipboardData.items).filter(
        (item) => item.kind === "file",
      );
      const rawFiles = items.length
        ? items.map((item) => item.getAsFile())
        : Array.from(event.clipboardData.files);
      const files: File[] = [];
      const seen = new Set<string>();

      for (const file of rawFiles) {
        if (!file) continue;
        const key = `${file.name}:${file.size}:${file.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        files.push(file);
      }

      return files;
    }

    async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
      const files = getUniqueClipboardFiles(event);
      const hasFileClipboardHint = Array.from(event.clipboardData.types).some(
        (type) => type.toLowerCase().includes("file"),
      );

      const clipboardFilePaths = !files.length
        ? (window.moltenForgeAI?.readClipboardFilePathsSync?.() ?? [])
        : [];

      if (!files.length && !clipboardFilePaths.length && !hasFileClipboardHint)
        return;

      event.preventDefault();
      if (files.length) {
        const inputs = await Promise.all(
          files.map((file) => fileToAttachmentInput(file, "pasted")),
        );
        void addFiles(inputs);
        return;
      }

      try {
        const paths = clipboardFilePaths.length
          ? clipboardFilePaths
          : ((await window.moltenForgeAI?.readClipboardFilePaths?.()) ?? []);
        if (!paths.length) return;
        await addFiles(
          paths.map((filePath) => ({
            name: filePath.split(/[\\/]/).pop() || "pasted-file",
            path: filePath,
          })),
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to read files from clipboard.",
        );
      }
    }

    async function getDroppedFileInputs(event: DragEvent<HTMLElement>) {
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) {
        for (const item of Array.from(event.dataTransfer.items)) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      }

      return Promise.all(
        files.map((file) => fileToAttachmentInput(file, "dropped")),
      );
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!canSend) return;

      const wasSent = await onSend(localDraft, attachments);
      if (wasSent) {
        setLocalDraft("");
        onDraftChange("");
        onAttachmentsChange([]);
        setActiveMention(null);
        setMentionMenuPosition(null);
        setSelectedMentionSuggestionIndex(0);
      }
    }

    return (
      <form
        onSubmit={handleSubmit}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDraggingAttachments(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDraggingAttachments(true);
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setIsDraggingAttachments(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDraggingAttachments(false);
          void getDroppedFileInputs(event).then(addFiles);
        }}
        className="bg-background py-3 md:py-4"
        data-draft-input
      >
        <div
          className={cn(
            "mx-auto w-full max-w-4xl border bg-card p-3 pt-0 shadow-sm",
            isDraggingAttachments && "border-primary bg-primary/5",
          )}
        >
          <div className="mx-auto grid w-full gap-2">
            <AttachmentChips
              attachments={attachments}
              isProcessing={isProcessingAttachments}
              onRemove={handleRemoveAttachment}
              className="pt-3"
            />
            {hasImageAttachments && !supportsVision && (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                This model is not marked as vision-capable. Images will still be
                sent, but the model may ignore them or the provider may reject
                the request.
              </div>
            )}
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
                      activeMention?.type === "skill" ? BookOpen : Bot;

                    return (
                      <button
                        key={option.name}
                        type="button"
                        data-mention-suggestion-index={index}
                        onMouseEnter={() =>
                          setSelectedMentionSuggestionIndex(index)
                        }
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyMentionSuggestion(option.name);
                        }}
                        className={cn(
                          "flex w-full min-w-0 items-start gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
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
                onPaste={handlePaste}
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
              <Button
                type="button"
                variant="ghost"
                onClick={handlePickAttachments}
                disabled={disabled || isSending || isProcessingAttachments}
                className="shrink-0"
                title="Attach files"
              >
                <Paperclip className="size-4" />
              </Button>
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
