import { Check, Clipboard, Download, Maximize2, Minimize2, WrapText } from "lucide-react";
import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { ReadOnlyCodeViewer } from "./code-viewer";
import {
  codeLanguageFromClassName,
  codePayload,
  filenameForLanguage,
  normalizeCodeLanguage,
} from "../core/code-rendering";
import { isExternalHttpUrl } from "../core/external-url";

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement(node)) return textFromNode((node.props as { children?: ReactNode }).children);
  return "";
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
  return codeLanguageFromClassName(props.className) ?? languageFromNode(props.children);
}

function downloadText(code: string, filename: string) {
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function CodeBlockFrame({
  code,
  language,
  wrapped,
  copied,
  fullscreen = false,
  enhancedViewer = false,
  onToggleWrapped,
  onCopy,
  onDownload,
  onToggleFullscreen,
}: {
  code: string;
  language?: string;
  wrapped: boolean;
  copied: boolean;
  fullscreen?: boolean;
  enhancedViewer?: boolean;
  onToggleWrapped: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onToggleFullscreen: () => void;
}) {
  const displayLanguage = normalizeCodeLanguage(language);
  return (
    <div className={`chat-code-block ${fullscreen ? "chat-code-block-fullscreen" : ""}`.trim()}>
      <div className="chat-code-header" data-codeblock-ui="true">
        <span className="chat-code-language" title={displayLanguage}>{displayLanguage}</span>
        <div className="chat-code-toolbar-actions" aria-label="Code block actions">
          <button className="chat-code-action" type="button" onClick={onToggleFullscreen} title={fullscreen ? "Close fullscreen" : "Open fullscreen"} aria-label={fullscreen ? "Close fullscreen" : "Open fullscreen"}>
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className={`chat-code-action ${!wrapped ? "chat-code-action-active" : ""}`} type="button" onClick={onToggleWrapped} title="Disable line wrap" aria-label="Disable line wrap" aria-pressed={!wrapped}>
            <WrapText size={14} />
          </button>
          <button className="chat-code-action" type="button" onClick={onCopy} title={copied ? "Copied" : "Copy code"} aria-label={copied ? "Copied" : "Copy code"}>
            {copied ? <Check size={14} /> : <Clipboard size={14} />}
          </button>
          <button className="chat-code-action" type="button" onClick={onDownload} title={`Download ${filenameForLanguage(language)}`} aria-label={`Download ${filenameForLanguage(language)}`}>
            <Download size={14} />
          </button>
        </div>
      </div>
      <div className="chat-code-scroll">
        <ReadOnlyCodeViewer
          code={code}
          language={language}
          wrapped={wrapped}
          lineNumbers={enhancedViewer}
          ariaLabel={enhancedViewer ? `Expanded ${displayLanguage} code block` : "Code block"}
        />
      </div>
    </div>
  );
}

export function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const rawCode = Children.toArray(children).map(textFromNode).join("");
  const code = codePayload(rawCode);
  const language = languageFromNode(children);
  const [wrapped, setWrapped] = useState(true);
  const [fullscreenWrapped, setFullscreenWrapped] = useState(true);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.warn("Failed to copy code block:", error);
    }
  }

  const regularFrame = (
    <CodeBlockFrame
      code={code}
      language={language}
      wrapped={wrapped}
      copied={copied}
      onToggleWrapped={() => setWrapped((value) => !value)}
      onCopy={() => void copy()}
      onDownload={() => downloadText(code, filenameForLanguage(language))}
      onToggleFullscreen={() => {
        setFullscreenWrapped(wrapped);
        setFullscreen(true);
      }}
    />
  );

  const fullscreenFrame = useMemo(() => fullscreen ? (
    <div className="code-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label="Code block fullscreen" onMouseDown={(event) => { if (event.target === event.currentTarget) setFullscreen(false); }}>
      <div className="code-fullscreen-surface">
        <CodeBlockFrame
          code={code}
          language={language}
          wrapped={fullscreenWrapped}
          copied={copied}
          fullscreen
          enhancedViewer
          onToggleWrapped={() => setFullscreenWrapped((value) => !value)}
          onCopy={() => void copy()}
          onDownload={() => downloadText(code, filenameForLanguage(language))}
          onToggleFullscreen={() => setFullscreen(false)}
        />
      </div>
    </div>
  ) : null, [code, copied, fullscreen, fullscreenWrapped, language]);

  return (
    <>
      {regularFrame}
      {fullscreenFrame && typeof document !== "undefined" ? createPortal(fullscreenFrame, document.body) : null}
    </>
  );
}


function MarkdownLink({ href, children, node: _node, ...props }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  const external = isExternalHttpUrl(href);

  return (
    <a
      {...props}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={(event) => {
        // Never let the embedded Tauri webview navigate away from Molten Forge.
        event.preventDefault();
        if (!external || !href) return;
        void invoke("open_external_url", { url: href }).catch((error) => {
          console.warn("Could not open external URL:", error);
        });
      }}
    >
      {children}
    </a>
  );
}

// Keep custom Markdown component identities stable across streamed content updates.
// Defining these inline in MarkdownRenderer gives React a new component type on
// every token, which remounts fenced-code children and recreates CodeMirror.
const MARKDOWN_COMPONENTS = {
  a: MarkdownLink,
  pre: ({ children }: { children?: ReactNode }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
  table: ({ children, node: _node, ...props }: ComponentPropsWithoutRef<"table"> & { node?: unknown }) => (
    <div className="markdown-table-scroll chat-message-scrollbar">
      <table {...props}>{children}</table>
    </div>
  ),
};

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
}
