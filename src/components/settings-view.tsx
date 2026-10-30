import type { CSSProperties } from "react";
import {
  ArrowLeft,
  Bell,
  Brain,
  ChevronDown,
  Image as ImageIcon,
  Moon,
  Settings2,
  Puzzle,
  BookOpen,
  Sun,
  Type as TypeIcon,
  Wrench,
} from "lucide-react";
import type { BackgroundTheme, ThemePreference } from "../core/appearance";
import type { AppFontFamily } from "../core/ui-preferences";
import type { CommandInfo, TranscriptItem } from "../core/chat-logic";
import { PiResourcesSettings } from "./pi-resources-settings";
import type { TimelineMode } from "../core/timeline-detail";
import { PiSkillsSettings } from "./pi-skills-settings";
import { PiToolsSettings } from "./pi-tools-settings";

type BackgroundView = { name: string; url: string };
type BackgroundViews = Partial<Record<BackgroundTheme, BackgroundView>>;

export type SettingsSection = "general" | "skills" | "tools" | "extensions";

export const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSection;
  label: string;
}> = [
  { id: "general", label: "General" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "Tools" },
  { id: "extensions", label: "Extensions" },
];

type SettingsViewProps = {
  activeSection: SettingsSection;
  cwd: string;
  commands: readonly CommandInfo[];
  transcriptItems: readonly TranscriptItem[];
  onReloadSkills: () => Promise<void>;
  reloadDisabled: boolean;
  sidebarWidth: number;
  contentWidth: number;
  resolvedTheme: BackgroundTheme;
  themePreference: ThemePreference;
  appFontFamily: AppFontFamily;
  autoExpandThinking: boolean;
  timelineMode: TimelineMode;
  autoExpandTools: boolean;
  notifyWhenBackground: boolean;
  notificationError: string | null;
  backgroundImagesEnabled: boolean;
  /* MF appearance settings: phase 2 */
  wallpaperOverlayPercent: number;
  onWallpaperOverlayPercentChange: (value: number) => void;
  customBackgrounds: BackgroundViews;
  backgroundPickerTheme: BackgroundTheme | null;
  backgroundError: string | null;
  onSectionChange: (section: SettingsSection) => void;
  onBackToChat: () => void;
  onThemePreferenceChange: (theme: ThemePreference) => void;
  onAppFontFamilyChange: (font: AppFontFamily) => void;
  onAutoExpandThinkingChange: (value: boolean) => void;
  onTimelineModeChange: (value: TimelineMode) => void;
  onAutoExpandToolsChange: (value: boolean) => void;
  onNotifyWhenBackgroundChange: (value: boolean) => void;
  onBackgroundImagesEnabledChange: (value: boolean) => void;
  onChooseBackgroundImage: (theme: BackgroundTheme) => void;
  onClearBackgroundImage: (theme: BackgroundTheme) => void;
};

function GeneralSettings({
  resolvedTheme,
  themePreference,
  appFontFamily,
  autoExpandThinking,
  timelineMode,
  autoExpandTools,
  notifyWhenBackground,
  notificationError,
  backgroundImagesEnabled,
  wallpaperOverlayPercent,
  onWallpaperOverlayPercentChange,
  customBackgrounds,
  backgroundPickerTheme,
  backgroundError,
  onThemePreferenceChange,
  onAppFontFamilyChange,
  onAutoExpandThinkingChange,
  onTimelineModeChange,
  onAutoExpandToolsChange,
  onNotifyWhenBackgroundChange,
  onBackgroundImagesEnabledChange,
  onChooseBackgroundImage,
  onClearBackgroundImage,
}: Omit<
  SettingsViewProps,
  "activeSection" | "cwd" | "commands" | "transcriptItems" | "onReloadSkills" | "reloadDisabled" | "sidebarWidth" | "contentWidth" | "onSectionChange" | "onBackToChat"
>) {
  return (
    <div className="settings-page-scroll">
      <div className="settings-page-content">
        <section className="settings-section">
          <h2>General</h2>
          <div className="settings-panel">
            <label className="settings-control-row">
              <span className="settings-row-icon">
                {resolvedTheme === "light" ? <Sun size={16} /> : <Moon size={16} />}
              </span>
              <span className="settings-row-copy">
                <strong>Theme</strong>
                <small>Choose the app appearance, or follow your system.</small>
              </span>
              <span className="settings-select-shell">
                <select
                  className="settings-select"
                  value={themePreference}
                  onChange={(event) => onThemePreferenceChange(event.target.value as ThemePreference)}
                  aria-label="Theme"
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
                <ChevronDown className="settings-select-chevron" size={15} aria-hidden="true" />
              </span>
            </label>

            <label className="settings-control-row">
              <span className="settings-row-icon"><TypeIcon size={16} /></span>
              <span className="settings-row-copy">
                <strong>Font</strong>
                <small>Choose Sans, Mono, or Miracode for the application.</small>
              </span>
              <span className="settings-select-shell">
                <select
                  className="settings-select"
                  value={appFontFamily}
                  onChange={(event) => onAppFontFamilyChange(event.target.value as AppFontFamily)}
                  aria-label="Font"
                >
                  <option value="sans">Sans</option>
                  <option value="mono">Mono</option>
                  <option value="miracode">Miracode</option>
                </select>
                <ChevronDown className="settings-select-chevron" size={15} aria-hidden="true" />
              </span>
            </label>

            <label className="settings-control-row">
              <span className="settings-row-icon"><Wrench size={16} /></span>
              <span className="settings-row-copy">
                <strong>Timeline detail</strong>
                <small>Compact groups tool calls; Full shows the original individual activity blocks.</small>
              </span>
              <span className="settings-select-shell">
                <select
                  className="settings-select"
                  value={timelineMode}
                  onChange={(event) => onTimelineModeChange(event.target.value as TimelineMode)}
                  aria-label="Timeline detail"
                >
                  <option value="compact">Compact</option>
                  <option value="full">Full</option>
                </select>
                <ChevronDown className="settings-select-chevron" size={15} aria-hidden="true" />
              </span>
            </label>

            <label className="settings-switch-row">
              <span className="settings-row-icon"><Brain size={16} /></span>
              <span className="settings-row-copy">
                <strong>Auto-expand thinking</strong>
                <small>In Full mode, open thinking while the model is reasoning. Completed thinking collapses automatically.</small>
              </span>
              <input
                type="checkbox"
                checked={autoExpandThinking}
                onChange={(event) => onAutoExpandThinkingChange(event.target.checked)}
              />
              <span className="settings-switch" aria-hidden="true" />
            </label>

            <label className="settings-switch-row">
              <span className="settings-row-icon"><Wrench size={16} /></span>
              <span className="settings-row-copy">
                <strong>Auto-expand tool calls</strong>
                <small>In Full mode, open tool details while a call is active. Completed calls collapse automatically.</small>
              </span>
              <input
                type="checkbox"
                checked={autoExpandTools}
                onChange={(event) => onAutoExpandToolsChange(event.target.checked)}
              />
              <span className="settings-switch" aria-hidden="true" />
            </label>

            <label className="settings-switch-row">
              <span className="settings-row-icon"><Bell size={16} /></span>
              <span className="settings-row-copy">
                <strong>Notify when a response finishes in the background</strong>
                <small>Show a system notification only if Molten Forge is not focused when Pi completes its response.</small>
              </span>
              <input
                type="checkbox"
                checked={notifyWhenBackground}
                onChange={(event) => onNotifyWhenBackgroundChange(event.target.checked)}
              />
              <span className="settings-switch" aria-hidden="true" />
            </label>
            {notificationError && <div className="settings-inline-error" role="alert">{notificationError}</div>}
          </div>
        </section>

        <section className="settings-section">
          <h2>Background</h2>
          <div className="settings-panel">
            <label className="settings-switch-row">
              <span className="settings-row-icon"><ImageIcon size={16} /></span>
              <span className="settings-row-copy">
                <strong>Show background image</strong>
                <small>Display the selected background image throughout the app.</small>
              </span>
              <input
                type="checkbox"
                checked={backgroundImagesEnabled}
                onChange={(event) => onBackgroundImagesEnabledChange(event.target.checked)}
              />
              <span className="settings-switch" aria-hidden="true" />
            </label>

            <div className="settings-control-row settings-wallpaper-overlay-row">
              <span className="settings-row-icon"><ImageIcon size={16} /></span>
              <span className="settings-row-copy">
                <strong>Wallpaper overlay</strong>
                <small>Repeat the wallpaper above panels, as in OpenCode. 0% disables the effect.</small>
              </span>
              <input
                className="settings-wallpaper-overlay-slider"
                type="range" min={0} max={25} step={1}
                value={wallpaperOverlayPercent}
                onChange={(event) => onWallpaperOverlayPercentChange(Number(event.target.value))}
                disabled={!backgroundImagesEnabled}
                aria-label="Wallpaper overlay opacity"
              />
              <output className="settings-wallpaper-overlay-value">{wallpaperOverlayPercent}%</output>
            </div>
            {(["light", "dark"] as const).map((backgroundTheme) => {
              const customBackground = customBackgrounds[backgroundTheme];
              const label = `${backgroundTheme === "light" ? "Light" : "Dark"} background`;
              return (
                <div className="settings-background-row" key={backgroundTheme}>
                  <span className="settings-row-icon"><ImageIcon size={16} /></span>
                  <span className="settings-row-copy">
                    <strong>{label}</strong>
                    <small title={customBackground?.name}>{customBackground?.name ?? "Default image"}</small>
                  </span>
                  <div className="settings-background-actions">
                    {customBackground && (
                      <button
                        className="settings-text-button"
                        type="button"
                        onClick={() => onClearBackgroundImage(backgroundTheme)}
                        disabled={backgroundPickerTheme !== null}
                      >
                        Clear
                      </button>
                    )}
                    <button
                      className="settings-choose-button"
                      type="button"
                      onClick={() => onChooseBackgroundImage(backgroundTheme)}
                      disabled={backgroundPickerTheme !== null}
                    >
                      {backgroundPickerTheme === backgroundTheme ? "Choosing…" : "Choose…"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {backgroundError && <div className="settings-inline-error" role="alert">{backgroundError}</div>}
        </section>
      </div>
    </div>
  );
}

export function SettingsView({
  activeSection,
  cwd,
  commands,
  transcriptItems,
  onReloadSkills,
  reloadDisabled,
  sidebarWidth,
  contentWidth,
  onSectionChange,
  onBackToChat,
  ...generalProps
}: SettingsViewProps) {
  return (
    <div
      className="settings-workspace"
      style={{
        "--settings-sidebar-width": `${sidebarWidth}px`,
        "--chat-width": `${contentWidth}px`,
      } as CSSProperties}
    >
      <aside className="settings-sidebar">
        <div className="settings-sidebar-titlebar" data-tauri-drag-region>
          <strong className="molten-forge-title">Molten Forge</strong>
        </div>

        <nav className="settings-sidebar-nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`settings-sidebar-row ${activeSection === section.id ? "active" : ""}`}
              onClick={() => onSectionChange(section.id)}
              aria-current={activeSection === section.id ? "page" : undefined}
            >
              {section.id === "general" ? <Settings2 size={16} /> : section.id === "skills" ? <BookOpen size={16} /> : section.id === "tools" ? <Wrench size={16} /> : <Puzzle size={16} />}
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <button className="settings-back-to-chat" type="button" onClick={onBackToChat}>
          <ArrowLeft size={15} />
          <span>Back to chat</span>
        </button>
      </aside>

      <section className="settings-main">
        <header className="settings-main-titlebar" data-tauri-drag-region>
          <strong>{SETTINGS_SECTIONS.find((section) => section.id === activeSection)?.label ?? "General"}</strong>
        </header>
        {activeSection === "general" ? <GeneralSettings {...generalProps} /> :
          activeSection === "tools" ? <PiToolsSettings items={transcriptItems} /> :
          activeSection === "skills" ? <PiSkillsSettings cwd={cwd} commands={commands} onReloadSkills={onReloadSkills} reloadDisabled={reloadDisabled} /> :
          <PiResourcesSettings cwd={cwd} commands={commands} />}
      </section>
    </div>
  );
}
