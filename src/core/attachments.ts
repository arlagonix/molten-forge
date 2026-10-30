/** Attachment bytes live in Tauri app-data, never in React's composer state. */
export interface ManagedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  path: string;
  kind: "image" | "file";
}

export const MAX_WEBVIEW_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 12;
const BLOCK_OPEN = "<molten-forge-attachments-v1>";
const BLOCK_CLOSE = "</molten-forge-attachments-v1>";

export function composeAttachmentPrompt(text: string, attachments: readonly ManagedAttachment[]): string {
  if (!attachments.length) return text;
  const content = text.trim() || "Please examine the attached files.";
  // A structured, readable footer persists in Pi's authoritative session JSONL.
  // The agent can use paths even after switching to a text-only model or forking.
  const lines = attachments.map(({ id, fileName, mimeType, byteSize, kind, path }) =>
    ({ id, fileName, mimeType, byteSize, kind, path }));
  return `${content}\n\n${BLOCK_OPEN}\n${JSON.stringify(lines)}\n${BLOCK_CLOSE}`;
}

export function parseAttachmentPrompt(text: string): { text: string; attachments: ManagedAttachment[] } {
  const end = text.lastIndexOf(`\n${BLOCK_CLOSE}`);
  if (end < 0 || end + BLOCK_CLOSE.length + 1 !== text.length) return { text, attachments: [] };
  const start = text.lastIndexOf(`\n\n${BLOCK_OPEN}\n`, end);
  if (start < 0) return { text, attachments: [] };
  try {
    const parsed: unknown = JSON.parse(text.slice(start + BLOCK_OPEN.length + 3, end));
    if (!Array.isArray(parsed) || parsed.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error("Invalid attachment list");
    const attachments: ManagedAttachment[] = parsed.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Invalid attachment");
      const value = item as Record<string, unknown>;
      if (!["id", "fileName", "mimeType", "path"].every((key) => typeof value[key] === "string")
        || (value.kind !== "image" && value.kind !== "file")
        || !Number.isSafeInteger(value.byteSize) || Number(value.byteSize) < 0) {
        throw new Error("Invalid attachment metadata");
      }
      return {
        id: value.id as string, fileName: value.fileName as string,
        mimeType: value.mimeType as string, path: value.path as string,
        byteSize: value.byteSize as number, kind: value.kind as "image" | "file",
      };
    });
    return { text: text.slice(0, start), attachments };
  } catch {
    return { text, attachments: [] };
  }
}

export function supportsImageInput(model: { input?: string[] } | null | undefined): boolean {
  return Boolean(model?.input?.includes("image"));
}

export function uint8ToBase64(bytes: Uint8Array): string {
  // Avoid String.fromCharCode(...bytes): spreading a large image exceeds the
  // JavaScript argument limit and can crash a WebView.
  const chunk = 0x6000; // Divisible by 3 so btoa chunks have no intermediate padding.
  let result = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    result += btoa(String.fromCharCode(...bytes.subarray(index, index + chunk)));
  }
  return result;
}

export function attachmentLabel(attachment: ManagedAttachment): string {
  return attachment.kind === "image" ? `Image: ${attachment.fileName}` : `File: ${attachment.fileName}`;
}
