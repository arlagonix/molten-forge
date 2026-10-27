# Runtime grouping rules

This document is the source of truth for how Molten Forge Pi groups Thinking, tool, retry, and assistant blocks in the transcript.

The UI has two independent grouping layers:

1. **Runtime groups** answer: “Does this belong to the same continuous reason → act phase?”
2. **Parallel tool subgroups** answer: “Were these tools emitted in the same explicit Pi tool batch?”

Do not collapse those two concepts into one adjacency rule.

## Outer runtime-group rules

- A tool starts or continues the current runtime group.
- Consecutive tools remain in one runtime group even if there is no Thinking block before them.
- Thinking before the first tool belongs to that same runtime group.
- Multiple Thinking blocks before the first tool may remain in the same runtime group.
- **Thinking after at least one tool has already appeared closes the current runtime group and starts a new reasoning phase.**
- Normal assistant prose is a hard boundary. Runtime grouping never crosses assistant prose.
- User, system, error, or other non-runtime transcript content is also a hard boundary.
- **Session-maintenance activity such as context compaction is a hard boundary even though it uses the shared tool-style renderer.** Compaction is Pi runtime/session maintenance, not an assistant-issued tool call, so it must never be absorbed into a reason → act runtime group.
- **Retry notices are transient, standalone status rows.** They always split runtime groups and must never share a dashed Thinking/tool container. On successful recovery, remove them entirely. An exhausted retry remains visible as a terminal error.
- Tool success/failure/result state does not create a boundary by itself.
- A trailing Thinking block after tools belongs to the next phase even if no later tool arrives; it must never be absorbed backwards into the preceding tool group.
- A Thinking-only sequence must not create a fake tool group.

A one-item Thinking/tool/retry block may render as a standalone runtime block rather than an outer multi-item container. The visual boundary is equivalent; the important rule is that it must not be merged across a semantic boundary.

## Parallel tool subgroup rules

- Parallelism comes only from explicit `toolBatchId` metadata supplied from Pi/message parsing.
- Only assistant/model tool activity is eligible for a parallel subgroup. Session-maintenance blocks such as `Compact` are never parallel-tool candidates, even if malformed/stale metadata happens to contain a batch id.
- Never infer parallel execution merely because tool blocks are adjacent.
- Adjacent tools with the same non-empty batch id form one `Parallel tool calls` subgroup when the batch contains at least two tools.
- A one-tool batch renders as an ordinary tool row, not as a fake parallel subgroup.
- Two adjacent explicit parallel batches remain two separate parallel subgroups.
- Parallel subgroup boundaries do **not** split the outer runtime group by themselves.
- A new Thinking block after tools splits the outer runtime group even when the preceding or following tools are parallel batches.

## Canonical edge cases

Notation: `T` = Thinking, `A/B/C` = sequential tool calls, `[A B]p1` = one explicit parallel batch, `Text` = normal assistant prose, `R` = retry activity.

| Input | Expected result |
| --- | --- |
| `A` | One standalone tool/runtime block. |
| `A B C` | One runtime group containing A, B, C. |
| `[A B]p1` | One runtime group with one parallel subgroup A+B. |
| `[A B]p1 C` | One runtime group: parallel A+B, then C. |
| `A [B C]p1 D` | One runtime group: A, parallel B+C, D. |
| `[A B]p1 [C D]p2` | One outer runtime group containing **two** parallel subgroups. Never merge p1+p2. |
| `T A` | One runtime group: T + A. |
| `T A B` | One runtime group: T + A + B. |
| `T [A B]p1` | One runtime group: T + parallel A+B. |
| `T [A B]p1 [C D]p2` | One outer runtime group: T + parallel p1 + parallel p2. |
| `T A T B` | **Two** runtime groups: `T A` / `T B`. |
| `A T B` | **Two** runtime groups: `A` / `T B`. |
| `T A B T C D` | **Two** runtime groups: `T A B` / `T C D`. |
| `T [A B]p1 T [C D]p2` | **Two** runtime groups, each preserving its own parallel subgroup. |
| `T T A` | One runtime group: both pre-tool Thinking blocks + A. |
| `T A T T B` | Two runtime groups: `T A` / `T T B`. |
| `A B T` | A+B group, then standalone trailing T. T must not join backwards. |
| `T A Text B` | `T A` group, Text, then B as a new block/group. |
| `T Text A` | Standalone T, Text, then A. Text breaks the association. |
| `A Text T B` | A, Text, then `T B`. |
| `T A(error) B` | One runtime group. Tool error alone does not split it. |
| `T A(error) T B` | Two runtime groups because the later Thinking starts a new phase. |
| `T A R B` | Three groups: T+A, standalone Retry, standalone B. |
| `T A R T B` | Three groups: T+A, standalone Retry, T+B. |
| `[A B]p1 Compact T` | Parallel A+B runtime group, standalone Compact maintenance block, then standalone T/new phase. Compact is a hard boundary. |
| Adjacent A/B with no shared batch id | Sequential tools, not a parallel subgroup. |
| Same batch id separated by another block | Do not reconnect them into one parallel subgroup; parallel grouping is contiguous. |

## Implementation contract

- `groupTranscriptItems()` owns **outer runtime grouping** only.
- Tool-styled session maintenance must carry `runtimeRole: "session-maintenance"`; visual use of the Tool component must never imply assistant-tool grouping semantics.
- `segmentRuntimeGroupItems()` owns **parallel subgroup segmentation** only.
- Rendering code must consume these helpers rather than reimplementing the rules.
- Any change to these rules must update this document and `src/core/chat-logic.test.ts` in the same change.
