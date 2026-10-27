# ub-mode action log — v0.36.91

## First make it work

1. Read `AGENTS.md`, `.agents/skills/ub-mode/SKILL.md`, the CSS skill, and `docs/appearance.md`. Compare the CSS from source archives v0.36.87 (reference) and v0.36.90 (regressed).
2. Identified v0.36.88 change to `.user-bubble` background (`rgba(52,55,59,.64)` → generic `var(--app-glass-message)` = `#252526`), plus unwanted solidification of dedicated user-message tokens for dark and light.
3. Introduced Chromium regression `tests/user-message-palette.browser.py` before changing production CSS; confirmed the regression fails on the dark bubble.
4. Made the smallest CSS edit: `.user-bubble` uses its existing dedicated `--app-glass-user-message` token; restore that token's former dark/light tint values without bringing back `backdrop-filter`.

## Then make it right

5. Updated existing foreground-opacity test to treat intentionally translucent user-message bubble as an exception while all other content cards remain opaque. Added a matching Vitest CSS regression.
6. Updated appearance contract to state exception, and checked real Chromium computed styles for user-message color/alpha in both themes.
7. Executed Chromium foreground, wallpaper, and generation-animation tests in both themes. No streaming/Steer, tint, virtualizer, or layout changes.

## Limits

- Full `npm run check` / Vitest and Tauri build require dependencies and Windows runtime not present in this environment. No dependency changes were made. No Git repository metadata/commits in the source archive.
