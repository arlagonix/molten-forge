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
import { Spinner } from "@/components/ui/spinner";
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
  messageId?: string;
  chatId?: string;
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

function classNameWithLanguage(className: string | undefined, language?: string) {
  if (!language) return className;

  const languageClass = `language-${language}`;
  const existingClassName = className?.trim();

  if (!existingClassName) return languageClass;

  const classes = existingClassName.split(/\s+/);

  if (classes.includes(languageClass)) return existingClassName;

  return [...classes, languageClass].join(" ");
}

function withSemanticCodeLanguage(
  node: ReactNode,
  language?: string,
): ReactNode {
  if (!language) return node;

  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <React.Fragment key={index}>
        {withSemanticCodeLanguage(child, language)}
      </React.Fragment>
    ));
  }

  if (!isValidElement(node)) return node;

  const props = node.props as { className?: string; children?: ReactNode };

  if (typeof node.type === "string" && node.type.toLowerCase() === "code") {
    return React.cloneElement(
      node as React.ReactElement<{
        className?: string;
        children?: ReactNode;
      }>,
      {
        className: classNameWithLanguage(props.className, language),
      },
    );
  }

  if (props.children === undefined) return node;

  return React.cloneElement(
    node as React.ReactElement<{ className?: string; children?: ReactNode }>,
    {
      children: withSemanticCodeLanguage(props.children, language),
    },
  );
}

function nodeAsElement(node: Node | null): Element | null {
  if (!node) return null;

  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as Element;
  }

  return node.parentElement;
}

function copyRangeIsInsideSingleCodeBlock(range: Range) {
  const startElement = nodeAsElement(range.startContainer);
  const endElement = nodeAsElement(range.endContainer);
  const startPre = startElement?.closest("pre.chat-code-pre[data-language]");
  const endPre = endElement?.closest("pre.chat-code-pre[data-language]");

  if (!startPre || startPre !== endPre) return null;

  return startPre as HTMLPreElement;
}

function sanitizeCopiedMarkdownHtml(container: HTMLElement) {
  container
    .querySelectorAll(
      [
        "[data-codeblock-ui='true']",
        ".chat-code-header",
        ".chat-code-toolbar-actions",
        ".chat-code-action",
      ].join(","),
    )
    .forEach((node) => node.remove());

  container.querySelectorAll("pre[data-language]").forEach((pre) => {
    const language = pre.getAttribute("data-language")?.trim();
    const code = pre.querySelector("code");

    if (!language || !code) return;

    code.className = classNameWithLanguage(code.className, language) ?? "";
  });
}

function createCodeClipboardHtml(text: string, language?: string) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");

  if (language) {
    pre.setAttribute("data-language", language);
    code.className = `language-${language}`;
  }

  code.textContent = text;
  pre.appendChild(code);

  return pre.outerHTML;
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
      <div className="chat-code-header" data-codeblock-ui="true">
        <span
          className="chat-code-language"
          title={displayLanguage}
          data-codeblock-ui="true"
        >
          {displayLanguage}
        </span>

        <div
          className="chat-code-toolbar-actions"
          aria-label="Code block actions"
          data-codeblock-ui="true"
        >
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
            interactive={isFullscreen}
          />
        </div>
      ) : (
        <CodeBlockSourceView
          wrapped={wrapped}
          className={isFullscreen ? "min-h-0 flex-1 overflow-auto" : undefined}
          language={language ? displayLanguage : undefined}
        >
          {withSemanticCodeLanguage(
            children,
            language ? displayLanguage : undefined,
          )}
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
  const [fullscreenDisplayMode, setFullscreenDisplayMode] =
    React.useState<CodeBlockDisplayMode>("code");
  const [fullscreenWrapped, setFullscreenWrapped] = React.useState(true);
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

  function openFullscreen() {
    setFullscreenDisplayMode(displayMode);
    setFullscreenWrapped(wrapped);
    setFullscreenOpen(true);
  }

  function toggleFullscreenDisplayMode() {
    setFullscreenDisplayMode((mode) =>
      mode === "preview" ? "code" : "preview",
    );
  }

  function toggleFullscreenWrapped() {
    setFullscreenWrapped((value) => !value);
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
        onFullscreenClick={openFullscreen}
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
          displayMode={fullscreenDisplayMode}
          isFullscreen
          language={language}
          payload={payload}
          suggestedFilename={suggestedFilename}
          wrapped={fullscreenWrapped}
          onCopyCode={copyCode}
          onDownloadCode={downloadCode}
          onFullscreenClick={() => setFullscreenOpen(false)}
          onToggleDisplayMode={toggleFullscreenDisplayMode}
          onToggleWrapped={toggleFullscreenWrapped}
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

const HUGE_MARKDOWN_THRESHOLD = 80_000;
const VIRTUAL_MARKDOWN_BLOCK_MAX_CHARS = 6_000;
const VIRTUAL_MARKDOWN_CODE_BLOCK_MAX_CHARS = 12_000;
const VIRTUAL_MARKDOWN_BUILD_BUDGET_MS = 6;
const VIRTUAL_MARKDOWN_OVERSCAN_PX = 900;
const VIRTUAL_MARKDOWN_BLOCK_CACHE_PREFIX =
  "chat-forge-virtual-markdown-blocks-v1";
const VIRTUAL_MARKDOWN_ANCHOR_PREFIX =
  "chat-forge-virtual-markdown-anchor-v1";

const VIRTUAL_MARKDOWN_FENCE_PATTERN = /^ {0,3}(```+|~~~+)\s*([^`~\s]*)?/;

type VirtualMarkdownBlockKind = "markdown" | "code";

type VirtualMarkdownBlock = {
  id: string;
  index: number;
  start: number;
  end: number;
  kind: VirtualMarkdownBlockKind;
  estimatedHeight: number;
  language?: string;
};

type PersistedVirtualMarkdownBlocks = {
  contentKey: string;
  blocks: VirtualMarkdownBlock[];
};

type VirtualMarkdownAnchor = {
  messageId: string;
  contentKey: string;
  blockId: string;
  offsetPx: number;
  updatedAt: number;
};

function safeStorageKey(prefix: string, id: string) {
  return `${prefix}:${encodeURIComponent(id)}`;
}

function hashShortString(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function getCheapContentKey(content: string) {
  return [
    content.length,
    hashShortString(content.slice(0, 512)),
    hashShortString(content.slice(-512)),
  ].join(":");
}

function createStableBlockId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `block-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function readPersistedVirtualMarkdownBlocks(messageId: string) {
  try {
    const stored = window.localStorage.getItem(
      safeStorageKey(VIRTUAL_MARKDOWN_BLOCK_CACHE_PREFIX, messageId),
    );
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;

    const value = parsed as Partial<PersistedVirtualMarkdownBlocks>;
    if (typeof value.contentKey !== "string" || !Array.isArray(value.blocks)) {
      return null;
    }

    const blocks = value.blocks.filter((block): block is VirtualMarkdownBlock => {
      if (!block || typeof block !== "object") return false;
      const candidate = block as Partial<VirtualMarkdownBlock>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.index === "number" &&
        typeof candidate.start === "number" &&
        typeof candidate.end === "number" &&
        (candidate.kind === "markdown" || candidate.kind === "code") &&
        typeof candidate.estimatedHeight === "number"
      );
    });

    return { contentKey: value.contentKey, blocks };
  } catch (error) {
    console.warn("Failed to read virtual Markdown block cache:", error);
    return null;
  }
}

function persistVirtualMarkdownBlocks(
  messageId: string,
  contentKey: string,
  blocks: VirtualMarkdownBlock[],
) {
  try {
    window.localStorage.setItem(
      safeStorageKey(VIRTUAL_MARKDOWN_BLOCK_CACHE_PREFIX, messageId),
      JSON.stringify({ contentKey, blocks }),
    );
  } catch (error) {
    console.warn("Failed to save virtual Markdown block cache:", error);
  }
}

function readVirtualMarkdownAnchor(chatId: string) {
  try {
    const stored = window.localStorage.getItem(
      safeStorageKey(VIRTUAL_MARKDOWN_ANCHOR_PREFIX, chatId),
    );
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;

    const anchor = parsed as Partial<VirtualMarkdownAnchor>;
    if (
      typeof anchor.messageId !== "string" ||
      typeof anchor.contentKey !== "string" ||
      typeof anchor.blockId !== "string" ||
      typeof anchor.offsetPx !== "number" ||
      typeof anchor.updatedAt !== "number"
    ) {
      return null;
    }

    return anchor as VirtualMarkdownAnchor;
  } catch (error) {
    console.warn("Failed to read virtual Markdown anchor:", error);
    return null;
  }
}

function persistVirtualMarkdownAnchor(chatId: string, anchor: VirtualMarkdownAnchor) {
  try {
    window.localStorage.setItem(
      safeStorageKey(VIRTUAL_MARKDOWN_ANCHOR_PREFIX, chatId),
      JSON.stringify(anchor),
    );
  } catch (error) {
    console.warn("Failed to save virtual Markdown anchor:", error);
  }
}

function estimateVirtualMarkdownBlockHeight(
  contentLength: number,
  kind: VirtualMarkdownBlockKind,
) {
  const lineHeight = kind === "code" ? 20 : 24;
  const charsPerLine = kind === "code" ? 96 : 88;
  const estimatedLines = Math.max(1, Math.ceil(contentLength / charsPerLine));

  return Math.max(32, estimatedLines * lineHeight + 18);
}

function findScrollParent(element: HTMLElement | null): HTMLElement | Window {
  let current = element?.parentElement ?? null;

  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;

    if (overflowY === "auto" || overflowY === "scroll") {
      return current;
    }

    current = current.parentElement;
  }

  return window;
}

function getScrollTop(scrollParent: HTMLElement | Window) {
  return scrollParent instanceof Window
    ? window.scrollY
    : scrollParent.scrollTop;
}

function setScrollTop(scrollParent: HTMLElement | Window, value: number) {
  if (scrollParent instanceof Window) {
    window.scrollTo({ top: value });
    return;
  }

  scrollParent.scrollTop = value;
}

function getScrollClientHeight(scrollParent: HTMLElement | Window) {
  return scrollParent instanceof Window
    ? window.innerHeight
    : scrollParent.clientHeight;
}

function getElementOffsetInsideScrollParent(
  element: HTMLElement,
  scrollParent: HTMLElement | Window,
) {
  const elementRect = element.getBoundingClientRect();

  if (scrollParent instanceof Window) {
    return elementRect.top + window.scrollY;
  }

  const parentRect = scrollParent.getBoundingClientRect();
  return elementRect.top - parentRect.top + scrollParent.scrollTop;
}

function findBlockIndexForOffset(offsets: number[], offset: number) {
  if (offsets.length <= 1) return 0;

  let low = 0;
  let high = offsets.length - 2;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = offsets[middle];
    const end = offsets[middle + 1];

    if (offset < start) {
      high = middle - 1;
    } else if (offset >= end) {
      low = middle + 1;
    } else {
      return middle;
    }
  }

  return Math.max(0, Math.min(offsets.length - 2, low));
}

function parseFencedCodeBlock(content: string, fallbackLanguage?: string) {
  const firstLineEnd = content.indexOf("\n");
  const firstLine = firstLineEnd >= 0 ? content.slice(0, firstLineEnd) : content;
  const openMatch = firstLine.match(VIRTUAL_MARKDOWN_FENCE_PATTERN);

  if (!openMatch) {
    return { language: fallbackLanguage, code: content };
  }

  const fence = openMatch[1];
  const language = openMatch[2]?.trim() || fallbackLanguage;
  let code = firstLineEnd >= 0 ? content.slice(firstLineEnd + 1) : "";
  const lines = code.split("\n");
  const lastLine = lines.at(-1) ?? "";
  const closingPattern = new RegExp(
    `^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`,
  );

  if (closingPattern.test(lastLine)) {
    lines.pop();
    code = lines.join("\n");
  }

  return { language, code };
}

function MarkdownRenderer({
  content,
  skipSyntaxHighlight = false,
}: {
  content: string;
  skipSyntaxHighlight?: boolean;
}) {
  return (
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
  );
}

function PlainCodeBlock({
  content,
  language,
}: {
  content: string;
  language?: string;
}) {
  const parsed = parseFencedCodeBlock(content, language);

  return (
    <div className="chat-code-block">
      <div className="chat-code-header" data-codeblock-ui="true">
        <span className="chat-code-language" data-codeblock-ui="true">
          {parsed.language || "text"}
        </span>
      </div>
      <pre
        className="chat-code-pre chat-code-pre-wrap"
        data-language={parsed.language || undefined}
      >
        <code>{parsed.code}</code>
      </pre>
    </div>
  );
}

function VirtualMarkdownBlockView({
  block,
  content,
  skipSyntaxHighlight,
}: {
  block: VirtualMarkdownBlock;
  content: string;
  skipSyntaxHighlight: boolean;
}) {
  const blockContent = content.slice(block.start, block.end);

  if (block.kind === "code") {
    return <PlainCodeBlock content={blockContent} language={block.language} />;
  }

  return (
    <MarkdownRenderer
      content={blockContent}
      skipSyntaxHighlight={skipSyntaxHighlight}
    />
  );
}

function buildCachedBlockLookup(blocks: VirtualMarkdownBlock[] | null) {
  if (!blocks?.length) return new Map<string, VirtualMarkdownBlock>();

  return new Map(
    blocks.map((block) => [
      `${block.start}:${block.end}:${block.kind}:${block.language ?? ""}`,
      block,
    ]),
  );
}

function createVirtualMarkdownBlocksBuilder({
  content,
  cachedBlocks,
  onBatch,
  onComplete,
}: {
  content: string;
  cachedBlocks: VirtualMarkdownBlock[] | null;
  onBatch: (blocks: VirtualMarkdownBlock[]) => void;
  onComplete: (blocks: VirtualMarkdownBlock[]) => void;
}) {
  const cachedByPosition = buildCachedBlockLookup(cachedBlocks);
  const blocks: VirtualMarkdownBlock[] = [];
  let offset = 0;
  let blockStart = 0;
  let inFence = false;
  let fenceChar = "`";
  let fenceLength = 3;
  let fenceLanguage: string | undefined;

  function createBlock(
    start: number,
    end: number,
    kind: VirtualMarkdownBlockKind,
    language?: string,
  ) {
    if (end <= start) return;

    const cacheKey = `${start}:${end}:${kind}:${language ?? ""}`;
    const cached = cachedByPosition.get(cacheKey);
    const block: VirtualMarkdownBlock = {
      id: cached?.id ?? createStableBlockId(),
      index: blocks.length,
      start,
      end,
      kind,
      language,
      estimatedHeight:
        cached?.estimatedHeight ?? estimateVirtualMarkdownBlockHeight(end - start, kind),
    };

    blocks.push(block);
  }

  function shouldCloseFence(line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(fenceChar.repeat(fenceLength))) return false;

    for (let index = 0; index < trimmed.length; index += 1) {
      if (trimmed[index] !== fenceChar) {
        return trimmed.slice(index).trim().length === 0;
      }
    }

    return true;
  }

  return function runBatch() {
    const startedAt = performance.now();

    while (offset < content.length) {
      const nextNewline = content.indexOf("\n", offset);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline + 1;
      const line = content.slice(offset, lineEnd);
      const trimmed = line.trim();
      const fenceMatch = line.match(VIRTUAL_MARKDOWN_FENCE_PATTERN);

      if (!inFence && fenceMatch) {
        if (offset > blockStart) {
          createBlock(blockStart, offset, "markdown");
          blockStart = offset;
        }

        inFence = true;
        fenceChar = fenceMatch[1][0];
        fenceLength = fenceMatch[1].length;
        fenceLanguage = fenceMatch[2]?.trim() || undefined;
      }

      offset = lineEnd;

      if (inFence) {
        const codeBlockIsTooLarge =
          offset - blockStart >= VIRTUAL_MARKDOWN_CODE_BLOCK_MAX_CHARS;
        const closesFence = shouldCloseFence(line) && offset > blockStart + line.length;

        if (closesFence || codeBlockIsTooLarge) {
          createBlock(blockStart, offset, "code", fenceLanguage);
          blockStart = offset;
          if (closesFence) {
            inFence = false;
            fenceLanguage = undefined;
          }
        }
      } else if (
        (trimmed.length === 0 && offset > blockStart) ||
        offset - blockStart >= VIRTUAL_MARKDOWN_BLOCK_MAX_CHARS
      ) {
        createBlock(blockStart, offset, "markdown");
        blockStart = offset;
      }

      if (performance.now() - startedAt >= VIRTUAL_MARKDOWN_BUILD_BUDGET_MS) {
        onBatch([...blocks]);
        return false;
      }
    }

    if (blockStart < content.length) {
      createBlock(blockStart, content.length, inFence ? "code" : "markdown", fenceLanguage);
    }

    onBatch([...blocks]);
    onComplete(blocks);
    return true;
  };
}

function VirtualizedMarkdownMessage({
  content,
  className,
  messageId,
  chatId,
  skipSyntaxHighlight,
  onCopy,
}: {
  content: string;
  className?: string;
  messageId: string;
  chatId?: string;
  skipSyntaxHighlight: boolean;
  onCopy: (event: React.ClipboardEvent<HTMLDivElement>) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const restoreAttemptedRef = React.useRef(false);
  const saveAnchorTimeoutRef = React.useRef<number | null>(null);
  const contentKey = React.useMemo(() => getCheapContentKey(content), [content]);
  const cachedBlocks = React.useMemo(() => {
    const cached = readPersistedVirtualMarkdownBlocks(messageId);
    return cached?.contentKey === contentKey ? cached.blocks : null;
  }, [contentKey, messageId]);
  const [blocks, setBlocks] = React.useState<VirtualMarkdownBlock[]>(
    () => cachedBlocks ?? [],
  );
  const [isBuilding, setIsBuilding] = React.useState(() => !cachedBlocks);
  const [viewport, setViewport] = React.useState({ top: 0, bottom: 0 });
  const [measuredHeights, setMeasuredHeights] = React.useState<
    Record<string, number>
  >({});

  React.useEffect(() => {
    restoreAttemptedRef.current = false;
    setMeasuredHeights({});

    if (cachedBlocks) {
      setBlocks(cachedBlocks);
      setIsBuilding(false);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    setBlocks([]);
    setIsBuilding(true);

    const runBatch = createVirtualMarkdownBlocksBuilder({
      content,
      cachedBlocks: null,
      onBatch: (nextBlocks) => {
        if (!cancelled) setBlocks(nextBlocks);
      },
      onComplete: (finalBlocks) => {
        if (cancelled) return;
        setIsBuilding(false);
        persistVirtualMarkdownBlocks(messageId, contentKey, finalBlocks);
      },
    });

    const schedule = () => {
      timer = window.setTimeout(() => {
        timer = null;
        if (cancelled) return;
        const done = runBatch();
        if (!done) schedule();
      }, 0);
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [cachedBlocks, content, contentKey, messageId]);

  const offsets = React.useMemo(() => {
    const nextOffsets = [0];

    for (const block of blocks) {
      nextOffsets.push(
        nextOffsets[nextOffsets.length - 1] +
          (measuredHeights[block.id] ?? block.estimatedHeight),
      );
    }

    return nextOffsets;
  }, [blocks, measuredHeights]);

  const totalHeight = offsets[offsets.length - 1] ?? 0;

  const updateViewport = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const scrollParent = findScrollParent(root);
    const rootOffset = getElementOffsetInsideScrollParent(root, scrollParent);
    const localTop = getScrollTop(scrollParent) - rootOffset;
    const clientHeight = getScrollClientHeight(scrollParent);

    setViewport({
      top: Math.max(0, localTop - VIRTUAL_MARKDOWN_OVERSCAN_PX),
      bottom: Math.min(
        Math.max(totalHeight, clientHeight),
        localTop + clientHeight + VIRTUAL_MARKDOWN_OVERSCAN_PX,
      ),
    });
  }, [totalHeight]);

  React.useLayoutEffect(() => {
    updateViewport();
  }, [updateViewport]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scrollParent = findScrollParent(root);
    let frame: number | null = null;

    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateViewport();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(root);
    if (!(scrollParent instanceof Window)) {
      resizeObserver.observe(scrollParent);
      scrollParent.addEventListener("scroll", scheduleUpdate, { passive: true });
    } else {
      window.addEventListener("scroll", scheduleUpdate, { passive: true });
      window.addEventListener("resize", scheduleUpdate);
    }

    scheduleUpdate();

    return () => {
      resizeObserver.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (!(scrollParent instanceof Window)) {
        scrollParent.removeEventListener("scroll", scheduleUpdate);
      } else {
        window.removeEventListener("scroll", scheduleUpdate);
        window.removeEventListener("resize", scheduleUpdate);
      }
    };
  }, [updateViewport]);

  React.useEffect(() => {
    if (!chatId || restoreAttemptedRef.current || blocks.length === 0) return;

    const anchor = readVirtualMarkdownAnchor(chatId);
    if (
      !anchor ||
      anchor.messageId !== messageId ||
      anchor.contentKey !== contentKey
    ) {
      restoreAttemptedRef.current = true;
      return;
    }

    const blockIndex = blocks.findIndex((block) => block.id === anchor.blockId);
    if (blockIndex < 0) return;

    restoreAttemptedRef.current = true;

    window.requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;

      const scrollParent = findScrollParent(root);
      const rootOffset = getElementOffsetInsideScrollParent(root, scrollParent);
      setScrollTop(scrollParent, rootOffset + offsets[blockIndex] + anchor.offsetPx);
      updateViewport();
    });
  }, [blocks, chatId, contentKey, messageId, offsets, updateViewport]);

  React.useEffect(() => {
    if (!chatId || blocks.length === 0) return;

    const root = rootRef.current;
    if (!root) return;

    const scrollParent = findScrollParent(root);
    const rootOffset = getElementOffsetInsideScrollParent(root, scrollParent);
    const scrollTop = getScrollTop(scrollParent);
    const clientHeight = getScrollClientHeight(scrollParent);

    if (scrollTop + clientHeight < rootOffset || scrollTop > rootOffset + totalHeight) {
      return;
    }

    const localTop = Math.max(0, scrollTop - rootOffset);
    const blockIndex = findBlockIndexForOffset(offsets, localTop);
    const block = blocks[blockIndex];
    if (!block) return;

    if (saveAnchorTimeoutRef.current !== null) {
      window.clearTimeout(saveAnchorTimeoutRef.current);
    }

    saveAnchorTimeoutRef.current = window.setTimeout(() => {
      saveAnchorTimeoutRef.current = null;
      persistVirtualMarkdownAnchor(chatId, {
        messageId,
        contentKey,
        blockId: block.id,
        offsetPx: Math.max(0, localTop - offsets[blockIndex]),
        updatedAt: Date.now(),
      });
    }, 200);

    return () => {
      if (saveAnchorTimeoutRef.current !== null) {
        window.clearTimeout(saveAnchorTimeoutRef.current);
        saveAnchorTimeoutRef.current = null;
      }
    };
  }, [blocks, chatId, contentKey, messageId, offsets, totalHeight, viewport.top]);

  const startIndex = Math.max(0, findBlockIndexForOffset(offsets, viewport.top));
  const endIndex = Math.min(
    blocks.length - 1,
    findBlockIndexForOffset(offsets, viewport.bottom),
  );
  const visibleBlocks =
    blocks.length === 0 || endIndex < startIndex
      ? []
      : blocks.slice(startIndex, endIndex + 1);

  const measureBlock = React.useCallback(
    (block: VirtualMarkdownBlock) => (element: HTMLDivElement | null) => {
      if (!element) return;

      const measuredHeight = Math.ceil(element.getBoundingClientRect().height);
      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return;

      setMeasuredHeights((currentHeights) => {
        if (Math.abs((currentHeights[block.id] ?? 0) - measuredHeight) < 2) {
          return currentHeights;
        }

        return { ...currentHeights, [block.id]: measuredHeight };
      });
    },
    [],
  );

  return (
    <div
      ref={rootRef}
      className={cn("chat-markdown w-full min-w-0 max-w-full", className)}
      onCopy={onCopy}
      data-virtual-markdown-message-id={messageId}
    >
      {blocks.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center text-muted-foreground">
          <Spinner className="size-10" />
        </div>
      ) : (
        <div className="relative w-full" style={{ height: Math.max(1, totalHeight) }}>
          {visibleBlocks.map((block) => (
            <div
              key={block.id}
              ref={measureBlock(block)}
              className="absolute left-0 w-full"
              style={{ transform: `translateY(${offsets[block.index]}px)` }}
              data-markdown-block-id={block.id}
              data-markdown-block-index={block.index}
            >
              <VirtualMarkdownBlockView
                block={block}
                content={content}
                skipSyntaxHighlight={skipSyntaxHighlight || block.kind === "code"}
              />
            </div>
          ))}
        </div>
      )}
      {isBuilding && blocks.length > 0 ? (
        <div className="flex justify-center py-3 text-muted-foreground">
          <Spinner className="size-5" />
        </div>
      ) : null}
    </div>
  );
}

export const MarkdownMessage = React.memo(function MarkdownMessage({
  content,
  className,
  messageId,
  chatId,
  skipSyntaxHighlight = false,
}: MarkdownMessageProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const handleCopy = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      const selection = window.getSelection();

      if (!root || !selection || selection.rangeCount === 0) return;
      if (selection.isCollapsed) return;

      const range = selection.getRangeAt(0);

      if (!root.contains(range.commonAncestorContainer)) return;

      const codePre = copyRangeIsInsideSingleCodeBlock(range);
      const selectedText = selection.toString();
      let html: string;
      let plainText = selectedText;

      if (codePre) {
        const language = codePre.getAttribute("data-language")?.trim();
        html = createCodeClipboardHtml(selectedText, language || undefined);
      } else {
        const container = document.createElement("div");
        container.appendChild(range.cloneContents());
        sanitizeCopiedMarkdownHtml(container);
        html = container.innerHTML;
        plainText = container.textContent ?? selectedText;
      }

      event.preventDefault();
      event.clipboardData.setData("text/plain", plainText);

      if (html.trim()) {
        event.clipboardData.setData("text/html", html);
      }
    },
    [],
  );

  const shouldVirtualize =
    Boolean(messageId) &&
    !skipSyntaxHighlight &&
    content.length >= HUGE_MARKDOWN_THRESHOLD;

  if (shouldVirtualize && messageId) {
    return (
      <VirtualizedMarkdownMessage
        content={content}
        className={className}
        messageId={messageId}
        chatId={chatId}
        skipSyntaxHighlight={skipSyntaxHighlight}
        onCopy={handleCopy}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn("chat-markdown w-full min-w-0 max-w-full", className)}
      onCopy={handleCopy}
    >
      <MarkdownRenderer
        content={content}
        skipSyntaxHighlight={skipSyntaxHighlight}
      />
    </div>
  );
});
