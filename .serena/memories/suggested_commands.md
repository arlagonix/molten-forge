# Molten Forge — Suggested Commands

## Development server

| Command       | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `npm run dev` | Start Vite dev server + Electron in dev mode (HMR for renderer) |

## Build

| Command                  | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `npm run build:renderer` | Type-check + build renderer only (tsc + vite build)          |
| `npm run build:win`      | Full build → Windows NSIS installer + portable in `release/` |
| `npm run build`          | Full cross-platform build (tsc + vite + electron-builder)    |

## Code quality

| Command        | Description                                                                          |
| -------------- | ------------------------------------------------------------------------------------ |
| `npm run lint` | ESLint (`eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0`) |

## Preview

| Command           | Description                             |
| ----------------- | --------------------------------------- |
| `npm run preview` | Vite preview (serve the built renderer) |

## Windows-specific shell notes

- File paths use backslashes (`\`), but Electron IPC and Vite resolve fine with forward slashes too.
- `grep` → use `findstr` or `Select-String` (PowerShell).
- `export` → use `$env:VAR="value"` in PowerShell or `set VAR=value` in cmd.
- Project root on dev machine: `C:\Prime\GitHub\molten-forge`
