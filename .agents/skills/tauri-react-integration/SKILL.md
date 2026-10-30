---
name: tauri-react-integration
description: Use when changing Pi RPC wiring, Tauri invoke commands, native filesystem/process behavior, or React-to-Rust boundaries in Molten Forge. Keeps Pi authoritative and the desktop bridge thin and testable.
---

# Tauri + React integration

Molten Forge is a thin desktop wrapper around Pi. Do not reimplement Pi runtime behavior in React or Rust when Pi already exposes it.

## Rules

- Pi RPC/session data is the runtime source of truth.
- Keep request/response shapes explicit. Silent application-chrome RPCs must not create transcript content.
- Keep native process/filesystem responsibilities in the Tauri layer; keep presentation/interaction state in React.
- Avoid blocking Rust commands on the UI thread; use async/process handling appropriate to Tauri.
- Preserve unknown/new Pi output where practical rather than destructively narrowing it.
- Persist defaults by modifying only the intended Pi settings fields; preserve unrelated settings.
- Treat cancellation, process exit, malformed JSONL, missing paths, and Windows path casing as real edge cases.
- Keep Tauri capabilities minimal; do not broaden permissions without a concrete need.

## Verification

For bridge changes, add Rust tests for deterministic parsing/path/settings behavior and frontend tests for request shape/wiring. Run `npm run check` when the environment supports both Node and Rust toolchains.
