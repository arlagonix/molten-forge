import { describe, expect, it } from "vitest";

import {
  buildApiMessages,
  buildUserApiContent,
} from "./direct-provider-client";
import type {
  ChatAttachment,
  ChatMessage,
  ChatToolResult,
  ProviderConfig,
} from "./types";

const provider: ProviderConfig = {
  id: "local",
  name: "Local",
  baseUrl: "http://localhost:1234/v1",
  apiKey: "test",
  model: "gemma-4-e2b",
};

describe("attachment model context", () => {
  it("includes extracted text and a usable path for text-like attachments", async () => {
    const attachment: ChatAttachment = {
      id: "att-1",
      name: "notes.md",
      kind: "text",
      mimeType: "text/markdown",
      sizeBytes: 42,
      storagePath: "/tmp/molten-forge/attachments/pending/att-1/notes.md",
      storageMode: "temporary",
      temporary: true,
      extractedText: "Important attachment content.",
      tokenEstimate: 8,
    };

    const content = await buildUserApiContent("Please read it", [attachment]);
    expect(Array.isArray(content)).toBe(true);
    const text =
      Array.isArray(content) && content[0].type === "text"
        ? content[0].text
        : "";
    expect(text).toContain("Attached files available to tools");
    expect(text).toContain(
      "path: /tmp/molten-forge/attachments/pending/att-1/notes.md",
    );
    expect(text).toContain("temporary: true");
    expect(text).toContain("Important attachment content.");
  });

  it("does not inline oversized images visually", async () => {
    const attachment: ChatAttachment = {
      id: "img-1",
      name: "huge.png",
      kind: "image",
      mimeType: "image/png",
      sizeBytes: 20 * 1024 * 1024,
      storagePath: "/tmp/huge.png",
      storageMode: "original",
      tokenEstimate: 800,
    };

    const content = await buildUserApiContent("Look at this", [attachment]);
    expect(Array.isArray(content)).toBe(true);
    expect(Array.isArray(content) ? content.length : 0).toBe(1);
    const text =
      Array.isArray(content) && content[0].type === "text"
        ? content[0].text
        : "";
    expect(text).toContain("image not attached visually");
    expect(text).toContain("path: /tmp/huge.png");
  });

  it("turns image read tool results into synthetic user image messages", async () => {
    const toolResult: ChatToolResult = {
      toolCallId: "call-1",
      toolName: "read",
      content: JSON.stringify({
        ok: true,
        type: "image",
        path: "screenshot.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,AAAA",
      }),
    };
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:00.000Z",
        activeVariantIndex: 0,
        variants: [
          {
            id: "variant-1",
            createdAt: "2026-01-01T00:00:00.000Z",
            content: "",
            status: "done",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "read", arguments: "{}" },
              },
            ],
            toolResults: [toolResult],
          },
        ],
      },
    ];

    const apiMessages = await buildApiMessages({
      provider,
      systemPrompt: "",
      messages,
      settings: {},
    });

    expect(apiMessages).toHaveLength(3);
    expect(apiMessages[0]).toMatchObject({ role: "assistant" });
    expect(apiMessages[1].role).toBe("tool");
    expect(apiMessages[1].content).not.toContain("data:image/png;base64,AAAA");
    expect(apiMessages[2]).toMatchObject({ role: "user" });
    const userContent =
      apiMessages[2].role === "user" ? apiMessages[2].content : "";
    expect(Array.isArray(userContent)).toBe(true);
    expect(Array.isArray(userContent) && userContent[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
  });
});
