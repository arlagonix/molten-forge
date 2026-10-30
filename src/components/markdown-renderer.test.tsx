import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./markdown-renderer";

describe("MarkdownRenderer contracts", () => {
  it("wraps GFM tables in a dedicated horizontal scroll container", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={"| A | B |\n| --- | --- |\n| one | two |"} />,
    );
    expect(html).toContain('class="markdown-table-scroll chat-message-scrollbar"');
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).not.toContain(' node="');
  });

  it("renders fenced code through the Molten Forge code-block frame", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={"```ts\nconst answer: number = 42;\n```"} />,
    );
    expect(html).toContain('class="chat-code-block');
    expect(html).toContain('class="chat-code-header"');
    expect(html).toContain(">typescript<");
    expect(html).toContain('aria-label="Code block actions"');
    expect(html).toContain('aria-label="Disable line wrap"');
    expect(html).toContain('aria-pressed="false"');
    expect((html.match(/aria-label="Disable line wrap"/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('chat-code-action-active');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('aria-label="Download file.ts"');
  });

  it("keeps unlabeled fences as text", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content={"```\nraw text\n```"} />);
    expect(html).toContain(">text<");
  });

  it("does not turn inline code into a framed code block", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content={"Use `npm run build`."} />);
    expect(html).toContain("<code>npm run build</code>");
    expect(html).not.toContain('class="chat-code-block');
  });
});
