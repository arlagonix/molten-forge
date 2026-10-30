export const THINKING_PREVIEW_INTERVAL_MS = 50;

export function cleanThinkingPreviewLine(value: string) {
  return value
    .trim()
    .replace(/^[\s#>*_`~\-+\d.)[\]]+/, "")
    .replace(/[*_`~]+$/g, "")
    .trim();
}

export function firstThinkingPreviewLine(content: string) {
  for (const line of content.split("\n")) {
    const cleaned = cleanThinkingPreviewLine(line);
    if (cleaned) return cleaned;
  }
  return "";
}

export function lastThinkingPreviewLine(content: string) {
  const lines = content.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const cleaned = cleanThinkingPreviewLine(lines[index]);
    if (cleaned) return cleaned;
  }
  return "";
}


export function rollingThinkingPreview(content: string, maxChars = 240) {
  if (maxChars <= 0) return "";
  const rows = content
    .split("\n")
    .map(cleanThinkingPreviewLine)
    .filter(Boolean);
  if (rows.length === 0) return "";

  const joined = rows.join(" · " );
  if (joined.length <= maxChars) return joined;
  return joined.slice(-maxChars);
}

export function displayedThinkingPreview({
  running,
  firstLine,
  sampledLastLine,
}: {
  running: boolean;
  firstLine: string;
  sampledLastLine: string;
}) {
  return running ? sampledLastLine : firstLine;
}

export function nextSampledThinkingLine(
  currentLine: string,
  latestLine: string,
) {
  return currentLine === latestLine ? currentLine : latestLine;
}
