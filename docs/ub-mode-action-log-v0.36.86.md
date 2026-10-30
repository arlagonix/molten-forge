# ub-mode change log — v0.36.86

## First make it work

1. Read `AGENTS.md`, `ub-mode`, frontend-testing, React performance/component, CSS design skills, and chat-scroll/composer contracts. Identified two conflicting concerns: textarea sizing had historical CSS and JS declarations, and supplementary UI had no *combined* overlay bound.
2. Wrote optional real-Chromium browser geometry regression, using the production stylesheet and a representative DOM. **RED:** 360px chat pane with queued messages, attachments, status and extension widgets yielded an overlay ~1006px tall, leaving a negative reading viewport; assertion failed.
3. Bounded the full overlay to `100% - min(160px, 33%)`, gave optional panels flex-shrink and internal scroll boundaries, and preserved the established measured overlap clearance.
4. **GREEN:** Chromium confirmed the last message ends above the overlay when scrolled to bottom at all tested heights.

## Then make it right

5. Browser regression uncovered a second edge case: aggressively shrinking the queue reduced it to nearly zero height. Reserved 52px for the queue header plus a message row and raised optional widget/status shrink priority.
6. Another regression exposed a nearly-collapsed textarea. Preserved its 72px minimum, and removed JavaScript's inline `overflowY` toggles; CSS `overflow-y:auto` now ensures the draft remains scrollable after flex shrink. Removed obsolete early 210px CSS max-height so the JS 11-line/35%-of-pane limit remains authoritative.
7. Tested crowded and normal states in both light and dark themes at 800, 520 and 360px, including shrinking/re-expanding the **same mounted DOM**. The browser fixture imports `composerOverlayClearance` and `textareaHeightLimit` from compiled production TypeScript instead of duplicating the sizing decision.
8. Updated the feature contract and release notes. No React root state or Pi RPC changes; the mature scroll-follow and reader-anchor logic stays intact.

## Skill conformance / limits

- **ub-mode:** Small, reversible layout-specific fix; failing test first; verified root cause; one height-max owner for the textarea; observable browser assertions (not only source-text matches); this action log records work.
- **React performance:** No new React state, root subscriptions, transcript rerenders, or new animation loops.
- **CSS design:** Reused project tokens; no new light/dark-specific colors or libraries. Measured visible viewport and internal overflow, not only style declarations.
- **Frontend testing:** Browser fixture exercises real CSS box geometry and production pure sizing helpers; it is not a full rendered React/Tauri/WebView2 test.
- **Crapper / Dryer / Mutator:** Tools are not installed; no numerical compliance is claimed. Git commit/push was not performed in the source-archive workspace.
- **Worktree cleanup:** Copied the v0.36.85 source as an isolated working tree; retained inputs, outputs, and audit artifact, and included no generated caches in the ZIP.
