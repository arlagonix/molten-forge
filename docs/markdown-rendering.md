# Markdown, code blocks, and tables

This document is the source of truth for Markdown rendering behavior ported from the final Electron Molten Forge code-block work.

## Code blocks

Fenced Markdown code blocks do not use a plain browser `<pre>` as the primary renderer. They use a read-only CodeMirror viewer with lazy language loading.

### Language handling

The renderer reads `language-*` classes produced by Markdown fences, normalizes familiar aliases (`ts`, `js`, `py`, `cs`, `yml`, etc.), and lazy-loads matching CodeMirror language support from `@codemirror/language-data`.

Unknown/unlabeled languages remain readable as plain text instead of failing the block.

### Streaming updates

CodeMirror is not recreated for every streamed delta. ReactMarkdown's custom `pre` / `table` component map is module-stable so a Markdown rerender does not remount fenced-code viewers. The viewer then computes the smallest practical document edit:

- append-only streaming becomes an append edit;
- truncation becomes a suffix deletion;
- middle changes preserve common prefix/suffix and replace only the changed region.

This is important for long blocks and streaming stability.

### Syntax and semantic colors

Chat content follows Pi's built-in semantic theme language while keeping Molten Forge's code-block chrome. CSS exposes `--pi-*` semantic tokens for both dark and light themes. The existing CodeMirror variables are aliases onto those Pi tokens:

- comments → Pi `syntaxComment`;
- keywords/control/modifiers → Pi `syntaxKeyword`;
- strings/regex/escapes → Pi `syntaxString`;
- numbers/bools/null → Pi `syntaxNumber`;
- headings/classes/types/namespaces → Pi `syntaxType`;
- properties/attributes/variables → Pi `syntaxVariable`;
- functions/built-ins/atoms → Pi `syntaxFunction`;
- unlabeled/base fenced-code text → Pi `mdCodeBlock`.

Markdown headings use Pi `mdHeading`, inline code uses `mdCode`, links use `mdLink`, and thinking prose uses `thinkingText`. All heading levels intentionally share the same semantic heading color; hierarchy comes from size/weight.

Pi defines different values for its dark and light built-in themes, so these semantic colors must not be hard-coded to one palette across both themes.

### Block chrome

Each block has the old Molten Forge frame:

- square bordered/glass surface;
- sticky header;
- normalized language label;
- wrap toggle (wrapped by default, matching the reference implementation; the toggle is highlighted only when wrapping is disabled);
- copy action;
- download action with language-aware filename;
- fullscreen action.

Fullscreen is rendered through a React portal so transcript virtualization/transforms do not turn `position: fixed` into a row-local overlay. `Escape` and backdrop click close it.

The normal in-chat code block remains the lightweight reference view and keeps its existing chrome/rendering unchanged. Only the expanded/fullscreen view enables the enhanced CodeMirror presentation with a line-number gutter, while retaining syntax highlighting, wrapping control, selection, copy, download, and the full-height internal scroll surface.

Code blocks retain an internal max height in normal chat and scroll internally when needed. Fullscreen removes that normal max height. The fullscreen surface is vertically centered with a 16 px viewport inset above and below, and its CodeMirror line-number gutter is opaque so horizontally scrolled code cannot show through underneath it.

### Sticky header and transcript virtualization

The sticky toolbar depends on the **entire ancestor chain between the code block and the transcript scrollport remaining transform-free**. This is not an incidental implementation detail. It is the behavior used by the final Electron Molten Forge after repeated sticky-header regressions.

The transcript virtualizer must therefore use TanStack Virtual direct DOM positioning with:

- `directDomUpdates: true`;
- `directDomUpdatesMode: "position"`;
- `virtualizer.containerRef(...)` on the inner virtual size container;
- absolutely positioned rows whose main-axis `top` is owned by TanStack Virtual;
- **no `transform: translateY(...)` / `translate3d(...)` on virtual transcript rows**;
- no hard-coded `top: 0` on those rows in position mode.

The normal code-frame DOM order is also contractual: `.chat-code-header` is the first child of `.chat-code-block`, followed by `.chat-code-scroll`. The header uses `position: sticky` and a sticky offset owned by the actual transcript scroll container. Fullscreen is the intentional exception: its header is static because the fullscreen code viewer owns its own internal scroll boundary.

Do not switch transcript virtualization back to transform positioning for compositor performance without first replacing the sticky/fixed descendant strategy. In this UI, correct sticky code chrome takes priority over that optimization.

## Inline code

Inline Markdown code stays inline and does not receive the framed CodeMirror UI.

## External links

Markdown HTTP/HTTPS links must never navigate the embedded Tauri webview away from Molten Forge. The renderer prevents default webview navigation and delegates the URL to the native bridge, which opens it with the operating system's default browser. Relative/non-HTTP links stay inert unless a dedicated in-app behavior is implemented later.

## Tables

GFM tables are wrapped in a dedicated `.markdown-table-scroll` container.

The wrapper:

- is constrained to the message width;
- scrolls horizontally when the table is wider than the message;
- hides vertical overflow;
- keeps a stable scrollbar gutter;
- contains horizontal overscroll.

The table itself uses `width: max-content` plus `min-width: 100%`. This means narrow tables fill the message width while wide tables preserve their natural width and become horizontally scrollable instead of crushing columns or expanding the whole chat layout.

Cells retain a bounded maximum width and wrap long prose/links/code within each cell.

## Large Markdown

The Pi wrapper's existing large-Markdown virtualization remains in place. Only visible Markdown blocks mount, and visible fenced-code blocks then mount their CodeMirror viewer. Do not replace this with mounting every code editor in a very large answer.

## Streaming geometry stability

Normal fenced code still uses CodeMirror during streaming, but CodeMirror must not create a second asynchronous layout pipeline that fights transcript auto-follow.

- Editor creation, wrapping reconfiguration, and incremental document edits run in React layout effects so the DOM geometry is committed before paint.
- Syntax highlighting is deliberately metric-neutral (color only). Lazy language loading must not introduce bold/italic font-metric changes that can rewrap code after the block is already measured.
- The CodeMirror scroller reserves a stable scrollbar gutter and disables browser scroll anchoring inside the editor.
- Large-Markdown virtualization remeasures each visible block through `ResizeObserver`; callback-ref-only measurement is insufficient because CodeMirror can finish measuring after refs are attached.
- Any resulting transcript geometry change re-arms the one old-Molten-Forge bottom lerp when live follow is active. It must not introduce a separate scroll correction algorithm.

## Testing contract

Tests must cover:

- language aliases and unknown-language fallback;
- download filename mapping;
- extraction of `language-*` classes;
- streaming append/truncate/middle document changes;
- CodeMirror pre-paint mount/update geometry and metric-neutral lazy syntax loading;
- stable internal scrollbar gutter/browser-anchor suppression;
- ResizeObserver-backed remeasurement for virtualized Markdown blocks containing CodeMirror;
- table wrapper presence;
- framed fenced-code rendering;
- language label rendering;
- code toolbar actions;
- sticky header DOM order and transform-free transcript virtualization (`directDomUpdatesMode: "position"`, containerRef-owned size, no row transform/top);
- unlabeled fences;
- inline code remaining inline.
