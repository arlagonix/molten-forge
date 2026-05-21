import React from "react";

import {
  buildHtmlPreviewDocument,
  sanitizeHtmlPreviewSource,
} from "@/lib/ai-chat/html-sanitize";
import { cn } from "@/lib/utils";

type HtmlPreviewProps = {
  source: string;
  className?: string;
};

export function HtmlPreview({ source, className }: HtmlPreviewProps) {
  const [srcDoc, setSrcDoc] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    let cancelled = false;

    async function sanitize() {
      setError(undefined);
      setSrcDoc(undefined);

      try {
        const sanitizedHtml = await sanitizeHtmlPreviewSource(source);
        if (!cancelled) {
          setSrcDoc(buildHtmlPreviewDocument(sanitizedHtml));
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Failed to render HTML preview.",
          );
        }
      }
    }

    void sanitize();

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className={cn("chat-code-preview-error", className)}>{error}</div>
    );
  }

  if (!srcDoc) {
    return (
      <div className={cn("chat-code-preview-loading", className)}>
        Preparing HTML preview...
      </div>
    );
  }

  return (
    <div className={cn("chat-code-html-preview", className)}>
      <iframe
        sandbox=""
        srcDoc={srcDoc}
        title="HTML preview"
        className="chat-code-html-preview-frame"
      />
    </div>
  );
}
