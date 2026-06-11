import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai-chat/code-block-preview-dialog", () => ({
  CodeBlockDisplayMode: { Preview: "preview", Source: "source" },
  CodeBlockPreviewDialog: () => null,
  CodeBlockSourceView: ({ code }: { code: string }) => <pre>{code}</pre>,
  RenderablePreview: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

import { ThinkingBlock } from "@/components/ai-chat/thinking-block";

const baseProps = {
  id: "thinking-1",
  content: "Working\n**hidden markdown body**",
  status: "in_progress" as const,
  startedAt: "2026-01-01T00:00:00.000Z",
  isStreaming: true,
  flushVersion: 0,
  onToggleCollapsed: vi.fn(),
};

describe("ThinkingBlock", () => {
  it("does not mount the Markdown body while collapsed", () => {
    const { container } = render(
      <ThinkingBlock {...baseProps} isCollapsed renderMarkdownWhileStreaming />,
    );

    expect(container.querySelector("#thinking-1-thinking-content")).toBeNull();
    expect(container.querySelector("strong")).not.toBeInTheDocument();
  });

  it("mounts the Markdown body while expanded", () => {
    const { container } = render(
      <ThinkingBlock
        {...baseProps}
        isCollapsed={false}
        renderMarkdownWhileStreaming
      />,
    );

    expect(
      container.querySelector("#thinking-1-thinking-content"),
    ).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe(
      "hidden markdown body",
    );
  });
});
