---
name: react-component-architecture
description: Use when adding or refactoring React components, state, hooks, or frontend modules in Molten Forge. Keeps App thin, logic testable, and component responsibilities explicit.
---

# React component architecture

Read `AGENTS.md` and the feature-specific document under `docs/` before editing.

## Rules

- `App.tsx` is the shell/integration layer, not the default home for new UI logic.
- Put deterministic parsing, grouping, navigation, normalization, and state-transition logic in `src/core/` with unit tests.
- Put reusable or stateful UI in `src/components/` rather than growing `App.tsx`.
- Keep ephemeral interaction state local: open/closed, search text, keyboard highlight, copied state, textarea draft, hover state.
- Lift state only when multiple real owners need the same source of truth.
- Prefer explicit feature components over generic abstractions that hide Pi-specific behavior.
- Keep async side effects at clear boundaries and surface errors instead of swallowing them silently unless the project explicitly treats persistence as optional.
- Preserve Pi RPC/session state as the source of truth for runtime behavior.

## Review checklist

Before finishing, ask:

- Did this add avoidable lines/state/effects to `App.tsx`?
- Can any new algorithm move to `src/core/`?
- Can the component be memoized without stale behavior?
- Are callback and object props stable enough for the memo boundary they cross?
- Is the behavior documented beside the existing project contract?
