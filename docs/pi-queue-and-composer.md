# Pi queued messages and tall composer

Pi is the sole owner of steering/follow-up messages. During streaming, the composer sends a correlated `prompt` RPC with `streamingBehavior: "steer"` or `"followUp"`; while idle it sends a normal prompt without that option. The user chooses a mode next to the model selector. Enter sends, Shift+Enter inserts a newline. Mode selection is local to Composer (does not rerender transcript on toggle) and persisted as a lightweight UI preference.

`queue_update` events contain complete `steering`/`followUp` snapshots. A read-only compact queue strip appears above the composer only while there are queued messages, scrolling internally when necessary. Do not guess queue contents from prompt acknowledgments. Acknowledgment means accepted, not completed or necessarily still queued (extensions can handle messages). `Retrieve` sends correlated `clear_queue` and puts the returned text into the draft; Pi provides no per-item removal RPC. Stop already clears queued text first. Never reset the queue merely on an `agent_settled` transition; Pi decides whether follow-ups remain.

When Pi **delivers** a queued user message, it emits `message_start` with
`message.role === "user"`. At that point the wrapper renders the user turn,
including persisted attachment references, with the normal transcript renderer.
Idle prompts are already shown optimistically and must consume exactly one
user-message echo from Pi. Do not append queued messages when `prompt` is
accepted or merely when `queue_update` changes. Preserve duplicate texts as
separate turns when Pi delivers them twice.

The composer is an absolute overlay, so the transcript reserves `--composer-overlay-clearance` equal to *measured intersection of the transcript bottom and composer top*, plus 16px. Observe both chat pane and composer sizes, listen to window resize/focus to catch window switches. Preserve reader anchor when manual scrolling, force bottom only when auto-follow was already enabled.

**Whole-overlay bound (v0.36.86):** `.composer-wrap` is a bounded flex column, not an unconstrained stack. Its maximum height leaves **at least `min(160px, 33% of the chat pane)` visible** above the composer. The queue retains a visible header and one row; oversized extension widgets/status panels and queue items scroll *inside their own sections*. Keep the floating model/command menus free of clipping. The textarea remains at least 72px tall, is sized by the existing 11-line / ~35%-of-pane JavaScript limit, and can shrink when the whole overlay becomes crowded. CSS must not impose another competing textarea maximum; `overflow-y: auto` always allows the textarea to scroll when flex-shrunk below the JavaScript size. The parent overlay remains the only measured surface for clearance. No transcript content should be hidden under a tall composer at maximum scroll position.

**Layout regression test:** `python tests/composer-layout.browser.py` uses real Chromium layout, the production CSS, and compiled production clearance helpers. It covers normal versus crowded overlays, 360/520/800px chat panes, narrow windows, and resizing the *same* mounted DOM without losing bottom readability. Requires optional Python Playwright and Chromium; it is not part of the default npm test suite. This is a browser geometry fixture rather than a complete Tauri/WebView2 end-to-end test.

This design must preserve Pi's `clear_queue → abort → verified idle` Stop flow, attachment restore on enqueue rejection, and extension slash command handling.

## Accessibility and keyboard

The mode control is a native select with a label; its selection does not trigger a prompt. The queue strip has an accessible section label, and its Retrieve button has both a text label and tooltip. `Shift+Enter` stays a newline; `Enter` sends using the selected mode while streaming. Stop stays a separate button. The queue preview uses one line per message, clips long text with ellipsis, and provides the user-visible text as its title (attachment metadata is stripped using the existing prompt parser). Native Pi queue events are never duplicated into local transcript content before delivery.
