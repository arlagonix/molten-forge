import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { File, Image as ImageIcon, X } from "lucide-react";
import { type ManagedAttachment, uint8ToBase64 } from "../core/attachments";

/** Historical attachment thumbnails load only while their transcript item is mounted. */
export const AttachmentChip = memo(function AttachmentChip({
  attachment, onRemove,
}: { attachment: ManagedAttachment; onRemove?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (attachment.kind !== "image") return;
    let live = true;
    void invoke<number[]>("read_attachment_bytes", { attachmentPath: attachment.path })
      .then((bytes) => {
        if (live) setSrc(`data:${attachment.mimeType};base64,${uint8ToBase64(Uint8Array.from(bytes))}`);
      })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [attachment.kind, attachment.mimeType, attachment.path]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  return (
    <>
      <div className={`attachment-chip ${attachment.kind === "image" ? "attachment-image-chip" : "attachment-file-chip"}`} title={`${attachment.fileName} (${Math.round(attachment.byteSize / 1024)} KB)`}>
        {attachment.kind === "image" ? (
          <button type="button" className="attachment-image-open" title={`Open ${attachment.fileName}`} aria-label={`Open ${attachment.fileName}`} disabled={!src} onClick={() => setExpanded(true)}>
            {src ? <img src={src} alt={attachment.fileName} /> : <ImageIcon size={20} />}
          </button>
        ) : <File size={17} className="attachment-file-icon" aria-hidden="true" />}
        {attachment.kind === "file" && <span className="attachment-filename">{attachment.fileName}</span>}
        {onRemove && <button type="button" className="attachment-remove" onClick={onRemove} title={`Remove ${attachment.fileName}`} aria-label={`Remove ${attachment.fileName}`}><X size={13} /></button>}
      </div>
      {expanded && src && createPortal(
        <div role="dialog" aria-modal="true" aria-label={attachment.fileName} className="attachment-lightbox" onClick={() => setExpanded(false)}>
          <button type="button" className="attachment-lightbox-close" aria-label="Close image" onClick={() => setExpanded(false)}><X size={20} /></button>
          <img src={src} alt={attachment.fileName} onClick={(event) => event.stopPropagation()} />
        </div>, document.body,
      )}
    </>
  );
});
