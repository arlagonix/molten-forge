# Attachments — v0.36.52

## Pi boundary

Use the existing Pi RPC `prompt` with a `message` string and optional `images: [{ type: "image", data: base64, mimeType }]`. Pass the actual image payload **only** when the active Pi model advertises `input: ["text", "image"]`. Regular files are never inlined. All files, including images, have persistent local paths included as readable JSON metadata appended to the prompt. Pi can `read` those paths on demand. Pi's session JSONL is authoritative for restoring the visible user attachment chips and message text.

## Persistence

- Rust stages picker selections, clipboard images/files, and native OS drag/drops in the app-data `attachments/<unique-id>/<safe-filename>` hierarchy. The original path or clipboard data is not needed afterward.
- React Composer stores only metadata. It reads image data when sending to Pi, never on every keystroke. Thumbnails read bytes only while mounted (no base64 in root App state).
- Pi session messages retain a `<molten-forge-attachments-v1>` metadata suffix. `src/core/attachments.ts` constructs/parses it, and the visible transcript strips it. Clone/fork sessions naturally preserve absolute-path references.
- Draft removal removes the managed attachment directory. **Sent attachments are intentionally preserved** while Pi sessions reference them, including across clone/fork. There is no session delete UI in Molten Forge v0.36.52; do not delete sent attachments on session switch or compact. When adding session deletion, implement reference-aware garbage collection rather than blindly deleting the original session's folder.

## Limits and interactions

- At most 12 attachments per prompt.
- Native path picker/OS drop: up to 50 MB for files and 16 MB for supported images.
- Browser clipboard/DOM drop: 16 MB due to IPC byte-array overhead.
- Supported vision raster types: png/jpeg/gif/webp/bmp. Unknown, HEIC, SVG, PDF, ZIP, etc. stay regular files with paths (no implied document extraction).
- `+`: native Add image or Upload file picker. `Ctrl/Cmd+V` accepts clipboard `File` items on the textarea. Native Tauri and browser drop events are separate integrations; browser file drops are handled in the composer, native drop events at the webview level.
- Pending stages disable Send to avoid losing attachments before they have valid paths. Errors are visible in the composer. Image thumbnail click opens the image lightbox; × discards an unsent attachment.

## Future work

- Session-level draft persistence and reference-aware attachment garbage collection.
- PDF/DOCX/XLSX extraction via explicit readers (not context inlining).
- Native clipboard-file handling for desktop platforms that do not expose Explorer/Finder file copies through `clipboardData.files`.

## Regression contracts

Keep composer interaction state in `Composer` (not `App`); do not disturb chat virtualization or smooth scroll. Preserve already accepted Pi RPC prompt/abort lifecycle and existing model switching/extension commands. Path IO belongs in Rust and `read_attachment_bytes` must reject paths outside the managed root, including symlink escapes.
