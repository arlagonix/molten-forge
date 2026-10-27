export type AppFontFamily = "sans" | "mono" | "miracode";

export const APP_FONT_FAMILY_STORAGE_KEY = "molten-forge-pi-font-family";

export function normalizeAppFontFamily(value: unknown): AppFontFamily {
  // Upgrade both retired choices to Miracode without resetting user preferences.
  if (value === "computer-modern" || value === "monocraft") return "miracode";
  return value === "mono" || value === "miracode" ? value : "sans";
}

export function readAppFontFamily(storage: Pick<Storage, "getItem">): AppFontFamily {
  try {
    return normalizeAppFontFamily(storage.getItem(APP_FONT_FAMILY_STORAGE_KEY));
  } catch {
    return "sans";
  }
}

export function writeAppFontFamily(
  storage: Pick<Storage, "setItem">,
  value: AppFontFamily,
): void {
  try {
    storage.setItem(APP_FONT_FAMILY_STORAGE_KEY, normalizeAppFontFamily(value));
  } catch {
    // UI persistence is optional; the current session can still use the value.
  }
}
