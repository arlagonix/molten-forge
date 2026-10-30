# Tool text output rendering

Molten Forge uses one lightweight read-only CodeMirror surface for **verbatim textual tool output**. Structured tool UIs remain separate when their data can be presented more usefully than as a text editor.

## Rendering boundary

Use the shared text viewer for:

- `read` output;
- `bash` / shell / PowerShell output;
- generic multiline textual output;
- generic output confidently detected as JSON, diff, HTML, XML, or Markdown;
- historical `write` content when the pre-write baseline was not persisted.

Do not force every tool through CodeMirror. `grep`, `find`, and `ls` remain outside this generic path so they can use compact structured result rendering without first coupling their UX to an editor surface. Short plain status strings (for example `Written` or `Context compacted.`) also stay lightweight.

## Language detection

Language selection is conservative and deterministic. Prefer, in order:

1. explicit language / MIME metadata supplied in tool arguments;
2. the target file path / filename;
3. unambiguous content structure (JSON, unified diff, HTML, XML, Markdown);
4. plain text.

Do not guess JavaScript/TypeScript/Python/YAML from vague punctuation or a small source fragment. Incorrect highlighting is worse than plain text.

The viewer never reads a file from disk merely to detect a language. Paths are syntax hints only.

## Read output

`read` uses the target path for syntax highlighting and shows CodeMirror line numbers. If Pi was called with `offset`, the gutter begins at that real 1-indexed source line rather than restarting at 1. Read output is a file-reading surface rather than a compact log preview: short reads expand naturally, while long reads may use up to `70dvh` (capped at 900 px) before their own vertical scroll. Generic tool logs keep the smaller compact viewport. Pi may still truncate an individual `read` result according to its own tool limits; Molten Forge should display all text Pi actually returned within this larger surface.

## Terminal output

Terminal output wraps to the available tool width and does not show editor line numbers. If the complete output is an unambiguous structured format such as JSON, syntax highlighting may use that format; ordinary logs remain plain text.

## Performance

- The shared viewer reuses `ReadOnlyCodeViewer`, including incremental CodeMirror document changes during streaming.
- CodeMirror mounts only while the containing tool block is expanded.
- Language support continues to lazy-load through `@codemirror/language-data`.
- No linting, completion, history, folding, or editable extensions are enabled.
- Tool text wraps instead of forcing horizontal chat scrolling.
- Generic/read tool viewers own a bounded vertical scroll area. Wheel scrolling must chain back to the outer transcript when that area reaches an edge; do not trap vertical overscroll inside CodeMirror.

## Historical write

Historical `write` rendering follows `docs/tool-diffs.md`: if the old file state was never stored, show the exact written content neutrally through this shared viewer. Never fabricate an additions-only diff or compare against the current file on disk.

## Runtime output and collapsed summaries

- `{ content: [] }` is a Pi transport sentinel for “execution started, no text yet”; never stringify it into the transcript.
- Once terminal execution has actually started and no stdout/stderr text exists yet, the expanded Output section shows `Waiting for output…`. Tool-call construction alone must not show that placeholder.
- Streaming text updates preserve prior output. Empty final wrappers must not erase already-streamed stdout/stderr.
- Completed Bash/shell blocks use the normalized command input as the collapsed preview: multiline input is concatenated in order, whitespace is flattened, and the first 200 characters are shown with `…` only when longer. Expanded terminal output stays verbatim.
- Completed Read blocks summarize the target path. Partial reads append the actual returned source range on success; Pi's trailing `[...] more lines in file. Use offset=N to continue.` footer is transport metadata and must never be counted as file lines. The continuation offset is authoritative when present. Failures may show the requested range because no returned range is authoritative.
- File paths under the active cwd are displayed relative to that cwd; paths outside it remain absolute.
## Read range metadata

For compact Read summaries, prefer Pi's structured `toolResult.details.truncation.outputLines` when Pi itself truncated the output. User-specified `limit` reads may not populate that metadata, so the textual `Use offset=N to continue` footer remains a compatibility fallback. Only fall back to counting visible output lines when neither source is available. Structured tool-result details must survive both live events and restored session history.

