---
name: accessible-interactions
description: Use for popovers, menus, pickers, dialogs, keyboard navigation, focus behavior, and interactive controls in Molten Forge. Ensures keyboard/pointer parity and stable focus/scroll behavior.
---

# Accessible interactions

Project-specific visual decisions in `AGENTS.md` and `docs/` take precedence, but keyboard behavior must remain complete and understandable.

## Interaction contract

- Every pointer action needs a keyboard path when the control is keyboard reachable.
- Use native `button`, `input`, and other semantic elements before recreating them with divs.
- Give icon-only controls an `aria-label` and useful `title` where appropriate.
- Popovers/dialogs must dismiss predictably with Escape and outside pointer input when that matches the UX.
- When ArrowUp/ArrowDown changes a highlighted option in a scrollable list, keep that option visible with `scrollIntoView({ block: "nearest" })` or equivalent. Pointer hover must not cause surprise scrolling.
- Enter activates the same selected/highlighted action as pointer click.
- Search/filter changes must never leave highlight pointing at an invisible option.
- Do not rely on color alone for selected/pending state when a compact icon/state marker can be used.
- If a project-specific control intentionally suppresses a native focus ring, maintain an obvious keyboard highlight/active surface and document the exception.
- Avoid leaking framework-only props into DOM elements.

## Verification

Test keyboard navigation boundaries, wrapping, Enter activation, filtering, dismissal, and scroll-follow of the highlighted row. Check both dark and light themes for visible interaction state.
