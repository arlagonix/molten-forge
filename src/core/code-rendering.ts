export const LANGUAGE_LABELS: Record<string, string> = {
  bash: "bash", c: "c", cpp: "cpp", csharp: "csharp", cs: "csharp",
  css: "css", csv: "csv", dart: "dart", dockerfile: "dockerfile",
  go: "go", html: "html", mermaid: "mermaid", mmd: "mermaid",
  java: "java", javascript: "javascript", js: "javascript", json: "json",
  jsx: "jsx", kotlin: "kotlin", kt: "kotlin", markdown: "markdown",
  md: "markdown", php: "php", powershell: "powershell", ps1: "powershell",
  python: "python", py: "python", rb: "ruby", ruby: "ruby", rust: "rust",
  rs: "rust", scala: "scala", sh: "shell", shell: "shell", sql: "sql",
  swift: "swift", text: "text", ts: "typescript", tsx: "tsx", txt: "text",
  typescript: "typescript", xml: "xml", yaml: "yaml", yml: "yaml", zsh: "zsh",
};

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: "sh", c: "c", cpp: "cpp", csharp: "cs", css: "css", csv: "csv",
  dart: "dart", dockerfile: "Dockerfile", go: "go", html: "html",
  mermaid: "mmd", mmd: "mmd", java: "java", javascript: "js", js: "js",
  json: "json", jsx: "jsx", kotlin: "kt", kt: "kt", markdown: "md", md: "md",
  php: "php", powershell: "ps1", ps1: "ps1", python: "py", py: "py", ruby: "rb",
  rust: "rs", scala: "scala", sh: "sh", sql: "sql", swift: "swift",
  ts: "ts", tsx: "tsx", typescript: "ts", xml: "xml", yaml: "yaml",
  yml: "yml", zsh: "sh",
};

export const CODEMIRROR_LANGUAGE_ALIASES: Record<string, string> = {
  csharp: "c#", cs: "c#", js: "javascript", jsx: "jsx", kt: "kotlin",
  md: "markdown", mmd: "mermaid", ps1: "powershell", py: "python",
  rb: "ruby", rs: "rust", sh: "shell", ts: "typescript", txt: "text",
  yml: "yaml",
};

export function codePayload(code: string) {
  return code.replace(/\n$/, "");
}

export function normalizeCodeLanguage(language?: string) {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return "text";
  return LANGUAGE_LABELS[normalized] ?? normalized;
}

export function normalizeCodeMirrorLanguage(language?: string) {
  const normalized = language?.trim().toLowerCase();
  if (!normalized || normalized === "text" || normalized === "plain" || normalized === "plaintext") {
    return undefined;
  }
  return CODEMIRROR_LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function filenameForLanguage(language?: string) {
  if (!language) return "file.txt";
  const extension = LANGUAGE_EXTENSIONS[language.toLowerCase()];
  if (!extension) return "file.txt";
  if (extension === "Dockerfile") return "Dockerfile";
  return `file.${extension}`;
}

export function codeLanguageFromClassName(className?: string) {
  const languageClass = className
    ?.split(/\s+/)
    .find((value) => value.startsWith("language-"));
  return languageClass?.slice("language-".length) || undefined;
}

export function calculateDocumentChange(currentValue: string, nextValue: string) {
  if (nextValue.startsWith(currentValue)) {
    return { from: currentValue.length, to: currentValue.length, insert: nextValue.slice(currentValue.length) };
  }
  if (currentValue.startsWith(nextValue)) {
    return { from: nextValue.length, to: currentValue.length, insert: "" };
  }

  let prefixLength = 0;
  const maxPrefixLength = Math.min(currentValue.length, nextValue.length);
  while (prefixLength < maxPrefixLength && currentValue.charCodeAt(prefixLength) === nextValue.charCodeAt(prefixLength)) {
    prefixLength += 1;
  }

  let currentSuffixStart = currentValue.length;
  let nextSuffixStart = nextValue.length;
  while (
    currentSuffixStart > prefixLength &&
    nextSuffixStart > prefixLength &&
    currentValue.charCodeAt(currentSuffixStart - 1) === nextValue.charCodeAt(nextSuffixStart - 1)
  ) {
    currentSuffixStart -= 1;
    nextSuffixStart -= 1;
  }

  return {
    from: prefixLength,
    to: currentSuffixStart,
    insert: nextValue.slice(prefixLength, nextSuffixStart),
  };
}
