# ub-mode action log — v0.36.90

## First make it work

1. Read `AGENTS.md`, `docs/appearance.md`, the `ub-mode` and CSS design-system skills, and the v0.36.89 production CSS/browser regression.
2. Identified mismatch: dark chat `rgba(10,12,14,.70)` vs dark Settings `rgba(30,30,30,.82)`; light chat alpha `.72` vs light Settings alpha `.80`.
3. Extended `tests/background-visibility.browser.py` to assert computed chat/Settings pane backgrounds match. Confirmed the test failed with the dark-theme mismatch before changing CSS.
4. Replaced separate `--app-workspace-tint` theme values with a direct alias of `--app-settings-tint` in both theme definitions. Did not touch underlying wallpaper gradient, blur policy, or foreground tokens.

## Then make it right

5. Updated `docs/appearance.md` so the relationship between the two tints is explicit; no duplicated new colors or theme-specific element overrides.
6. Confirmed `tests/background-visibility.browser.py`, `tests/opaque-surfaces.browser.py`, and `tests/generation-animations.browser.py` pass for both light and dark themes. These checks use Chromium and production CSS.
7. Updated exact application version fields and only the application package entry in `Cargo.lock`. No dependency changes. Tauri/Vitest builds depend on unavailable npm modules in this environment and are not claimed.

No unrelated component or Pi RPC changes.
