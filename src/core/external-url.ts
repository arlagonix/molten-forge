export function isExternalHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (!candidate || candidate !== value || /[\u0000-\u001f\u007f]/.test(candidate)) return false;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
