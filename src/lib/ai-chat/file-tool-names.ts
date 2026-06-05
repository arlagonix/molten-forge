// Shared identifiers for the built-in workspace file tools.
//
// These names cross the Electron process boundary: the renderer uses them for
// tool schemas and the approval flow, while the main process uses them to
// dispatch the actual filesystem work. Keep this module dependency-free so it
// can be imported from either side without pulling in DOM or Node globals.

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

export const FILE_TOOL_NAMES = [
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

export type FileToolName = (typeof FILE_TOOL_NAMES)[number];

// File tools that mutate regular workspace files and therefore require user
// approval (or an explicit auto-approve setting) before they run.
// App-managed artifact/conversion/archive tools write only into controlled chat
// workspace folders and are handled as normal tool executions.
export const FILE_TOOLS_REQUIRING_APPROVAL = [
  FILE_REPLACE_TEXT_TOOL_NAME,
  FILE_CREATE_TOOL_NAME,
  FILE_DELETE_TOOL_NAME,
] as const;

export function isFileToolName(toolName: string): toolName is FileToolName {
  return (FILE_TOOL_NAMES as readonly string[]).includes(toolName);
}

export function requiresFileToolApproval(toolName: string) {
  return (FILE_TOOLS_REQUIRING_APPROVAL as readonly string[]).includes(
    toolName,
  );
}
