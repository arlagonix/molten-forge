# Molten Forge — Tech Stack

## Language & Runtime

- **TypeScript 5.7.3** with strict mode enabled
- **ES2020** target, **ESNext** module system, **bundler** module resolution
- Path alias `@/*` → `src/*`

## Renderer (React)

- **React 19.2.4** (with `react-jsx` transform, `use` hook available)
- **ReactDOM 19.2.4**
- React StrictMode enabled in dev
- Hooks-only codebase (no class components)

## UI Framework

- **Tailwind CSS v4.2.0** via PostCSS (`@tailwindcss/postcss`)
- **tw-animate-css** — Tailwind v4 animation utilities
- **@radix-ui/themes v3.3.0** (Radix Themes: `<RadixTheme accentColor="gray" …>`, `isolation: isolate` on `.radix-themes`)
- **Radix UI primitives** — selected set of @radix-ui/react-\* packages
- **class-variance-authority (cva)** — component variant definitions
- **clsx + tailwind-merge** — `cn()` utility in `src/lib/utils.ts`
- **lucide-react** — icon set
- **sonner** — toast notifications, mounted outside Radix stacking context

## AI / Chat

- **ai SDK v6.0.193** (Vercel AI SDK)
- **@ai-sdk/openai-compatible v2** — OpenAI-compatible provider adapter
- **@modelcontextprotocol/sdk v1.23.0** — MCP server lifecycle

## Markdown / Content

- **react-markdown v10** — Markdown rendering
- **rehype-\* plugins** (highlight, katex, raw, sanitize)
- **remark-\* plugins** (gfm, math)
- **mermaid v11** — Mermaid diagram rendering
- **katex v0.16** — LaTeX math rendering
- **dompurify v3** — HTML sanitization

## Rich Text / Virtualization

- **cmdk** — Command menu (used in combobox pickers)
- **@tanstack/react-virtual v3** — Virtualized message list

## Build Tools

- **Vite v7.3.2** with:
  - `@vitejs/plugin-react` — React Fast Refresh
  - `vite-plugin-electron` — Electron main + preload bundling
  - Custom `transformIndexHtml` plugin for dynamic `<title>`
- **PostCSS v8.5** — Tailwind processing
- **TypeScript compiler (tsc)** — type checking before builds
- **ESLint v8.57** with `@typescript-eslint/* v7`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`
- **electron-builder v26.8.1** — packaging/distribution

## Desktop

- **Electron v41.3.0** (ships Node 24)
- **IPC bridge** via `contextBridge.exposeInMainWorld` with 6 namespaces:
  - `moltenForgeAI` — AI chat streaming, attachments
  - `moltenForgeStorage` — KV store + chat CRUD
  - `moltenForgeWorkspace` — folder picker
  - `moltenForgeTools` — tool execution (file edit, bash, etc.)
  - `moltenForgeFind` — find-in-page
  - `moltenForgeMcp` — MCP tool refresh/execute
- **System CA trust**: `electron/main.ts` loads system TLS certificates via `tls.getCACertificates`/`tls.setDefaultCACertificates` (Node 24 API)

## Dependencies of note

- **undici v6** — HTTP client (replaces Node built-in fetch in Electron main)
- **node-7z + 7zip-bin** — 7z extraction (attachments)
- **pdf-parse** — PDF text extraction
- **officeparser** — Office document text extraction
- **@fontsource/ibm-plex-sans, @fontsource/ibm-plex-mono, @fontsource/jetbrains-mono**

## Build Targets

- **Windows**: NSIS installer + portable, x64
- **macOS**: DMG
- **Linux**: AppImage
- Build output goes to `release/`
