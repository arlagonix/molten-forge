# Molten Forge — Agent Guide

## Purpose

Molten Forge is a small Tauri desktop client around the system-installed Pi coding agent. Pi owns the agent/runtime behavior; Molten Forge owns the desktop UX, rendering, session navigation, and native integration.

Keep the wrapper thin. Do not reimplement Pi features when Pi already exposes them through RPC, session files, extensions, skills, or commands.

## Architecture

- `src/` — React/TypeScript UI.
- `src/App.tsx` — application shell and Pi RPC event integration.
- `src/core/` — pure/testable frontend logic. Prefer putting parsing, grouping, formatting, and state transformations here instead of growing `App.tsx`.
- `docs/runtime-grouping.md` — source of truth for Thinking/tool/retry runtime grouping and explicit parallel-tool subgroup boundaries. Read it before changing transcript grouping.
- `docs/releasing.md` — release/version rules, source-of-truth release notes, and publication validation. Read before version bumps or release packaging.
- `docs/appearance.md` — source of truth for System/Light/Dark theme behavior, old Molten Forge palette compatibility, background visibility, and per-theme custom backgrounds. Read it before changing appearance settings.
- `docs/window-chrome.md` — source of truth for the frameless Tauri title bar, old Molten Forge window controls, drag regions, and startup loading screen. Read it before changing desktop chrome or startup hydration UI.
- `docs/chat-scroll.md` — source of truth for smooth sticky-to-bottom scrolling, manual-reader intent, suppression/resume rules, and programmatic-scroll guards. Read it before changing transcript scrolling.
- `docs/thinking-preview.md` — source of truth for collapsed-thinking one-second live-line sampling and completed first-line previews.
- `docs/markdown-rendering.md` — source of truth for CodeMirror code blocks, syntax-token colors, code toolbar behavior, fullscreen rendering, and horizontally scrollable tables.
- `docs/tool-text-output.md` — source of truth for CodeMirror-backed verbatim tool output, conservative syntax detection, read line numbering, and the boundary between text viewers and structured tool UIs.
- `docs/pi-queue-and-composer.md` — source of truth for Pi steering/follow-up queues, composer send mode, and tall-composer viewport clearance.
- `docs/composer-performance.md` — source of truth for keeping textarea draft/autocomplete state out of root `App` so composer keystrokes cannot rerender the transcript.
- `docs/model-switcher.md` — source of truth for the composer model picker, local search/filtering, compact id-only rows, provider grouping, silent `set_model` switching, and the rule that clicking a model never creates transcript content.
- `docs/context-usage.md` — source of truth for the shared header/composer context telemetry popover, compact percentage display, usage fields, context breakdown, and post-compaction estimate presentation. Read it before changing context/token telemetry.
- `docs/pi-rpc-lifecycle.md` — source of truth for Pi request correlation, prompt settlement, interruption/recovery, session mutation synchronization, direct bash, extensions, and graceful shutdown. Read it before changing any Pi/Tauri interaction.
- `docs/attachments.md` — managed local attachments, image RPC payloads, clipboard/drop, path security and persistence lifecycle.
- `docs/pi-integration-audit.md` — current audit of the wrapper against Pi's RPC/session boundary.
- `src/styles.css` — app styling.
- `src-tauri/src/lib.rs` — Rust/Tauri bridge that starts Pi, sends JSONL RPC records, reads stdout/stderr, handles folders, and reads Pi session metadata.
- Pi is system-installed and launched in RPC mode. Do not bundle or fork Pi unless the project direction explicitly changes.

Before changing attachments, read `docs/attachments.md`.

## Skills workflow

Project-local agent skills live under `.agents/skills/`. This is the canonical, harness-neutral location for engineering guidance used by any coding agent working on this repository. **Before substantial React/frontend/Tauri work, read the relevant skill(s) and follow their checklist before editing unless the task is genuinely unrelated.** Do this regardless of which agent harness is currently running the task. If the harness does not automatically discover `.agents/skills/`, read the relevant `SKILL.md` files directly. This is especially important for areas with regressions that are easy to reintroduce.

Recommended skills:

- `.agents/skills/release-notes/SKILL.md` — consistent, source-grounded Features / Changes / Fixes release notes and GitHub Release prose. Read before publishing any release notes.

- `.agents/skills/ub-mode/SKILL.md` — overall change discipline (first make it work, then make it right, then practice); read before code modifications. It supplements the feature-specific skills and does not require running unavailable external tools.
- `.agents/skills/react-performance/SKILL.md` — state ownership, memoization, long-chat rendering, virtualization, streaming hot paths.
- `.agents/skills/react-component-architecture/SKILL.md` — component boundaries, `src/core/` extraction, keeping `App.tsx` from accumulating unrelated responsibilities.
- `.agents/skills/accessible-interactions/SKILL.md` — keyboard/pointer parity, focus, popovers, highlighted-option scrolling.
- `.agents/skills/frontend-testing/SKILL.md` — broad Vitest/typecheck/render regression coverage.
- `.agents/skills/css-design-system/SKILL.md` — dark/light theming, glass surfaces, spacing, overflow, responsive styling.
- `.agents/skills/tauri-react-integration/SKILL.md` — Pi RPC/Tauri/native boundary work.

For a cross-cutting change, load more than one relevant skill. `AGENTS.md` and feature-specific documents under `docs/` are project contracts and override generic skill advice if there is a conflict. See `docs/frontend-skill-audit.md` for the current project review against these skills.

## Reference implementation

The old Electron Molten Forge UI is the reference for established visual behavior. When an old implementation exists for a requested UI behavior, inspect and reuse its logic/styles rather than approximating it.

Important established behavior includes:

- dark glass/background treatment, with translucent full-height wallpaper tints (no backdrop blur) and opaque content cards;
- 16 px default UI/chat font;
- 4 px default border radius unless an element is intentionally circular;
- 8 px spacing between blocks inside one logical turn;
- 32 px spacing between user/agent turns;
- compact thinking/tool blocks and Molten Forge hover icons;
- composer overlay/blur behavior;
- resizable/persisted chat and sidebar widths;
- context ring and model controls in the composer;
- transcript virtualization and large-Markdown virtualization;
- smooth streaming auto-follow that yields to real user scroll intent;
- collapsed thinking previews that sample the live last row once per second, then show the first row after completion;
- CodeMirror fenced-code blocks with the established syntax palette and horizontally scrollable GFM tables.
- Sticky fenced-code headers depend on transform-free transcript virtualization. Preserve the old Electron implementation: TanStack Virtual direct DOM updates in `position` mode, containerRef-owned list sizing, and no transforms/hard-coded main-axis `top` on virtual transcript rows. Read `docs/markdown-rendering.md` before changing transcript virtualization or code-block chrome.

## Pi integration rules

- **Before changing any Pi interaction, read `docs/pi-rpc-lifecycle.md` and `.agents/skills/tauri-react-integration/SKILL.md`.** Treat lifecycle changes as cross-boundary work and add regression coverage.
- Writing an RPC record to stdin is not completion. State/lifecycle-changing commands must use correlated Pi `response` records when later behavior depends on success.
- Stop must follow `clear_queue → abort → verified idle → state/history resync`; never flip the UI to idle solely from a click.
- After interruption, verify persisted history has no unmatched tool calls before treating the branch as portable to another provider/harness. Preserve the original branch when recovery requires a fork.
- Session-changing commands must resynchronize authoritative Pi state/history before re-enabling input.
- Shutdown must close Pi stdin first and allow graceful disposal before force termination fallback.
- Treat Pi RPC/session data as the source of truth.
- A Pi `prompt` response is acceptance, not model completion. Keep the run busy until `agent_settled` or an authoritative idle `get_state`; compaction/retry phase-end events are not whole-run idle barriers.
- Finalized assistant failures come from `message_end.message.stopReason/errorMessage`, but retry intent is only known at `agent_end`. Buffer assistant errors across that boundary; retryable attempts belong to Retry activity, while a still-pending non-retryable failure is surfaced at `agent_settled` and must also reappear correctly in restored history.
- Provider-side abort failures such as `Provider finish_reason: abort` are terminal interruptions for the current turn: stop still-running Thinking/tool chrome immediately, preserve partial payloads, and keep input blocked through authoritative state/history reconciliation. Dangling tool calls use the same clean-fork recovery as explicit Stop.
- The lifetime `pi-record` listener must dispatch through the latest handler ref so incoming events never observe first-render React state.
- Preserve unknown/new RPC output instead of silently dropping it when practical.
- Extension/skill/prompt commands come from Pi discovery; interactive TUI-only commands may need wrapper mappings.
- A single Pi process has one active session. Do not pretend background generation can survive session switching unless multiple runtimes/processes are implemented.
- Do not display raw internal/session metadata as chat content unless it is explicitly useful to the user.
- Compaction/retry/tool lifecycle events should render as compact runtime activity, not as raw RPC JSON. Compaction is session maintenance: render it with the shared compact tool chrome, but keep it a hard runtime-group/parallel-tool boundary.
- During Stop, a Pi compaction that outlives the normal abort window stays in `Stopping compaction…`; reassert abort when compaction yields and use a same-session process restart only as the long-stall fallback before authoritative resync.
- Context usage must follow Pi turn boundaries: refresh session stats at `turn_end`/settlement rather than polling every streaming delta. Immediately after compaction Pi may report `contextUsage.tokens/percent = null`; display Pi's `estimatedTokensAfter` as an approximate value until a later assistant turn restores authoritative usage. Never render that null state as a false `0`.
- Header token telemetry and the composer context ring must reuse the same `ContextUsagePopover`; keep its open/close state local to the component. The header percentage is a separate telemetry item with the same gap as its neighbors, not text joined to `used/limit`. Do not add KV-cache totals to the shared popover; see `docs/context-usage.md`.
- Explicit transcript-producing actions (slash commands and direct `!`/`!!` bash as well as normal prompts) must re-arm forced bottom-follow so their newly appended blocks land visibly even if idle scrolling previously disabled follow.
- Model changes made through the wrapper should persist through Pi settings and remain stable when switching sessions unless Pi/project settings explicitly override them.
- The composer model picker must use Pi's `get_available_models`/`set_model` RPCs, group choices by provider, keep its search/filter/highlight state local to the picker, render compact id-only rows, keep keyboard-highlighted rows visible while arrowing through long lists, and send model changes silently so application-chrome interaction never appears as a chat message/tool block; see `docs/model-switcher.md`.
- Thinking must become complete as soon as tool-call construction begins; a later running tool must not keep the preceding thinking block visually in progress.
- Runtime grouping must follow `docs/runtime-grouping.md`: a Thinking block after any tool starts a new reason → act group; consecutive tools stay together; explicit Pi tool batches create nested parallel subgroups without merging distinct batches.
- Tool output UI must not claim output exists before tool execution has actually started.

## Performance rules

Long chats are a first-class case.

- Do not make composer keystrokes rerender the root app or transcript. Draft text, command suggestions, selection state, and textarea auto-resize belong inside the memoized Composer boundary; see `docs/composer-performance.md`.
- Preserve referential identity of unchanged transcript items during streaming updates.
- Keep expensive Markdown parsing out of unrelated renders.
- Keep turn-level virtualization through `@tanstack/react-virtual`.
- Transcript virtual rows are a sticky-positioning boundary: use TanStack Virtual `directDomUpdatesMode: "position"`; do not position them with CSS transforms because that breaks sticky code headers and viewport-fixed descendants.
- Keep large Markdown block virtualization; do not replace it with mounting the entire document.
- Do not replace the scroll-follow state machine with a plain near-bottom check. Programmatic scroll events must remain distinguishable from wheel/keyboard/touch/scrollbar user intent; see `docs/chat-scroll.md`.
- Do not recreate CodeMirror editors on every streaming delta; preserve incremental document edits and lazy language loading.
- Avoid fixed-height assumptions for thinking, tools, Markdown, or user content.

## Testing policy

Tests are part of the implementation, not optional cleanup.

- New pure logic should be placed in a testable module and get unit tests.
- Every bugfix should get a regression test when the failure can be represented deterministically.
- Runtime wiring changes (imports, exported constants, component references) must pass TypeScript typecheck; unit tests alone are not sufficient.
- Changes to parsing/grouping/command handling/virtualization helpers must update or add tests.
- Rust parsing/path/session helpers should have Rust unit tests when practical.
- CSS-only visual changes do not require artificial unit tests, but must not break existing logic tests.
- Cover as much deterministic behavior as practical. For stateful UI features, test defaults, persistence/normalization, state transitions, independent settings, invalid input, and fallback/error paths where those behaviors can be extracted from rendering. Do not stop at one happy-path test.
- Prefer **generous regression coverage** over a minimal single-case test. For interaction state machines (scrolling, streaming, collapsing, retries, grouping), cover every meaningful branch and transition that can be expressed deterministically.
- For rendering contracts that matter structurally (for example a table scroll wrapper or fenced-code toolbar), add a lightweight render/SSR test in addition to pure helper tests when practical.
- Source-text contract tests must assert meaningful structure/behavior, not incidental whitespace, line breaks, or equivalent code formatting. Prefer regex/behavioral assertions that survive harmless refactors.
- When a UI feature mixes rendering with state/storage logic, move the state/storage decisions into `src/core/` so the behavior can be tested without a browser-heavy component harness.
- Do not duplicate production algorithms inside tests. Tests must import/use production logic.
- Standalone `scripts/*.test.mjs` use Node’s test runner; Vitest is filtered to `src/` by npm scripts so the runners do not collect each other’s test files.

Before considering a change complete, run:

```bash
npm run test      # unit tests + TypeScript typecheck
npm run build
npm run test:rust
```

Or run all checks with:

```bash
npm run check
```

During development:

```bash
npm run test:watch
```

## Current test coverage

Frontend tests currently cover:

- thinking whitespace normalization;
- fenced Markdown-table recovery;
- command metadata/order invariants;
- thinking/tool phase boundaries, consecutive-tool grouping, and explicit parallel-batch segmentation;
- appearance preference normalization/persistence, System theme resolution, background visibility, custom/default background selection, supported image formats, bundled default-background asset imports, stored-background validation, and unavailable-storage fallback;
- thinking/tool auto-expand state helpers and tool output/preview visibility;
- thinking completion when tool-call construction begins;
- logical conversation-turn construction;
- user/agent spacing assumptions used by virtualization;
- virtualization offset lookup;
- referential equality used by memoization;
- sampled 80 ms chat auto-follow, explicit reader ownership, visual transcript freezing while the reader is away from the live bottom, one final `agent_settled` flush with logical-anchor preservation, manual wheel/keyboard/touch/scrollbar intent, exact-bottom resumption, streaming/final-flush virtualizer scroll ownership, browser-anchor suppression, deterministic thinking/tool auto-collapse, bounded/auto-following running Thinking, full-height completed Thinking, and giant user prompts, and empty-history top landing/non-scrolling empty-session layout;
- collapsed-thinking preview cleanup, first/latest-line selection, one-second cadence, in-progress sampling, and completion behavior;
- code-language aliases, download filenames, incremental CodeMirror document edits, fenced-code frame/toolbars, inline-code separation, horizontal GFM-table wrapper rendering, exact dark/light syntax-palette contracts, sticky code-toolbar styling, transform-free transcript virtualization required by sticky headers, and CodeMirror/table overflow contracts;
- syntax-aware tool text rendering: conservative metadata/path/structure detection, read offset line numbering, terminal/plain fallback behavior, specialized-tool exclusions, wrapped output surfaces, and historical-write reuse of the shared viewer;
- composer render isolation: draft/autocomplete/textarea sizing stay local to memoized Composer while root App and TranscriptView remain outside the per-keystroke hot path.
- model picker grouping/deduplication/matching/RPC construction plus provider/id search filtering, compact id-only rendering, search reset, silent switching, local popover state, provider headings, keyboard highlight wrap/Enter selection, keyboard-only scroll-into-view, and dismissal behavior.
- live Pi context usage: authoritative vs post-compaction estimated/unknown states, turn-boundary refresh wiring, and command-triggered bottom-follow re-arming;
- Rust lockfile integrity for previously corrupted pinned crate entries (currently `tao 0.35.2`).

Rust tests currently cover:

- token approximation;
- extraction of text from Pi message content;
- path normalization;
- Windows case-insensitive path comparison;
- Pi session metadata/name/first-message parsing and cwd filtering;
- preservation of unrelated Pi settings when persisting the default provider/model.

When touching these areas, extend the existing tests rather than creating parallel one-off test helpers.

## Dependency policy

Prefer the platform, Pi, React, Tauri, and already-installed libraries. Add dependencies only when they clearly reduce complexity or provide a well-tested implementation of nontrivial behavior.

### Tauri npm/Rust version compatibility

- Keep `@tauri-apps/api` pinned to the **same major/minor** release as the declared and resolved `tauri` Rust crate. npm `^` ranges can otherwise advance to the next Tauri minor while Cargo.lock remains on the previous release. `scripts/sync-tauri-lock.mjs` reconciles an outdated lockfile before Tauri CLI runs; Cargo must generate its own checksums and transitive resolutions.
- Keep `@tauri-apps/cli` and notification JS/Rust plugin version pins coherent and verify them before shipping a new source archive.
- When adding a Rust plugin, regenerate Cargo.lock using Cargo, not hand-edited checksums. The source archive may have a stale lockfile only until the first Cargo build; this is not a substitute for a tested release.

### Cargo lockfile integrity

- Treat `src-tauri/Cargo.lock` as generated dependency state. Do **not** manually change transitive crate versions or checksums.
- Never perform a global version-string replacement across `Cargo.lock` when bumping the Molten Forge application version; dependency versions can coincidentally match the app version.
- When bumping the app version, edit only Molten Forge's own package entry in `Cargo.lock` (or let Cargo regenerate it).
- Change Rust dependency versions through Cargo and keep the resulting lockfile. Cargo checksum errors are integrity failures, not warnings to suppress.
- Keep deterministic regression coverage for any lockfile corruption that has previously reached a release archive.

## Build and artifacts

Development:

```bash
npm install
npm run tauri:dev
```

Production:

```bash
npm run tauri:build
```

Source archives should exclude generated/heavy directories such as `node_modules`, `src-tauri/target`, build outputs, caches, `.git`, and prior archives. Keep lockfiles when present.


## Layout regression guard

- Sidebar collapse must not change the chat column geometry or leave a phantom sidebar column. The sidebar width preference is persisted independently from collapsed state.
- Windows taskbar icons use pre-rendered physical sizes matched to the current DPI; do not replace this with a single oversized runtime image without checking taskbar sharpness.
- Transcript/composer alignment uses the rendered transcript column as the geometry source of truth. Keep composer, command menu, extension widgets, local composer blur, and resize guides on the shared `--chat-content-physical-width` / `--chat-content-center-offset` geometry; do not reintroduce guessed scrollbar offsets.
- The project launcher uses the Molten Forge logo and a persisted newest-first recent-project list; see `docs/window-chrome.md`.

- Model picker keyboard behavior is a regression contract: no search focus ring; ArrowUp/ArrowDown move the highlight and automatically scroll that highlighted row into view within the model-list container, accounting for the sticky provider heading; pointer hover must not auto-scroll; Enter must select the highlighted filtered model.
