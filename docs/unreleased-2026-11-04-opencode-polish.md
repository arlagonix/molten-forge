# Unreleased UI polish — November 4, 2026

- Sidebar: render one hover highlight on the entire project row; the inner project button remains transparent.
- Composer: model and Steer selectors share 12px regular text styling.
- Model picker: centered dialog, scrollable provider groups, Recent without duplicates, local search, keyboard navigation, Escape / backdrop close, focus trap and focus restoration. Model changes still use Pi's silent `set_model` RPC.
- Message details: display available response model and timestamps, copy the exact visible message text. Historical user prompts have a Fork button backed by Pi's `fork` RPC, with confirmation. Fork actions are disabled during generation.
- Rewind is intentionally **not** present: Pi's documented RPC surface does not expose an equivalent operation. Do not substitute `fork` for rewind.
- Working shimmer: replaced the discontinuous moving gradient with a transparent-at-both-ends sweep; reduced-motion preferences still disable it.

No application version bump; preserve the Pi runtime, storage keys, and session behavior.
