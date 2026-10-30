# Documentation

Molten Forge is a Tauri desktop interface for the separately installed Pi coding agent. [`AGENTS.md`](../AGENTS.md) establishes project contracts and points to the relevant implementation documents.

## Getting started and releases

- [Project overview and build instructions](../README.md)
- [Version 2.0.0 release notes](releases/v2.0.0.md)
- [Release procedure and notes style](releasing.md)
- [Historical changelog](../CHANGELOG.md)

## Pi integration

- [RPC lifecycle and interruption safety](pi-rpc-lifecycle.md)
- [Pi integration audit](pi-integration-audit.md)
- [Message queue and composer](pi-queue-and-composer.md)
- [Model switcher](model-switcher.md)
- [Attachments](attachments.md)
- [Context usage](context-usage.md)

## Interface and rendering

- [Appearance and backgrounds](appearance.md)
- [Window chrome and loading](window-chrome.md)
- [Chat scrolling](chat-scroll.md)
- [Markdown and code rendering](markdown-rendering.md)
- [Tool text output](tool-text-output.md)
- [Thinking preview](thinking-preview.md)
- [Runtime grouping](runtime-grouping.md)
- [Tool diffs](tool-diffs.md)
- [Composer performance](composer-performance.md)

## Testing and maintenance

- [Behavioral lifecycle tests](behavioral-lifecycle-tests.md)
- [Frontend skills audit](frontend-skill-audit.md)
- [Engineering skills](../.agents/skills/)

Older `ub-mode-action-log-*.md` documents are preserved as implementation history, not as instructions to revert later UI decisions.
