# Chat scroll-following

This document is the source of truth for transcript auto-follow behavior.

## Core model

Scrolling has one explicit ownership bit: **auto follow is either on or off**.
Generation state and rendered state are intentionally separate.

### Auto follow on

While Pi is generating and auto follow is on:

- the visible transcript updates live;
- Molten Forge uses the mature Electron moving-bottom `requestAnimationFrame` lerp;
- every animation frame re-reads the **current** legal transcript bottom;
- the next scroll position is `current + (target - current) * 0.12` until it settles within `0.5px`;
- bottom-follow never performs an explicit upward write when real layout contracts;
- transcript/content resize events re-arm the same lerp, including delayed Markdown and CodeMirror geometry changes;
- token, thinking, tool, retry, Markdown, ResizeObserver, and virtualizer events do not own separate competing scroll algorithms.

This is intentionally the same animation model that made the old Electron Molten Forge feel smooth. The target may move while the animation is running; the lerp follows it continuously instead of restarting fixed-duration animations.

### Auto follow off

When the reader takes control:

- auto follow turns off immediately;
- any active bottom-follow animation is cancelled;
- the currently visible transcript is frozen as a snapshot while authoritative Pi state continues to update in memory;
- generation events do not change the visible active turn;
- Molten Forge performs no generation-driven bottom scrolling.

The frozen visual transcript is the main layout-stability mechanism. We do not try to compensate for hundreds of streamed Markdown/tool/thinking reflows while the reader is above the live bottom.

## Manual ownership

Explicit reader input turns auto follow off:

- upward mouse/trackpad wheel;
- `ArrowUp`, `PageUp`, or `Home` outside editable controls;
- touch/pen interaction in the transcript;
- mouse interaction with the native scrollbar gutter;
- activating a height-changing Thinking/tool/Diff/Raw control while generation is active.

Downward scrolling while auto follow is already off never re-enables follow merely because the reader is "near" the bottom. The reader must actually reach the bottom (within a small `2px` numerical tolerance), or explicitly press the scroll-to-bottom control / start a new prompt or command.

No timeout re-enables auto follow. New tokens do not re-enable it.

## Visual freeze and final flush

Authoritative Pi transcript state always keeps updating, even while the UI is frozen.

The visible transcript uses:

```text
frozen snapshot ?? authoritative transcript
```

When the reader leaves the live bottom during generation, the last **committed visual array** becomes the frozen snapshot. Molten Forge deliberately does not snapshot a newer authoritative Pi delta that React has not painted yet. This freezes assistant tokens, Thinking lifecycle changes, tool output, retry blocks, and runtime regrouping together rather than trying to stabilize them independently.

The task boundary for releasing a frozen generation is Pi's `agent_settled` event. At settlement:

1. capture a logical reader anchor if auto follow is still off;
2. remove the frozen snapshot so the latest authoritative transcript appears once;
3. preserve that anchor through the bounded final layout settle;
4. keep auto follow **off**.

If the reader manually returns to the bottom before `agent_settled`, the frozen snapshot is released immediately and live rendering/following resumes.

## Reader anchor

The old Molten Forge logical-anchor idea is retained, but only for the bounded final visual flush and explicit reader-triggered layout transactions such as expanding/collapsing Thinking/tools or switching Diff/Raw. It is not a continuous generation-time correction loop.

An anchor stores:

- visible `data-message-id`;
- a child-element path inside that message;
- the child's offset from the transcript viewport top.

After the final flush, Molten Forge resolves the same element and corrects `scrollTop` so the same content remains at the same screen Y position. A short bounded settle window catches virtualization/Markdown/CodeMirror measurements from that one flush.

## Virtualization and CodeMirror geometry

TanStack Virtual remains transform-free (`directDomUpdatesMode: "position"`) so sticky code headers continue to work.

TanStack row-size scroll correction is disabled while:

- Pi is streaming; or
- Molten Forge is preserving the reader anchor through the final visual flush.

This keeps one scroll-position owner at a time. The old monotonic streaming row-height floor stays removed: virtual rows always report their real measured height, so legitimate Thinking/tool collapse cannot leave phantom blank space.

Native browser scroll anchoring stays disabled (`overflow-anchor: none`) on both the transcript scroller and transcript content.

CodeMirror must not introduce a second asynchronous geometry pipeline:

- editor mount, wrapping changes, and streamed document edits use React layout effects so the editor is updated before paint;
- syntax highlighting is color-only so delayed language loading cannot change font metrics and wrapping;
- CodeMirror reserves a stable scrollbar gutter to avoid width/line-wrap oscillation when internal scrolling appears;
- virtualized Markdown blocks own a `ResizeObserver` and continuously report their real height, so a late CodeMirror measurement cannot leave the inner Markdown virtualizer with a stale estimate;
- those real geometry changes only re-arm the same bottom lerp when auto follow is active.

## Thinking/tool lifecycle

Activity expansion is deterministic and must survive React remounts caused by runtime regrouping:

```text
manual user override ?? (running && autoExpandSetting)
```

Therefore:

- running + auto-expand -> expanded;
- completed + no manual override -> collapsed;
- a manual user choice is respected.

Thinking is considered complete not only on Pi's explicit `thinking_end`, but also on the first subsequent assistant text or tool-call event. Some provider/event paths transition directly from reasoning deltas into answer text; the UI must stop the Thinking spinner and collapse the block at that transition rather than waiting for the whole assistant message to finish.

Running expanded Thinking has a bounded inner viewport (`52dvh`, capped at `560px`) with its own vertical scrolling. As reasoning streams, that nested pane follows its own bottom when it overflows so the newest reasoning stays visible. This inner follow must only write the Thinking pane's `scrollTop`; it must never call or mutate the transcript auto-follow, reader-anchor, or sticky-scroll state.

Once Thinking completes, an expanded block drops the inner max-height/vertical scrollbar and uses its full natural height. This keeps active streaming bounded without forcing completed reasoning into a nested scroll pane.

Nested scroll surfaces (running Thinking, tool-text viewers, and CodeMirror code blocks) must use normal vertical scroll chaining: consume wheel motion while the inner surface can scroll, then hand it back to the transcript at the edge. Do not use vertical `overscroll-behavior: contain` on these surfaces; it creates dead wheel zones. Chat-width resize gutters sit above the transcript for pointer dragging, so their wheel handler explicitly forwards vertical wheel motion into the transcript and applies the same manual-reader ownership rules.

## Explicit landings

Sending a prompt, transcript-producing command, opening a populated history/session, or pressing the scroll-to-bottom control explicitly arms auto follow and lands at the latest content.

Empty sessions land at `scrollTop = 0` and remain non-scrollable until content exists.

## Testing contract

Regression coverage must include:

- the old `0.12` moving-bottom lerp and `0.5px` settle epsilon;
- continuously re-reading the current bottom while the rAF loop is active;
- no explicit upward auto-follow writes;
- explicit reader input disabling follow;
- no automatic near-bottom resumption;
- manual return to the real bottom re-enabling follow;
- visible transcript snapshot while authoritative items continue changing;
- one final flush at `agent_settled`;
- logical anchor preservation through that flush;
- no monotonic streaming measurement floor;
- TanStack correction disabled while streaming/final-flush settling;
- native browser anchoring disabled;
- CodeMirror pre-paint mount/update geometry and stable scrollbar gutter;
- ResizeObserver-backed virtual Markdown block measurement;
- deterministic Thinking/tool auto-collapse across remounts;
- Thinking completion on explicit `thinking_end` and on first following text/tool activity;
- bounded/auto-following running Thinking, full-height completed Thinking, and large user prompts;
- empty-history top landing and populated-history bottom landing.


## Composer overlay clearance and horizontal stability

The composer is an absolute overlay and must never participate in transcript scrolling. The transcript reserves a measured bottom clearance instead:

- the full `.composer-wrap` is observed with `ResizeObserver`;
- `--composer-overlay-clearance` is the larger of the existing 190 px baseline or the measured composer overlap with the transcript plus 16 px;
- transcript `scroll-padding-bottom` and content `padding-bottom` consume that variable;
- the composer itself remains pinned to the chat pane.

The transcript uses `scrollbar-gutter: stable` in populated, empty, and history-loading states. Session switching must not temporarily remove the gutter, because the composer mirrors the physical transcript center and even a half-scrollbar-width change is visible as horizontal jitter. Geometry synchronization rebinds when the active session changes and otherwise relies on `ResizeObserver` rather than item-count/history-loading effects.

## Settings and appearance reflow

Opening Settings must not unmount the active transcript. The chat stays mounted behind the Settings workspace so its virtualizer, scroll state, and reader ownership survive arbitrary setting changes.

Geometry-changing settings use the existing reader-anchor transaction:

- font changes preserve the same logical visible content when the reader owns the viewport;
- running Thinking/tool auto-expand changes preserve the current reader anchor;
- if bottom-follow owns the viewport, a geometry-changing setting keeps the transcript pinned to the authoritative bottom;
- theme/background-only changes do not create a new scroll owner.

## Scroll-to-bottom affordance

When the reader is meaningfully away from the bottom, Molten Forge shows the dedicated down-arrow affordance above the composer. Small numerical bottom offsets do not show it.

Activating it is an explicit landing:

- release any frozen streaming snapshot;
- clear reader-anchor ownership;
- jump immediately to the current legal bottom;
- re-arm normal bottom-follow;
- settle again after pending virtualizer/Markdown measurements so the control cannot land on a stale pre-flush bottom.

The control follows the measured composer clearance so a tall multiline composer cannot cover it.


For queue strip and short-window multiline drafts, also see `docs/pi-queue-and-composer.md`. The resize observer tracks both the composer and chat pane, plus window resize/focus.

## Phase 4: Floating composer fade

The composer **already** overlays the transcript. Preserve its absolute
positioning, measured bottom clearance, 16px safety gap, queue/widget height
bounds, center alignment, and existing auto-follow/reader-anchor owners.

The new fade is a 16px `mask-image` gradient on the **transcript scroll viewport**,
not a backdrop blur, tinted card, or per-message mask. Because the mask belongs
to the viewport, its horizon remains stationary while virtualized messages
scroll beneath it. A mask affects only appearance, not hit testing or scroll
geometry; avoid `transform` on the virtualized rows and their sticky code headers.

`--composer-fade-inset` measures the actual overlap from the transcript's bottom
to `.composer-wrap`'s top, independently of `--composer-overlay-clearance`.
The overlay has **no top padding**, so its measured top coincides with the first
visible composer/queue/widget surface; otherwise the masked viewport would
show an invisible strip immediately above the composer.
The latter retains the 190px minimum, needed for scroll clearance and large
composer/queue layouts. Using that minimum as the fade position would make a
short composer hide text far above its actual top. The existing ResizeObserver
updates both values and keeps automatic following/reader intent unchanged.

The mask is disabled for empty and history-loading transcripts, and applies in
both light/dark themes without an extra image layer or blur. It begins fading
at the composer top and returns to full opacity 16px above it, where the last
message is allowed to settle.
