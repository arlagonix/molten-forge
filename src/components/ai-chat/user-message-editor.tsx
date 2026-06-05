import {
  BookOpen,
  Bot,
  Lock,
  Paperclip,
  Save as SaveIcon,
  Send,
  Wrench,
  X,
} from "lucide-react";
import {
  type ClipboardEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AttachmentChips } from "@/components/ai-chat/attachment-chips";
import type { ToolMentionOption } from "@/components/ai-chat/chat-composer";
import { Textarea } from "@/components/ui/textarea";
import {
  cleanupUnusedAttachments,
  deleteTemporaryAttachments,
  findAttachmentById,
} from "@/lib/ai-chat/attachment-cleanup";
import type { ChatAttachment } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { TooltipIconButton } from "./tooltip-icon-button";

type AttachmentInput =
  | { name: string; path: string; mimeType?: string }
  | { name: string; bytes: Uint8Array | number[] | ArrayBuffer; mimeType?: string };

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

export const UserMessageEditor = memo(function UserMessageEditor({
  initialContent,
  initialAttachments = [],
  disabled,
  toolMentionOptions = [],
  skillMentionOptions = [],
  agentMentionOptions = [],
  onCancel,
  onSave,
  onSubmit,
}: {
  initialContent: string;
  initialAttachments?: ChatAttachment[];
  disabled: boolean;
  toolMentionOptions?: ToolMentionOption[];
  skillMentionOptions?: ToolMentionOption[];
  agentMentionOptions?: ToolMentionOption[];
  onCancel: () => void;
  onSave: (content: string, attachments: ChatAttachment[]) => void | Promise<void>;
  onSubmit: (content: string, attachments: ChatAttachment[]) => void | Promise<void>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const [content, setContent] = useState(initialContent);
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(
    null,
  );
  const [mentionMenuPosition, setMentionMenuPosition] =
    useState<CaretMenuPosition | null>(null);
  const [selectedMentionSuggestionIndex, setSelectedMentionSuggestionIndex] =
    useState(0);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [isProcessingAttachments, setIsProcessingAttachments] = useState(false);
  const trimmedContent = content.trim();
  const canSaveOrSubmit =
    !disabled && !isProcessingAttachments &&
    (trimmedContent.length > 0 || attachments.length > 0);

  const mentionSuggestions = useMemo<ToolMentionOption[]>(() => {
    if (!activeMention || disabled) return [];

    const options =
      activeMention.type === "skill"
        ? skillMentionOptions
        : activeMention.type === "agent"
          ? agentMentionOptions
          : toolMentionOptions;
    const query = activeMention.query.trim().toLowerCase();

    return options
      .filter((option) =>
        query ? option.name.toLowerCase().includes(query) : true,
      )
      .slice(0, 12);
  }, [activeMention, agentMentionOptions, disabled, skillMentionOptions, toolMentionOptions]);

  const isMentionMenuOpen = Boolean(activeMention && mentionSuggestions.length);

  function updateActiveMention(contentValue: string, cursorIndex: number) {
    const mention = findActiveMention(contentValue, cursorIndex);
    setActiveMention(mention);

    const textarea = textareaRef.current;
    if (!mention || !textarea) {
      setMentionMenuPosition(null);
      return;
    }

    setMentionMenuPosition(getTextareaCaretMenuPosition(textarea, cursorIndex));
  }

  function applyMentionSuggestion(name: string) {
    if (!activeMention) return;

    const suffix = content.slice(activeMention.endIndex);
    const shouldAddTrailingSpace = suffix.length === 0 || !/^\s/.test(suffix);
    const mentionText = `@${activeMention.type}:${name}${
      shouldAddTrailingSpace ? " " : ""
    }`;
    const nextContent = `${content.slice(0, activeMention.startIndex)}${mentionText}${suffix}`;
    const nextCursorPosition = activeMention.startIndex + mentionText.length;

    setContent(nextContent);
    setActiveMention(null);
    setMentionMenuPosition(null);
    setSelectedMentionSuggestionIndex(0);

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  useEffect(() => {
    setContent(initialContent);
    setAttachments(initialAttachments);
    setActiveMention(null);
    setMentionMenuPosition(null);
    setSelectedMentionSuggestionIndex(0);
  }, [initialAttachments, initialContent]);

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
    isMentionMenuOpen,
    selectedMentionSuggestionIndex,
    mentionSuggestions.length,
  ]);

  async function addFiles(inputs: AttachmentInput[]) {
    if (!inputs.length) return;
    if (!window.codeForgeAI?.processAttachments) {
      toast.error("Attachment processing is not available.");
      return;
    }

    setIsProcessingAttachments(true);
    try {
      const result = await window.codeForgeAI.processAttachments(inputs);
      setAttachments((current) => [...current, ...result.attachments]);
      for (const warning of result.warnings ?? []) toast.warning(warning);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to process attachments.",
      );
    } finally {
      setIsProcessingAttachments(false);
    }
  }

  function getFileSystemPath(file: File) {
    return (
      window.codeForgeAI?.getPathForFile?.(file) ||
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
    if (filePath) return { name, path: filePath, mimeType: file.type };

    const buffer = await file.arrayBuffer();
    return {
      name,
      bytes: new Uint8Array(buffer),
      mimeType: file.type,
    };
  }

  function getUniqueClipboardFiles(event: ClipboardEvent<HTMLTextAreaElement>) {
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
      ? (window.codeForgeAI?.readClipboardFilePathsSync?.() ?? [])
      : [];

    if (!files.length && !clipboardFilePaths.length && !hasFileClipboardHint) return;

    event.preventDefault();
    if (files.length) {
      await addFiles(
        await Promise.all(
          files.map((file) => fileToAttachmentInput(file, "pasted")),
        ),
      );
      return;
    }

    try {
      const paths = clipboardFilePaths.length
        ? clipboardFilePaths
        : ((await window.codeForgeAI?.readClipboardFilePaths?.()) ?? []);
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

  async function handlePickAttachments() {
    if (!window.codeForgeAI?.pickAttachments) {
      toast.error("File picker is not available.");
      return;
    }

    await addFiles(await window.codeForgeAI.pickAttachments());
  }

  function handleRemoveAttachment(attachmentId: string) {
    setAttachments((current) => {
      const removedAttachment = findAttachmentById(current, attachmentId);
      if (removedAttachment) {
        const isInitialAttachment = initialAttachments.some(
          (attachment) => attachment.id === removedAttachment.id,
        );
        if (isInitialAttachment) cleanupUnusedAttachments([removedAttachment]);
        else deleteTemporaryAttachments([removedAttachment]);
      }
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }

  function handleSave() {
    if (!canSaveOrSubmit) return;

    void onSave(content, attachments);
  }

  function handleSubmit() {
    if (!canSaveOrSubmit) return;

    void onSubmit(content, attachments);
  }

  function handleCancel() {
    const initialAttachmentIds = new Set(
      initialAttachments.map((attachment) => attachment.id),
    );
    const addedAttachments = attachments.filter(
      (attachment) => !initialAttachmentIds.has(attachment.id),
    );
    deleteTemporaryAttachments(addedAttachments);
    onCancel();
  }

  return (
    <div className="grid min-w-0 max-w-full gap-2">
      <article className="flex justify-end">
        <div className="relative min-w-0 w-full overflow-visible bg-primary px-4 py-3 text-base leading-6 text-primary-foreground shadow-xs [overflow-wrap:anywhere]">
          {isMentionMenuOpen && mentionMenuPosition && (
            <div
              ref={mentionMenuRef}
              className="absolute z-30 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto border bg-popover p-1 text-popover-foreground shadow-lg"
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
                        <span className="min-w-0 truncate">{option.name}</span>
                        {activeMention?.type === "tool" && option.isBuiltin && (
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
          <AttachmentChips
            attachments={attachments}
            isProcessing={isProcessingAttachments}
            onRemove={handleRemoveAttachment}
            className="mb-3 text-primary-foreground"
          />
          <Textarea
            ref={textareaRef}
            value={content}
            onPaste={handlePaste}
            onChange={(event) => {
              const nextContent = event.target.value;
              setContent(nextContent);
              updateActiveMention(nextContent, event.target.selectionStart);
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

              if (event.key === "Escape") {
                event.preventDefault();
                handleCancel();
              }

              if ((event.ctrlKey || event.metaKey) && event.key === "s") {
                event.preventDefault();
                handleSave();
              }

              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                handleSubmit();
              }
            }}
            autoFocus
            disabled={disabled}
            className="min-h-[12rem] max-h-[32rem] w-full resize-y rounded-none border-0 !bg-transparent p-0 text-primary-foreground shadow-none outline-none placeholder:text-primary-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-80"
          />
        </div>
      </article>

      <div className="flex justify-end gap-1.5 text-sm leading-5 text-muted-foreground">
        <TooltipIconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Attach files"
          onClick={handlePickAttachments}
          disabled={disabled || isProcessingAttachments}
        >
          <Paperclip className="size-3" />
        </TooltipIconButton>
        <TooltipIconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Save edit"
          onClick={handleSave}
          disabled={!canSaveOrSubmit}
        >
          <SaveIcon className="size-3" />
        </TooltipIconButton>
        <TooltipIconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Submit edit and regenerate"
          onClick={handleSubmit}
          disabled={!canSaveOrSubmit}
        >
          <Send className="size-3" />
        </TooltipIconButton>
        <TooltipIconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Cancel edit"
          onClick={handleCancel}
          disabled={disabled}
        >
          <X className="size-3" />
        </TooltipIconButton>
      </div>
    </div>
  );
});
