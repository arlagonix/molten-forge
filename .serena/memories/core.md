# Chat Forge — Core

Project root: `C:\Prime\GitHub\chat-forge`  
App name: **Chat Forge** (package name: `code-forge-electron`)  
Executable entry: `dist-electron/main.js` (Electron main process)

## Source map

```
electron/
  main.ts              Electron main process (~5050 lines) — IPC handlers,
                       storage, provider proxy/streaming, file tools, MCP client
  preload.ts           contextBridge API surface for the renderer
  ai-sdk-client.ts     AI SDK chat completion (streaming + non-streaming)
  file-tools.ts        File-system tools (read, write, edit, bash)
  mcp-client.ts        MCP server lifecycle + tool execution
  pi-tools.ts          Pi tool integration
  terminal-tool.ts     Terminal execution tool
  tool-utils.ts        Shared helpers (error formatting, JSON, workspace)

src/
  App.tsx              Main app UI + state orchestration, ~2881 lines
  main.tsx             React entry (mounts App with ThemeProvider, RadixThemeBridge, Toaster)
  index.css            Tailwind v4 imports, font imports, CSS variables, Radix theme overrides
  lib/
    utils.ts           cn() helper (clsx + tailwind-merge)
    theme.tsx          Light/dark/system theme context + provider
    types.ts           Legacy (deprecated) types; use lib/ai-chat/types.ts instead
    ai-chat/
      types.ts         Core type definitions (ProviderConfig, ChatSession, ChatMessage,
                       ModesState, ToolsSettings, etc.)
      storage.ts       IndexedDB storage facade (kv-store + chats-store)
      chat-utils.ts    Pure helpers (createId, providerDisplayName, sortChatsByUpdatedAt, etc.)
      builtin-tools.ts Built-in tool definitions + default settings
      builtin-agents.ts Built-in agent definitions
      modes.ts         Mode normalization, permission resolution
      mcp.ts           MCP tool name building, schema helpers
      provider-presets.ts Default provider (LM Studio) + generation settings
      request-builder.ts Request construction, permission lookup, workspace root resolution
      title-generation.ts Chat title generation logic
      stream-buffer.ts  Stream buffer for incremental rendering
      task-state.ts     Task state management
      tool-execution-queue.ts Tool execution queuing
      terminal-tool.ts  Terminal tool name constant
      file-tool-names.ts File tool name constants + helpers
      attachment-*.ts   Attachment handling (limits, format, cleanup)
      process-step-groups.ts Step group processing for tool calls
      renderable-code-blocks.ts Code block rendering
      html-sanitize.ts  DOMPurify-based HTML sanitization
      markdown-selection.ts Markdown selection utilities
      generation-metadata.ts Generation metadata tracking
      direct-provider-client.ts Direct provider API client
  components/
    ai-chat/           Chat-specific components (composer, message list, markdown, etc.)
    ui/                shadcn-ui / Radix primitives (only those currently imported)
    dialogs/
      system-prompt-dialog.tsx
    *.tsx              Top-level dialogs (settings, provider-settings, mcp, modes, skills, agents, tools)
  hooks/
    use-chat-actions.ts       Chat CRUD + side effects
    use-chat-generation.ts    AI generation orchestration
    use-chat-autoscroll.ts    Scroll management during streaming
    use-tool-execution.ts     Tool execution UI state
    use-message-context-menu.ts Context menu state
    use-stable-callback.ts    Stable callback wrapper (ref-based)
```

## Project-wide invariants

- **Local-first:** All data (providers, chats, settings) lives in the user's local IndexedDB (migrated from older versions). No cloud sync.
- **OpenAI-compatible only:** The app works with any provider that exposes an OpenAI-compatible `/v1/chat/completions` or `/v1/models` endpoint.
- **Electron IPC bridge:** Renderer never accesses Node APIs directly; everything goes through `contextBridge`-exposed objects (`codeForgeAI`, `chatForgeStorage`, `chatForgeWorkspace`, `chatForgeTools`, `chatForgeFind`, `chatForgeMcp`).
- **Path alias:** `@/` maps to `src/` (configured in both tsconfig.json and vite.config.ts). All imports from `src/` use this alias.
- **Font stack:** IBM Plex Sans (UI), IBM Plex Mono / JetBrains Mono (code), loaded via @fontsource packages.
- **Stacking context:** Radix Themes renders `.radix-themes` with `isolation: isolate`. Toasts (sonner) must be mounted *outside* `<RadixThemeBridge>` to escape the stacking context (see `src/main.tsx` comment).
- **Mode system:** Two built-in modes (`default`, `minimal`). Custom modes can be defined. Each mode can override tool/skill/agent permissions with its own allow/ask/deny rules.
- **Tool permissions:** Three-tier permission model — global (settings-level), mode-level, and chat-level. Permissions cascade: chat-level overrides mode-level overrides global. Values: `allow`, `ask`, `deny`.
- **Draft-first chat:** Creating a new chat starts as an unsaved draft (no persistent chat session). The real chat is created + persisted only when the first message is sent.
- **System CA trust:** `electron/main.ts` loads system CA certificates (Windows/macOS/Linux) using `tls.getCACertificates`/`tls.setDefaultCACertificates` so corporate TLS-inspection proxies work without disabling cert verification.

## Top-level entry points

- `mem:tech_stack` — language/framework/build details
- `mem:conventions` — code style, naming, patterns
- `mem:suggested_commands` — frequently used npm scripts and Windows shell commands
- `mem:task_completion` — linter/type-check/format commands for sign-off
