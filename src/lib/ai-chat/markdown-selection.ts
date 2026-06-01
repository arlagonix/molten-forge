function nodeAsElement(node: Node | null): Element | null {
  if (!node) return null;

  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as Element;
  }

  return node.parentElement;
}

function selectionIsFullyInsideElement(selection: Selection, element: HTMLElement) {
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const startElement = nodeAsElement(range.startContainer);
    const endElement = nodeAsElement(range.endContainer);

    if (!startElement || !endElement) return false;
    if (!element.contains(startElement) || !element.contains(endElement)) {
      return false;
    }
  }

  return true;
}

function copyRangeIsInsideSingleCodeBlock(range: Range) {
  const startElement = nodeAsElement(range.startContainer);
  const endElement = nodeAsElement(range.endContainer);
  const startPre = startElement?.closest("pre.chat-code-pre");
  const endPre = endElement?.closest("pre.chat-code-pre");

  if (!startPre || startPre !== endPre) return null;

  return startPre as HTMLPreElement;
}

function getCodeLanguage(pre: HTMLPreElement) {
  const dataLanguage = pre.getAttribute("data-language")?.trim();
  if (dataLanguage) return dataLanguage;

  const codeLanguage = pre
    .querySelector("code")
    ?.className.split(/\s+/)
    .find((className) => className.startsWith("language-"))
    ?.replace("language-", "")
    .trim();

  return codeLanguage || undefined;
}

function markdownCodeFence(content: string, language?: string) {
  const fence = content.includes("```") ? "~~~~" : "```";
  const trailingNewline = content.endsWith("\n") ? "" : "\n";

  return `${fence}${language ?? ""}\n${content}${trailingNewline}${fence}`;
}

function escapeInlineCode(content: string) {
  if (!content.includes("`")) return `\`${content}\``;

  const ticks = content.match(/`+/g)?.reduce(
    (longest, value) => Math.max(longest, value.length),
    0,
  ) ?? 0;
  const fence = "`".repeat(ticks + 1);

  return `${fence} ${content} ${fence}`;
}

function sanitizeFragment(container: HTMLElement) {
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
}

function normalizeMarkdown(markdown: string) {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function block(content: string) {
  const normalized = normalizeMarkdown(content);

  return normalized ? `${normalized}\n\n` : "";
}

function inline(content: string) {
  return content.replace(/\s+\n/g, "\n").trim();
}

function indentContinuation(content: string, prefixLength: number) {
  const indent = " ".repeat(prefixLength);

  return content
    .split("\n")
    .map((line, index) => (index === 0 || !line ? line : `${indent}${line}`))
    .join("\n");
}

function childNodesToMarkdown(nodes: NodeListOf<ChildNode> | ChildNode[]) {
  return Array.from(nodes).map(nodeToMarkdown).join("");
}

function listToMarkdown(element: Element, ordered: boolean) {
  const items = Array.from(element.children).filter(
    (child) => child.tagName.toLowerCase() === "li",
  );

  return `${items
    .map((item, index) => {
      const prefix = ordered ? `${index + 1}. ` : "- ";
      const content = normalizeMarkdown(childNodesToMarkdown(item.childNodes));

      return `${prefix}${indentContinuation(content, prefix.length)}`.trimEnd();
    })
    .join("\n")}\n\n`;
}

function tableToMarkdown(table: Element) {
  const rows = Array.from(table.querySelectorAll("tr"));
  const markdownRows = rows
    .map((row) =>
      Array.from(row.children)
        .filter((cell) => ["td", "th"].includes(cell.tagName.toLowerCase()))
        .map((cell) => inline(childNodesToMarkdown(cell.childNodes)).replace(/\|/g, "\\|")),
    )
    .filter((cells) => cells.length > 0);

  if (markdownRows.length === 0) return "";

  const header = markdownRows[0];
  const separator = header.map(() => "---");
  const body = markdownRows.slice(1);

  return `${[header, separator, ...body]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n")}\n\n`;
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();
  const children = childNodesToMarkdown(element.childNodes);

  if (element.getAttribute("data-codeblock-ui") === "true") return "";

  switch (tagName) {
    case "br":
      return "\n";
    case "hr":
      return "\n---\n\n";
    case "p":
      return block(children);
    case "div": {
      const pre = element.matches("pre.chat-code-pre")
        ? element
        : element.querySelector("pre.chat-code-pre");

      if (pre instanceof HTMLPreElement) {
        return `${markdownCodeFence(pre.textContent ?? "", getCodeLanguage(pre))}\n\n`;
      }

      return block(children);
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tagName.slice(1));
      return `${"#".repeat(level)} ${inline(children)}\n\n`;
    }
    case "strong":
    case "b":
      return `**${inline(children)}**`;
    case "em":
    case "i":
      return `*${inline(children)}*`;
    case "del":
    case "s":
      return `~~${inline(children)}~~`;
    case "code": {
      if (element.closest("pre.chat-code-pre")) return children;
      return escapeInlineCode(element.textContent ?? children);
    }
    case "pre": {
      const pre = element as HTMLPreElement;
      return `${markdownCodeFence(pre.textContent ?? "", getCodeLanguage(pre))}\n\n`;
    }
    case "a": {
      const href = element.getAttribute("href")?.trim();
      const text = inline(children) || href || "";

      return href ? `[${text}](${href})` : text;
    }
    case "blockquote":
      return `${normalizeMarkdown(children)
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n")}\n\n`;
    case "ul":
      return listToMarkdown(element, false);
    case "ol":
      return listToMarkdown(element, true);
    case "li":
      return children;
    case "table":
      return tableToMarkdown(element);
    case "thead":
    case "tbody":
    case "tfoot":
    case "tr":
    case "th":
    case "td":
      return children;
    case "input": {
      const input = element as HTMLInputElement;
      if (input.type === "checkbox") {
        return input.checked ? "[x] " : "[ ] ";
      }
      return "";
    }
    default:
      return children;
  }
}

export function getSelectedMarkdownWithin(element: HTMLElement) {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return "";
  }

  if (!selectionIsFullyInsideElement(selection, element)) {
    return "";
  }

  if (selection.rangeCount === 1) {
    const range = selection.getRangeAt(0);
    const codePre = copyRangeIsInsideSingleCodeBlock(range);

    if (codePre) {
      return markdownCodeFence(selection.toString(), getCodeLanguage(codePre));
    }
  }

  const container = document.createElement("div");

  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.appendChild(selection.getRangeAt(index).cloneContents());
  }

  sanitizeFragment(container);

  return normalizeMarkdown(childNodesToMarkdown(container.childNodes));
}
