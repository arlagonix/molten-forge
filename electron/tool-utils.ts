// Low-level utilities and types shared by the tool-execution code in the
// Electron main process (command tools, web fetch, and the workspace file
// tools in ./file-tools.ts). Kept dependency-free apart from Node built-ins so
// it can be imported from any of those modules without creating cycles.

import path from "node:path";

export type JsonRecord = Record<string, unknown>;

export type WorkspaceRoot = {
  id: string;
  name: string;
  path: string;
  createdAt?: string;
  kind?: "chat" | "manual" | "skill";
};

export type ToolExecutionContext = {
  workspaceRoots?: WorkspaceRoot[];
  signal?: AbortSignal;
};

export function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function stringifyToolResult(result: unknown) {
  if (typeof result === "string") return result;

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function normalizeWorkspaceRoots(value: unknown): WorkspaceRoot[] {
  if (!Array.isArray(value)) return [];

  const roots: WorkspaceRoot[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const id = safeString(item.id).trim();
    const rootPath = safeString(item.path).trim();
    if (!id || !rootPath || seen.has(id)) continue;

    roots.push({
      id,
      name: safeString(item.name).trim() || path.basename(rootPath) || rootPath,
      path: rootPath,
      createdAt: safeString(item.createdAt).trim() || undefined,
      kind: (() => {
        const kind = safeString(item.kind).trim();
        return kind === "chat" || kind === "manual" || kind === "skill" ? kind : undefined;
      })(),
    });
    seen.add(id);
  }

  return roots;
}

export function readOptionalString(args: unknown, key: string) {
  if (!isPlainObject(args)) return undefined;
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

export function readRequiredString(args: unknown, key: string) {
  const value = readOptionalString(args, key)?.trim();
  if (!value) throw new Error(`Missing required file tool argument: ${key}`);
  return value;
}

export function readRequiredRawString(args: unknown, key: string) {
  const value = readOptionalString(args, key);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required file tool argument: ${key}`);
  }
  return value;
}

export function readOptionalStringArray(args: unknown, key: string) {
  if (!isPlainObject(args) || !Array.isArray(args[key])) return [];
  return (args[key] as unknown[])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readPositiveIntegerArg(
  args: unknown,
  key: string,
  fallback: number,
  max: number,
) {
  if (!isPlainObject(args)) return fallback;
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}
