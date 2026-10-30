# Collapsed thinking preview

This document defines the compact `Thinking` header behavior copied from Electron Molten Forge.

## In-progress thinking

When a thinking block is collapsed while still running:

- the spinner remains visible;
- the compact header also shows the **latest non-empty thinking line**;
- the live compact preview is sampled every `50ms`, rather than changing on every streamed token;
- the newest rolling preview is sampled immediately when the block becomes collapsed/running, then refreshed by the 50ms interval.

The 50ms cadence keeps the preview visibly alive while still avoiding per-token header rerenders.

## Completed thinking

As soon as thinking is complete, the compact header stops showing the latest line and switches to the **first non-empty thinking line**. No idle interval is kept alive after completion.

Completion is authoritative on Pi's `thinking_end`, but the UI also treats the first following assistant text (`text_start` / `text_delta` / `text_end`) or tool-call event as a defensive end-of-thinking boundary. Some provider/event paths transition directly from reasoning deltas into answer text; Thinking must stop showing progress and auto-collapse at that transition rather than waiting for the whole assistant message to finish.

This gives completed reasoning a stable label instead of leaving whatever transient line happened to be visible at the end of streaming.

## Line cleanup

Preview lines are prose-oriented. Before display, common leading/trailing Markdown markers are removed, including headings, bullets, numbered-list punctuation, emphasis/backticks, blockquote markers, and surrounding whitespace.

Empty/marker-only lines are skipped.

## Expanded thinking

Expanded thinking continues to render the full Markdown body. The compact preview timer is only needed while the block is both running and collapsed.

While Thinking is still running, the expanded body keeps a bounded inner viewport and automatically follows its own bottom as new reasoning arrives. This follow is local to the nested Thinking scroller; it must not mutate the transcript scroll position or the transcript reader/auto-follow state.

After Thinking completes, an expanded block uses its full natural height with no inner vertical max-height or scrollbar. Completed reasoning therefore scrolls as ordinary transcript content.

## Testing contract

Tests must cover:

- `50ms` cadence constant;
- Markdown-marker cleanup;
- first useful line selection;
- latest useful line selection;
- whitespace/marker-only content;
- in-progress selection of sampled latest line;
- completed selection of first line;
- text/tool activity finalizing an otherwise still-running Thinking block;
- unchanged sampled-line identity when no new line appeared.

## v0.36.37 live frontier preview

- While Thinking is actively running and collapsed, the compact preview samples the latest meaningful row once per second and shows its tail, so the newest generated characters remain visible.
- The live preview is right-anchored when space is tight; completed Thinking immediately returns to the stable beginning of the first meaningful row.
- Running tool blocks use the same sampled live-tail convention. Before execution the preview follows generated tool input; after output begins it follows the latest output row. Completed tools return to their stable first meaningful input preview (file mutation tools keep the path preview).
- Tool input/output nested panes may follow their own bottom while running. This local follow must not call or mutate transcript reader/auto-follow state.


## Live train preview

While Thinking is running and collapsed, the compact preview concatenates rolling recent meaningful rows and right-anchors the newest text. Once that text exceeds the available header width, the old left edge fades away rather than inserting a literal ellipsis. Completed Thinking keeps the stable first-row preview. Tool blocks use the same live-preview contract.


## Thinking typography

Thinking reasoning text and the collapsed preview are italic, matching the established Pi/Molten Forge treatment. The Thinking label/chrome and code/preformatted content remain upright so syntax stays readable.
