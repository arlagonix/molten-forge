# Molten Forge — ub-mode code review

**Baseline:** v0.36.79, source archive dated 2026-10-26. **Review date:** 2026-10-27.  
**Reference:** [unclebob/ub-mode](https://github.com/unclebob/ub-mode/blob/master/SKILL.md).  
**Scope:** static architecture / testing / boundary review against the skill. No runtime behavior was changed by this audit.

## Verdict

**Partially aligned; not yet conformant to the full ub-mode workflow.** The project has a strong set of extracted pure core helpers, UI/RPC regression tests, and documented boundaries. However, several important paths remain concentrated in a single mutable React component, many RPC records are typed as `any`, some tests verify implementation text rather than observable behavior, and the deterministic quality-gate tools required by the skill are not integrated. The audit does **not** establish a CRAP score, duplication threshold, mutation score, or full runtime test result.

## Findings (priority order)

### P1 — Agent lifecycle and UI state are overly centralized

- **Evidence:** `src/App.tsx` (~5,911 lines). `App` contains project/session selection, Pi RPC request handling, interruption reconciliation, context usage, chat scrolling, and rendering. Representative sections: session state/refs near lines 1090–1240; RPC/history near 1946–2180; interruption near 2299; session switching near 4158.
- **ub-mode:** “Model the Domain”, “Separate Before Serializing Shared State”, “Keep business logic in a pure function”, and “Reduce each function under CRAP 10”. The length alone does *not* establish a CRAP violation; this is a maintainability and state-ownership risk.
- **Action:** Extract one lifecycle state machine at a time (e.g. project switching, then pending RPC correlation) behind explicit typed events and transitions. Preserve existing behavior with event-sequence tests before moving code. Avoid a wholesale rewrite.

### P1 — Several regression tests inspect source strings rather than behavior

- **Evidence:** `src/core/pi-history-wiring.test.ts`, `src/core/project-sidebar-transition.test.ts`, and `src/core/tool-presentation-wiring.test.ts` read TSX/CSS files and use `.toContain()` or regexes to assert exact snippets and order.
- **ub-mode:** “Test Behavior, Not Implementation” and “Refactoring — Prove the behavior did not change”. These tests can fail after harmless refactoring or pass even when the runtime behavior is broken.
- **Action:** Replace the highest-risk tests incrementally with behavior tests that drive the project/session and Pi-RPC handlers using fake native command responses/events. Keep a small number of intentional structural/style assertions for contracts that cannot be observed otherwise.

### P2 — Pi RPC values are not consistently parsed at the boundary

- **Evidence:** `src/App.tsx:166` defines `type Json = Record<string, any>`; `historyToTranscript(messages: any[])` near line 447, and `map((command: any)` near 2007/3072 mix parsing and domain logic. Some dedicated helpers in `src/core/` are better typed.
- **ub-mode:** “Check the data where it enters”, “Parse outside data once”, “Do not silence the compiler”, and “Make illegal states impossible”.
- **Action:** Define discriminated unions for known Pi RPC envelopes and runtime events. Parse/validate `unknown` once on arrival, then pass typed records into pure reducers and presentation helpers. Preserve forward compatibility by explicitly carrying unknown records rather than coercing them into known cases.

### P2 — Session discovery repeatedly traverses and parses persisted JSONL histories

- **Evidence:** `src-tauri/src/lib.rs:490` (`list_sessions`) and `:525` (`collect_project_summaries`) traverse session files. Both call `read_session_info` (near `:1134`), which parses all entries to compute activity time and first message. The project summary path also separately opens/parses the header before calling that helper.
- **ub-mode:** “One decision lives in one place”, “Build the Lever”, and “Sequence work into verifiable units”. This is an *observed redundant IO path*, not a measured performance regression.
- **Action:** Read each header and each file body at most once per discovery pass, using a shared typed metadata extraction helper. Benchmark with hundreds of sessions before introducing persistent caching; the project deliberately avoids a stale conversation-list cache.

### P2 — Full ub-mode quality gates are not wired into the build

- **Evidence:** `package.json` runs Node checks, Vitest, TypeScript, Vite and Cargo; there are no `crapper`, `dryer`, or `mutator` scripts in the project. Tool availability was not established and no CRAP/mutation/duplication scores were generated.
- **ub-mode:** “Crapper” (CRAP < 10), “Dryer” (duplication similarity < 0.8), “Mutator” (kill surviving mutants).
- **Action:** Trial the companion tools against a small subset of pure `src/core` modules; verify their language compatibility and runtime before adding gates. Do not report numerical compliance until those programs actually run.

### P3 — Read-only SKILL.md preview is bounded, but its native path input is broader than the UI inventory

- **Evidence:** `src-tauri/src/lib.rs:749–763` verifies basename `SKILL.md`, file type and <=256 KiB, but `read_pi_skill(path)` accepts a caller-supplied path without checking that it was discovered under trusted skill roots.
- **ub-mode:** “Boundary Discipline”. This is a defense-in-depth concern for native IPC; it is **not** evidence of a remote vulnerability or privilege escalation.
- **Action:** If the Tauri threat model requires it, resolve/canonicalize selected manifests and allow only paths from approved project/global skill directories (plus Pi-configured resource roots). Test symlink/path traversal behavior before enforcing such a restriction.

## Existing strengths

- `src/core/` contains reusable pure helpers with numerous behavioral unit tests, e.g. `project-sidebar.ts` / `.test.ts`, `pi-resources.ts` / `.test.ts`, and scroll/grouping logic.
- `src-tauri/src/lib.rs` already includes native tests for project-directory preflight and size-limited skill preview.
- `AGENTS.md` and topic-specific docs describe critical behavior boundaries and regression requirements, including Pi RPC lifecycle, scrolling and code-block rendering.
- A consistent `npm run check` contract already exists; execute it on a dependency-equipped workstation.

## Not verifiable from this snapshot

- Whether prior changes were written failing-test-first or committed/pushed in small increments (the archive contains no Git history).
- CRAP < 10, duplication < 0.8, and mutation test success (companion tools not run).
- Full frontend/Windows/Tauri runtime success without npm dependencies/Cargo in the audit container.
- Actual multi-project performance under realistic session histories (no benchmark data).

## Suggested sequence (small, observable steps)

1. **Behavior tests:** make project switch and interrupted-turn tests drive real handlers instead of searching source text; confirm failures are meaningful.
2. **Typed RPC boundary:** introduce discriminated records with a no-loss unknown fallback, one event family at a time.
3. **Pure lifecycle reducers:** move one state machine out of `App.tsx`, pin old behavior first, then compare tests.
4. **Session metadata scan:** remove duplicate file opens, add repeatable timing fixtures, measure before caching.
5. **Quality gates:** evaluate the three companion tools on a small representative module and only then integrate them into CI.

## Action log

- Inspected the supplied v0.36.79 source archive and the original `ub-mode` `SKILL.md` (reason: establish the correct baseline and checklist).
- Installed a project-local skill in `.agents/skills/ub-mode/SKILL.md` and registered it in `AGENTS.md` (reason: ensure Pi and other project agents discover it).
- Examined frontend state/RPC handling, Rust session scanning, representative pure helpers, and test strategy (reason: distinguish violations from existing strengths).
- Wrote this review without refactoring application logic (reason: the request was to install and review, not to risk unrelated behavior changes).
- No Git commit or push performed: the input was a standalone source ZIP, not a Git working tree.
