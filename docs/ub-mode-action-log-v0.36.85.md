# ub-mode action log — v0.36.85

1. Read project contracts and relevant installed skills before edits. Reason: preserve RPC authority, scroll ownership, and composer render isolation.
2. Verified Pi RPC `streamingBehavior`, `queue_update`, and `clear_queue` from upstream documentation; looked at pi-gui's publicly documented steer/queue feature. Reason: avoid inventing local queue semantics.
3. Added pure queue/geometry tests before production implementation. The red phase could not execute without installed Vitest. Reason: test intended behavior without depending on source strings.
4. Implemented queue model normalization and geometry helpers in `src/core/message-queue.ts`, with distinct lightweight UI components. Reason: isolate domain policy and keep composer interaction state local.
5. Centralized image/attachment prompt preparation in one helper shared by idle and queued prompts. Reason: avoid duplicated payload decisions.
6. Kept Pi authoritative for queue state and correlated prompt/clear responses. Never appended queued text to the transcript before Pi delivers it. Reason: correct lifecycle and extension handling.
7. Capped tall composer textarea based on chat pane height, made queue/attachment strips independently scrollable, and measured actual overlay intersection after resize/focus. Reason: transcript text must remain reachable above composer.
8. Updated old geometry assertion and docs; tested pure compiled helper scenarios and 7 Node-native tests; checked syntax/transpilation. Full Vitest, tsc whole project, Cargo, and GUI runtime tests unavailable in this environment. No Crapper/Dryer/Mutator binaries available.
