# Chat Forge — Coding Conventions

## Import style
- Always use the `@/` path alias for `src/` imports (e.g. `import { cn } from "@/lib/utils"`)
- Use relative imports only *within* `src/lib/ai-chat/` (e.g. `import { createId } from "./chat-utils"`)
- Group imports: React → external libs → `@/` aliases → sonner → types
- Always use the `import type` syntax for type-only imports

## React patterns
- **Function components only** (no class components)
- **Hooks naming**: `use<Verb>`, e.g. `useChatActions`, `useChatGeneration`
- **State pattern**: `const [state, setState] = useState<T>(initial)`
- **Boolean naming**: prefix with `is-` or `has-`:
  - `isNewChatDraft`, `hasMessages`, `isSending`, `isChatGenerating`
  - `settingsOpen`, `providerSettingsOpen` → these are boolean state variables for dialog visibility
- **Update pattern**: `updateChat(id, updater)` / `updateChatMessages(id, updater)` / `updateActiveChatMessages(updater)` where updater is `(prev: T) => T`
- **Ref naming**: always `.current` with meaningful suffix, e.g. `didHydrateRef`, `chatSaveTimeoutRef`, `pendingChatSwitchTargetRef`
- **Hydration guard**: effects that persist state must check `didHydrateRef.current` first to prevent overwriting stored data before initial load completes
- **Callback stability**: use `useStableCallback` (a ref-based wrapper) instead of `useCallback` for callbacks passed to async/event-heavy APIs

## TypeScript conventions
- **Type exports**: types are defined in `src/lib/ai-chat/types.ts` (the canonical version). The older `src/lib/types.ts` is deprecated and should not be extended.
- **Discriminated unions** for message variants, tool call status, etc.
- **Readonly arrays**: prefer `T[]` (mutable) for state, but use `readonly T[]` in pure utility signatures where appropriate.
- **Memoization**: heavy computed values (available tools, permissions, filtered lists) use `useMemo` with explicit deps. See `src/App.tsx` for patterns.

## CSS / Tailwind
- **Tailwind v4 syntax**: `@import "tailwindcss"` (no `@tailwind` directives)
- **Custom variant**: `@custom-variant dark (&:is(.dark *));`
- **CSS variables** for custom properties (fonts, Radix theme overrides)
- **Dark mode**: `.dark` class toggled on `<html>` by `ThemeProvider`
- **`cn()` utility** used everywhere for className composition (merges Tailwind classes via tailwind-merge)
- **Component-level styles**: all styling via Tailwind utility classes (no CSS modules or styled-components)
- **Radix Themes** provides base component styling; custom components extend with Tailwind

## File organization
- **One component per file** (except small tightly-coupled helpers)
- **UI primitives** go in `src/components/ui/` (shadcn-style, each wraps a Radix primitive)
- **Chat-specific components** in `src/components/ai-chat/`
- **Dialog components** are top-level in `src/components/` (settings, mcp, modes, etc.)
- **Hooks** in `src/hooks/`
- **Core chat modules** (types, storage, utils, modes, mcp, etc.) in `src/lib/ai-chat/`
- **Electron main process** code in `electron/`

## Key abstractions & patterns
- **createId()**: `${Date.now()}-${Math.random().toString(16).slice(2)}` — used everywhere for entity IDs
- **labelForError(error)**: extracts `error.message` or returns `"Unknown error."`
- **Provider model**: `ProviderConfig` object with `baseUrl`, `model`, `apiKey`, model lists. Default is `LM Studio` at `http://localhost:1234/v1`
- **Chat lifecycle**: unsaved draft → create + persist on first send → all subsequent saves debounced via `chatSaveTimeoutRef`
- **Settings persistence pattern**: state + `useEffect` guarded by `didHydrateRef` → auto-saves on every change (debounced for chats)
- **Tool permissions**: three-tier (global → mode → chat-level). Each level can be `allow`, `ask`, or `deny`. Mode-level uses `"global"` to fall through.
- **Modes**: `normalizeModesState()` creates a normalized state from raw input. `resolveModeForChat(chatModeId, modesState)` picks the effective mode.
- **Permission resolution**: cascade from most specific (chat) → mode → global. Helper functions in `request-builder.ts`: `getEffectiveToolPermission`, `getEffectiveSkillPermission`, `getEffectiveAgentPermission`.
- **Electron IPC bridge namespaces** on `window`:
  - `window.codeForgeAI` — streaming chat, attachment processing
  - `window.chatForgeStorage` — indexeddb-like KV operations
  - `window.chatForgeWorkspace` — folder selection
  - `window.chatForgeTools` — file/bash tool execution
  - `window.chatForgeFind` — find-in-page
  - `window.chatForgeMcp` — MCP server tool calls
- **Streaming pattern**: `window.codeForgeAI.streamChat()` returns `{ id, cancel(), result(onDelta) }`. The main process emits deltas on IPC channel `ai:stream-delta:{streamId}`.
- **Tool execution**: the renderer sends a request to the main process via IPC, main executes (bash/file/MCP), returns `ToolCommandResult`. Bash tools also stream terminal events.
- **MCP tool naming**: tools exposed as `mcp_{serverName}_{toolName}`, sanitized to `[a-zA-Z0-9_-]{1,64}`.
- **Error display**: `toast()` from sonner for success/error/info messages.

## Dialog patterns
- Each dialog has `<Name>Open` boolean state + `<name>Open` setter in App.tsx
- Dialogs are rendered inside the main `Home()` component's return, gated by the open state
- Pattern: `<Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>`

## Storage (IndexedDB via Electron IPC)
- **KV store** named `settings` in IndexedDB database `chat-forge`
- **Chats store** named `chats` in same database
- Migration from older IndexedDB schema via `migrateFromIndexedDb(snapshot)` IPC call
- Key prefixes: `provider`, `providers-state`, `system-prompt`, `active-chat-id`, `tools-settings`, `skills-settings`, `agents-settings`, `app-settings`, `mcp-settings`, `modes-state`, `provider-models:${cacheKey}`
