# Composer render isolation

Long chats must remain responsive while typing. The chat composer therefore has its own local render boundary instead of storing the draft in the root `App` component.

## Why this matters

The transcript may contain hundreds of turns, virtualized rows, Markdown renderers, CodeMirror viewers, thinking/tool blocks, and active streaming state. If the current textarea value lives in root `App` state, every keypress schedules a root render and forces React to reconcile the entire application shell even though only the draft changed.

Memoizing transcript rows helps, but it does not remove the unnecessary root render itself and it still makes every parent-level prop/callback boundary participate in reconciliation.

## Contract

The following state belongs inside the memoized `Composer` component:

- current textarea draft;
- slash-command suggestions derived from that draft;
- selected suggestion index;
- command-menu DOM ref/scrolling;
- textarea auto-height measurement;
- Enter/Shift+Enter and suggestion keyboard handling.

The root `App` receives text only when the user actually submits it. Normal `onChange` events must not call a root setter.

The transcript remains a separate memoized component (`TranscriptView`) with memoized turns/items. Composer draft changes therefore do not cause a transcript render or a root `App` render.

## What may still rerender the root

Real application state is allowed to rerender `App`, for example:

- Pi streaming/transcript updates;
- model/context/session changes;
- settings changes;
- sidebar/layout changes;
- opening/closing context/settings UI.

The optimization is specifically that **typing/editing the unsent composer draft is not application state**.

## Submission behavior

On a valid submit, Composer clears its own draft immediately and invokes the root submit callback with the submitted string. The root then appends the user message, arms bottom-follow, and sends the RPC command/prompt.

Slash-command autocomplete also submits through this same boundary so selecting a command does not require moving draft state back into `App`.

## Testing contract

Regression coverage must verify structurally that:

- draft state is declared inside `Composer`, not root `App`;
- suggestion index/menu state is local to `Composer`;
- textarea `onChange` only updates local Composer state;
- textarea auto-resize is local to Composer;
- transcript view/turns remain memoized;
- root `App` renders `<Composer>` but does not own draft setters.

If a future feature needs draft information elsewhere, prefer a ref, submit-time callback, or narrowly scoped context. Do not lift the per-keystroke draft back into root state unless there is a measured reason and the transcript render isolation is preserved another way.
