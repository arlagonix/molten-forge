# Frontend skill audit

Audit target: Molten Forge Pi frontend/desktop architecture around v0.35.x.

This audit uses the project-local skills under `.agents/skills/` as review lenses. It is not a demand to rewrite working code. Existing `AGENTS.md` and feature-specific `docs/` contracts remain authoritative.

## Summary

| Area | Current fit | Main strengths | Main gap / next improvement |
| --- | --- | --- | --- |
| React performance | Strong | Memoized composer/transcript boundaries, turn virtualization, large-Markdown virtualization, incremental CodeMirror updates, local model-picker interaction state | Keep reducing unrelated root `App` state/render coupling; add profiling only when a concrete regression appears |
| Component architecture | Partial / improving | Pure logic is increasingly in `src/core/`; newer UI lives in `src/components/`; behavior has feature docs | `src/App.tsx` is still ~3.7k lines and owns many unrelated concerns; continue extracting cohesive UI/integration modules instead of adding more there |
| Accessible interactions | Partial | Native buttons/inputs, many aria-labels, Escape/outside-dismissal, keyboard model navigation, Enter parity | Model picker is a dialog of buttons rather than a full listbox pattern; search focus ring is intentionally suppressed, so visible keyboard highlight must remain strong; some buttons still omit explicit `type="button"` |
| Frontend testing | Strong | Broad Vitest regression suite, strict TypeScript, render/CSS contracts, pure helper tests, Rust tests | Several integration tests are source-text/CSS-regex contracts; useful today, but interaction-heavy features would benefit from real DOM/browser tests if the harness later adds one |
| CSS / design system | Partial / strong visuals | Dark/light variables, glass surfaces, established spacing, explicit overflow behavior, code palette, responsive truncation | `src/styles.css` is ~3.3k lines with accumulated overrides/repeated token sections; future styling should consolidate variables and feature sections rather than append more overrides |
| Tauri + React integration | Strong | Thin Pi-oriented bridge, explicit RPC path, minimal Tauri capability file, Rust coverage for paths/session/settings, Pi remains source of truth | `src-tauri/src/lib.rs` is ~850 lines; as native responsibilities grow, split process/session/settings concerns before the bridge becomes another monolith |

## 1. React performance

### Matches the skill well

- Composer draft/autocomplete state is isolated inside memoized `Composer`, so ordinary typing does not update root `App`.
- `ModelSwitcher` keeps open/search/highlight/pending state local.
- `TranscriptView` and transcript rows are memoized.
- `@tanstack/react-virtual` is used for turn virtualization.
- Very large Markdown has a second virtualization path.
- CodeMirror streaming updates use incremental document edits rather than rebuilding the entire editor.
- Chat auto-follow distinguishes programmatic scroll from reader intent and includes reader-anchor correction.

### Watch items

`App.tsx` remains a very large integration component. Local-state fixes already proved valuable for composer/model-picker performance; follow the same pattern for future interactive chrome. Do not pre-emptively split everything, but new self-contained state/effects should default to a component or hook outside `App`.

## 2. React component architecture

### Matches the skill

- `src/core/` is now a real pure-logic boundary rather than test-only duplication.
- Feature components such as `ModelSwitcher` and Markdown/code rendering are extracted.
- Feature behavior is documented (`chat-scroll`, `thinking-preview`, `markdown-rendering`, `composer-performance`, `model-switcher`, etc.).

### Gaps

- `App.tsx` is still about 3,700 lines and combines connection lifecycle, Pi RPC handling, settings, layout resizing, session navigation, appearance, and transcript orchestration.
- Some UI components (Composer, transcript activity components, settings UI) still live in `App.tsx`.

### Recommended direction

Extract only along stable responsibility boundaries. Good candidates when next touched are settings UI, connection/session shell, and transcript runtime components. Avoid a broad rewrite solely to reduce line count.

## 3. Accessible interactions

### Matches the skill

- Interactive controls predominantly use native buttons and inputs.
- Icon-only controls generally carry `aria-label`/`title`.
- Model picker supports search, ArrowUp/ArrowDown, Enter, Escape, outside-click dismissal, pointer hover, and keyboard-highlight scroll following.
- Selected model state has a checkmark, not color alone.

### Gaps / intentional exceptions

- The model search focus ring is intentionally suppressed by project design. This makes the highlighted option state especially important for keyboard users; do not weaken it.
- The model picker currently uses a dialog containing buttons rather than the stricter combobox/listbox + `aria-activedescendant` pattern. Current behavior is usable, but this is the main semantic accessibility improvement available later.
- A few buttons in `App.tsx` omit an explicit `type="button"`. They are safe in their current context but should be made explicit when those sections are touched.
- Error/status surfaces are not consistently announced with `aria-live`.

## 4. Frontend testing

### Matches the skill well

- The project has a large deterministic frontend suite plus Rust unit tests.
- `npm run test` combines Vitest with `tsc --noEmit`, preventing the earlier class of “tests green, build typecheck broken” regressions.
- Complex state machines have unusually broad coverage: scrolling, runtime grouping, thinking preview, code rendering, appearance persistence, model switching, and composer isolation.
- Pure logic is imported from production modules in tests.

### Gaps

- Some integration guarantees are asserted by reading source/CSS text. This is appropriate for the current dependency-light harness, but it is more brittle than behavior-driven DOM tests.
- There is no browser/E2E layer covering real focus, scroll geometry, Tauri window behavior, or full Pi RPC flows.

Do not add a heavy test stack just for its own sake. Add browser-level tooling when a class of bugs cannot be represented reliably by current pure/render tests.

## 5. CSS / design system

### Matches the skill

- Theme variables exist for dark/light surfaces and code syntax colors.
- Light-theme overrides are explicit for major UI surfaces.
- Old Molten Forge spacing/radius/glass behavior is documented and defended by tests.
- Horizontal table overflow, internal CodeMirror overflow, sticky code toolbar, sticky model-provider headings, and text ellipsis are deliberate contracts.

### Gap

`src/styles.css` has grown to roughly 3,300 lines and contains several historical override sections and repeated root variable blocks. Visual behavior is good, but maintainability is now the main risk. When a feature area is next substantially reworked, consolidate its variables/states instead of appending another late override block.

## 6. Tauri + React integration

### Matches the skill

- Pi remains the agent/runtime source of truth; the wrapper does not duplicate model/session logic unnecessarily.
- Frontend calls a small explicit Tauri command boundary.
- Default-model persistence preserves unrelated Pi settings.
- Windows path behavior, session parsing, text extraction, and token approximation have Rust tests.
- The Tauri capability file remains minimal (`core:default`).

### Gap

`src-tauri/src/lib.rs` is approaching 850 lines. It is still manageable, but future native additions should separate process lifecycle, Pi session metadata, and settings/filesystem helpers into modules rather than extending one file indefinitely.

## Practical priority

No skill review found a reason for a large rewrite. The highest-value rules for future work are:

1. Keep high-frequency React state local and protect long-chat render isolation.
2. Keep extracting deterministic logic to `src/core/` and new cohesive UI to `src/components/` instead of growing `App.tsx`.
3. Preserve complete keyboard behavior, including keeping keyboard-highlighted rows visible in scrollable pickers.
4. Continue broad regression tests plus TypeScript/build checks.
5. Consolidate CSS and Rust modules opportunistically when those areas are already being changed, not via risky cleanup-only rewrites.
