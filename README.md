# Molten Forge

Local-first Electron chat client for OpenAI-compatible providers.

## Project layout

```text
electron/
  main.ts      Electron main process, storage IPC, provider proxy/streaming IPC
  preload.ts   Safe renderer API exposed through contextBridge
src/
  App.tsx      Main chat UI and state orchestration
  main.tsx     React entry point
  components/
    ai-chat/   Markdown and streaming message rendering
    ui/        Only the shadcn/Radix primitives currently used by the app
  lib/
    ai-chat/   Provider, storage, chat type, and chat utility modules
    theme.tsx  Light/dark theme state
    utils.ts   Shared className helper
```

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build:renderer
npm run build:win
```

`npm run build` runs TypeScript, builds the renderer, then packages the Electron app using `electron-builder.json5`.

## Refactor notes

The project intentionally keeps only UI components and dependencies that are imported by the current app. Before adding a new shadcn component, add only that component and its direct dependencies instead of copying the whole generated component catalog.

## Documentation

- [Attachments and model context](docs/attachments.md)
- [Chat folders and default workspaces](docs/chat-folders.md)
- [MCP settings](docs/mcp-settings.md)
- [Project instructions (`AGENTS.md`)](docs/project-instructions.md)
