# Pi RPC lifecycle contract

Molten Forge is a UI around Pi RPC. Pi/session data is authoritative; local React state is only a projection of it.

## Request completion

Writing JSON to stdin is not command completion. Commands that affect lifecycle/state must carry an id and be correlated with Pi's `response` record. Timeouts reject locally and clean pending bookkeeping. Process exit rejects all in-flight requests.

## Prompt lifecycle

A prompt is guarded as busy before it is written so a fast second Enter cannot enqueue an accidental second prompt. The visible run remains busy until Pi reaches a settled/idle state. Extension commands may complete without an agent run, so their command path re-reads `get_state` after the prompt acknowledgement.

## Provider/model failures

The `prompt` RPC response acknowledges acceptance only; provider/model failures arrive later through the assistant lifecycle. Treat `message_end.message` as authoritative. A finalized assistant message with `stopReason: "error"` carries the user-facing failure in `errorMessage`.

Do not render that error immediately at `message_end`: Pi decides retryability after the attempt ends. Buffer the error across `agent_end`. If `agent_end.willRetry` is true, discard the pending terminal row and let `auto_retry_start` / `auto_retry_end` own the visible Retry activity. A `willRetry: false` boundary may still be followed by compaction recovery or an extension-driven continuation, so only surface a still-pending non-retryable failure at `agent_settled`. Explicit `stopReason: "aborted"` is cancellation, not a provider-error row.

A provider can also terminate a turn with an error such as `Provider finish_reason: abort`. Treat that as a terminal interruption even when Pi never emits the normal `thinking_end` or `tool_execution_end` events: immediately stop live Thinking/tool spinners, mark only still-running agent activity as interrupted, preserve partial tool input/output, and keep already-completed tools completed. Keep the run blocked through `agent_settled` while Molten Forge resynchronizes full display history, current model-visible history, session stats, and final Pi state. If that resync finds dangling tool calls, use the same clean-fork recovery used by explicit Stop so a stale half-built tool tail cannot poison the next provider/harness.

Raw `get_entries` history intentionally retains failed retry attempts even after Pi uses context edits to omit them from future model context. On transcript restoration, suppress an errored assistant attempt when another assistant message follows before the next user turn; render only the final unsuperseded assistant failure. This avoids turning historical retry attempts into fake terminal failures after reopening a session.

## Stop / interruption

Stop mirrors Pi's Escape semantics and must execute in this order:

1. `clear_queue` and restore returned steering/follow-up text into the composer.
2. `abort` and wait for its correlated response.
3. Poll `get_state` until Pi is not streaming, compacting, or holding pending messages.
4. Re-read messages and session stats from Pi.
5. Detect assistant `toolCall` blocks with no matching `toolResult`.
6. If a dangling tool call remains, create a clean fork before the interrupted turn and restore that user prompt into the composer. Preserve the original interrupted branch for inspection.

Never mark Stop complete merely because the UI received an abort click.

### Stop during compaction

Current Pi builds can acknowledge the normal `abort` RPC while an automatic compaction summary is still running. Molten Forge therefore treats Stop as a persistent user intention across that phase:

- while `get_state.isCompacting` remains true, keep the run busy and show `Stopping compaction…`; do not append a terminal transcript error merely because the ordinary 60-second idle window elapsed;
- when compaction ends, reassert `abort` before Pi can resume the larger agent run, then continue the normal verified-idle → state/history resync path;
- if compaction remains stuck for the long fallback window (currently three minutes), restart the Pi process, restore the same session, and continue authoritative state/history synchronization before considering Stop complete;
- this fallback cancels the whole current run. It must not silently change the persistent auto-compaction setting.


## Context usage refresh

`get_session_stats.contextUsage` is the authoritative context meter when Pi has a valid usage baseline. Refresh it at stable agent boundaries, especially `turn_end` (one assistant response plus its tool results) and final settlement, rather than issuing an RPC for every streaming token delta. This keeps long autonomous tool loops current without turning context accounting into a hot polling path.

Immediately after compaction, Pi intentionally may return `contextUsage.tokens = null` and `percent = null` until the next post-compaction assistant response establishes a fresh usage baseline. Do not coerce that state to zero. Use the compaction result's `estimatedTokensAfter` as a temporary approximate display, then replace it as soon as a later `get_session_stats` returns finite authoritative tokens. The UI intentionally does not prefix approximate values with `~`; approximation remains tracked internally and may be explained in a tooltip instead. Lightweight live refreshes should not repeatedly re-run expensive session-file breakdown analysis.

## Session mutations

`switch_session`, `new_session`, `fork`, and `clone` are transactional from the wrapper's perspective: wait for Pi's response, then refresh `get_state`, full display history, `get_session_stats`, and the session sidebar. Display history uses Pi's `get_entries` RPC and projects only the current root→leaf branch. This is intentionally different from `get_messages`: `get_messages` is model-context history and omits pre-compaction messages, while the desktop transcript must preserve the full visible conversation and historical compaction entries. Fall back to `get_messages` only for older Pi builds that do not support `get_entries`. The preferred wrapper model may then be re-applied through Pi's `set_model` RPC.

After abort, `get_messages` is still used separately for dangling-tool-call safety because that check must match Pi's current model-visible context. It must not replace the full display history.

`/reload` must remember the authoritative active `sessionFile`, restart Pi gracefully, then switch back to that session and resynchronize it.

## Direct bash

Direct `!` / `!!` commands are separate from agent streaming. While direct bash is running, ordinary prompt submission is blocked; the Stop control sends `abort_bash`. The bash request is correlated until Pi returns the final result so a subsequent prompt cannot race ahead of context inclusion.

## Extensions

Blocking extension methods (`select`, `confirm`, `input`, `editor`) use dialog UI. Fire-and-forget methods must not make the agent look blocked. `setWidget` is mutable editor-adjacent chrome and must not be appended to the chat transcript.

## Process shutdown

Pi RPC uses LF-delimited JSON records. On shutdown, close Pi stdin first and allow Pi a short graceful exit window so it can dispose extensions/session state. Force-kill the process tree only as a timeout fallback.

Pi stderr is diagnostic logging and must not become conversation content.

## Event-listener freshness

The Tauri `pi-record` subscription is installed once for the app lifetime, but it must dispatch through a ref containing the latest record handler. Do not let the listener close over the first React render: Pi events such as session stats, extension UI, state changes, and session mutations need current React state and callbacks.

## Settlement boundaries

`agent_settled` or an authoritative idle `get_state` are whole-run settlement boundaries. `prompt` acceptance, `agent_end`, `compaction_end`, retry events, and a successful stdin write are not interchangeable with settlement. In particular, a compaction may be one phase of a larger run, so finishing the compact block must not enable prompt/session actions prematurely.

## Startup readiness

A spawned Pi process is not yet an application-ready RPC session. Do not enable the composer from the process-start event alone. Molten Forge marks the runtime connected only after a correlated `get_state` readiness response and the initial command/model/stats/history synchronization succeed.

## Retry visibility and completion notification (v0.36.53)

Retry is a standalone transient status, not assistant/tool runtime content. Keep a set of IDs for all retries in the current run. Remove them on success (`auto_retry_end.success` or new assistant attempt); do not persist "Retry recovered" rows. Only preserve an exhausted failure as a visible terminal error. Older Pi builds without a retry-end event must not leave an endlessly spinning retry row at `agent_settled`.

Native background notifications are optional and requested only from Settings, not from Pi event handlers. Trigger them at `agent_settled` only (not `agent_end`/`turn_end`), and only for a genuine active run not interrupted or aborted and when the Tauri window is not focused. Never block Pi session settlement on the permission/focus check or notification dispatch.

## Queue modes and editor overlay (v0.36.85)

See `docs/pi-queue-and-composer.md` for Steer/Follow-up RPC delivery, `queue_update` authority, and dynamic composer clearance.
