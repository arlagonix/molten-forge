import type { ChatAttachment } from "./types";

export function findAttachmentById(
  attachments: ChatAttachment[],
  attachmentId: string,
): ChatAttachment | undefined {
  for (const attachment of attachments) {
    if (attachment.id === attachmentId) return attachment;
    const child = findAttachmentById(attachment.children ?? [], attachmentId);
    if (child) return child;
  }
  return undefined;
}

export function getTopLevelRemovedAttachments(
  previousAttachments: ChatAttachment[],
  nextAttachments: ChatAttachment[],
) {
  const nextIds = new Set(nextAttachments.map((attachment) => attachment.id));
  return previousAttachments.filter((attachment) => !nextIds.has(attachment.id));
}

export function cleanupUnusedAttachments(attachments: ChatAttachment[]) {
  if (!attachments.length) return;
  void window.codeForgeAI?.deleteUnusedAttachments({ attachments }).catch(
    (error) => {
      console.warn("Failed to clean up unused attachments:", error);
    },
  );
}

export function deleteTemporaryAttachments(attachments: ChatAttachment[]) {
  if (!attachments.length) return;
  void window.codeForgeAI?.deleteTemporaryAttachments({ attachments }).catch(
    (error) => {
      console.warn("Failed to delete temporary attachments:", error);
    },
  );
}
