---
name: frontend-testing
description: Use when implementing or reviewing React/TypeScript behavior in Molten Forge. Guides broad Vitest regression coverage, typechecking, render contracts, and avoiding tests that merely duplicate production code.
---

# Frontend testing

Read the testing policy in `AGENTS.md` first.

## Test strategy

- Put deterministic logic in `src/core/` and test production exports directly.
- Every bugfix should get a regression test when it can be represented deterministically.
- Cover state-machine branches and transitions generously, not only one happy path.
- For important rendering structure, add a lightweight renderer/SSR contract in addition to helper tests.
- Use source/CSS text assertions only for contracts that cannot reasonably be exercised in the current lightweight harness; prefer behavioral tests when practical.
- When source-text assertions are unavoidable, match semantic structure rather than exact whitespace or one-line formatting so harmless refactors do not create false failures.
- Do not copy the production algorithm into the test.
- Include edge cases: empty input, invalid records, wraparound, cancellation, unavailable storage, errors, and stale/filtered selection.
- TypeScript compilation is part of correctness. A green Vitest run with `tsc --noEmit` failing is not a passing change.

## Required finish line

Run:

```bash
npm run test
npm run build
npm run test:rust
```

Or `npm run check`. If the environment cannot run one of them, state exactly which command could not run and why.
