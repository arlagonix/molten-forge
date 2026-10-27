# Pi integration audit — v0.36.18

Reviewed against the Pi RPC/session contract and the Tauri bridge.

## Hardened in v0.36

- Correlated RPC request/response handling with timeout and process-exit cleanup.
- Startup readiness barrier before initial state/model/command/history synchronization.
- Stop lifecycle: queue clear, abort acknowledgement, idle verification, persisted-history resync, dangling-tool-call recovery.
- Cross-harness safety: interrupted branches with unmatched tool calls are moved to a clean fork before further use.
- Session mutations (`switch_session`, `new_session`, `fork`, `clone`) now resync authoritative Pi state/history.
- `/reload` preserves and restores the active session.
- Prompt double-submit race is closed by setting the busy guard before the RPC write.
- Direct bash is serialized against prompt submission and supports `abort_bash`.
- Process shutdown closes stdin first; force kill is fallback only.
- stderr stays diagnostic rather than becoming transcript data.
- Queue, session-name, thinking-level, UI-prompt and extension-widget events now update UI state directly.
- Extension widgets are editor-adjacent mutable UI rather than permanent chat messages.
- Context usage refreshes at Pi turn boundaries during long autonomous runs; post-compaction null usage is represented by Pi's `estimatedTokensAfter` rather than a false zero.
- Terminal assistant/provider failures are buffered from `message_end` until Pi exposes retry intent at `agent_end`; non-retryable failures render once, while retry attempts stay represented by the Retry lifecycle. Restored full history keeps only the final unsuperseded assistant error.

## Intentionally unchanged

- One Pi process still owns one active session. There is no claim of background generation across session switches.
- TUI-only commands remain explicitly identified rather than being emulated incompletely.
- Pi owns session persistence, tool semantics, provider behavior, extensions, and skills; Molten Forge does not reimplement those systems.

## Follow-up observation

`src/App.tsx` still contains a large amount of Pi orchestration. Future touched areas should continue moving pure parsing/state decisions into `src/core/`, but this audit does not justify a broad rewrite by itself.

## Audited boundary matrix

| Pi boundary | Molten Forge behavior |
| --- | --- |
| JSONL transport | One LF-delimited JSON object per stdin write; stdout is read by LF and an optional CR is stripped. stderr remains diagnostic. |
| Request/response | State-changing or sequencing-sensitive operations use unique ids and correlated responses; process exit rejects outstanding waiters. |
| Prompt | UI becomes busy before the write, waits for acceptance, and stays busy until authoritative state / `agent_settled`; the prompt acknowledgement is not treated as model completion. |
| Stop | `clear_queue` → restore queued text → `abort` → verify idle → resync durable history/stats. During compaction, keep Stop pending, reassert abort when compaction yields, and use a same-session Pi restart only after a long compaction stall. |
| Interrupted tools | Persisted unmatched `toolCall`/`toolResult` history triggers a clean fork before the interrupted user turn when possible; the original branch is preserved. |
| Compaction/retry | Compaction/retry events update activity UI but do not independently declare the whole agent run idle. |
| Context usage | `get_session_stats` is refreshed at `turn_end` and settlement boundaries. Post-compaction `null` context usage uses `estimatedTokensAfter` until Pi has a new authoritative assistant-usage baseline. |
| Direct bash | Serialized against prompts; streamed updates are rendered; final response is awaited; Stop maps to `abort_bash`. |
| Session changes | `new_session`, `switch_session`, `fork`, and `clone` are followed by state/history/stats resync. `/reload` restores the active session. |
| Model/thinking | Pi is authoritative; model picker uses correlated `set_model`; state-change events synchronize the UI. |
| Commands | `get_commands` supplies extension/skill/prompt commands. Wrapper commands are handled locally; TUI-only commands are identified rather than faked. |
| Extension blocking UI | `select`, `confirm`, `input`, and `editor` use the extension UI response sub-protocol. Server-side `ui_prompt_end` also dismisses stale dialogs. |
| Extension fire-and-forget UI | notify/status/title/editor-text/widget updates do not masquerade as blocking agent work; widgets stay around the editor instead of becoming transcript history. |
| Process lifecycle | stdin closes first, Pi receives a grace period to dispose/flush, and force termination is only a bounded fallback. |

## Pi RPC capabilities intentionally not exposed yet

The audit also checked commands that the current product does not offer as first-class UI. Their absence is intentional rather than an unhandled lifecycle hole:

- `steer` and `follow_up`: Molten Forge currently blocks ordinary composer submission while an agent run is active. If streaming message injection is added later, it must use Pi's explicit streaming behavior rather than sending a plain `prompt`.
- model/thinking cycling commands: the app exposes direct model selection and thinking selection instead of cycling UI.
- lower-level entry/tree navigation beyond the existing `/tree`, `/fork`, and session sidebar flows.
- optional auto-compaction/auto-retry configuration RPCs that are not currently represented in Settings.

Before exposing any of these, extend `docs/pi-rpc-lifecycle.md` and add boundary regression tests rather than wiring them as fire-and-forget stdin writes.
