import { normalizeCodeLanguage } from "./code-rendering";
import { languageFromFilePath } from "./tool-diff";

export type ToolTextLanguageSource = "explicit" | "path" | "structure" | "fallback";

export type ToolTextLanguage = {
  language: string;
  source: ToolTextLanguageSource;
};

export type ToolTextViewerDecision = ToolTextLanguage & {
  useViewer: boolean;
  lineNumbers: boolean;
  lineNumberStart: number;
  filePath?: string;
};

type UnknownRecord = Record<string, unknown>;

const SPECIALIZED_TEXT_TOOLS = new Set(["grep", "find", "ls"]);
const TERMINAL_TOOLS = /^(bash|shell|terminal|powershell|pwsh)$/i;
const READ_TOOLS = /^(read|read_file)$/i;
const SHORT_PLAIN_TEXT_THRESHOLD = 160;

function objectRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}


export function extractToolResultText(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result;

  const record = objectRecord(result);
  const content = record?.content;
  if (Array.isArray(content)) {
    const textParts = content
      .filter((part): part is UnknownRecord => Boolean(objectRecord(part)?.type === "text"))
      .map((part) => typeof part.text === "string" ? part.text : "");
    const text = textParts.join("\n");
    if (text) return text;

    // Pi uses { content: [] } while a tool has started but has not emitted any
    // textual output yet. Treat that as pending/empty output rather than
    // rendering the transport wrapper as JSON. Preserve non-text content arrays
    // below so future/unknown result shapes are still visible.
    const wrapperOnly = Object.keys(record ?? {}).every((key) => key === "content");
    if (wrapperOnly && (content.length === 0 || content.every((part) => objectRecord(part)?.type === "text"))) {
      return "";
    }
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function firstString(record: UnknownRecord | undefined, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function languageFromMime(value: string | undefined) {
  if (!value) return undefined;
  const mime = value.toLowerCase().split(";", 1)[0].trim();
  if (mime === "application/json" || mime.endsWith("+json")) return "json";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime === "application/xml" || mime === "text/xml" || mime.endsWith("+xml")) return "xml";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (mime === "text/plain") return "text";
  if (mime === "text/css") return "css";
  if (mime === "text/csv") return "csv";
  if (mime === "application/javascript" || mime === "text/javascript") return "javascript";
  if (mime === "application/typescript" || mime === "text/typescript") return "typescript";
  return undefined;
}

function explicitLanguage(args: unknown) {
  const record = objectRecord(args);
  const raw = firstString(record, ["language", "lang", "syntax"]);
  if (raw) {
    const normalized = normalizeCodeLanguage(raw);
    return normalized === "plain" || normalized === "plaintext" ? "text" : normalized;
  }
  return languageFromMime(firstString(record, ["mimeType", "mime_type", "contentType", "content_type"]));
}

export function toolFilePath(toolName: string, args: unknown) {
  const record = objectRecord(args);
  if (!record) return undefined;

  const normalizedName = toolName.trim().toLowerCase();
  if (["read", "read_file", "edit", "write"].includes(normalizedName)) {
    return firstString(record, ["path", "filePath", "filepath", "file", "filename"]);
  }

  // Extension tools often use one of these conventional fields. Treat it only
  // as a syntax hint; the file is never read from disk for display purposes.
  return firstString(record, ["filePath", "filepath", "filename", "path", "file"]);
}

function looksLikeJson(text: string) {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))
    && !(trimmed.startsWith("[") && trimmed.endsWith("]"))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeDiff(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").slice(0, 80);
  if (lines.some((line) => /^diff --git\s/.test(line))) return true;
  const hasHunk = lines.some((line) => /^@@\s+-\d+/.test(line));
  const hasChanges = lines.some((line) => /^\+(?!\+\+)/.test(line))
    && lines.some((line) => /^-(?!---)/.test(line));
  return hasHunk && hasChanges;
}

function looksLikeHtml(text: string) {
  const trimmed = text.trimStart().slice(0, 2048).toLowerCase();
  return /^<!doctype\s+html\b/.test(trimmed)
    || /^<html\b/.test(trimmed)
    || (/<(?:head|body)\b/.test(trimmed) && /<\/[a-z][^>]*>/.test(trimmed));
}

function looksLikeXml(text: string) {
  const trimmed = text.trimStart().slice(0, 2048);
  return /^<\?xml\b/i.test(trimmed)
    || (/^<[A-Za-z_][\w:.-]*(?:\s[^>]*)?>/.test(trimmed) && /<\/[A-Za-z_][\w:.-]*>/.test(trimmed));
}

function looksLikeMarkdown(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (/^```[A-Za-z0-9_-]*\s*$/m.test(normalized)) return true;
  const lines = normalized.split("\n").slice(0, 80);
  const headings = lines.filter((line) => /^#{1,6}\s+\S/.test(line)).length;
  const listItems = lines.filter((line) => /^\s*(?:[-*+] |\d+\. )\S/.test(line)).length;
  return headings >= 2 || (headings >= 1 && listItems >= 2);
}

export function detectToolTextLanguage({
  toolName,
  args,
  text,
  filePath,
}: {
  toolName: string;
  args?: unknown;
  text: string;
  filePath?: string;
}): ToolTextLanguage {
  const explicit = explicitLanguage(args);
  if (explicit) return { language: explicit, source: "explicit" };

  const path = filePath?.trim() || toolFilePath(toolName, args);
  if (path) {
    const language = languageFromFilePath(path);
    if (language && language !== "text") return { language, source: "path" };
  }

  if (looksLikeJson(text)) return { language: "json", source: "structure" };
  if (looksLikeDiff(text)) return { language: "diff", source: "structure" };
  if (looksLikeHtml(text)) return { language: "html", source: "structure" };
  if (looksLikeXml(text)) return { language: "xml", source: "structure" };
  if (looksLikeMarkdown(text)) return { language: "markdown", source: "structure" };

  return { language: "text", source: "fallback" };
}

export function readLineNumberStart(toolName: string, args: unknown) {
  if (!READ_TOOLS.test(toolName)) return 1;
  const record = objectRecord(args);
  const offset = record?.offset;
  return typeof offset === "number" && Number.isFinite(offset) && offset >= 1
    ? Math.floor(offset)
    : 1;
}

export function toolTextViewerDecision({
  toolName,
  args,
  text,
}: {
  toolName: string;
  args?: unknown;
  text: string;
}): ToolTextViewerDecision {
  const name = toolName.trim().toLowerCase();
  const filePath = toolFilePath(toolName, args);
  const detected = detectToolTextLanguage({ toolName, args, text, filePath });
  const trimmed = text.trim();
  const isRead = READ_TOOLS.test(name);
  const isTerminal = TERMINAL_TOOLS.test(name);
  const isSpecialized = SPECIALIZED_TEXT_TOOLS.has(name);
  const structured = detected.source !== "fallback";
  const substantialPlainText = text.includes("\n") || text.length >= SHORT_PLAIN_TEXT_THRESHOLD;

  return {
    ...detected,
    filePath,
    useViewer: Boolean(trimmed) && !isSpecialized && (isRead || isTerminal || structured || substantialPlainText),
    lineNumbers: isRead,
    lineNumberStart: isRead ? readLineNumberStart(name, args) : 1,
  };
}
