## v0.36.83 — Sidebar error-state regression and brittle CSS test

The Windows Vitest run for v0.36.82 reported 3 failed assertions, but the pasted excerpt includes enough detail to diagnose only two. The sidebar component hid the `Could not load sessions` error when `openedKey === activeKey`, because the error element only rendered in `!expanded`; the session rows could continue to render in that state. The SSR test now pins both empty-error and stale-row error cases. The Skills CSS test referred to a removed selector despite the current `.pi-skill-code-viewer` wrapper existing. The assertion now checks the current frame and wrapping scroller instead.

### Action log (ub-mode) — v0.36.83

1. Read the supplied Windows test failure, `AGENTS.md`, `ub-mode`, frontend testing guidance, sidebar component/tests, and relevant CSS.
2. Confirmed the pre-change failure report: the expanded sidebar omitted `Could not load sessions`; a stale CSS selector had no corresponding production rule. No assertion-level local red test was possible because Vitest/React dependencies are unavailable.
3. Fixed the sidebar status in one rendering decision, placed outside or inside the expanded container as appropriate. Blocked active-project conversation rows while lookup is loading or failed.
4. Added a stale-row regression test, and updated the obsolete CSS contract without changing Settings behavior.
5. Verified checks available in this environment. Full React/Vite build and Rust tests require the dependency-equipped developer workstation. No Git commit/push: source-archive workflow, no repository checkout.

---

## v0.36.82 — Transaction-level project switching

The real `switchToProject` callback now calls `executeProjectSwitch`, a single production coordinator with injected Pi/native and React adapters. Unlike the preflight-only checks, `src/core/project-switch-lifecycle.test.ts` exercises the complete **operation order** from directory validation through UI cleanup. It tests that a failed `stop_pi` does not clear the old conversation; an accepted switch stops the old Pi process before connecting the new one; a restored conversation is synchronized **before** the loading state closes; cancelled/failed restoration and thrown native/RPC failures still release input blocking and loading; direct bash is aborted before shutdown; fresh sessions skip history restoration; disconnected startup skips stopping a nonexistent runtime.

The connector (`App.tsx`) still supplies actual React setters, Pi RPC callbacks, Tauri `invoke` and `connect`. These tests execute the same coordinator used by the connector but do **not** mount the entire React app or spawn Pi. Any assumption about renderer timing or real Tauri process behavior must still be verified in a Windows build. Existing source assertions for the interrupted-turn RPC boundary remain until that integration handler is testable.

### Action log (ub-mode) — v0.36.82

1. Read `AGENTS.md`, `ub-mode`, `frontend-testing`, `tauri-react-integration`, `react-component-architecture`, and `docs/pi-rpc-lifecycle.md`. Inspected the v0.36.81 `switchToProject` callback and preflight implementation.
2. **Wrote the transaction tests first.** Confirmed a compile-time red state (production lifecycle module missing). The Vitest runner was unavailable, so no assertion-level red stage was claimed.
3. Moved sequencing to `executeProjectSwitch` while keeping all React/Tauri effects in thin adapters. Added a discriminated-state narrowing fix after strict compilation rejected the initial code.
4. Replaced an obsolete inline `switchToProject` formatting assertion with transaction-level behavioral tests; retained sidebar-specific loading and animation contracts.
5. Compiled the production coordinator and dependencies using strict TypeScript and executed nine scripted Node smoke scenarios against the compiled production modules, including stop failure, restore failure, fresh and disconnected startup. Seven independent Node tests passed.
6. Full Vitest/React build and Rust tests were not executable because project npm dependencies and Cargo were unavailable. The CRAP/Dryer/Mutator binaries were also unavailable. No commit or push: this is a source archive without a Git checkout.

---

# Behavioral lifecycle tests — v0.36.81

## Scope

This is the first small, nonvisual ub-mode testing increment. Rather than rewriting the large React application, two already-existing decisions moved behind simple injectable interfaces.

- `src/core/project-switch-preflight.ts`: project directory must exist before Pi can be interrupted; decline-to-switch keeps the current session intact; a successful preflight enters loading **before** history listing; inactive-project activation restores the last selected session or newest session; `fresh` skips restoration; explicit target sessions skip redundant list RPCs.
- `src/core/pi-history-rpc.ts`: prefer Pi `get_entries` for the complete display transcript, use `get_messages` only as a compatibility fallback after an explicit unsuccessful response, and let transport failures/timeouts reject instead of silently returning a truncated transcript.

Both are used by `src/App.tsx`, not duplicate test-only reimplementations. `project-switch-preflight.test.ts` and `pi-history-rpc.test.ts` drive them with scripted native/RPC callbacks. Existing `session-history.test.ts` covers active-branch projection, and `interruption-lifecycle.test.ts` covers pure abort/post-abort primitives.

## Remaining work and boundaries

- This does **not** claim integration coverage for the entire `App.tsx` React event listener, UI loading animation, live Pi process, or actual Tauri desktop app.
- `pi-history-wiring.test.ts` retains one source-level contract for the distinction between post-abort model-visible `get_messages` and display history. `project-sidebar-transition.test.ts` likewise retains some UI-loading/style assertions. Replace these only after building a real injected event-handler/React integration harness, not by moving assertions to a different text file.
- The first iteration intentionally leaves scrolling/virtualization, direct bash, model switching and retry recovery untouched.
- Full verification on a development workstation: `npm run test`, `npm run build`, `npm run test:rust`. Without Vitest / Cargo, targeted pure TypeScript typecheck and scripted compiled-module assertions are the local fallback; they do not replace the full suite.

## Action log (ub-mode)

1. Inspected v0.36.80, `AGENTS.md`, `ub-mode`, the frontend testing skill, and the Pi RPC lifecycle documentation; selected two small seams to avoid a large application refactor.
2. Wrote failure-oriented Vitest cases for directory validation, cancellation, session restoration and Pi RPC fallback. Tried `npm run test:unit`: blocked because `vitest` is not installed in this environment (not a passing red test).
3. Extracted the two small production functions and wired the existing App callers to them; preserved loading-before-listing ordering using `beginSwitch`.
4. Removed redundant source-string assertions for those behaviors; left structural checks that still represent untested React integration contracts.
5. Ran strict TypeScript compilation for the pure modules and independently executed their compiled JS with scripted fake native/RPC results. Did not claim full React, Vite or Rust success.
6. Packaged source with the original `ub-mode` skill unchanged. No commit or push: this is a source archive rather than a connected Git checkout.
