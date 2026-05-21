import React from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

import { cn } from "@/lib/utils";

const SAFE_MARKDOWN_PREVIEW_HTML_SCHEMA = {
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
  clobberPrefix: "chat-preview-html-",
};

const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];

const REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, SAFE_MARKDOWN_PREVIEW_HTML_SCHEMA],
  rehypeKatex,
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];

const MARKDOWN_PREVIEW_COMPONENTS: Components = {
  a: ({ className, ...props }) => (
    <a
      className={cn("underline underline-offset-4", className)}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
};

type MarkdownPreviewProps = {
  source: string;
  className?: string;
};

export function MarkdownPreview({ source, className }: MarkdownPreviewProps) {
  return (
    <div className={cn("chat-markdown-preview chat-markdown min-w-0 max-w-full", className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_PREVIEW_COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
