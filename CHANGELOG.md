# Changelog

## 2.0.0 — Tauri / Pi architecture (2026-10-30)

Molten Forge 2.0.0 replaces the original Electron application with a lightweight Tauri desktop client around the system-installed Pi coding agent.

See [2.0.0 release notes](docs/releases/v2.0.0.md) for user-facing features, changes, and fixes.

## Earlier Tauri/Pi development builds

The entries below are historical development notes retained for reference; they are not separate public 2.x releases.

The entries below are newest-first and record the incremental development history that led to the current implementation.

## v0.36.93 — Solid sidebars matching the chat header

- Fixes v0.36.92's half-transparent left column. The session sidebar and the Settings sidebar are now **opaque** and share the chat header's exact surface: `--app-chrome-tint` is `var(--app-glass-card)` itself, with no `color-mix(... transparent)` or alpha form left anywhere in the token.
- This intentionally overrides the previous "every full-height pane must be translucent" contract for these two panes only. Chat, Settings main and the Skills subpanes stay translucent so the wallpaper is still visible where it belongs.
- Rewrote the affected tests to the new contract instead of patching weights: the source check now rejects any alpha chrome token, an SSR/CSS contract asserts both sidebars equal the header surface, and the Chromium regression measures a zero wallpaper delta inside each sidebar while still requiring the wallpaper to show through the chat column and Settings pane, in both themes.
- Test fixture gained the missing `--session-sidebar-width`, so the sidebar/chat split is measured at real coordinates rather than collapsing to a single column.

**Upgrade:** Nothing to delete. Extract over v0.36.92; no new dependencies, no identifier or storage-path changes.

## v0.36.92 — Sidebar tint, reachable projects, unified list paging

- Both sidebars (projects/conversations and Settings) now derive their tint from `--app-glass-card`, the same surface as the chat header, instead of a darker cool-grey of their own. Mixing weight stays at 82% so the wallpaper remains visible through the panes.
- Projects whose folder no longer exists are no longer listed. A deleted directory cannot host a Pi session, so the row only offered an action that could not succeed; this also removes the duplicated `Folder not found` label that appeared both under the project name and again after clicking it. Sessions on disk are untouched — restore the folder and the project returns on next load. The active project is always kept so an open conversation is never stranded.
- Project paging now mirrors the conversation list: `Show 12 more (N)` and `Show less` step in whole batches. The previous `Show all projects` button and the 25-row infinite-scroll sentinel are gone, so the sidebar has one paging mechanism instead of two.
- Extracted the shared batching step into `nextVisibleCount` with `nextVisibleSessionCount`/`nextVisibleProjectCount` wrappers, and `visibleProjectPaths` as the single place that decides which projects are on screen (including the active-project guarantee).
- Tests cover batch stepping in both directions, out-of-step normalization, slicing/empty lists, active-project pinning and case-insensitive matching, plus render contracts for the new labels and the absence of `Show all`.

**Upgrade:** Nothing to delete. Extract over v0.36.91; no new dependencies, no identifier or storage-path changes.

## v0.36.91 — Restore user-message colors

- Fixes the unintended v0.36.88 change that painted dark-theme user bubbles with the generic `#252526` card color. Their original distinct background `rgba(52,55,59,.64)` is restored; light-theme user bubbles return to the original primary-color surface at 90% opacity. No backdrop blur is reintroduced.
- Applies one existing dedicated `--app-glass-user-message` token to user bubbles in both themes; foreground tool/card colors and the chat/Settings wallpaper tint stay unchanged.
- Adds a real-Chromium regression for the original user-message colors and updates the generic opaque-card checks to exempt deliberately tinted user messages. Existing background, animation, composer and Node checks remain unchanged.

**Upgrade:** Nothing to delete. Extract over v0.36.90; no new dependencies. Full Vitest/Tauri builds require installed npm modules and Windows tooling.

## v0.36.90 — Match chat wallpaper tint to Settings

- Chat now uses exactly the same unblurred, translucent full-pane tint as the Settings main area in both light and dark themes. The chat tint token aliases `--app-settings-tint`; sidebar and Skills tints stay as they were.
- The wallpaper remains visible under the shared tint; foreground cards stay opaque. No changes to Steer, streaming, scroll, virtualization, or the Settings pane.
- Added an actual-browser assertion that computed chat and Settings tints are identical in both themes, while the wallpaper remains visible when enabled.

**Upgrade:** No files or folders need deleting. Extract over v0.36.89. No new dependencies.

## v0.36.89 — Restore wallpaper beneath tint panels (no backdrop blur)

- Fixes v0.36.88 hiding the default/custom background image: opaque full-height chat/sidebars/Settings/Skills panes completely obscured the wallpaper. The image and `.app-shell` translucent overlay had not been removed.
- Restores **theme-aware translucent tint backgrounds only on full-height panes**; opaque message/tool/composer/popover cards stay opaque, and `backdrop-filter` remains removed.
- Maintains the `Show background image` toggle. Added Chromium pixel regression covering wallpaper visible vs hidden in chat, sidebar, Settings and Skills in both themes. Updated foreground-card regression and `docs/appearance.md` contract.
- No changes to Pi streaming, Steer/Follow-up delivery, model controls, virtualizer, or animation logic; all v0.36.88 fixes are preserved. See `docs/ub-mode-action-log-v0.36.89.md`.

**Upgrade:** Nothing to delete. Extract over v0.36.88 and run `npm run check` and `npm run tauri:build` on Windows. No new dependencies.

## v0.36.88 — Opaque surfaces, streaming delta coalescing, queued user-message visibility

- Replaced backdrop-blurred panels with opaque dark/light theme surfaces across chat, sidebars, composer, Settings, and popovers; kept small transparent hover/dimmer effects and the existing loading-screen image blur. Sticky chat-code headers remain solid and sticky.
- Coalesces adjacent Pi `text_delta`/`thinking_delta` events over **50 ms**. Every other RPC event is delivered immediately, after pending text, so tool transitions, queue updates, and settlement retain order. Virtualization and auto-scroll remain unchanged.
- Fixes **Steer/Follow-up messages disappearing after dequeue**: `message_start` with `role: "user"` appends the delivered user turn (including attachment display), while the initial optimistically displayed prompt consumes its Pi echo to prevent duplicates. Pi still exclusively owns the actual queue.
- Keeps composer control order **Steer → Model → Tokens**. Added event-order, queue-delivery, CSS, RPC wiring, and computed-style Chromium regressions. No new dependencies. See `docs/ub-mode-action-log-v0.36.88.md`.
- **Validation boundary:** Local TS source transpilation and autonomous logic/CSS checks can run here; dependency-based Vitest/build and native Windows/WebView2 behavior still require the project's npm packages and a Windows runtime.

**Upgrade:** Nothing to delete. Extract over v0.36.87 and run `npm install`, `npm run check`, and `npm run tauri:build` on Windows.

## v0.36.87 — Remove idle and generation background-repaint animations

- Keeps the dark molten wordmark's gradient **static** rather than animating its background position continuously. The light-theme neutral wordmark is unchanged.
- Keeps the `Composing` gradient and the eight radial-spinner leaf gradients **static**; the spinner itself still rotates via its existing stepped `transform` animation. Tool/Thinking progress icons and the startup loader are not modified.
- Removed the now-unused `molten-forge-lava-flow` and `generating-gradient-slide` keyframes. No runtime state, React render, Pi RPC, or chat-scroll changes.
- Added optional real-Chromium test `python tests/generation-animations.browser.py` (Playwright + Chromium) asserting computed active CSS animations in both themes. Before the fix, it observed **10 background-position animations** (1 title + 1 status + 8 leaves) plus 1 spinner rotation; after the fix, only rotation remains. This is an animation-count observation, **not** a WebView2 CPU benchmark.
- For a real CPU comparison on Windows, compare Task Manager WebView2 GPU Process usage after opening the *same session* in idle dark theme, idle light theme, and generation, before/after this version. WebView2 GPU Process CPU percentage is not GPU utilization.
- See `docs/ub-mode-action-log-v0.36.87.md` for the test-first record and limits.

**Upgrade:** Nothing to delete. Copy over v0.36.86, then run `npm run check` and `npm run tauri:build` on Windows. No new dependencies.

## v0.36.86 — Full composer overlay bound and browser geometry regression

- Caps the **whole floating composer overlay** (draft, queue, attachments, and extension UI), preserving at least `min(160px, 33% of the chat pane)` as an unobstructed reading area even in short windows.
- Keeps the queue header/one item visible, makes oversized extension sections independently scrollable, and gives the textarea a 72px usable minimum and automatic internal scrolling whenever the flex layout reduces its height. No second CSS textarea maximum competes with JS autosize.
- Leaves existing reader-anchor and scroll-follow ownership unchanged. The transcript's measured composer-overlap clearance still accounts for the actual overlay top. No Pi RPC or message-delivery changes.
- Adds a real Chromium geometry fixture using production CSS and compiled production sizing helpers, covering ordinary/crowded composer layouts in light/dark themes and **800→520→360→800px** resizing of one mounted DOM. Optional: `python tests/composer-layout.browser.py` (requires Python Playwright, Chromium, and `tsc`). The normal npm check does not require it.
- See `docs/pi-queue-and-composer.md` and `docs/ub-mode-action-log-v0.36.86.md` for behavior and validation scope.

**Upgrade:** No deletion required. Extract over v0.36.85 and run `npm run check` and `npm run tauri:build`. The real Tauri/WebView2 runtime and full app build remain to be verified on a dependency-equipped Windows machine.

## v0.36.85 — Pi steering/follow-up queue and tall composer safety

- Added a compact **Steer / Follow-up** dropdown beside the composer model/usage controls. `Enter` sends in the chosen mode while Pi is generating, `Shift+Enter` remains newline; when idle, sending is unchanged. Preference persists locally. Send and Stop buttons are separately available during generation.
- Pi's `queue_update` event is the single source of truth for a compact, scrollable queue preview above the composer. `Retrieve` calls correlated `clear_queue` and restores queued text to the editor for changes; no unsupported per-item queue editing. Stop's existing queue-restore/abort flow stays intact.
- Dynamic composer overlap clearance reserves sufficient scrollable space for the last transcript content, including after window resize/focus. Tall composer drafts cap their textarea relative to chat pane height; the queue strip and attachment bar have independent small scroll regions.
- Added behavior/SSR regression tests in `src/core/message-queue.test.ts` and `src/components/message-queue.test.tsx`, and updated the composer geometry integration contract. No new npm or Rust dependencies.
- See `docs/pi-queue-and-composer.md` for design decisions, limitations, and test boundary.

**Upgrade:** Nothing to delete. Copy over v0.36.84 and run `npm run check` and `npm run tauri:build` on Windows. This environment has no installed project npm dependencies or Cargo, so full project compilation and runtime integration remain unverified here.

## v0.36.84 — Separate Node and Vitest test discovery

- `npm run test`, `test:unit`, and `test:watch` restrict Vitest to `src/`; the two `scripts/*.test.mjs` suites remain owned by `node --test`. Avoids Vitest collecting Node-native test files and reporting "No test suite found".
- Removes the obsolete launcher source-string expectation of an inline `connect(...)` call. The disconnected project restoration behavior is covered by `src/core/project-switch-lifecycle.test.ts`, which exercises the production switch coordinator.
- No application runtime or UI changes and no new dependencies.

## v0.36.83 — Sidebar session-error regression fix

- Fixed a rendering bug found by the Windows Vitest run: if the active project's session list was already expanded, a failed session lookup hid the error message and could expose stale conversation rows. The same status is now shown exactly once inside either the expanded list or the initial collapsed transition; stale rows stay hidden during loading/failure.
- Added an SSR regression covering failure with previously loaded sessions, in addition to the empty/error case.
- Replaced an obsolete Skills Settings CSS assertion for a removed `.pi-skill-editor-frame .chat-code-viewer` selector with checks against the actual Skills editor frame and wrapped CodeMirror scroller. No Settings CSS change.
- No new dependencies. No session/Pi RPC lifecycle changes or intentional visual changes outside the error/loading state.
- Full `npm run test` / `npm run build` / Rust verification must be run in a dependency-equipped Windows checkout. See `docs/behavioral-lifecycle-tests.md` for limitations.

**Upgrade:** Nothing to delete. Copy over v0.36.82, then run `npm run check` and `npm run tauri:build`.

## v0.36.82 — Executable project-switch lifecycle tests

- Extracted the **actual project-switch transaction order** to `src/core/project-switch-lifecycle.ts`; `src/App.tsx` calls it with React/Tauri/RPC adapters. This is not a parallel test-only implementation.
- Added `project-switch-lifecycle.test.ts` with scripted Pi/native operations covering missing folders, declined interruption, stop failures, refused aborts, direct bash, successful session restoration, deferred restoration that keeps sidebar loading active, reconnect failures, cancelled/rejected restore RPCs, discovery failure, fresh sessions, and disconnected startup.
- Preserved the existing loading, input-block, Pi shutdown/reconnect, error notification, and session selection effects. The testable coordinator owns the single `finally` cleanup path.
- Removed the outdated `switchToProject` source-format assertion from `project-sidebar-transition.test.ts`, keeping only the separate sidebar refresh/animation contracts.
- No new dependencies and no intentional UI/runtime behavior changes. See `docs/behavioral-lifecycle-tests.md` for coverage and verification limitations.

**Upgrade:** Nothing to delete. Copy over v0.36.81 and run `npm run check` (or `npm run test` and `npm run tauri:build`) on a machine with dependencies and Cargo installed.

## v0.36.81 — Behavioral test foundation (project switching and full-history RPC)

- Extracted two small, externally testable lifecycle decisions from `src/App.tsx`: `prepareProjectSwitch` and `requestFullHistory`. No intended UI/runtime behavior change.
- Added scripted native/RPC tests for nonexistent project folders, interrupted switches, session selection, fresh-session activation, failed native listing, successful `get_entries`, old-Pi `get_messages` fallback, and RPC failures.
- Replaced source-string assertions for these decisions with executable behavior tests. Remaining source assertions that guard full React event-handler wiring are intentionally deferred until an injectable handler harness is available.
- See `docs/behavioral-lifecycle-tests.md` for scope, limitations, and next steps.

**Upgrade:** No new dependencies or file removals. Copy over v0.36.80 and run `npm run test` and `npm run tauri:build` on a machine with the project toolchain installed.

## v0.36.80 — Project-local ub-mode skill and code review

- Added `.agents/skills/ub-mode/SKILL.md` from `unclebob/ub-mode` to the project skill catalog, indexed by `AGENTS.md`.
- Added `docs/ub-mode-code-review.md`: prioritized, evidence-based review against the skill, with an action log and explicit unverified checks.
- No application runtime/UI behavior or dependencies changed.

## v0.36.79 — Skills focus and layout finishing touches

- Removed the inherited global input-focus shadow from the Skills search field, matching the old Electron picker without a duplicate/offset focus ring.
- Both footer icons now sit centrally inside equal-width buttons, retaining hover tooltips and accessible labels.
- The Location folder button is flat, precisely centered and stretched to match the readonly location field height.
- Increased the read-only skill description height to 112–158px (from 75–105px).
- Expanded `View skill` dialog now fills all available viewport height except 16px at its top and bottom, with its own internal scroll.
- No Pi runtime/API changes, no new dependencies, and no changes to regular code blocks.

## v0.36.77 — Skills layout matched to original Electron v1.16.12

- Rebuilt the **Skills** Settings page with the original Electron full-height split structure (`skills-dialog.tsx` and `settings-detail-pane.tsx`), rather than placing two small cards inside the General Settings centered column. The separate skills list starts immediately after the Settings sidebar, with a 325px search/list pane and independently scrolling detail pane.
- Skill list rows once again show the skill name **and a two-line description**, with full-width selection highlighting, Global/Project headings, independent scroll and persistent bottom actions (**Open global folder** and **Reload**).
- Right pane uses the old separate tinted detail header showing the **skill name instead of Edit Skill**, plus read-only Description and Location fields and a visible `SKILL.md` CodeMirror viewer with line numbers. **View skill** opens a larger read-only viewer. No skill creation, editing, deletion, permissions or enable toggles.
- Retained original dark/light Settings color tokens, a strong tinted content surface, and blurred bounded panels; no changes to project navigation, session management, Pi permissions, or skills discovery.
- Extensions remain a compact read-only inventory, with the obsolete Skills card implementation removed from their component. No new npm dependencies.

## v0.36.75 — Unified chat entry, resource settings polish

- Removed the standalone project launcher. The familiar sidebar and chat layout now stay available even before a folder is selected; the chat shows an Open Folder empty state. On startup, Molten Forge attempts to restore the last opened project and its last selected session once. Missing folders and Pi startup failures leave the UI accessible without repeated launcher navigation.
- Skills and Extensions reuse **General Settings** `.settings-panel` glass styling, blur, card borders, readable semantic colors, and 16px primary text. Global and Project groups are shown only when populated; unclassified/temporary runtime entries remain visible as Other.
- Added a per-skill/per-extension **Open Folder** button to reveal its actual directory in Explorer (or platform file manager). Invalid paths yield a visible per-resource error, not a project switch.
- Aligned project quick actions: Explorer and `+` use the same hover styling and pointer cursor. The `+` no longer stays visible merely because another control on the project row retains focus; keyboard focus and touch access remain available.
- Kept resource discovery read-only, Pi lifecycle unchanged for existing running projects, and the original blurred startup loading animation.
- No new npm dependencies. Changed React/Rust bridge actions require a Tauri rebuild.

## v0.36.74 — project quick-create and Pi resources in Settings

- Added a `+` action after Open in Explorer on project-row hover or keyboard focus. It opens a fresh session in the selected project, activating that project when needed; other project sessions stay collapsed.
- Preserved the project-switch confirmation before terminating an active Pi run, and checks for missing project folders before stopping Pi.
- Added dedicated **Skills** and **Extensions** settings sections. These provide a read-only inventory of conventional global/project Pi resource files and resources referenced by settings.json, with names, descriptions, paths, and scope. Pi `get_commands` output supplements the inventory with discoverable runtime skill/extension commands.
- Displays configured Pi package sources separately because a package can contain skills and extensions. The inventory does **not** claim that every discovered file is currently loaded, or that every extension has a registered command. No configuration is modified or extension code executed.
- External documentation: https://pi.dev/docs/latest/skills , https://pi.dev/docs/latest/extensions , https://pi.dev/docs/latest/packages
- Existing Pi Settings General controls and chat UI are unchanged. No new npm dependencies.

## v0.36.73 — smoother pagination and missing-project safeguards

- `Show 5 more` / `Show less` now animate the conversation container height (240 ms, reduced-motion aware) without replaying the entire project-switch entrance animation.
- Switching to a project whose directory was moved, renamed, or deleted now checks the filesystem **before** stopping the active Pi process. The current chat stays connected and the old project row shows `Folder not found`.
- A short desktop notification explains the missing directory and points to the `Open Folder` control. Failed Explorer launches also use UI notifications, not chat transcript messages.
- This is a **safe non-destructive fallback**, not automatic relocation: Pi's saved session metadata still references the old directory. To reopen a renamed project, use Open Folder to select its new directory. Historical sessions won't automatically be reassigned to the new directory.

## v0.36.72 — stable project/session transitions

- Fixed repeated `Loading sessions…` flashing while restoring a chat in a different project: project switching now retains one loading phase until the destination conversation is restored.
- Switching between conversations in the same project no longer toggles the project's loading state or temporarily removes the session list.
- Collapsing the old project preserves its conversation rows until the 240 ms exit transition finishes; the new project expands only after the session list has finished loading, giving the entrance animation a measurable height.
- Selected conversations now have a full-width background matching the project row, with labels horizontally aligned with project names.
- Removed per-row initial opacity animations that could create additional flicker when rows mounted.
- Added source-wiring and component-render regression tests; no new runtime dependencies or conversation caching.

## v0.36.71 — test-suite corrections

- Corrected attachment path assertion to verify JSON-escaped paths.
- Corrected project ordering fixture to distinguish equal activity from newer project activity.
- Updated agent-settled scroll integration source assertion to account for the longer handler.
- No runtime UI changes.

## v0.36.70 — sidebar test/build corrections

- Updated the project sidebar rendering tests for the v0.36.69 component props and UI labels; added loading/error empty-state regression coverage.
- Updated the tool presentation wiring assertion for `readToolSummary` with `toolResultDetails`, and the Rust managed-path assertion to match the actual safe `Path`-based implementation.
- No production UI/behavior/dependency changes; all v0.36.69 project navigation functionality is retained.
- A complete `npm run build`/`npm run test` remains necessary on a machine with the Node dependencies installed.

## v0.36.69 — project sidebar and switching

- Projects and conversations are sorted by latest conversation activity, not by simply opening a chat.
- Only the active project shows its conversation list; clicking an inactive project switches Pi and restores its last selected chat, or its latest chat on first visit.
- Active work prompts for confirmation before changing directories; cancelling preserves the running agent.
- Conversation list starts at 5, `Show 5 more` and `Show less` move in batches of 5. Expansion counts persist for the app session.
- Project discovery includes paths found in Pi's saved session headers, without the previous 8-project cap. Sidebar renders projects progressively in sets of 25.
- Compact aligned project/session names, hover-only Open in Explorer, Open Folder beside PROJECTS, loading/empty states, and reduced-motion-aware transitions.
- No cross-project conversation caching; only lightweight project activity metadata is retained for ordering.

## v0.36.68 — grouped project sidebar (UI-first)

- Replaced the flat Sessions list and separate folder row with compact, collapsible project sections, following the DeepSeek Harness workspace/session hierarchy.
- Expanded projects show five conversations by default and a Show more control for additional conversations.
- Expanding/collapsing does not switch the Pi process. Inactive-project conversations load on demand through the existing `list_sessions` native command; selecting one uses the existing stop/start and session-restore flow.
- Project groups with loaded metadata sort by most recent conversation activity; projects without loaded metadata retain their recent-project order. The 8-project saved-history limit and lack of a global session index remain unchanged pending the next phase.
- Groups are progressively rendered in chunks of 25 if more paths are ever available. No new sidebar, background Pi processes, or separate project manager.

# Molten Forge — v0.36.67 prototype

## v0.36.67 Miracode replacement and build recovery

- Removed the broken Monocraft multi-face provisioning step and replaced the third font option with Miracode v1.0 (one official font file).
- Verifies the upstream release SHA-256, as published by Homebrew. If GitHub cannot be reached, the build **continues** with bundled JetBrains Mono as a fallback.
- The official font can also be placed manually at `public/fonts/Miracode.ttf`; it will be packaged for offline runtime. No font binary is included in the source archive.
- Old persisted `monocraft` and `computer-modern` selections map to `miracode`. Sans stays the default.
- Miracode applies to code blocks, CodeMirror, tool output, and normal UI text when selected. The standalone app remains free of the right workspace pane.

## v0.36.65 Monocraft code font consistency

- When Monocraft is selected, inline code, fenced Markdown CodeMirror blocks, expanded tool output, read/write/diff views, and code labels now use Monocraft.
- Sans and Mono keep the existing JetBrains Mono rendering for all code surfaces.
- Use a shared CSS custom property for the selected code font to avoid stale hard-coded CodeMirror theme stacks.
- No new dependencies; workspace sidebar remains absent.


## v0.36.64 Monocraft font replacement

- Replaced **Computer Modern** in Settings → General → Font with **Monocraft**, preserving Sans, Mono, and the rest of the v0.36.57 application (no workspace pane).
- Removed the broken `@import "computer-modern/cmu-serif.css"` and the incorrect `computer-modern` npm dependency.
- `npm run build` and `npm run dev` now provision the **official Monocraft v4.2.1 regular TTF** and SIL OFL-1.1 notice into `public/fonts/` using `scripts/prepare-monocraft.mjs`. The generated font is bundled by Vite for offline use at runtime. Only first-time provisioning needs network access; the script checks the font header and reuses an existing valid file.
- Existing users who selected Computer Modern automatically get Monocraft on next launch without losing their font preference.
- JetBrains Mono remains unchanged in code blocks, tool output, diffs, and CodeMirror. UI default stays Sans.

**Build:** Extract over v0.36.63, then run `npm install` (to prune Computer Modern) and `npm run tauri:build`. The first build needs GitHub or jsDelivr access to fetch Monocraft. The source archive does not contain separate font binaries; the font and license are retrieved from the original author as part of the build.

## v0.36.63 Computer Modern font option (superseded)

- Added **Computer Modern** to Settings → General → Font, alongside Sans and Mono; the selection persists across sessions.
- Loads the `CMU Serif` font from the version-pinned `computer-modern@0.1.3` npm package. Run `npm install` before building to fetch the font; the bundled app uses it offline.
- Leaves code blocks, diffs, terminal output, and CodeMirror on the existing JetBrains Mono stack. Defaults remain unchanged.

## v0.36.57 standalone runtime surface parity

- Fixed standalone **Compact** maintenance events appearing transparent in the light theme. The old global `.tool` override stripped backgrounds from **every** tool, not just rows inside shared runtime groups.
- Applied the same correction to standalone Bash, Read, Write, Edit and other tool rows. These now retain the same glass fill and dashed boundary as standalone Thinking in both themes.
- Kept tools inside `runtime-group` and parallel-tool batches transparent so their parent container remains the single visible surface, without double backgrounds or borders.
- Preserved the flat, shadow-free runtime treatment introduced in v0.36.56 and the NSIS installer configuration.


## v0.36.56 light-theme/runtime UI polish

- Light-theme Thinking, Bash/tool titles, and collapsed runtime previews now share one slightly darker neutral color; error titles remain red.
- Sidebar icon buttons gain a more visible hover/focus color and background, without changing disabled states.
- Composer extends one pixel past the transcript at each edge, keeping the measured center and eliminating narrow message slivers.
- Code wrap stays enabled by default; the wrap toolbar button is highlighted only while wrapping is disabled.
- Removed shadows around runtime/Thinking/tool-call groups in dark and light themes; existing borders remain.
- Preserved the user's Windows NSIS installer configuration (`bundle.active=true`, `targets=["nsis"]`).

## v0.36.55 latest stable Tauri 2.12

- Updated the core Rust Tauri dependency to **2.12.3** and Tauri Build to its independently versioned **2.7.2** release.
- Updated npm `@tauri-apps/api` to **2.12.3** and `@tauri-apps/cli` to **2.12.2**, all pinned to exact releases. Upgraded the notification plugin to **2.6.0** on both npm and Cargo, preserving exact patch-version parity.
- Added a small `pretauri:dev`/`pretauri:build` lockfile synchronization step. An old source archive's `Cargo.lock` still records Tauri 2.11.6; the first command asks Cargo to resolve Tauri 2.12.3 **before** Tauri CLI checks for version mismatches. Subsequent launches skip synchronization once the lockfile matches.
- Updated dependency-regression tests to check exact pinned manifest compatibility while allowing Cargo to generate the new lockfile on the developer machine. No unrelated app functionality changed.

**Upgrade:** Do not delete files or directories. Overwrite the project with this archive, run `npm install`, then `npm run tauri:build` (or `npm run tauri:dev`). The first run needs working Cargo/network access to update `src-tauri/Cargo.lock`; commit/keep the regenerated lockfile. This build environment cannot regenerate the lockfile or perform a Tauri/Rust build, so the bundled lockfile still contains the old resolved dependencies until that first run.

## v0.36.54 Tauri dependency version lock

- Fixed the `Found version mismatched Tauri packages` error after `npm install` by pinning `@tauri-apps/api` to 2.11.1, matching the Rust Tauri 2.11.x release line (`tauri` 2.11.6 in `Cargo.lock`).
- Pinned the frontend Tauri CLI to 2.11.5 and notification JS/Rust plugin to 2.3.3 to prevent untested automatic upgrades to newer minors.
- Added a regression test to ensure the JavaScript API and Rust Tauri share a major/minor version, and that the npm Tauri/plugin versions are pinned.
- npm dependencies changed: run `npm install` after extracting. The existing Rust lockfile predates the notification plugin; Cargo will resolve and update it on the first Rust build. Do not manually edit transitive Cargo.lock entries.

## v0.36.52 managed attachments

- Added a Paseo-inspired attachment tray to the memoized composer with native **Add image** and **Upload file** actions, Ctrl/Cmd+V image/file paste handling, browser drop handling, and Tauri-native OS file drag/drop.
- Stage selected, pasted, and dropped files into Molten Forge's app-data attachment store instead of retaining fragile source/clipboard locations. Native picker/drop supports files up to 50 MB and supported raster images up to 16 MB; browser clipboard/drop staging is capped at 16 MB to avoid moving very large blobs through the webview IPC path.
- Keep only lightweight attachment metadata in React state. Images render as thumbnails, ordinary files as compact pills, and sent attachments are restored from Pi history alongside the user message.
- Image-capable Pi models receive real RPC `images` payloads. Every attachment also keeps a durable local-path marker in the prompt, so ordinary files and images sent to text-only models remain available through Pi's normal `read` tool without auto-inlining file contents into context.
- Added managed-path validation in the Rust bridge, conservative raster-image detection, path-aware attachment restoration, and regression coverage for attachment serialization, composer isolation, and RPC wiring. Full dependency-based frontend and Rust tests still require a development toolchain.


## v0.36.51 context popover backdrop-root fix

- Render the shared context-usage popover through a document-body portal so the composer/header glass surfaces no longer form a nested backdrop root that prevents the popover from visibly blurring transcript content behind it.
- Keep header and composer-ring placement aligned to their triggers with viewport-fixed geometry, updating on viewport resize while preserving local popover state and outside-click dismissal.
- Increased the visible glass effect by lowering the popover surface opacity and using a 28 px backdrop blur in dark and light themes.

## v0.36.50 Read metadata + context glass + external links

- Prefer Pi's structured Read truncation metadata for actual compact line ranges, while retaining the continuation-footer fallback used by user-limited reads. Structured tool-result details now survive live tool completion and restored history.
- Fixed the header telemetry keyboard focus geometry so the focus ring encloses the complete stats row instead of a flex-shrunk trigger box.
- Made the shared context-usage popover more translucent and increased backdrop blur in both dark and light themes.
- Prevented Markdown links from navigating the Tauri webview away from Molten Forge. HTTP/HTTPS URLs now open through the native bridge in the user's default system browser.

## v0.36.49 Read range + runtime visual consistency

- Fixed partial Read summaries counting Pi's continuation footer and its separator blank line as if they were source lines.
- When Pi returns `[N more lines in file. Use offset=X to continue.]`, the next offset now defines the authoritative end of the returned source range (`X - 1`).
- Added regression coverage for reads starting at line 1 and at a non-default offset.
- Removed the faint card fill from tool rows in both themes and disabled activity-row hover backgrounds; grouping now comes from the existing runtime/dashed boundary rather than a second surface.
- Unified normal tool chrome and all collapsed descriptions (including Read path/range spans) with Thinking's muted semantic color, while keeping actual execution errors red.
- Thinking code fragments now inherit the same italic treatment as the surrounding reasoning text, including the mono-font path.



## v0.36.48 interrupted-tool color consistency

- Interrupted tools still end with an `X`, but interruption is now visually neutral: the tool name/icon and terminal `X` use the normal muted runtime color.
- Red tool-name/icon/X emphasis is reserved for actual `error` state only, so abort/interruption is no longer presented as execution failure.
- Kept the internal `interrupted` lifecycle state and tooltip for recovery/debug semantics.
- Normalized interruption sources too: cancelled direct Bash/history entries, aborted compaction, and late tool-end records preserve `interrupted` instead of being recolored as execution errors.
- Added regression coverage for the error-vs-interrupted color contract.


## v0.36.47 interrupted activity + Read header polish

- Interrupted Thinking no longer has a separate interrupted visual state or badge; its partial reasoning is retained and the block settles like completed Thinking.
- Interrupted tools retain their internal interrupted lifecycle state but render the same terminal X affordance as an unsuccessful tool, while preserving partial input/output and the Interrupted tooltip.
- Read summaries now render file path and optional line range as separate header elements with the same CSS separator/gap contract as the rest of the activity row. Full-file reads still omit the range entirely.
- Added regression coverage for the Thinking/tool interruption presentation and structured Read summary parts.


## v0.36.46 Read range separator

- Partial Read summaries now use the same compact activity separator as the rest of the header: `README.md · 166-234`.
- Full-file Read summaries continue to show only the file path, with no separator or range.

## v0.36.45 Bash compact-input preview fix

- Restored Bash compact summaries to describe the command input rather than the command output.
- Multiline Bash input is flattened into one compact line, preserving row order, stripping the leading shell prompt, and showing up to the first 200 characters with an ellipsis only when needed.
- Kept the existing live moving-train behavior while a Bash tool is active; this change only affects the stable collapsed summary after the tool finishes.
- Added regression coverage for multiline input flattening and the 200-character truncation contract.


## v0.36.44 tool presentation checkpoint

- Added compact terminal summaries for Read/Edit/Write/Bash: project-local file paths are shown relative to the active cwd, successful partial Read shows the actual returned line range, and Bash initially used the first 200 normalized output characters (superseded by v0.36.45, which restores command-input summaries).
- Edit/Write now keep their real raw generated input visible while constructing/running; successful completion switches to the existing structured diff when available, while failure/interruption keeps Raw instead of implying an applied diff.
- Bash/tool streaming treats Pi's empty `{ content: [] }` wrapper as a no-output-yet sentinel, shows `Waiting for output…` only after execution starts, accumulates streamed chunks, and never lets an empty final wrapper erase prior output.
- Successful compaction blocks now show token reduction directly as `before → after (−saved)` using Pi's `tokensBefore` / `estimatedTokensAfter`, with the last authoritative pre-compaction context usage used only as a fallback for a missing before-value.
- Added deterministic helper and wiring regression coverage for path shortening, Read ranges, terminal previews, streaming output merging, compaction summaries, and restored compaction metadata.


## v0.36.43 mono Thinking italics fix

- Fixed Thinking prose and collapsed Thinking previews losing italics when the app font is set to JetBrains Mono.
- Bundled the real JetBrains Mono italic faces for the same 400/500/600/700 weights already used by the app; the root stylesheet intentionally keeps `font-synthesis: none`, so the browser can now render actual italics instead of silently falling back to upright mono glyphs.
- Kept Thinking code blocks, inline code, and keyboard text upright.
- Added regression coverage for the mono italic font-face imports.


## v0.36.42 provider-abort lifecycle checkpoint

- Treats provider-side terminal aborts such as `Provider finish_reason: abort` as a real interrupted turn even when Pi never emits normal Thinking/tool completion events. Still-running Thinking and agent tool blocks stop animating immediately and enter an explicit interrupted state while already-completed tools stay completed.
- Preserves partial tool input/output across interruption. Interrupted Edit/Write blocks fall back to their raw generated input instead of remaining stuck on `Preparing file diff…` or presenting a successful diff/content view.
- Keeps the run/input blocked through authoritative post-abort reconciliation: full display history, model-visible `get_messages`, session stats, final Pi state, and dangling-tool-call detection. Dangling tails reuse the existing clean-fork recovery so the interrupted original branch remains inspectable while the active session is safe to continue.
- Changes assistant tool-call construction status from `Composing` to `Preparing tool`; execution still transitions to `Waiting for tool`.
- Restores/guards italic Thinking prose and collapsed Thinking previews while keeping labels, code, and preformatted content upright.
- Adds regression coverage for provider-abort detection, interrupted runtime-state preservation, reconciliation wiring, tool-construction status, and Thinking typography.

## v0.36.41 scroll/viewport checkpoint

- Preserves the reader's logical transcript position while Settings is open instead of unmounting/remounting the chat; font changes and auto-expand setting changes keep the same visible content anchored through reflow.
- Hardens manual scroll ownership so a tiny upward wheel/scroll near the bottom cannot immediately re-arm auto-follow; follow resumes only after a later downward manual movement reaches the real bottom or an explicit bottom action occurs.
- Extends transcript bottom clearance from the real measured composer height and preserves the active scroll owner when a tall multiline composer grows or shrinks, keeping the final message reachable.
- Restores a dedicated Scroll to bottom button once the reader is meaningfully away from the live bottom. The button jumps immediately, releases any frozen live snapshot, and re-arms normal bottom-follow.
- Adds regression coverage for manual follow re-arm guards, the scroll-to-bottom threshold/control, Settings reflow preservation, and dynamic composer clearance.

## v0.36.40 responsive live-preview train

- Live Thinking/tool previews now sample every 50 ms (20 Hz) so the generation frontier feels continuous rather than stepping four times per second.
- Keeps the v0.36.39 overflow-aware train behavior: previews grow naturally from left to right while they fit, then switch to right-anchored clipping only after real overflow so the old left tail moves through the fade.
- Completed previews remain unchanged and still return to the stable beginning of the first meaningful row.

## v0.36.39 natural live-preview train start

- Live Thinking/tool previews now grow from left to right while their content fits, matching normal text-entry behavior instead of appearing from the right edge immediately.
- Once the preview genuinely overflows, it switches to the existing right-anchored train behavior so new text remains visible while the old left tail moves into the fade.
- Completed previews are unchanged; v0.36.40 increases the live sampling cadence to 50 ms.





## v0.36.38 live preview train

- Reworked collapsed running Thinking/tool previews into a rolling recent-text train sampled every 250 ms.
- Concatenates recent meaningful rows so a short current row does not leave most of the header empty.
- Keeps newest generated text right-anchored; once it actually overflows, older text disappears through a subtle left-edge fade instead of a literal ellipsis.
- Keeps completed Thinking/tool previews unchanged: they still return to the stable beginning of the first meaningful row.

## v0.36.37 live activity frontier + tool payload follow

- Running tool payloads now follow their own nested scroll area to the bottom while input or output is actively growing, without touching the transcript reader/auto-follow state.
- Collapsed running Thinking and tool blocks now sample the tail of the latest meaningful row once per second, making the current generation frontier visible.
- Tool previews switch from generated input to generated output once output starts arriving.
- Completed Thinking/tool previews return to a stable beginning/first meaningful row (file mutation tools retain their useful path preview).

## v0.36.36 thinking overflow + live inner follow

- Completed Thinking blocks now use their full natural height when expanded instead of keeping the running-time `52dvh` / `560px` inner cap.
- Running expanded Thinking keeps the bounded inner viewport and automatically follows its own bottom once reasoning exceeds that viewport, so the newest reasoning stays visible without manual inner scrolling.
- The live Thinking follow writes only the nested Thinking pane's `scrollTop`; it does not touch Molten Forge's transcript auto-follow, reader anchor, or sticky-scroll state.
- Added regression coverage for the running/completed overflow split and nested-scroll isolation.

## v0.36.34 telemetry arrows + fullscreen overflow polish

- Kept the compact telemetry direction convention as `↓` Input and `↑` Output.
- Fixed fullscreen CodeMirror forcing a horizontal scrollbar for short lines: the scrollbar now remains available but appears only when unwrapped code genuinely exceeds the viewport width.

## v0.36.33 telemetry arrow direction fix

- Swapped the compact header telemetry arrows so input points downward toward the user and output points upward away from the user.
- Kept Cached (`C`) and Cache hit (`H`) unchanged.

# Molten Forge — v0.36.30 prototype

## v0.36.32 regression-test contract fix

- Updated the v0.36.26 UI-polish regression tests to match the later approved behavior: direct bash highlighting now uses `trimStart()`, and header telemetry retains separate semantic colors instead of the superseded single-color contract.
- Runtime UI behavior is unchanged from v0.36.31.

## v0.36.30 cached-input abbreviation

- Changed the compact header cache-count label from `R` (cache read) to `C` (cached input), matching the user-facing `Cached` terminology used in the context details panel while keeping `H` for the derived cache-hit percentage.
- Added a `Cached input tokens` hover title and regression coverage for the compact `C…` / `H…` labels.

## v0.36.29 context popover telemetry colors

- Matched the Input, Cached, Cache hit, and Output values in the context popover to the same semantic colors used by the compact header telemetry. Current-context totals remain neutral.

## v0.36.28 project-path hover marquee

- Long project paths remain ellipsized at rest and smoothly pan to reveal their hidden end while hovered, then return and repeat without changing sidebar geometry. Short paths stay static and reduced-motion preferences are respected.

## v0.36.27 bash cue + telemetry color correction

- Restored distinct semantic colors for header input/output/cache/cache-hit telemetry, with stronger light-theme contrast instead of the v0.36.26 single-color override.
- Made direct-Bash composer highlighting detect leading `!` / `!!` after leading whitespace.

## v0.36.26 input, scroll and header polish

- Restored the old Electron font-loading approach with `@fontsource/jetbrains-mono`; JetBrains Mono is now the deterministic first mono face for Mono mode, code, CodeMirror, tool output, startup copy, and diffs instead of silently preferring an installed Cascadia Code.
- Treats Pi's transient `{ content: [] }` tool result as “no output yet” so a running Bash call no longer renders the transport wrapper as fake JSON before stdout arrives.
- Restored natural nested wheel chaining for CodeMirror/tool/thinking scroll surfaces. Long inner content still scrolls internally, but wheel input at an edge continues into the transcript instead of creating a dead scroll zone.
- Forwards wheel input received by the chat-width resize gutters into the real transcript, preserving manual-scroll/auto-follow ownership while keeping the resize hit areas draggable.
- Highlights composer `!` / `!!` direct-Bash mode with Pi's warning accent without moving or rerendering the transcript.
- Surfaces Pi `stopReason: "length"` as `Response was truncated before completion.` in both live and restored transcripts.
- Makes header telemetry one consistent color, strengthens the light-theme contrast, aligns title/telemetry controls on the same vertical center, and hides telemetry when the actual chat pane is too narrow to fit it cleanly.
- Gives the composer context ring a visible hover state, keeps enabled buttons explicitly pointer-shaped, and softens generic light-theme button surfaces so they no longer read as opaque cards.

**Upgrade note:** this release adds `@fontsource/jetbrains-mono`. After overwriting an older checkout, run `npm install` once before `npm run tauri:dev` / `npm run tauri:build`.


## v0.36.25 composer geometry + Pi startup welcome

- Keeps the transcript scrollbar gutter reserved across populated, empty, and history-loading states so session switches no longer shift the measured transcript center and make the overlaid composer twitch horizontally.
- Stops rerunning transcript geometry synchronization on ordinary history/item-count changes; the observer now follows real geometry while active-session changes rebind the measured elements.
- Measures the full composer overlay with `ResizeObserver` and grows transcript bottom clearance only when the composer becomes taller than the existing 190 px baseline, so multi-line drafts cannot cover the newest transcript content.
- Replaces the old generic empty-chat card with Pi's compact startup header copy and compact Skills / Prompts / Extensions sections derived from RPC `get_commands` metadata.
- Preserves Pi command provenance (`sourceInfo`) so extension labels can use their real source path instead of command names when RPC exposes it.



## v0.36.24 compaction grouping + persistent Stop

- Made context compaction explicit session-maintenance activity instead of ordinary assistant tool activity. `Compact` is now a hard outer runtime-group boundary and is never eligible for `Parallel tool calls`, including restored historical compaction entries.
- Changed Stop during automatic/manual compaction from a one-minute failure into a persistent user intention. While Pi still reports `isCompacting`, Molten Forge keeps the run busy and shows `Stopping compaction…` instead of appending the misleading `Pi remained busy after abort` transcript error.
- Reasserts `abort` immediately when compaction ends so Pi cannot silently resume the larger agent run after swallowing the first abort request. A polling fallback performs the same reassertion if the lifecycle event is missed.
- Added a controlled last-resort fallback for truly stalled compaction: after three minutes, Molten Forge restarts Pi, restores the same active session, then continues authoritative state/history safety checks before treating Stop as complete. The persistent auto-compaction setting is not changed.
- Added regression coverage for compaction as a grouping boundary, maintenance exclusion from parallel batches, compaction-aware Stop status, post-compaction abort reassertion, and the long-stall restart path.


## v0.36.23 old Molten Forge follow + CodeMirror stability

- Restored the mature Electron Molten Forge moving-bottom scroll animation instead of the v0.36.22 fixed 80 ms sampler. Live follow now re-reads the current bottom on each animation frame and eases toward it with the original `0.12` lerp, while preserving v0.36.22's explicit auto-follow ownership and frozen-reader transcript.
- Kept bottom-follow downward-only: real layout contraction may clamp the browser to a smaller legal bottom, but Molten Forge does not add a competing explicit upward scroll write. Transcript/Markdown resize events simply re-arm the same lerp instead of introducing another scroll-correction path.
- Stabilized fenced CodeMirror geometry during streaming: editor creation, wrapping reconfiguration, and incremental document edits now commit in layout effects before paint; syntax highlighting is color-only so delayed language loading cannot change text metrics; internal scrollbars reserve a stable gutter.
- Reworked large-Markdown block measurement so each visible virtual Markdown block has its own `ResizeObserver`. Late CodeMirror/layout changes therefore update the inner Markdown virtualizer's real height instead of leaving a stale estimate that can make the outer transcript jump.
- Fixed Thinking lifecycle fallback: the first assistant `text_start`/`text_delta`/`text_end` now finalizes the active Thinking block just like `thinking_end` or a tool-call transition. The spinner stops and auto-expanded Thinking collapses as soon as answer generation begins rather than waiting for the whole assistant message to finish.
- Updated scroll/rendering regression contracts around the old lerp, visual freeze/final flush, dynamic CodeMirror measurement, and text-driven Thinking completion.


## v0.36.22 sampled follow + frozen reader transcript

- Replaced the accumulated frame-by-frame sticky-scroll/settle/suppression state machine with one explicit auto-follow owner. During generation, Molten Forge samples the current transcript bottom every **80 ms** and smoothly animates to that fixed sample over the same interval; content produced during an animation is picked up by the next sample instead of continuously retargeting the viewport.
- When the reader scrolls away from the live bottom, auto-follow now turns off immediately and the **last committed visible transcript freezes** while Pi continues updating the authoritative transcript in memory. Tokens, Thinking/tool lifecycle changes, runtime regrouping, and tool output therefore cannot keep reflowing the page underneath someone reading older content.
- Frozen generation is released once at Pi's real task boundary, `agent_settled`. The final authoritative transcript is painted in one flush while a logical message/child anchor preserves the reader's screen position; auto-follow stays off. Returning manually to the actual bottom before settlement releases the snapshot and resumes live follow.
- Removed the v0.36.19 monotonic virtual-row measurement floor. TanStack now receives real row heights, so legitimate Thinking/tool collapse cannot leave phantom blank space. TanStack scroll correction remains disabled while streaming or while the final reader-anchor flush owns the viewport.
- Made Thinking/tool expansion deterministic across React remounts: `manual override ?? (running && auto-expand)`. Finished activity therefore collapses automatically even when runtime grouping changes the component tree; explicit manual choices remain respected.
- Capped expanded Thinking at `min(52dvh, 560px)` with its own vertical scrollbar and contained overscroll so long reasoning remains inspectable without creating a multi-screen virtual row.
- Reworked scroll regression coverage around the new ownership model: fixed 80 ms sampling, explicit manual takeover, exact-bottom resumption, frozen visual state, one final settlement flush, anchor preservation, real virtual measurements, and deterministic activity collapse.


## v0.36.21 code/runtime/settings polish

- Restored the old Molten Forge neutral base foreground for fenced code blocks: plain/unclassified code is light gray in dark theme and normal dark foreground in light theme, while Pi semantic syntax accent colors remain for recognized tokens.
- Muted completed successful tool-call names to the same gray family as Thinking so finished runtime steps no longer compete visually with the assistant answer; running and error states retain stronger emphasis.
- Raised primary Settings labels, selects, navigation rows, and action controls to the app-wide 16 px default while keeping helper copy secondary.


## v0.36.20 Pi semantic colors + light-theme parity

- Ported Pi's current built-in dark/light semantic content palette into chat rendering: Markdown headings, links, inline code, fenced-code base text, list markers, quotes, thinking text, tool text, diffs, and CodeMirror syntax colors now follow Pi's theme tokens while Molten Forge keeps its own window/surface design.
- Kept all Markdown heading levels on Pi's shared `mdHeading` color; size and weight still communicate heading hierarchy.
- Made the Molten Forge wordmark use the normal foreground color in light theme, including the project launcher and settings/sidebar headers; the animated molten gradient remains dark-theme-only.
- Restored old Electron Molten Forge light-sidebar behavior: ordinary session rows are transparent with no border/card background until hover, while the selected row uses only the subtle selected fill.
- Fixed grouped Thinking/tool rows in light theme inheriting their own card backgrounds over the parent runtime group. The group now owns one coherent surface, and nested runtime rows stay transparent.
- Quieted expanded tool payload surfaces in light theme so input/output viewers visually belong to the surrounding tool block instead of appearing as mismatched nested cards.
- Added visual regression contracts for Pi semantic tokens and the light-theme wordmark/sidebar/runtime-group behavior.










## v0.36.19 reader-scroll authority + streaming stability

- Fixed upward scrolling during generation being pulled back toward a stale pre-wheel/pre-keyboard reader anchor. Manual wheel/keyboard intent now disables live follow immediately, then refreshes the reader lock from the viewport position the browser actually reached.
- Added a next-frame reader-anchor refresh fallback so a recent programmatic-scroll guard cannot hide the user's first real upward movement.
- Made virtual transcript row measurements monotonic while Pi is streaming **and live-bottom follow is active**: transient Markdown/virtualization contractions no longer shrink the live scroll extent between fast deltas and fight sticky bottom-follow. Once the reader takes control, intentional contractions are allowed again; final row sizes are remeasured when generation settles.
- Capped giant user-message bubbles at `clamp(240px, 44dvh, 480px)` with their own vertical scrollbar so very large pasted prompts do not monopolize the transcript viewport or create oversized virtual rows.
- Added regression coverage for post-scroll reader-anchor ownership, monotonic streaming measurements, idle floor release, and giant-user-message overflow.

## v0.36.18 terminal Pi error propagation

- Fixed terminal provider/model failures being silently dropped when Pi accepted the prompt RPC but later finalized the assistant message with `stopReason: "error"` and `errorMessage`.
- Buffer finalized assistant errors across `agent_end`, use `willRetry` to hand retryable attempts to the Retry lifecycle, and surface only the still-pending failure at `agent_settled`.
- Keep retryable failures owned by the existing Retry activity block; exhausted retries continue to finish that block instead of producing a duplicate standalone error.
- Added an `agent_settled` compatibility fallback so a pending provider failure is still surfaced if an older/edge Pi runtime omits the expected final retry event.
- Restored terminal provider errors from full session history while suppressing superseded failed retry attempts that are retained in Pi's append-only raw history.
- Explicitly exclude normal user aborts (`stopReason: "aborted"`) from terminal error rows.
- Added regression coverage for 401-style authentication failures, retry chains, final failed retries, abort handling, live RPC wiring, and restored-history wiring.

## v0.36.17 launcher, alignment and Pi-style thinking

- Fixed the remaining transcript/composer centering drift by measuring the rendered transcript column itself and making the composer, command picker, extension widgets, local blur, and resize guides reuse that exact physical width and center offset.
- Moved Settings select chevrons inward with wrapper-owned icons so native WebView arrow placement cannot crowd the right border.
- Italicized Thinking previews/content while keeping the Thinking label, tool chrome, and code upright.
- Made session sidebar dates explicitly English (`en-GB`) instead of inheriting the operating-system locale.
- Replaced the prototype `MF` launch mark with the Molten Forge logo and polished the first-run/open-project copy.
- Added up to eight persisted recent projects to the launch screen; selecting one starts Pi in that working directory immediately.
- Added regression coverage for recent-project persistence/path labels, English date formatting, zero-width overlay scrollbar alignment, Settings chevron structure, and Thinking typography.

## v0.36.16 settings workspace, font, loading + alignment

- Restored transcript/composer horizontal alignment on Windows/WebView by falling back to the known 6 px transcript scrollbar gutter when overlay-scrollbar measurement reports zero. Messages, runtime groups, composer, command menu, and resize guides again share the same centered column.
- Restyled startup `Loading...` to match the old Molten Forge treatment: larger semibold text, animated molten orange gradient in dark mode, subdued pulsing text in light mode, and reduced-motion fallback.
- Added a persisted `Sans / Mono` application-font switch. Mono uses the old Molten Forge-style system stack (`Cascadia Code`, `JetBrains Mono`, `SFMono-Regular`, `Consolas`) without bundling font files. Code/CodeMirror surfaces remain explicitly monospaced regardless of the application-font choice.
- Replaced the Settings modal with the old split workspace pattern: settings occupy the normal left-sidebar slot and the active section fills the right side. The first section is `General`; section navigation is data-driven so Extensions, Skills, and other pages can be added without replacing the shell.
- Kept General appearance/background and auto-expand controls in the new settings workspace and matched the existing resizable sidebar/content widths.
- Added regression coverage for font persistence, zero-width scrollbar fallback, settings navigation structure, and the split-layout/font controls.

## v0.36.15 frameless Molten Forge chrome + startup loading

- Removed the default Windows title bar with Tauri `decorations: false` and restored the old Molten Forge integrated title-bar pattern: the existing launch/sidebar/chat top rows are draggable instead of adding a second bar above the app.
- Added the compact old-style minimize, maximize/restore, and close controls at the top-right, with explicit Tauri window permissions and non-draggable interactive controls.
- Reduced the integrated launch/sidebar/chat title rows to the old 41 px chrome height while reserving room for the window controls.
- Added the old Molten Forge startup loading treatment: theme-aware bundled/custom background, image preload + fade-in, blurred/overscanned background, dark/light scrim, and centered pulsating `Loading...` text with reduced-motion fallback.
- Keep the startup screen visible until native/Pi bridge initialization, the Pi availability check, and stored-background hydration have all settled, preventing partially initialized UI from flashing on startup.
- Added `docs/window-chrome.md` and regression coverage for frameless configuration, Tauri permissions, drag/no-drag regions, window actions, and loading-screen visual contracts.

## v0.36.14 empty-session landing + expanded code viewer

- Fixed the remaining empty/new-session scroll leak: the transcript view now remounts when the active session changes, and a true empty state also resets to the top after commit with a short settling check. A deeply scrolled old chat can no longer push the centered welcome card below the viewport.
- Kept the normal/collapsed code-block view unchanged. Only the expanded/fullscreen code-block view now enables the enhanced CodeMirror line-number gutter while retaining syntax highlighting, wrap toggle, copy/download, selection, and full-height scrolling.
- Styled CodeMirror gutters through the existing theme variables so line-numbered read/fullscreen viewers remain consistent in dark and light themes.
- Added regression coverage for post-commit empty-session landing and for the rule that enhanced code-block chrome is fullscreen-only.

## v0.36.13 history wiring regression test fix

- Fixed the Pi full-history regression test to verify the actual interruption contract instead of requiring a specific timeout constant.
- Interruption safety still checks `get_messages` for dangling tool calls while full transcript restoration remains routed through `requestHistorySnapshot(...)`.
- No runtime history, scrolling, CodeMirror, or Pi startup behavior changed in this release.

## v0.36.12 full session history and transcript polish

- Restored complete Pi session history with `get_entries` instead of treating compacted `get_messages` context as the canonical UI transcript. Molten Forge reconstructs only the active root-to-leaf branch, so pre-compaction messages return without leaking abandoned branches.
- Restored historical compaction events as normal `compact` tool blocks when reopening a session. Older Pi builds that do not support `get_entries` still fall back to `get_messages`.
- Added a dedicated history-loading state during session switches. The previous transcript can clear without briefly flashing the empty-chat welcome card before Pi history arrives.
- Re-centered the true empty-chat welcome card with a fixed, non-scrollable grid layout so it remains visible instead of disappearing behind the empty transcript geometry.
- Increased `read` CodeMirror output from the generic ~360 px tool viewport to up to `70dvh` / 900 px, while keeping other logs compact. Pi's own read-size limits remain unchanged.
- Changed session ordering to use the latest meaningful conversation activity rather than JSONL file `mtime`. Silent `model_change` / thinking / metadata writes no longer move a merely opened chat to the top, while real messages, tool activity, branch summaries, and compactions still do.
- Added deterministic coverage for active-branch projection, pre-compaction restoration, compaction rows, `get_entries` fallback wiring, history-loading/empty-state layout, tall `read` output, and state-only session activity.


## v0.36.11 empty-chat scroll fix

- Restored the old Molten Forge empty-chat layout contract: an empty transcript is a fixed viewport with vertical scrolling disabled instead of inheriting the normal message bottom spacer.
- The welcome card now stays centered in the visible area above the overlaid composer without creating a large fake scroll zone.
- Empty `get_messages` history no longer triggers the forced bottom-settle used for populated chats; it explicitly lands at `scrollTop = 0` instead.
- Populated history still lands at the latest content exactly as before.
- Added deterministic history-landing coverage plus structural regression checks for the empty transcript layout.

## v0.36.10 Pi readiness regression test fix

- Updated the Pi RPC readiness regression test for the v0.36.7 startup helper refactor. `get_state` now lives inside `startPiAndSync()`, while `connect()` awaits that helper before setting the UI connected.
- The test now verifies both halves of the real contract instead of searching for the next textual `get_state` after `connect()`, which could match an unrelated later resync call.
- Runtime startup/readiness behavior is unchanged; this release only fixes the false-negative test while retaining v0.36.9 tool CodeMirror output.

## v0.36.9 syntax-aware tool text output

- Added one shared lightweight CodeMirror viewer for verbatim tool output instead of rendering every substantial result as a plain `<pre>`.
- `read` now uses the target file path for syntax highlighting, wraps long lines, and shows real source line numbers starting from Pi's requested `offset`.
- `bash` / shell / PowerShell output uses the same incremental read-only viewer without noisy editor line numbers; streaming output updates the existing CodeMirror document instead of recreating the editor.
- Generic output uses conservative auto-detection: explicit language/MIME metadata, then file path, then unambiguous JSON/diff/HTML/XML/Markdown structure, otherwise plain text.
- Kept `grep`, `find`, and `ls` outside the generic CodeMirror path so they remain free for dedicated structured result UIs; tiny plain status outputs also stay lightweight.
- Reused the shared tool text viewer for legacy `write` content, removing the separate duplicate CodeMirror implementation while preserving line numbers, syntax highlighting, and wrapping.
- Added deterministic language/viewer-decision tests plus rendering coverage and `docs/tool-text-output.md`.

## v0.36.8 tool diff readability

- Long `edit`/`write` diff lines now wrap to the tool width instead of requiring horizontal scrolling.
- Successful historical `write` calls created before baseline capture now show the exact written file content with syntax highlighting, line numbers, and wrapping instead of unreadable raw JSON.
- Historical writes do not fabricate red/green changes when the previous file state was never persisted; Raw remains available.

## v0.36.7 Pi startup resilience

- Fixed the Windows Pi launcher so `-e` and the bundled extension path are passed as real process arguments instead of being embedded in a manually quoted `cmd.exe /C` command string. This prevents Pi from interpreting an absolute temp path as a quoted relative path under the active project cwd.
- Resolve the installed `pi.exe` / `pi.cmd` launcher from `PATH` and let Rust handle Windows batch-file argument escaping.
- Moved the bundled Molten Forge edit/write diff extension off Pi's TypeScript/Jiti startup path: Pi now receives a plain JavaScript extension file.
- Made structured file-diff capture optional at runtime. If Pi exits during startup while the bundled diff extension is enabled, Molten Forge automatically retries once without that extension so chat and tools still open.
- Tagged Pi process lifecycle events with the child PID so a delayed `exited` event from the failed extension attempt cannot tear down the replacement Pi during fallback startup.
- Preserved native Pi edit output on fallback; write diff previews may fall back to raw input for that session instead of blocking the entire application.
- Captured the recent Pi stderr tail and include it in startup failures, replacing the previous opaque `Pi process exited` diagnosis with actionable details.
- Kept the v0.36.6 scroll stabilization unchanged.



## v0.36.6 scroll stabilization + diff path fix

- Stabilized fast-response bottom following so Molten Forge never adds an explicit upward scroll write when virtualization or late layout measurement temporarily reports a smaller bottom.
- Disabled TanStack Virtual row-size scroll correction while Pi is streaming so it cannot fight Molten Forge's sticky-follow / reader-anchor state machine; normal virtualizer correction resumes when generation is idle.
- Restored `overflow-anchor: none` on both the transcript scroller and transcript content, matching the old Electron Molten Forge and preventing the browser from becoming a third independent scroll-position writer.
- Treat expanding/collapsing Thinking or tool blocks, plus switching Edit/Write between Diff and Raw, as reader intent before their height changes. Pointer and Enter/Space activation preserve the current reader anchor during streaming.
- Fixed the TypeScript error in `molten-forge-diff-extension.ts` by narrowing the Pi hook `cwd` value to a real string before passing it to `path.resolve`.
- Added regression coverage for downward-only sticky scrolling, streaming virtualizer ownership, browser anchoring, and layout-changing reader interactions.


## v0.36.5 structured edit/write diffs

- Replaced raw `edit` / `write` input JSON with a compact unified diff by default while keeping the existing tool output unchanged and preserving a `Raw` fallback.
- Added real old/new file line numbers, three lines of surrounding context, collapsed unchanged gaps, syntax highlighting, and intra-line red/green highlighting for small replacements.
- Added an internal Pi extension that snapshots the target immediately before `write`, then persists only the compact resulting diff in Pi `toolResult.details`; full old-file copies are not kept in session history.
- Reused Pi's native unified patch for `edit`, trimming its display to the same three-line context contract and persisting file metadata needed after session restore.
- Added safeguards for failed writes, overlapping same-path mutations, changed target paths, CRLF/LF/mixed endings, final-newline-only changes, very large rewrites/minified lines, and restored-session rendering.
- Added deterministic diff, Pi-hook, rendering, and RPC-wiring regression coverage.


## v0.36.4 sticky code-header restoration

- Restored the exact transform-free transcript virtualization strategy used by the old Electron Molten Forge so fenced-code headers can remain sticky while the outer chat scrolls.
- Enabled TanStack Virtual `directDomUpdates` with `directDomUpdatesMode: "position"`; the virtualizer now owns row `top` positioning and the React tree no longer applies `translateY(...)` transforms to transcript rows.
- Removed the legacy `top: 0` rule from virtual transcript rows because it conflicts with position-mode direct DOM updates.
- Kept the code header as the first child of the code frame, with `position: sticky`, the original glass/backdrop treatment, and an explicit `0px` sticky offset on the current transcript scroll container.
- Added regression coverage and documentation for the critical rule that code-header ancestors in the virtualized transcript must remain transform-free.


## v0.36.3 shared context usage details

- Made the entire top-right token telemetry block clickable and added current context percentage as a separate compact item beside `used/limit`, using the same spacing as the other telemetry values.
- Added one reusable context-usage popover shared by the header telemetry and the composer progress ring.
- The popover now shows Input, Cached, Cache hit, Output, Used, Limit, Remaining, Used %, and the System / instructions, Tool definitions, Messages context breakdown. KV-cache totals are intentionally omitted.
- Moved context-popover open/close state out of root `App`, preserving transcript render isolation; both variants close on Escape/outside pointer input and refresh Pi session stats when opened.
- Added `docs/context-usage.md` and regression coverage for the shared component and agreed fields.


## v0.36.2 quieter estimated context display

- Removed the visual `~` prefix from approximate context-token values. Estimated post-compaction values and the approximate context breakdown now use the same compact numeric presentation as exact values, while the underlying `estimated` state and explanatory tooltip remain intact.


## v0.36.1 live context usage + command scroll

- Fixed the context meter showing `0` immediately after manual/automatic compaction. Pi intentionally reports exact context usage as unknown until the next post-compaction assistant response; Molten Forge now shows the compaction `estimatedTokensAfter` value as approximate instead of coercing `null` to zero.
- Added lightweight context-usage refresh at Pi `turn_end` boundaries so long autonomous tool loops update the context meter between turns, plus an initial refresh when an agent run begins. Refreshes are coalesced and do not poll on every streaming token delta.
- Lightweight live stats refreshes no longer re-run the native session context-breakdown analysis every turn; the full breakdown still refreshes at normal/session-settlement points.
- Slash commands and direct `!` / `!!` shell commands now re-arm the same forced bottom-follow used by normal sends, fixing manual `/compact` and other command output remaining above the viewport while idle. Automatic compaction does not force-scroll a user who intentionally scrolled up.
- Added `src/core/context-usage.ts` and regression coverage for authoritative/estimated/unknown context states plus Pi-boundary wiring.


## v0.36.0 Pi lifecycle and interruption hardening

- Stop now follows Pi queue/abort semantics: queued steering/follow-up text is restored, abort is acknowledged, and Pi is verified idle before the UI settles.
- After abort, Molten Forge reloads persisted Pi history and detects dangling tool calls. If Pi left an unmatched tool call, the active session is moved to a clean fork before that interrupted turn and the prompt is restored to the composer, keeping the original branch intact.
- Added correlated RPC request/response handling, startup readiness checks, process-exit cleanup, and authoritative state resynchronization.
- Hardened session switching/new/fork/clone and made `/reload` restore the active session after restarting Pi.
- Serialized direct `!`/`!!` bash against prompts and added `abort_bash` Stop behavior.
- Pi stderr is now diagnostic-only; extension widgets render beside the composer instead of polluting transcript history.
- Pi process shutdown now closes stdin and waits for graceful disposal before force-killing as a fallback.
- Added `docs/pi-rpc-lifecycle.md`, a full Pi integration audit, and broad lifecycle/wiring regression coverage.


## v0.35.6 Rust lockfile integrity fix

- Corrected the `tao 0.35.2` checksum in `src-tauri/Cargo.lock`; the previous lockfile paired the 0.35.2 version with the checksum of 0.35.3, which Cargo correctly rejected.
- Added a regression test for the pinned `tao 0.35.2` lockfile entry.
- Added an `AGENTS.md` rule forbidding global version replacement or manual edits of transitive Cargo.lock package entries; dependency changes must be regenerated through Cargo.
- The Vite `>500 kB` chunk message remains a non-fatal optimization warning and is unrelated to this Rust build failure.


## v0.35.5 harness-neutral agent skills

- Moved project engineering skills from Pi-specific `.pi/skills/` to canonical `.agents/skills/`.
- Updated `AGENTS.md` to strongly recommend consulting relevant skills before substantial frontend/React/Tauri changes regardless of the active coding harness.
- Kept Pi-specific guidance only where Pi is actually part of the application architecture, such as RPC/session source-of-truth and Tauri integration.
- Updated the frontend skill audit and historical skill notes to point at the vendor-neutral location.

## v0.35.4 test-contract fix

- Fixed the model-switcher search-reset regression test so it verifies the closed-picker reset branch without depending on one-line `if` formatting.
- Added guidance to `AGENTS.md` and the frontend-testing skill that unavoidable source-text assertions must match semantic structure rather than incidental whitespace or line breaks.

## v0.35.3 model navigation + frontend skills

- Fixed model-picker keyboard navigation so `ArrowUp` / `ArrowDown` keep the highlighted row visible inside the model list, including clearance for sticky provider headings. Pointer hover changes highlight without moving the scroll position.
- Added regression coverage for above/below/visible scroll geometry and keyboard-only list scrolling.
- Added six project-local agent skills (now under `.agents/skills/`): React performance, React component architecture, accessible interactions, frontend testing, CSS/design-system work, and Tauri/React integration.
- Added a strong `AGENTS.md` recommendation to inspect relevant skills before substantial frontend/Tauri work.
- Added `docs/frontend-skill-audit.md` with a current review of the project against those skills and concrete follow-up areas without proposing a broad rewrite.


## v0.35.2 model picker keyboard polish

- Removed the search focus ring so the picker keeps the same neutral surface while typing.
- Added one shared highlighted model state for keyboard and pointer navigation.
- `ArrowUp` / `ArrowDown` move the highlight through filtered models with wrapping.
- `Enter` selects the highlighted model through the existing silent model switch path.

## v0.35.1 model picker polish

- Added a searchbar to the model picker. Search matches provider, model id, or `provider/id` while preserving provider grouping.
- Removed friendly-name/description secondary text so every model occupies one compact row.
- Search state remains local to the memoized picker, resets when the picker closes, and does not rerender the transcript.
- Added regression coverage for search filtering, hidden descriptions, fixed searchbar/list scrolling, and light-theme search styling.

## v0.35 model picker

- The model label beside the context ring is now clickable and opens a compact model picker above the composer.
- Models are grouped by provider, with the current model marked and friendly model names shown as secondary text when available.
- Opening the picker silently refreshes Pi's `get_available_models` list.
- Selecting a model uses the same `set_model` RPC shape as `/model`, persists through the existing default-model path, and is sent silently so the click does not create a user message, system notice, or model tool block in the transcript.
- Picker open/close state is local to a memoized component, so browsing the model list does not rerender the root chat transcript.
- Added model-picker behavior documentation and regression coverage for grouping, deduplication, matching, exact RPC construction, silent switching, provider headings, and dismissal behavior.

## v0.34.3 fixes

- **Abort callback typing.** The Composer abort handler now awaits `sendRecord()` so it satisfies the `void | Promise<void>` callback contract while preserving rejected-command errors.

- Fixed the v0.34 Markdown style tests so they read the real `src/styles.css` file instead of relying on Vite CSS-module behavior in Vitest.
- Added the missing `ps1` download extension mapping.
- Kept CodeMirror packages in `package.json`; after upgrading from an older checkout, run `npm install` once to install them into `node_modules`.
- Isolated composer draft/autocomplete/textarea-resize state inside a memoized Composer component so ordinary typing no longer rerenders root `App` or the transcript.
- Preserved extension `set_editor_text` support through an imperative composer ref without lifting the draft back into root state.
- Added composer render-isolation regression tests and documentation.


## v0.34 interaction/rendering parity

- Ported the mature Electron Molten Forge transcript follow logic: smooth streaming lerp, exact manual-scroll intent stop/resume rules, forced settle behavior, and reader-anchor locking so reflow does not move the line being read after scrolling upward.
- Restored collapsed-thinking live-line sampling (once per second while active; first line after completion).
- Restored CodeMirror fenced-code rendering, syntax-token colors, wrap/copy/download/fullscreen controls, and horizontal table scrolling.
- Added detailed behavior documentation and broad regression coverage (scroll state machine/reader lock, thinking previews, CodeMirror diffing/metadata, renderer structure, syntax palette, and table/code overflow contracts).

**Upgrade note:** v0.34 adds CodeMirror packages. After overwriting an older project folder, run `npm install` once before `npm run tauri:dev` or `npm run tauri:build`.

## v0.33 appearance

- Added the old Molten Forge `System / Light / Dark` theme switcher to Settings.
- Ported the old Molten Forge light palette and bundled light mountain background while preserving the existing dark appearance.
- Restored the master `Show background image` toggle.
- Added independent custom background selection for light and dark themes, with `Clear` returning each theme to its bundled default.
- Persists lightweight appearance preferences in local storage and custom image blobs in IndexedDB.
- Added appearance regression tests for theme resolution/persistence, background visibility and fallback selection, supported image formats, stored-record validation, and unavailable-storage behavior.
- Expanded `AGENTS.md` testing policy: stateful UI work should cover defaults, persistence, state transitions, invalid data, and fallback/error paths wherever deterministic.

## v0.30 settings and runtime polish

- Added a Molten Forge-style Settings dialog with persisted auto-expand toggles for thinking and tool calls.
- Added the old sidebar hamburger behavior and animated Molten Forge title treatment.
- Fixed thinking completion when a following tool call starts and hid tool output until execution actually begins.
- Grouped consecutive runtime/tool calls even when no thinking block surrounds them.
- Model changes render as tool blocks, persist to Pi `defaultProvider`/`defaultModel`, and stay selected when switching sessions.
- Restored the local composer backdrop blur and removed the selected-session border.
- Added regression tests for runtime grouping, activity state, tool output visibility, and Pi settings persistence.


## v0.30 runtime regression guard

- Fixed the command-palette runtime crash caused by an unimported `COMMAND_SOURCE_ORDER`.
- `npm run test` now runs both Vitest and `tsc --noEmit`, so missing imports/identifiers fail the test command before the app is launched.
- Added a regression assertion for the command palette section order exported by production code.

- Adds `AGENTS.md` with architecture, performance, testing, and contribution rules for future agent work.
- Adds Vitest coverage for pure frontend chat logic, Markdown recovery, runtime grouping, logical turns, and virtualization helpers.
- Moves tested production logic into `src/core/chat-logic.ts` so tests exercise the same code used by the UI.
- Adds Rust unit tests for Pi session parsing, path normalization, message extraction, and token approximation.
- Adds `npm run test`, `npm run test:watch`, `npm run test:rust`, and `npm run check`.


## v0.27 virtualization

- Ports the two-level virtualization model from Molten Forge 1.16.10.
- Virtualizes conversation turns with `@tanstack/react-virtual`, keeping only the viewport plus overscan mounted.
- Uses measured dynamic row heights so thinking/tool expansion and streaming content can change size without fixed-height assumptions.
- Groups each user turn and its agent activity into one virtual row, preserving 8 px internal spacing and 32 px turn spacing.
- Virtualizes very large Markdown messages (80k+ characters) into ~6k-character blocks with viewport overscan.
- Keeps thinking/tool expansion state stable when a virtualized turn scrolls out of the DOM and later remounts.

## v0.26 sidebar overflow

- Folder paths and session titles are constrained to the sidebar width and ellipsized instead of bleeding into chat content.
- Full folder/session text remains available via native hover tooltips.

## v0.25 performance, commands and compaction

- Memoizes the transcript/message runtime tree so typing in the composer no longer reparses the whole chat.
- Keeps unchanged transcript items referentially stable during streaming updates.
- Completes the slash-command palette with Pi interactive built-ins and separates wrapper-only RPC commands.
- Scrolls the command palette explicitly when navigating with Up/Down.
- Renders manual and automatic compaction as a normal Compact tool block.
- Hides persisted compaction summaries from restored chat history so they do not appear at the top of a conversation.
- Fixes thinking soft line breaks by letting Markdown control wrapping instead of `white-space: pre-wrap`.

## v0.21 last working directory

- Remembers the last successfully opened working directory across app restarts.
- Falls back to the user home directory only when no previous project has been stored.

## v0.20 table recovery

- Recovers fenced Markdown pipe tables from untyped/markdown/md/gfm/table fences so they render as GFM tables.
- Leaves real source-code fences untouched.

## v0.15 UI pass

- Added compact session token stats to the top-right header: cumulative input/output/cache-read plus live context usage.
- Removed thinking-level metadata from the header.
- Moved the current model identifier into the composer, immediately left of the context meter.

## v0.12 UI pass

- Ported Molten Forge 1.16.10 message typography and markdown spacing.
- Restored the 32px message rhythm and 16px process-to-answer spacing used by the old chat.
- Matched headings, paragraphs, lists, blockquotes, inline formatting and table spacing.
- Kept the current lightweight code-block implementation; sticky/code-toolbar logic was intentionally not ported in this pass.

## v0.11 UI pass

- Mirrored chat-width resize affordances now use identical hit areas and sit slightly outside the content column.
- Runtime/thinking/tool groups use a consistent 8 px internal gap.
- User turns have explicit spacing before and after them to separate the following agent response.

## Transcript/composer alignment fix

- Compensates for the transcript scrollbar gutter so the transcript, runtime groups, composer, command menu, and resize guides share the same centered width.

## v0.10 UI pass

- Removed the transient “Started a new Pi session” and “Pi RPC started …” transcript messages.
- Empty chats now show a centered Molten Forge-style start card with no action button.
- Removed the redundant `You` role label above user messages.
- Fenced Markdown code blocks now use the square, bordered Molten Forge surface with no border radius while retaining the copy action.

No new dependencies were added in v0.10. If `node_modules` already exists from v0.10, you can run the app directly.

## v0.10 UI pass

- Restored the original Molten Forge Lucide icons for thinking/tools and swaps them for the expand/collapse icon on hover.
- Compacts thinking whitespace and runtime block spacing; standalone thinking/tools now use the same dashed process boundary.
- Context details close on outside click.
- Chat width can be resized from either content edge and is persisted in localStorage.
- Composer, transcript, command menu and extension status share the same persisted content width and alignment.
- Composer outline removed.

This version adds `lucide-react`, so run `npm install` once after overwriting an older prototype folder.

## v0.10 UI pass

- First-run Pi launcher is vertically centered.
- Project-local `.pi` resources are trusted automatically; the extra trust checkbox was removed.
- Changing the working folder while connected immediately restarts Pi in the selected folder without returning to the launcher.
- Composer auto-sizes with its content up to 11 lines, matching the Molten Forge implementation.
- Context usage is a circular meter beside the icon-only send button, with the details popover anchored to that meter.
- Default corner radius is 4 px, user messages no longer have an outline, assistant replies no longer show a redundant `Pi` label, and the working-directory path is only shown in the sidebar.
- App icon is intentionally unchanged pending the replacement icon asset.

A small **Tauri + React + Rust** desktop client around a **system-installed Pi** runtime.

The app launches `pi --mode rpc` in the selected working directory and communicates with Pi over JSONL stdin/stdout.

## Current scope

- System-installed Pi runtime, so Pi can be updated independently from Molten Forge.
- Native folder picker for selecting the working directory.
- Persistent Pi RPC process with streaming text, thinking, tool-call arguments, and tool output.
- Thinking expands while it is streaming, then collapses to a first-line preview like Molten Forge.
- Tool calls show separate Input and Output sections, collapse after completion, and use Molten Forge-style runtime grouping.
- Tool calls from the same Pi assistant tool batch are grouped under `Parallel tool calls` when more than one is present.
- A Molten Forge-style gradient generation status shows Composing, Thinking, Waiting for tool, or Writing as Pi moves through the turn.
- Markdown fenced code blocks use read-only CodeMirror with the old Molten Forge syntax palette, lazy language loading, incremental streaming edits, wrap/copy/download/fullscreen controls, and internal scrolling.
- Markdown rendering for assistant and wrapper/system messages, including GFM tables/lists; wide tables scroll horizontally inside the message instead of widening the chat.
- Molten Forge System/Light/Dark appearance with the original light/dark semantic palettes, bundled mountain backgrounds, a master background toggle, and independent per-theme custom backgrounds.
- The chat runs behind an absolutely-positioned composer with a local blur below it instead of a full-width footer surface.
- Normal UI/sidebar text uses 16px as the default size.
- Saved Pi sessions shown in the left sidebar for the current working directory.
- Clicking a saved session switches Pi to it and restores its messages.
- Current model and thinking level shown in the chat header.
- `/model` lists configured models; `/model provider/model-id` switches models and now shows a confirmation/error.
- `/` command completion for wrapper mappings plus commands discovered from Pi extensions, prompt templates, and skills. Arrow keys change the highlighted command; Enter or click executes it immediately.
- Context usage is shown in the composer footer using Pi's actual current `contextUsage`; the system-prompt/tool/message split is an approximate breakdown derived from Pi session metadata.
- `!command` and `!!command` through Pi's RPC `bash` command.
- Pi RPC extension UI support for select/confirm/input/editor interactions.

## Requirements

Pi must already be installed and available on PATH:

```bash
pi --version
```

You also need the normal Tauri development prerequisites: Node.js, Rust/Cargo, and platform build tools.

## Run

Install/update frontend dependencies first. This is required when upgrading to v0.34 because CodeMirror dependencies were added:

```bash
npm install
npm run tauri:dev
```

Production build:

```bash
npm run tauri:build
```

## Architecture

```text
React UI
   │
   │ Tauri invoke/events
   ▼
Rust bridge
   │
   ├── native folder picker
   ├── Pi session discovery
   │
   │ JSONL stdin/stdout
   ▼
system Pi CLI
   ├── agent loop
   ├── models/auth
   ├── sessions
   ├── tools
   ├── extensions
   ├── skills
   └── prompt templates
```

Molten Forge intentionally does not duplicate Pi's agent runtime.

- Surfaces Pi non-retryable terminal provider/model errors, automatic provider retries, and exhausted retry failures in the transcript.


## v0.10 notes

- Reattaches to the already-running Pi RPC process after a frontend reload.
- Chat width and sidebar width are persisted locally.
- Chat resize markers mirror each other vertically and no longer jump before hiding.

- Markdown LaTeX math rendering via KaTeX (`$...$` and `$$...$$`).


## v0.25

- Uses the original Molten Forge Windows icon resources without regenerating the ICO.
- Command palette shows every discovered command, groups commands by source, and keeps keyboard selection scrolled into view.
- Composer model/context/send controls use 16px spacing.
- Manual/automatic compaction is visible while it runs and reports completion/failure.
- Unknown successful RPC command responses are rendered instead of being silently dropped.

## Testing

Run frontend unit tests:

```bash
npm run test
```

Run Rust unit tests:

```bash
npm run test:rust
```

Run tests plus the production frontend build:

```bash
npm run check
```

Use `npm run test:watch` while iterating on frontend logic. See `AGENTS.md` for the project testing policy and architectural invariants.

## v0.36.35 window-control cursor + test contract fix

- Fixed the stale context-header regression assertion to match the established lowercase compact `k` formatter (`↑239k`).
- Made minimize, maximize/restore, and close explicitly use a pointer cursor even inside the custom Tauri titlebar region.
- Disabled pointer targeting on the Lucide SVGs inside those controls so the button itself consistently owns hover/cursor behavior.


## v0.36.53 literal composer text, retry notices, notifications

- Composer text preserves sequences such as `!!`, `...`, and `..` visually by disabling discretionary ligatures/font substitutions on the textarea. The entered characters are not rewritten.
- Pi provider retry notices are standalone rows, never inside Thinking/tool runtime groups or dashed cards. On successful recovery, the transient notice disappears; exhausted retries remain visible as errors. Summary retry notices follow the same rule.
- General settings now includes an opt-in **Notify when a response finishes in the background** switch. It requests OS notification permission when enabled and sends one system notification on Pi `agent_settled` only if the app is unfocused and the user didn't interrupt the response.
- Added deterministic regression coverage for literal composer styling, runtime grouping, retry cleanup wiring, notification focus/permitted completion decisions, and the native Tauri integration.

**Upgrade:** This version adds the official Tauri v2 notification plugin. After copying source files, run `npm install` to install the new frontend dependency. Cargo automatically updates its lockfile when you next build with Rust toolchain/network available. No existing files or directories need deleting.

