export const ACTIVITY_PREVIEW_MAX_CHARS = 240;

type ActivityPreviewOptions = {
  stripShellPrompt?: boolean;
  skipStructuralOnly?: boolean;
};

export function cleanActivityPreviewLine(
  value: string,
  { stripShellPrompt = false, skipStructuralOnly = false }: ActivityPreviewOptions = {},
) {
  let clean = value.trim();
  if (stripShellPrompt) clean = clean.replace(/^\$\s*/, "");
  clean = clean.replace(/\s+/g, " ").trim();
  if (skipStructuralOnly && /^[\[\]{}(),;]+$/.test(clean)) return "";
  return clean;
}

export function firstActivityPreviewLine(content: string, options?: ActivityPreviewOptions) {
  for (const line of content.split("\n")) {
    const clean = cleanActivityPreviewLine(line, options);
    if (clean) return clean;
  }
  return "";
}

export function lastActivityPreviewLine(content: string, options?: ActivityPreviewOptions) {
  const lines = content.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const clean = cleanActivityPreviewLine(lines[index], options);
    if (clean) return clean;
  }
  return "";
}


export function rollingActivityPreview(
  content: string,
  options?: ActivityPreviewOptions,
  maxChars = ACTIVITY_PREVIEW_MAX_CHARS,
) {
  if (maxChars <= 0) return "";
  const rows = content
    .split("\n")
    .map((line) => cleanActivityPreviewLine(line, options))
    .filter(Boolean);
  if (rows.length === 0) return "";

  const joined = rows.join(" · " );
  if (joined.length <= maxChars) return joined;
  return joined.slice(-maxChars);
}

export function tailActivityPreview(value: string, maxChars = ACTIVITY_PREVIEW_MAX_CHARS) {
  const clean = value.trim();
  if (!clean || maxChars <= 0) return "";
  if (clean.length <= maxChars) return clean;
  if (maxChars === 1) return "…";
  return `…${clean.slice(-(maxChars - 1))}`;
}
