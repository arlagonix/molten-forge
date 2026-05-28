import { ReactNode } from "react";

import { HtmlPreview } from "@/components/ai-chat/html-preview";
import { MarkdownPreview } from "@/components/ai-chat/markdown-preview";
import { MermaidPreview } from "@/components/ai-chat/mermaid-preview";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { getRenderableCodeBlockKind } from "@/lib/ai-chat/renderable-code-blocks";
import { cn } from "@/lib/utils";

export type CodeBlockDisplayMode = "code" | "preview";

type RenderablePreviewProps = {
  source: string;
  language?: string;
  className?: string;
  interactive?: boolean;
};

type CodeBlockSourceViewProps = {
  children: ReactNode;
  wrapped: boolean;
  className?: string;
  language?: string;
};

type CodeBlockPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export function RenderablePreview({
  source,
  language,
  className,
  interactive = false,
}: RenderablePreviewProps) {
  const kind = getRenderableCodeBlockKind(language);

  if (kind === "mermaid") {
    return (
      <MermaidPreview
        source={source}
        className={className}
        interactive={interactive}
      />
    );
  }

  if (kind === "html") {
    return <HtmlPreview source={source} className={className} />;
  }

  if (kind === "markdown") {
    return <MarkdownPreview source={source} className={className} />;
  }

  return (
    <div className={cn("chat-code-preview-error", className)}>
      Preview is not available for this code block.
    </div>
  );
}

export function CodeBlockSourceView({
  children,
  wrapped,
  className,
  language,
}: CodeBlockSourceViewProps) {
  return (
    <div
      className={cn(
        "chat-code-scroll",
        wrapped ? "chat-code-scroll-wrap" : "chat-code-scroll-nowrap",
        className,
      )}
    >
      <pre
        className={cn(
          "chat-code-pre",
          wrapped ? "chat-code-pre-wrap" : "chat-code-pre-nowrap",
        )}
        data-language={language || undefined}
      >
        {children}
      </pre>
    </div>
  );
}

export function CodeBlockPreviewDialog({
  open,
  onOpenChange,
  children,
}: CodeBlockPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle className="sr-only">Code block fullscreen</DialogTitle>
      <DialogDescription className="sr-only">
        Fullscreen code block viewer with code, preview, wrap, copy, and
        download actions.
      </DialogDescription>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-h-none max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(70vw,1440px)] data-[state=closed]:animate-none data-[state=closed]:opacity-0"
      >
        <div className="chat-markdown h-full min-h-0 overflow-hidden">
          {open ? children : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
