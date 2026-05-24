"use client";

import {
  Check,
  Clipboard,
  Code2,
  Download,
  Eye,
  Maximize2,
  Minimize2,
  WrapText,
} from "lucide-react";
import React, { isValidElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

import {
  CodeBlockDisplayMode,
  CodeBlockPreviewDialog,
  CodeBlockSourceView,
  RenderablePreview,
} from "@/components/ai-chat/code-block-preview-dialog";
import { Button } from "@/components/ui/button";
import { isRenderableCodeBlock } from "@/lib/ai-chat/renderable-code-blocks";
import { cn } from "@/lib/utils";

type MarkdownMessageProps = {
  content: string;
  className?: string;
  skipSyntaxHighlight?: boolean;
};

const SAFE_HTML_SCHEMA = {
  tagNames: [
    "a",
    "b",
    "blockquote",
    "br",
    "caption",
    "code",
    "col",
    "colgroup",
    "del",
    "details",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "input",
    "ins",
    "kbd",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
  ],
  attributes: {
    a: ["href", "title"],
    code: [["className", /^language-./, "math-inline", "math-display"]],
    col: ["span"],
    colgroup: ["span"],
    details: ["open"],
    input: [
      ["type", "checkbox"],
      ["checked", true],
      ["disabled", true],
    ],
    ol: ["start", "reversed", "type"],
    td: ["abbr", "align", "colSpan", "headers", "rowSpan"],
    th: ["abbr", "align", "colSpan", "headers", "rowSpan", "scope"],
  },
  protocols: {
    href: ["http", "https", "irc", "ircs", "mailto", "xmpp"],
  },
  clobberPrefix: "chat-html-",
};

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "bash",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  cs: "csharp",
  css: "css",
  csv: "csv",
  dart: "dart",
  dockerfile: "dockerfile",
  go: "go",
  html: "html",
  mermaid: "mermaid",
  mmd: "mermaid",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kotlin: "kotlin",
  kt: "kotlin",
  markdown: "markdown",
  md: "markdown",
  php: "php",
  powershell: "powershell",
  ps1: "powershell",
  python: "python",
  py: "python",
  rb: "ruby",
  ruby: "ruby",
  rust: "rust",
  rs: "rust",
  scala: "scala",
  sh: "shell",
  shell: "shell",
  sql: "sql",
  swift: "swift",
  text: "text",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  typescript: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "zsh",
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  css: "css",
  csv: "csv",
  dart: "dart",
  dockerfile: "Dockerfile",
  go: "go",
  html: "html",
  mermaid: "mmd",
  mmd: "mmd",
  java: "java",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "jsx",
  kotlin: "kt",
  kt: "kt",
  markdown: "md",
  md: "md",
  php: "php",
  powershell: "ps1",
  python: "py",
  py: "py",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  sh: "sh",
  sql: "sql",
  swift: "swift",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  xml: "xml",
  yaml: "yaml",
  yml: "yml",
  zsh: "sh",
};

function normalizeMarkdownContent(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/^\n+/, "");
  const lines = normalized.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

  if (nonEmptyLines.length === 0) return normalized;

  const indents = nonEmptyLines.map(
    (line) => line.match(/^ */)?.[0].length ?? 0,
  );
  const smallestIndent = Math.min(...indents);

  if (smallestIndent < 4) return normalized;

  return lines.map((line) => line.slice(smallestIndent)).join("\n");
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(textFromNode).join("");
  }

  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return textFromNode(props.children);
  }

  return "";
}

function codePayload(code: string) {
  return code.replace(/\n$/, "");
}

function normalizeCodeLanguage(language?: string) {
  const normalized = language?.trim().toLowerCase();

  if (!normalized) return "text";

  return LANGUAGE_LABELS[normalized] ?? normalized;
}

function filenameForLanguage(language?: string) {
  if (!language) return "file.txt";

  const normalized = language.toLowerCase();
  const extension = LANGUAGE_EXTENSIONS[normalized];

  if (!extension) return "file.txt";
  if (extension === "Dockerfile") return "Dockerfile";

  return `file.${extension}`;
}

function languageFromNode(node: ReactNode): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const language = languageFromNode(child);
      if (language) return language;
    }
  }

  if (!isValidElement(node)) return undefined;

  const props = node.props as { className?: string; children?: ReactNode };
  const languageClass = props.className
    ?.split(/\s+/)
    .find((value) => value.startsWith("language-"));

  if (languageClass) return languageClass.replace("language-", "");

  return languageFromNode(props.children);
}

type CodeBlockFrameProps = {
  children: ReactNode;
  className?: string;
  copied: boolean;
  canPreview: boolean;
  displayLanguage: string;
  displayMode: CodeBlockDisplayMode;
  isFullscreen?: boolean;
  language?: string;
  payload: string;
  suggestedFilename: string;
  wrapped: boolean;
  onCopyCode: () => void;
  onDownloadCode: () => void;
  onFullscreenClick: () => void;
  onToggleDisplayMode: () => void;
  onToggleWrapped: () => void;
};

function CodeBlockFrame({
  children,
  className,
  copied,
  canPreview,
  displayLanguage,
  displayMode,
  isFullscreen = false,
  language,
  payload,
  suggestedFilename,
  wrapped,
  onCopyCode,
  onDownloadCode,
  onFullscreenClick,
  onToggleDisplayMode,
  onToggleWrapped,
}: CodeBlockFrameProps) {
  return (
    <div
      className={cn(
        "chat-code-block",
        isFullscreen && "chat-code-block-fullscreen",
        className,
      )}
    >
      <div className="chat-code-header">
        <span className="chat-code-language" title={displayLanguage}>
          {displayLanguage}
        </span>

        <div className="chat-code-toolbar-actions" aria-label="Code block actions">
          {canPreview ? (
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="chat-code-action"
              onClick={onToggleDisplayMode}
              title={displayMode === "preview" ? "Show code" : "Show preview"}
              aria-label={
                displayMode === "preview" ? "Show code" : "Show preview"
              }
            >
              {displayMode === "preview" ? (
                <Code2 className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="chat-code-action"
            onClick={onFullscreenClick}
            title={isFullscreen ? "Close fullscreen" : "Open fullscreen"}
            aria-label={isFullscreen ? "Close fullscreen" : "Open fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className={cn(
              "chat-code-action",
              wrapped && "chat-code-action-active",
            )}
            onClick={onToggleWrapped}
            title={wrapped ? "Disable line wrap" : "Enable line wrap"}
            aria-label={wrapped ? "Disable line wrap" : "Enable line wrap"}
            aria-pressed={wrapped}
          >
            <WrapText className="size-3.5" />
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="chat-code-action"
            onClick={onCopyCode}
            title={copied ? "Copied" : "Copy code"}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Clipboard className="size-3.5" />
            )}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="chat-code-action"
            onClick={onDownloadCode}
            title={`Download ${suggestedFilename}`}
            aria-label={`Download ${suggestedFilename}`}
          >
            <Download className="size-3.5" />
          </Button>
        </div>
      </div>

      {displayMode === "preview" && canPreview ? (
        <div
          className={cn(
            "chat-code-preview",
            isFullscreen && "chat-code-preview-fullscreen",
          )}
        >
          <RenderablePreview
            source={payload}
            language={language}
            className={isFullscreen ? "h-full min-h-0" : undefined}
          />
        </div>
      ) : (
        <CodeBlockSourceView
          wrapped={wrapped}
          className={isFullscreen ? "min-h-0 flex-1 overflow-auto" : undefined}
        >
          {children}
        </CodeBlockSourceView>
      )}
    </div>
  );
}

function CodeBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const [wrapped, setWrapped] = React.useState(true);
  const [displayMode, setDisplayMode] = React.useState<CodeBlockDisplayMode>("code");
  const [fullscreenOpen, setFullscreenOpen] = React.useState(false);
  const code = React.Children.toArray(children).map(textFromNode).join("");
  const language = languageFromNode(children);
  const displayLanguage = normalizeCodeLanguage(language);
  const payload = codePayload(code);
  const suggestedFilename = filenameForLanguage(language);
  const canPreview = isRenderableCodeBlock(language);

  async function copyCode() {
    if (!payload) return;

    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  function downloadCode() {
    if (!payload) return;

    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = suggestedFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function toggleDisplayMode() {
    setDisplayMode((mode) => (mode === "preview" ? "code" : "preview"));
  }

  function toggleWrapped() {
    setWrapped((value) => !value);
  }

  return (
    <>
      <CodeBlockFrame
        className={className}
        copied={copied}
        canPreview={canPreview}
        displayLanguage={displayLanguage}
        displayMode={displayMode}
        language={language}
        payload={payload}
        suggestedFilename={suggestedFilename}
        wrapped={wrapped}
        onCopyCode={copyCode}
        onDownloadCode={downloadCode}
        onFullscreenClick={() => setFullscreenOpen(true)}
        onToggleDisplayMode={toggleDisplayMode}
        onToggleWrapped={toggleWrapped}
      >
        {children}
      </CodeBlockFrame>

      <CodeBlockPreviewDialog
        open={fullscreenOpen}
        onOpenChange={setFullscreenOpen}
      >
        <CodeBlockFrame
          copied={copied}
          canPreview={canPreview}
          displayLanguage={displayLanguage}
          displayMode={displayMode}
          isFullscreen
          language={language}
          payload={payload}
          suggestedFilename={suggestedFilename}
          wrapped={wrapped}
          onCopyCode={copyCode}
          onDownloadCode={downloadCode}
          onFullscreenClick={() => setFullscreenOpen(false)}
          onToggleDisplayMode={toggleDisplayMode}
          onToggleWrapped={toggleWrapped}
        >
          {children}
        </CodeBlockFrame>
      </CodeBlockPreviewDialog>
    </>
  );
}

const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];

const REHYPE_PLUGINS_WITH_HIGHLIGHT: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, SAFE_HTML_SCHEMA],
  rehypeKatex,
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];

const REHYPE_PLUGINS_WITHOUT_HIGHLIGHT: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, SAFE_HTML_SCHEMA],
  rehypeKatex,
];

const MARKDOWN_COMPONENTS: Components = {
  a: ({ className, ...props }) => (
    <a
      className={cn("underline underline-offset-4", className)}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  code: ({ className, children, ...props }) => (
    <code className={cn(className)} {...props}>
      {children}
    </code>
  ),
  pre: ({ className, children }) => (
    <CodeBlock className={className}>{children}</CodeBlock>
  ),
};

export const MarkdownMessage = React.memo(function MarkdownMessage({
  content,
  className,
  skipSyntaxHighlight = false,
}: MarkdownMessageProps) {
  return (
    <div className={cn("chat-markdown w-full min-w-0 max-w-full", className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={
          skipSyntaxHighlight
            ? REHYPE_PLUGINS_WITHOUT_HIGHLIGHT
            : REHYPE_PLUGINS_WITH_HIGHLIGHT
        }
        components={MARKDOWN_COMPONENTS}
      >
        {normalizeMarkdownContent(content)}
      </ReactMarkdown>
    </div>
  );
});
