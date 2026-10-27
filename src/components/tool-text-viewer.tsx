import { useMemo } from "react";
import {
  detectToolTextLanguage,
  toolTextViewerDecision,
  type ToolTextViewerDecision,
} from "../core/tool-text";
import { ReadOnlyCodeViewer } from "./code-viewer";

type ToolTextViewerProps = {
  text: string;
  toolName: string;
  args?: unknown;
  filePath?: string;
  language?: string;
  lineNumbers?: boolean;
  lineNumberStart?: number;
  ariaLabel?: string;
  className?: string;
};

export function ToolTextViewer({
  text,
  toolName,
  args,
  filePath,
  language,
  lineNumbers,
  lineNumberStart,
  ariaLabel = "Tool text output",
  className,
}: ToolTextViewerProps) {
  const detected = useMemo(
    () => language
      ? { language, source: "explicit" as const }
      : detectToolTextLanguage({ toolName, args, text, filePath }),
    [args, filePath, language, text, toolName],
  );

  return (
    <div
      className={`tool-text-viewer ${className ?? ""}`.trim()}
      data-language={detected.language}
      data-language-source={detected.source}
    >
      <ReadOnlyCodeViewer
        code={text}
        language={detected.language}
        wrapped
        syntaxHighlight
        className="tool-text-code-viewer"
        ariaLabel={ariaLabel}
        lineNumbers={lineNumbers}
        lineNumberStart={lineNumberStart}
      />
    </div>
  );
}

export function ToolOutputContent({
  text,
  toolName,
  args,
  decision,
}: {
  text: string;
  toolName: string;
  args?: unknown;
  decision?: ToolTextViewerDecision;
}) {
  const resolved = decision ?? toolTextViewerDecision({ toolName, args, text });
  if (!resolved.useViewer) return <pre>{text}</pre>;

  const isRead = /^(read|read_file)$/i.test(toolName.trim());

  return (
    <ToolTextViewer
      text={text}
      toolName={toolName}
      args={args}
      filePath={resolved.filePath}
      lineNumbers={resolved.lineNumbers}
      lineNumberStart={resolved.lineNumberStart}
      ariaLabel={`${toolName || "Tool"} output`}
      className={isRead ? "tool-text-viewer-read" : undefined}
    />
  );
}
