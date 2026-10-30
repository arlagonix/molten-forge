---
name: react-performance
description: Use before changing React state ownership, streaming UI, composer input, transcript rendering, memoization, or virtualization in Molten Forge. Prevents keystroke-driven root renders and long-chat regressions.
---

# React performance

Read `AGENTS.md` first. Project contracts override generic advice. For chat/composer work also read `docs/composer-performance.md` and `docs/chat-scroll.md`.

## Workflow

1. Identify the state owner before editing. Keep rapidly changing UI state in the smallest component that needs it.
2. Treat the transcript as a long-list hot path. Do not let composer typing, picker search, hover state, or popover state update root `App` unless application state truly changes.
3. Preserve referential identity for unchanged transcript items and stable props across memo boundaries.
4. Keep turn-level virtualization and large-Markdown virtualization. Never replace measured dynamic rows with fixed-height assumptions.
5. For streaming code, thinking, and Markdown, update incrementally where practical instead of recreating expensive viewers.
6. Avoid effects that subscribe globally on every render. Keep event handlers/effect dependencies intentional and clean up listeners/timers/frames.
7. Before finishing, inspect the render path from the interaction you changed and add a regression test for any important isolation contract.

## Molten Forge checks

- Composer draft/autocomplete/textarea resize stays inside memoized `Composer`.
- Model picker open/search/highlight state stays inside memoized `ModelSwitcher`.
- Transcript remains memoized and virtualized.
- Smooth streaming follow and reader-anchor behavior remain intact.
- CodeMirror editors are not recreated for every streamed delta.

## Verification

Run `npm run test` and `npm run build`. For performance-sensitive state changes, add or extend a structural regression test that proves the hot state did not move into root `App`.
