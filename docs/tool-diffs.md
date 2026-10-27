# Structured file tool diffs

Molten Forge renders `edit` and `write` tool **Input** as a compact unified diff. Tool **Output** remains Pi's original result text.

## Display contract

- Use real old/new file line numbers when the completed tool result provides them.
- Keep three unchanged context lines before and after each changed region.
- Merge nearby changes into one hunk; separate distant hunks with `⋯ N unchanged lines`.
- Use a weak red/green background for removed/added rows and a stronger intra-line highlight for the changed word/value.
- Reuse CodeMirror syntax highlighting without the normal fenced-code toolbar/header.
- Wrap long diff/content lines to the available tool width; do not require horizontal scrolling for ordinary review.
- Show the file path in the tool preview and `+N −N` beside the Raw/Diff toggle in the Input heading.
- Keep Raw input available as a fallback.

## `edit`

Pi remains authoritative. Its native `result.details.patch` is parsed for the completed diff. The bundled Molten Forge Pi extension adds only file metadata (path, line counts, and text-format changes) needed for stable display and session restore.

## `write`

Pi's built-in `write` does not provide a before/after patch. The bundled extension listens to `tool_call` before execution, reads the current target into temporary in-memory state keyed by `toolCallId`, and on `tool_result` compares that baseline with the written content. Only the compact diff metadata is attached to `toolResult.details`; the full baseline is discarded.

A failed write is never presented as applied unless the post-write file actually matches the requested content. If another extension changes the target path after the baseline was captured, Molten Forge omits the structured diff rather than comparing the wrong files. Overlapping mutations of the same absolute path also prefer the Raw fallback for later in-flight calls instead of reusing a stale baseline.

## Bounds and format-only changes

The diff algorithm is bounded. Very large rewrites, generated/minified files, or excessive hunk counts fall back to a compact summary instead of persisting thousands of changed rows. Line-ending and final-newline-only changes are represented explicitly without inventing added/removed source lines.

## Legacy `write` results

Sessions created before Molten Forge began capturing `write` baselines do not contain the previous file state, so a historical red/green diff cannot be reconstructed reliably. For a successful legacy `write` with no persisted diff metadata, show the exact written `content` in a neutral read-only CodeMirror view with syntax highlighting, line numbers, and line wrapping. Keep Raw available. Never compare against the file currently on disk or present the whole payload as additions, because either would imply a before-state that is not known. Failed writes without an applied diff remain in Raw/error presentation.

## Active / terminal presentation

While `edit` or `write` arguments are still being generated or the tool is running, show the actual raw generated input. Do not replace it with a synthetic `Preparing file diff…` placeholder. On successful completion, switch to the structured diff when authoritative diff metadata is available. On failure or interruption, keep Raw as the fallback and never imply that a preview diff was applied. The collapsed terminal summary is the target file path (relative to cwd when the path is inside the project).
