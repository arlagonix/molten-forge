# Project instructions (`AGENTS.md`)

Molten Forge automatically loads workspace project instructions from `AGENTS.md` in the background.

## When instructions are loaded

- `AGENTS.md` loading is always enabled.
- Molten Forge only checks for instructions when a chat has a user-selected workspace.
- Only the workspace root file is loaded: `<workspace>/AGENTS.md`.
- Nested `AGENTS.md`, `CLAUDE.md`, Cursor rules, and custom instruction paths are not loaded in this version.
- If a chat has no workspace, no project instructions are loaded.

## How instructions affect the model

Loaded instructions are injected as hidden project context before chat messages are sent to the model. They are not added as chat messages, tool messages, visible assistant output, or chat timeline blocks.

The current user request still wins over `AGENTS.md` when there is a conflict. Higher-priority app/system instructions also take precedence.

A running generation keeps the instruction snapshot that existed when that generation started. Workspace changes or file changes affect future requests only.

## Workspace changes

When a workspace is added or changed in an existing chat, Molten Forge immediately checks the new workspace root for `AGENTS.md`.

If previous project instructions were loaded, they are discarded from future model context. If the new workspace has `AGENTS.md`, the new file is loaded silently. If the new workspace does not have `AGENTS.md`, no project instructions are loaded.

No project-instructions status is rendered in the chat timeline.

## Refresh behavior

Molten Forge refreshes project instructions automatically:

- when a workspace is set or changed,
- when a chat is opened or the app reloads,
- before sending a message if the file size or modification time changed.

There is no manual reload button in this version.

## Large files

Files over the recommended 32 KiB soft limit are still loaded in the background. Keep `AGENTS.md` short because large instruction files increase prompt size, cost, latency, and can push useful chat context out of the model window.

## Recommended content

Keep `AGENTS.md` short and operational:

```md
# AGENTS.md

## Project overview

Electron + React + TypeScript app.

## Commands

- Typecheck: `npm run build`
- Tests: `npm test`

## Coding rules

- Keep IPC contracts typed.
- Do not change persisted settings without migration.
- Avoid rendering collapsed hidden content.

## Verification

After UI changes, run relevant tests and the production build.
```
