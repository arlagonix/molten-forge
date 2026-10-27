# ub-mode action log — v0.36.88

## First make it work

1. Read `AGENTS.md`, `ub-mode`, `react-performance`, `tauri-react-integration`, the Pi lifecycle and queue/composer contracts, and the appearance contract. Compare the v0.36.87 source archive against the working tree before changing files.
2. Place Pi text/thinking delta accumulation in one small coalescer with a 50 ms boundary. Any other Pi RPC record synchronously drains the accumulated text first; process teardown discards remaining deltas. Keep the lifetime Pi listener and existing scroll/virtualization mechanism.
3. Change the old transparent/backdrop-blurred panel rules to opaque dark/light semantic tokens, preserving deliberate transparency for hover states, modal dimmers, and the startup image treatment. Retain no separate fill on nested thinking/tools already within an opaque runtime group.
4. Reproduce the Steer display omission at the RPC wiring level: the existing `message_start` switch only handled assistants. Queued user messages are emitted as user `message_start` once Pi dequeues them. Append these event-delivered user turns and consume the initial prompt's already-rendered echo to prevent duplicates. Queue snapshots and retrieval remain Pi-owned.

## Then make it right

5. Add pure tracker and delta-coalescer unit tests: repeated queued texts, initial-echo deduplication, teardown, timer flushes, immediate queue/status barriers, message/index/kind separation, and event order. Add wiring tests against real `App.tsx` paths.
6. Update obsolete tests that required the removed blur, preserving opaque context portal and sticky code toolbar contracts. Add theme-token and actual Chromium computed-style opacity tests for major dark/light panels.
7. Preserve Steer → Model → Tokens controls and leave the original virtualization, DOM scroll owner and 80ms scroll-follow sampler unchanged.

## Verification and limits

- PASS: Global TypeScript transpiler parse for all changed TS/TSX files.
- PASS: PostCSS parses production CSS; no active `backdrop-filter` declarations.
- PASS: Chromium computed-style surface regression in both themes (`tests/opaque-surfaces.browser.py`). Its first run exposed a remaining alpha runtime group and light Settings main tint; fixed both and reran green.
- PASS: Existing Chromium generation animation and composer geometry regressions; Node-native scripts (7 tests).
- BLOCKED: `npm run test` cannot start Vitest because the environment has no `node_modules`; `npm install` stalls with no result. Full TypeScript typecheck/Vitest, Rust/Tauri build, and live Pi/WebView2 integration must be run in the development environment.
- No new dependencies; no Git metadata, so no commit/push. Only the application version field in Cargo.lock was changed.
