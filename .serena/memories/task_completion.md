# Chat Forge — Task Completion

When a coding task is considered done, run the following checks:

## TypeScript type check
```bash
npx tsc --noEmit
```
This checks all files included in `tsconfig.json` (`src/` + `electron/`). The build command (`npm run build:renderer`) also runs `tsc` first.

## Lint
```bash
npm run lint
```
Uses ESLint with @typescript-eslint and react-hooks plugins. `--max-warnings 0` means zero warnings allowed.

## Verification
- Run `npm run dev` (or a targeted Vite build) to verify the app starts without runtime errors
- If making UI changes, visually check both light and dark themes
- If changing IPC or Electron code, verify the app launches and the feature works end-to-end

## Memory checklist
After completing work, optionally run from project root:
```bash
serena memories check
```
This verifies all `mem:` references in memories are valid and there are no stale references.
