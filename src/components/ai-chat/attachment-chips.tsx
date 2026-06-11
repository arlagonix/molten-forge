import {
  AlertTriangle,
  Download,
  FileArchive,
  FileCode,
  FileText,
  ImageIcon,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAttachmentSize } from "@/lib/ai-chat/attachment-format";
import type { ChatAttachment } from "@/lib/ai-chat/types";
import { cn } from "@/lib/utils";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const FIT_PADDING = 24;

type ImageTransform = {
  scale: number;
  x: number;
  y: number;
};

type PreviewState = {
  name: string;
  dataUrl: string | null;
  fallbackDataUrl?: string;
  loading: boolean;
  transform: ImageTransform;
  initialTransform?: ImageTransform;
  notice?: string;
};

type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function countArchiveChildren(attachment: ChatAttachment): number {
  return (attachment.children ?? []).reduce(
    (count, child) =>
      count + (child.kind === "archive" ? countArchiveChildren(child) : 1),
    0,
  );
}

function AttachmentIcon({
  attachment,
  onPreview,
  iconClassName,
}: {
  attachment: ChatAttachment;
  onPreview: (attachment: ChatAttachment) => void;
  iconClassName?: string;
}) {
  if (attachment.kind === "image" && attachment.thumbnailDataUrl) {
    return (
      <button
        type="button"
        className="size-9 shrink-0 overflow-hidden border bg-transparent focus:outline-none focus-visible:ring-0"
        onClick={(event) => {
          event.stopPropagation();
          onPreview(attachment);
        }}
        title="Preview image"
      >
        <img
          src={attachment.thumbnailDataUrl}
          alt=""
          className="size-full object-cover"
        />
      </button>
    );
  }

  const Icon =
    attachment.kind === "image"
      ? ImageIcon
      : attachment.kind === "archive"
        ? FileArchive
        : attachment.kind === "text"
          ? FileCode
          : FileText;

  if (attachment.kind === "image") {
    return (
      <button
        type="button"
        className="flex size-8 shrink-0 items-center justify-center focus:outline-none focus-visible:ring-0"
        onClick={(event) => {
          event.stopPropagation();
          onPreview(attachment);
        }}
        title="Preview image"
      >
        <Icon className={cn("size-5 text-muted-foreground", iconClassName)} />
      </button>
    );
  }

  return (
    <span className="flex size-8 shrink-0 items-center justify-center">
      <Icon className={cn("size-7 text-muted-foreground", iconClassName)} />
    </span>
  );
}

export function AttachmentChips({
  attachments,
  readOnly = false,
  isProcessing = false,
  onRemove,
  className,
  tone = "default",
}: {
  attachments: ChatAttachment[];
  readOnly?: boolean;
  isProcessing?: boolean;
  onRemove?: (attachmentId: string) => void;
  className?: string;
  tone?: "default" | "onPrimary";
}) {
  const [previewImage, setPreviewImage] = useState<PreviewState | null>(null);
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);
  const previewDragRef = useRef<DragState | null>(null);

  const fitPreviewToViewport = useCallback((rememberInitial = false) => {
    const viewport = previewViewportRef.current;
    const image = previewImgRef.current;
    if (!viewport || !image) return;

    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;

    if (
      naturalWidth <= 0 ||
      naturalHeight <= 0 ||
      viewportWidth <= 0 ||
      viewportHeight <= 0
    ) {
      return;
    }

    const availableWidth = Math.max(viewportWidth - FIT_PADDING * 2, 1);
    const availableHeight = Math.max(viewportHeight - FIT_PADDING * 2, 1);
    const scale = clampScale(
      Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight),
    );
    const transform = {
      scale,
      x: (viewportWidth - naturalWidth * scale) / 2,
      y: (viewportHeight - naturalHeight * scale) / 2,
    };

    setPreviewImage((current) =>
      current
        ? {
            ...current,
            transform,
            initialTransform: rememberInitial
              ? transform
              : (current.initialTransform ?? transform),
          }
        : current,
    );
  }, []);

  const zoomPreviewAt = useCallback(
    (factor: number, center?: { x: number; y: number }) => {
      const viewport = previewViewportRef.current;
      if (!viewport) return;

      const viewportRect = viewport.getBoundingClientRect();
      const focalPoint = center ?? {
        x: viewportRect.width / 2,
        y: viewportRect.height / 2,
      };

      setPreviewImage((current) => {
        if (!current) return current;

        const nextScale = clampScale(current.transform.scale * factor);
        const scaleRatio = nextScale / current.transform.scale;

        return {
          ...current,
          transform: {
            scale: nextScale,
            x: focalPoint.x - (focalPoint.x - current.transform.x) * scaleRatio,
            y: focalPoint.y - (focalPoint.y - current.transform.y) * scaleRatio,
          },
        };
      });
    },
    [],
  );

  useLayoutEffect(() => {
    if (!previewImage?.dataUrl) return;

    let frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(() => {
        fitPreviewToViewport(true);
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [fitPreviewToViewport, previewImage?.dataUrl]);

  async function handleDownloadAttachment(attachment: ChatAttachment) {
    if (!attachment.storagePath) {
      toast.error("Attachment file is not available for download.");
      return;
    }

    try {
      const result = await window.codeForgeAI?.exportAttachment?.({
        storagePath: attachment.storagePath,
        name: attachment.name,
      });

      if (!result || result.cancelled) return;
      toast.success("File downloaded", { description: result.path });
    } catch (error) {
      toast.error("Failed to download file", {
        description:
          error instanceof Error ? error.message : "Unknown download error.",
      });
    }
  }

  async function handlePreviewImage(attachment: ChatAttachment) {
    if (attachment.kind !== "image") return;

    const fallbackDataUrl = attachment.thumbnailDataUrl;
    setIsDraggingPreview(false);
    previewDragRef.current = null;
    setPreviewImage({
      name: attachment.name,
      dataUrl: fallbackDataUrl ?? null,
      fallbackDataUrl,
      loading: Boolean(attachment.storagePath),
      transform: { scale: 1, x: 0, y: 0 },
    });

    if (!attachment.storagePath) {
      if (!fallbackDataUrl) {
        toast.error("Image file is not available for preview.");
      }
      return;
    }

    try {
      const dataUrl = await window.codeForgeAI?.readAttachmentDataUrl({
        storagePath: attachment.storagePath,
        mimeType: attachment.mimeType,
      });

      if (!dataUrl) throw new Error("Image preview is not available.");

      setPreviewImage((current) =>
        current
          ? {
              ...current,
              name: attachment.name,
              dataUrl,
              loading: false,
              notice: undefined,
              transform: { scale: 1, x: 0, y: 0 },
            }
          : current,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to open image preview.";

      setPreviewImage((current) => {
        if (!current) return current;

        if (current.fallbackDataUrl) {
          return {
            ...current,
            dataUrl: current.fallbackDataUrl,
            loading: false,
            notice:
              "Full image preview is unavailable. Showing thumbnail preview.",
            transform: { scale: 1, x: 0, y: 0 },
          };
        }

        return {
          ...current,
          dataUrl: null,
          loading: false,
          notice: message,
        };
      });

      toast.error(message);
    }
  }

  function closePreview() {
    previewDragRef.current = null;
    setIsDraggingPreview(false);
    setPreviewImage(null);
  }

  function restoreInitialPreviewFit() {
    setPreviewImage((current) =>
      current?.initialTransform
        ? { ...current, transform: current.initialTransform }
        : current,
    );
  }

  function handlePreviewWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!previewImage?.dataUrl) return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomPreviewAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  function handlePreviewPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!previewImage?.dataUrl || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingPreview(true);
    previewDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: previewImage.transform.x,
      startY: previewImage.transform.y,
    };
  }

  function handlePreviewPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    setPreviewImage((current) =>
      current
        ? {
            ...current,
            transform: {
              ...current.transform,
              x: drag.startX + event.clientX - drag.startClientX,
              y: drag.startY + event.clientY - drag.startClientY,
            },
          }
        : current,
    );
  }

  function finishPreviewDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (previewDragRef.current?.pointerId !== event.pointerId) return;

    previewDragRef.current = null;
    setIsDraggingPreview(false);
  }

  if (!attachments.length && !isProcessing) return null;

  const isOnPrimary = tone === "onPrimary";
  const mutedTextClassName = isOnPrimary
    ? "text-primary-foreground/75"
    : "text-muted-foreground";
  const chipClassName = isOnPrimary
    ? "border-primary-foreground/35 bg-primary-foreground/10 text-primary-foreground"
    : "border bg-muted/25";
  const actionButtonClassName = isOnPrimary
    ? "h-7 w-7 shrink-0 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
    : "h-7 w-7 shrink-0 bg-muted/40 hover:bg-muted";

  return (
    <>
      <div className={cn("max-h-36 overflow-y-auto pr-1", className)}>
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => {
            const childCount =
              attachment.kind === "archive"
                ? countArchiveChildren(attachment)
                : 0;

            return (
              <div
                key={attachment.id}
                className={cn(
                  "flex min-h-12 min-w-0 max-w-[15rem] items-center gap-2 px-2 py-1.5 text-xs",
                  chipClassName,
                  attachment.error && "border-destructive/40 bg-destructive/10",
                )}
                title={
                  attachment.available === false
                    ? `${attachment.name} (unavailable)`
                    : (attachment.error ?? attachment.name)
                }
              >
                <AttachmentIcon
                  attachment={attachment}
                  onPreview={handlePreviewImage}
                  iconClassName={mutedTextClassName}
                />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">
                    {attachment.name}
                  </span>
                  <span className={cn("truncate", mutedTextClassName)}>
                    {attachment.kind === "archive" && childCount
                      ? `${childCount} files · ${formatAttachmentSize(attachment.sizeBytes)}`
                      : formatAttachmentSize(attachment.sizeBytes)}
                  </span>
                </span>
                {attachment.available === false && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    unavailable
                  </Badge>
                )}
                {attachment.truncated && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    truncated
                  </Badge>
                )}
                {attachment.error && (
                  <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {attachment.storagePath && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={actionButtonClassName}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownloadAttachment(attachment);
                      }}
                      title="Download attachment"
                    >
                      <Download className="size-3.5" />
                    </Button>
                  )}
                  {!readOnly && onRemove && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={actionButtonClassName}
                      onClick={() => onRemove(attachment.id)}
                      title="Remove attachment"
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
          {isProcessing && (
            <div className="flex items-center gap-2 border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Processing…
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(previewImage)}
        onOpenChange={(open) => !open && closePreview()}
      >
        <DialogContent
          className="!h-[calc(100vh-16px)] !max-h-none !w-[calc(100vw-16px)] !max-w-none select-none grid-rows-[auto_1fr] overflow-hidden p-4 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 sm:!max-w-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
          }}
        >
          <DialogHeader className="pr-8">
            <DialogTitle className="truncate">
              {previewImage?.name ?? "Image preview"}
            </DialogTitle>
          </DialogHeader>

          {previewImage && (
            <div className="relative h-full min-h-0 overflow-hidden">
              {previewImage.notice && (
                <div className="absolute left-4 top-4 z-10 max-w-[calc(100%-2rem)] border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow">
                  {previewImage.notice}
                </div>
              )}

              <div
                ref={previewViewportRef}
                className={cn(
                  "relative h-full w-full overflow-hidden",
                  previewImage.dataUrl && "cursor-grab",
                  isDraggingPreview && "cursor-grabbing",
                )}
                onWheel={handlePreviewWheel}
                onPointerDown={handlePreviewPointerDown}
                onPointerMove={handlePreviewPointerMove}
                onPointerUp={finishPreviewDrag}
                onPointerCancel={finishPreviewDrag}
              >
                {previewImage.loading && !previewImage.dataUrl ? (
                  <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading preview…
                  </div>
                ) : previewImage.dataUrl ? (
                  <img
                    ref={previewImgRef}
                    src={previewImage.dataUrl}
                    alt={previewImage.name}
                    draggable={false}
                    className="absolute left-0 top-0 block max-w-none object-contain"
                    style={{
                      transform: `translate(${previewImage.transform.x}px, ${previewImage.transform.y}px) scale(${previewImage.transform.scale})`,
                      transformOrigin: "top left",
                    }}
                    onLoad={() => fitPreviewToViewport(true)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Preview is not available.
                  </div>
                )}
              </div>

              {previewImage.dataUrl && (
                <div
                  className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 border bg-background/95 px-3 py-2 shadow"
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerMove={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onWheel={(event) => event.stopPropagation()}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => zoomPreviewAt(1.2)}
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => zoomPreviewAt(1 / 1.2)}
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={restoreInitialPreviewFit}
                    title="Fit image"
                    aria-label="Fit image"
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                  <span className="min-w-12 text-right text-xs text-muted-foreground">
                    {Math.round(previewImage.transform.scale * 100)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
