// Shared identifiers for the built-in workspace coding tools.
//
// These names cross the Electron process boundary: the renderer uses them for
// tool schemas and the approval flow, while the main process uses them to
// dispatch the actual filesystem work.

export const READ_TOOL_NAME = "read";
export const BASH_TOOL_NAME = "bash";
export const EDIT_TOOL_NAME = "edit";
export const WRITE_TOOL_NAME = "write";

export const FILE_TOOL_NAMES = [
  READ_TOOL_NAME,
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
] as const;

export type FileToolName = (typeof FILE_TOOL_NAMES)[number];

export function isFileToolName(toolName: string): toolName is FileToolName {
  return FILE_TOOL_NAMES.includes(toolName as FileToolName);
}

export function requiresFileToolApproval(toolName: string) {
  return isFileToolName(toolName);
}

// Legacy names are kept so historical saved messages/settings can still parse
// and render. They are not exposed to the model anymore.
export const FILE_READ_TOOL_NAME = "file_read";
export const FILE_FIND_TOOL_NAME = "file_find";
export const FILE_SEARCH_TEXT_TOOL_NAME = "file_search_text";
export const FILE_REPLACE_TEXT_TOOL_NAME = "file_replace_text";
export const FILE_CREATE_TOOL_NAME = "file_create";
export const FILE_DELETE_TOOL_NAME = "file_delete";
export const ARCHIVE_EXTRACT_TOOL_NAME = "archive_extract";
export const ARCHIVE_CREATE_TOOL_NAME = "archive_create";
export const DOCUMENT_CONVERT_TOOL_NAME = "document_convert";
export const CHAT_FILE_CREATE_TOOL_NAME = "chat_file_create";

export const LEGACY_FILE_TOOL_NAMES = [
  FILE_READ_TOOL_NAME,
  FILE_FIND_TOOL_NAME,
  FILE_SEARCH_TEXT_TOOL_NAME,
  FILE_REPLACE_TEXT_TOOL_NAME,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL_NAME,
  ARCHIVE_EXTRACT_TOOL_NAME,
  ARCHIVE_CREATE_TOOL_NAME,
  DOCUMENT_CONVERT_TOOL_NAME,
  CHAT_FILE_CREATE_TOOL_NAME,
] as const;

export function isLegacyFileToolName(toolName: string) {
  return LEGACY_FILE_TOOL_NAMES.includes(
    toolName as (typeof LEGACY_FILE_TOOL_NAMES)[number],
  );
}
