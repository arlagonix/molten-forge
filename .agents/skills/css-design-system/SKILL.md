---
name: css-design-system
description: Use for Molten Forge styling, themes, glass surfaces, spacing, overflow, responsive layout, code colors, or visual state changes. Preserves old Molten Forge visual contracts without accidental dark-only CSS.
---

# CSS and design-system work

The old Electron Molten Forge is the visual reference. Read the relevant `docs/` file and inspect existing CSS before inventing new styling.

## Rules

- Reuse existing variables/tokens for themeable surfaces where available.
- Every new visible surface must be checked in both dark and light themes.
- Preserve the established 16 px base font, 4 px default radius where applicable, 8 px internal runtime spacing, and 32 px turn spacing unless a feature contract says otherwise.
- Treat overflow as a first-class behavior: lists own their scroll boundary, wide tables scroll horizontally, CodeMirror scrolls internally, and popovers stay within the viewport.
- Avoid focus/hover rules that change geometry and cause layout shift.
- Do not duplicate large blocks of dark/light CSS when a variable can express the difference cleanly.
- Keep sticky headers/toolbars inside the correct scrolling ancestor.
- When adding a compact picker/menu row, preserve text ellipsis and `min-width: 0` so long model/session names cannot widen the layout.

## Review

Check: dark, light, long labels, narrow window, scroll overflow, selected/hover/disabled/focus states, and background-on/background-off appearance.
