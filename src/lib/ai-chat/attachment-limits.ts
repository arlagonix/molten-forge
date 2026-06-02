import type { ChatAttachment } from "./types";

export const ATTACHMENT_LIMITS = {
  maxFilesPerMessage: 20,
  maxFileBytes: 25 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxArchiveBytes: 100 * 1024 * 1024,
  maxArchiveDepth: 2,
  maxEntriesPerArchive: 200,
  maxEntriesTotal: 500,
  maxExtractedBytesTotal: 200 * 1024 * 1024,
  maxTextBytesPerFile: 1 * 1024 * 1024,
  maxTotalExtractedChars: 400_000,
  imageExtensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  archiveExtensions: [".zip", ".tar", ".tar.gz", ".tgz", ".gz", ".rar", ".7z"],
} as const;

export const IMAGE_TOKEN_COST = 800;

export function estimateAttachmentTokens(attachment: ChatAttachment): number {
  if (attachment.tokenEstimate !== undefined) return attachment.tokenEstimate;
  if (attachment.kind === "image") return IMAGE_TOKEN_COST;
  if (attachment.kind === "archive") {
    return (attachment.children ?? []).reduce(
      (sum, child) => sum + estimateAttachmentTokens(child),
      0,
    );
  }
  return Math.ceil((attachment.extractedText?.length ?? 0) / 4);
}

export function estimateAttachmentsTokens(attachments?: ChatAttachment[]): number {
  return (attachments ?? []).reduce(
    (sum, attachment) => sum + estimateAttachmentTokens(attachment),
    0,
  );
}
