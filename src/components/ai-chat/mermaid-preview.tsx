import React from "react";

import { cn } from "@/lib/utils";

type MermaidPreviewProps = {
  source: string;
  className?: string;
};

function useDocumentTheme() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  });

  React.useEffect(() => {
    const updateTheme = () => {
      setTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Failed to render Mermaid diagram.";
}

export function MermaidPreview({ source, className }: MermaidPreviewProps) {
  const reactId = React.useId();
  const theme = useDocumentTheme();
  const [svg, setSvg] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      const trimmedSource = source.trim();

      setError(undefined);
      setSvg(undefined);

      if (!trimmedSource) return;

      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        const id = `chat-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Math.random().toString(36).slice(2)}`;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
        });

        const result = await mermaid.render(id, trimmedSource);

        if (!cancelled) {
          setSvg(result.svg);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(errorMessageFromUnknown(caughtError));
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [reactId, source, theme]);

  if (error) {
    return <div className={cn("chat-code-preview-error", className)}>{error}</div>;
  }

  if (!svg) {
    return (
      <div className={cn("chat-code-preview-loading", className)}>
        Rendering Mermaid diagram...
      </div>
    );
  }

  return (
    <div
      className={cn("chat-code-mermaid-preview", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
