# ub-mode action log — v0.36.89

## First make it work

1. Inspected `docs/appearance.md`, AGENTS instructions, CSS design-system and ub-mode skills, v0.36.87/v0.36.88 CSS delta, and actual image/overlay layering.
2. Identified the regression: `.app-shell` wallpaper and its tint stayed intact, but v0.36.88 made `.chat-pane` and other full-height panes opaque, blocking the wallpaper.
3. Added a failing real-Chromium regression (`tests/background-visibility.browser.py`); v0.36.88 failed on the opaque chat pane in dark theme.
4. Introduced dedicated dark/light translucent tint tokens for wallpaper-covering panes, separate from foreground opaque card tokens. Did not reintroduce backdrop filters.

## Then make it right

5. Applied the tint tokens to chat, normal/Settings sidebar, main Settings pane, and nested Skills list/detail surfaces. The nested Skills tint is intentionally light to avoid stacking opacity to near-opaque.
6. Restored dark/light CSS specificity for `.session-sidebar`, `.settings-sidebar`, `.chat-pane`, `.settings-main` without adding `!important` or broad end-of-file overrides.
7. Updated the v0.36.88 opacity regression to assert the *foreground* card contract; retained the existing blur-free assertion. Retained streaming/Steer logic unmodified.
8. Extended the wallpaper regression to screenshot/pixel-check both themes with wallpaper enabled vs disabled under chat/sidebar and Settings/Skills.

## Verification

- `python tests/background-visibility.browser.py`: passed both themes, including enabled/disabled wallpaper, pane transparency and absence of backdrop-filter.
- `python tests/opaque-surfaces.browser.py`: passed both themes; foreground panels/cards stay opaque and blur-free.
- `python tests/generation-animations.browser.py`: passed both themes; no idle gradient repaint animation restored.
- Full TypeScript/Vitest/Tauri checks require installed npm dependencies and native Windows/WebView2; not asserted by this CSS-only patch.

The old v0.36.88 requirement that *all* full-height panels be opaque conflicted with a visible wallpaper. The revised contract separates unblurred tinted panes from opaque content surfaces.
