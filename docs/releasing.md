# Releasing Molten Forge

This repository distributes the **Molten Forge** desktop UI. Pi is a separately installed runtime.

## Version files

Keep these values identical for every release:

- `package.json` → `version`
- `package-lock.json` → root `version` and `packages[""].version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `[package].version`
- `src-tauri/Cargo.lock` → **only** the `[[package]]` entry for `molten-forge-pi`; never search-and-replace dependency versions or checksums

Do not change the Tauri identifier (`com.moltenforge.pi`) as part of a version or branding bump.

## Notes

Follow [`.agents/skills/release-notes/SKILL.md`](../.agents/skills/release-notes/SKILL.md) for the exact release-note style. The canonical notes for each release live in `docs/releases/vX.Y.Z.md`. Add a reference in `CHANGELOG.md`; don't duplicate the full notes in README.

## Verification

1. Confirm the working branch and inspect the diff. Do not change branches or reset anything implicitly.
2. Verify version fields and check that no secrets or build outputs are staged.
3. Run `npm run check` (including the Rust tests) and `npm run tauri:build` on a Windows build machine with Pi and Tauri prerequisites installed.
4. Test a fresh Windows install, project/session restore, model selection, Steer/Follow-up delivery, background images in both themes, and links/notifications.
5. Review the installer path and old “Molten Forge Pi” uninstall behavior before claiming an in-place upgrade.
6. Confirm a suitable project license and third-party asset notices before publishing the source.
7. Commit, push, tag `vX.Y.Z`, and create a GitHub Release using the canonical notes. Do not claim a release is live before it is published.

`legacy/electron` and the `electron-final` tag preserve the previous Electron application. For the 2.0.0 release, keep those references unchanged.
