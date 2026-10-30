# ub-mode action log — v0.36.87

## First make it work

1. Read `AGENTS.md`, `ub-mode`, `css-design-system`, `react-performance`, and `frontend-testing` skills plus the appearance contract. Scoped the performance hypothesis to the two continuously animated background-position gradients: title and generation status/spinner leaves.
2. Added `tests/generation-animations.browser.py`, a Chromium DOM/CSS regression fixture loading the *production stylesheet*. **RED:** Dark-mode idle title had one running `molten-forge-lava-flow`; generating status had one `generating-gradient-slide` and eight leaf animations. The assertion for no title animation failed as expected.
3. Removed only these paint-heavy animation declarations and the now-unused keyframes, retaining static gradients and `molten-radix-spinner-rotate` for the parent spinner. No JS/RPC changes.
4. **GREEN:** Chromium in both themes confirms title/text/eight leaves have no CSS animations, dark title gradient remains, light title stays neutral, and the parent spinner still rotates.

## Then make it right

5. Kept the startup splash unchanged (it has a bounded lifetime) and retained other transform-based tool/thinking loading icons. No new framework/dependency or global animation suppression.
6. Documented how to compare before/after CPU use in Windows Task Manager and recorded the limit: headless Chromium animation inspection is not a WebView2 CPU profile.
7. Bumped app version in `package.json`, Tauri config, Cargo manifest, and only the application entry of Cargo.lock. No third-party lock checksums were changed.

## Practice / verification boundaries

- Behavior test is the actual computed CSS animation list, not a source-string assertion. Red → green was observed.
- The smallest-change principle and one owner for each paint animation were followed; no chat scrolling/render code was touched.
- CPU percentage reduction **cannot be guaranteed** without comparing the installed WebView2 build on Windows.
- Crapper/Dryer/Mutator are unavailable here, so numerical quality gates are unverified. No Git commit/push is possible without the user's repository metadata.
