export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type BackgroundTheme = ResolvedTheme;

export type AppearanceSettings = {
  theme: ThemePreference;
  backgroundImagesEnabled: boolean;
};

export type BackgroundImageInfo = {
  name: string;
  type: string;
};

export const THEME_STORAGE_KEY = "molten-forge-pi-theme";
export const BACKGROUND_IMAGES_ENABLED_STORAGE_KEY = "molten-forge-pi-background-images-enabled";

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: "system",
  backgroundImagesEnabled: true,
};

const SUPPORTED_BACKGROUND_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const SUPPORTED_BACKGROUND_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
]);

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_APPEARANCE_SETTINGS.theme;
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function parseStoredBoolean(value: string | null, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function readAppearanceSettings(storage: Pick<Storage, "getItem">): AppearanceSettings {
  let theme: ThemePreference = DEFAULT_APPEARANCE_SETTINGS.theme;
  let backgroundImagesEnabled = DEFAULT_APPEARANCE_SETTINGS.backgroundImagesEnabled;

  try {
    theme = normalizeThemePreference(storage.getItem(THEME_STORAGE_KEY));
    backgroundImagesEnabled = parseStoredBoolean(
      storage.getItem(BACKGROUND_IMAGES_ENABLED_STORAGE_KEY),
      DEFAULT_APPEARANCE_SETTINGS.backgroundImagesEnabled,
    );
  } catch {
    // Browser storage is optional; defaults keep the UI usable.
  }

  return { theme, backgroundImagesEnabled };
}

export function writeThemePreference(
  storage: Pick<Storage, "setItem">,
  theme: ThemePreference,
): void {
  storage.setItem(THEME_STORAGE_KEY, normalizeThemePreference(theme));
}

export function writeBackgroundImagesEnabled(
  storage: Pick<Storage, "setItem">,
  enabled: boolean,
): void {
  storage.setItem(BACKGROUND_IMAGES_ENABLED_STORAGE_KEY, String(Boolean(enabled)));
}

export function backgroundExtension(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  return dot >= 0 ? trimmed.slice(dot) : "";
}

export function isSupportedBackgroundImage(info: BackgroundImageInfo): boolean {
  const mimeType = info.type.trim().toLowerCase();
  if (SUPPORTED_BACKGROUND_MIME_TYPES.has(mimeType)) return true;
  return mimeType === "" && SUPPORTED_BACKGROUND_EXTENSIONS.has(backgroundExtension(info.name));
}

export function backgroundImageAcceptValue(): string {
  return [
    ...SUPPORTED_BACKGROUND_MIME_TYPES,
    ...SUPPORTED_BACKGROUND_EXTENSIONS,
  ].join(",");
}

export function selectActiveBackgroundUrl(
  enabled: boolean,
  resolvedTheme: ResolvedTheme,
  customUrls: Partial<Record<BackgroundTheme, string>>,
  defaultUrls: Record<BackgroundTheme, string>,
): string | null {
  if (!enabled) return null;
  return customUrls[resolvedTheme] || defaultUrls[resolvedTheme];
}
