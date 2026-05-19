"use client";

import { Check, Clipboard, Download, WrapText } from "lucide-react";
import React, { isValidElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MarkdownMessageProps = {
  content: string;
  className?: string;
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

function CodeBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const [wrapped, setWrapped] = React.useState(true);
  const code = React.Children.toArray(children).map(textFromNode).join("");
  const language = languageFromNode(children);
  const displayLanguage = normalizeCodeLanguage(language);
  const payload = codePayload(code);
  const suggestedFilename = filenameForLanguage(language);

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

  return (
    <div className={cn("chat-code-block", className)}>
      <div className="chat-code-header">
        <span className="chat-code-language" title={displayLanguage}>
          {displayLanguage}
        </span>

        <div className="chat-code-toolbar-actions" aria-label="Code block actions">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className={cn(
              "chat-code-action",
              wrapped && "chat-code-action-active",
            )}
            onClick={() => setWrapped((value) => !value)}
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
            onClick={copyCode}
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
            onClick={downloadCode}
            title={`Download ${suggestedFilename}`}
            aria-label={`Download ${suggestedFilename}`}
          >
            <Download className="size-3.5" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "chat-code-scroll",
          wrapped ? "chat-code-scroll-wrap" : "chat-code-scroll-nowrap",
        )}
      >
        <pre
          className={cn(
            "chat-code-pre",
            wrapped ? "chat-code-pre-wrap" : "chat-code-pre-nowrap",
          )}
        >
          {children}
        </pre>
      </div>
    </div>
  );
}

export function MarkdownMessage({ content, className }: MarkdownMessageProps) {
  return (
    <div className={cn("chat-markdown min-w-0 max-w-full", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, SAFE_HTML_SCHEMA],
          rehypeKatex,
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={{
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
        }}
      >
        {normalizeMarkdownContent(content)}
      </ReactMarkdown>
    </div>
  );
}
