# Attachments and model context

Molten Forge treats attachments as model context and as files that tools can inspect.

## Core behavior

When a user attaches a file, Molten Forge gives the model a real filesystem path whenever possible.

- If the file already has a local path, Molten Forge keeps that original path and does not copy the file.
- If the file has no stable path, for example a pasted image/blob, Molten Forge stages it under the OS temp directory:

```text
<os-temp>/molten-forge/attachments/...
```

The temp directory is intentionally temporary. Old chats can keep attachment metadata even if the underlying temp file has been removed by the OS or by Molten Forge cleanup.

## Model-facing manifest

Every attachment adds a manifest entry to the model context with:

- file name,
- file kind,
- byte size,
- path available to tools,
- whether the file is temporary,
- whether extracted text was included.

Text extracted from supported files is inserted into the prompt under configured limits. The path remains available so the model can call tools for more targeted inspection.

## File type handling

### Images

Images are sent as multimodal `image_url` parts when attached. The model also receives their path.

The `read` tool is multimodal: reading a supported image path returns an image data URL payload instead of raw binary text. On the next model request, Molten Forge converts that tool result into an attached image message so vision-capable models can inspect workspace images.

If the selected model is not marked as vision-capable, Molten Forge shows a warning. The request is still allowed, but the model/provider may ignore or reject the image.

### Text-like files

Text-like files, including common source-code and data formats, are read as UTF-8 when safe. Extracted content is inserted into model context under limits. The original path is also exposed to tools.

### PDFs

PDF text is extracted with `pdf-parse`. If no text is found, Molten Forge marks the attachment as likely scanned/image-only and keeps the path available.

### Office documents

DOCX, XLSX, and PPTX files are parsed with `officeparser`. Extracted text is inserted into model context under limits. The original file path remains available to tools.

### Archives

Archives keep their original path when one exists. Pathless archives are staged in the Molten Forge temp attachment directory only if they are below the hard staging limit.

Archive extraction is strict:

- only small archives are inspected,
- extraction depth is limited,
- entry count is limited,
- total extracted bytes are limited,
- child files are processed with the same rules as normal attachments.

Extracted children are staged under the Molten Forge temp attachment directory. Binary/image children are not blindly injected; image children can be inspected with `read(path)` when a vision-capable model is selected.

### Unsupported binaries

Unsupported binary files are metadata/path-only. Molten Forge does not inject raw bytes into the prompt.

## Tool access

Attachment access is added to tool execution context:

- original attached files are allowed as exact file paths,
- temporary attachment folders are added as additional read roots,
- parent folders of original files are not exposed automatically.

This means attaching:

```text
C:\Users\Acer\Downloads\report.pdf
```

allows tools to read that exact file, but it does not automatically expose the entire Downloads folder as a workspace root.

## Cleanup

When a message is deleted, Molten Forge deletes temporary files and extracted children owned by that message where possible. Original user files are never deleted.

When a chat is deleted, Molten Forge deletes temporary/staged attachment files for that chat where possible. Original user files are never deleted.

When a user edits a message and removes an attachment, Molten Forge removes the attachment reference and deletes Molten Forge-created temporary files for that removed attachment.

## Old chats

If an old chat references a path that still exists, the attachment remains usable.

If the path no longer exists, the UI should keep the attachment record but mark it unavailable. The model context should state that the previously attached file is no longer available rather than pretending the content can still be read.
