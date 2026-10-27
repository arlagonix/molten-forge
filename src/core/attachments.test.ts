import { describe, expect, it } from "vitest";
import { composeAttachmentPrompt, parseAttachmentPrompt, supportsImageInput, uint8ToBase64, type ManagedAttachment } from "./attachments";

const image: ManagedAttachment = {
  id: "one", kind: "image", fileName: "screen.png", mimeType: "image/png", byteSize: 12,
  path: "C:\\Users\\Test\\AppData\\Roaming\\Molten Forge\\attachments\\a\\screen.png",
};
const file: ManagedAttachment = {
  id: "two", kind: "file", fileName: "config.json", mimeType: "application/json", byteSize: 31,
  path: "/home/user/.local/share/molten-forge/attachments/b/config.json",
};

describe("managed attachments", () => {
  it("persists structured metadata as readable path-bearing Pi prompt text", () => {
    const message = composeAttachmentPrompt("Check this", [image, file]);
    expect(message).toContain(JSON.stringify(image.path));
    expect(message).toContain(file.path);
    expect(parseAttachmentPrompt(message)).toEqual({ text: "Check this", attachments: [image, file] });
  });
  it("supports attachment-only messages and does not alter ordinary prompts", () => {
    expect(parseAttachmentPrompt(composeAttachmentPrompt("", [image])).attachments).toEqual([image]);
    expect(parseAttachmentPrompt("hello")).toEqual({ text: "hello", attachments: [] });
  });
  it("does not hide malformed or user-authored lookalike blocks", () => {
    const malformed = 'hello\n\n<molten-forge-attachments-v1>\n[{"path":"x"}]\n</molten-forge-attachments-v1>';
    expect(parseAttachmentPrompt(malformed)).toEqual({ text: malformed, attachments: [] });
  });
  it("honors model capability and does not silently send image payload to text-only models", () => {
    expect(supportsImageInput({ input: ["text", "image"] })).toBe(true);
    expect(supportsImageInput({ input: ["text"] })).toBe(false);
    expect(supportsImageInput(null)).toBe(false);
  });
  it("encodes multi-chunk image content without corrupt padding", () => {
    const bytes = Uint8Array.from({ length: 60001 }, (_, i) => i % 256);
    const base64 = uint8ToBase64(bytes);
    expect(base64).toBe(btoa(String.fromCharCode(...bytes)));
  });
});
