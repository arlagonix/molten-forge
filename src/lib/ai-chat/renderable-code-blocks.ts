export type RenderableCodeBlockKind = "html" | "markdown" | "mermaid";

const RENDERABLE_CODE_BLOCK_LANGUAGES: Record<string, RenderableCodeBlockKind> = {
  html: "html",
  markdown: "markdown",
  md: "markdown",
  mermaid: "mermaid",
  mmd: "mermaid",
};

export function getRenderableCodeBlockKind(language?: string) {
  if (!language) return undefined;

  const normalized = language.trim().toLowerCase();
  return RENDERABLE_CODE_BLOCK_LANGUAGES[normalized];
}

export function isRenderableCodeBlock(language?: string) {
  return Boolean(getRenderableCodeBlockKind(language));
}
