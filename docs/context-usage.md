# Context usage UI

The context-usage UI has two entry points and one implementation:

- the token telemetry block in the top-right chat header;
- the circular context-progress ring beside the composer send controls;
- both render `ContextUsagePopover` from `src/components/context-usage-popover.tsx`.

Do not fork the content, labels, calculations, or styling into separate header/composer implementations. Changes to the detail panel should apply to both entry points.

## Compact header telemetry

The header keeps the compact sequence:

- `↑` input tokens;
- `↓` output tokens;
- `R` cached/read tokens;
- `H` cache-hit percentage;
- `used/limit` current context;
- context percentage as a separate item at the same spacing as the other telemetry items.

Do not join `used/limit` and the percentage with a decorative separator. The flex gap already separates them visually.

The whole telemetry block is clickable and opens the shared context-usage popover.

## Popover content

The popover shows:

1. Context summary: used / limit, progress bar, percent used, remaining tokens.
2. Usage: Input, Cached, Cache hit, Output.
3. Current context: Used, Limit, Remaining, Used %.
4. Context breakdown: System / instructions, Tool definitions, Messages. The native breakdown is an estimate and should carry a subdued `Estimated` label rather than a `~` prefix on every number.

Do not show KV-cache totals in this popover. They are lower-level implementation detail and are not part of the agreed user-facing summary.

## Estimated usage after compaction

Immediately after compaction Pi may temporarily report exact context usage as unknown. Continue using the existing `estimatedTokensAfter` fallback until a later turn provides authoritative stats.

Estimated values use the same numeric formatting as exact values; do not prefix them with `~`. The popover may show a subdued `Estimated` label so the distinction remains available without dominating the compact UI.

## Interaction and performance

Popover open/closed state belongs inside `ContextUsagePopover`, not root `App`. Opening either the header telemetry or the composer ring must not introduce a root-state update that rerenders the long transcript.

Both variants:

- refresh session stats when opened;
- render the popover through a document-body portal so the composer/header glass surfaces cannot become a nested backdrop root that hides the popover blur;
- use a translucent backdrop-blurred glass surface so transcript/background content remains softly visible behind the panel;
- close on Escape;
- close on outside pointer input;
- expose `aria-expanded` and `aria-haspopup` on the trigger;
- keep the popover inside the viewport and internally scroll it if vertical space is constrained.

The header telemetry trigger must keep max-content geometry while visible so keyboard focus chrome encloses the complete stats row rather than a flex-shrunk box whose children overflow it.

## Compaction activity summary

A successful compact runtime block shows the token reduction directly when Pi provides both values, for example `97.2k → 41.5k (−55.7k)`. Prefer authoritative `tokensBefore` / `estimatedTokensAfter` from the compaction event/result. If `tokensBefore` is absent, the last finite authoritative context usage captured when compaction starts may be used as the before-value. Never turn Pi's post-compaction `null` context usage into zero.
