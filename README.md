# Molten Forge

**A lightweight desktop interface for the [Pi coding agent](https://github.com/earendil-works/pi).**

Molten Forge 2.0.0 is a new Tauri-based implementation of the original Molten Forge desktop application. It launches the Pi CLI in RPC mode and provides a graphical workspace for agent conversations, projects, session history, tool output, and model selection. **Pi is installed separately**; Molten Forge does not fork or bundle the agent.

[2.0.0 release notes](docs/releases/v2.0.0.md) · [Changelog](CHANGELOG.md) · [Documentation](docs/README.md) · [GitHub releases](https://github.com/arlagonix/molten-forge/releases)

## Features

- **Pi-powered conversations:** live text, Thinking, tool calls, retries, and persistent Pi sessions.
- **Projects and history:** per-folder conversations, recent activity sorting, switching, and paginated lists.
- **Steer / Follow-up:** queue messages during generation, inspect the queue, or retrieve its contents into the composer.
- **Model controls:** searchable model picker, thinking controls, context and token usage telemetry.
- **Rich transcripts:** Markdown and math, syntax-highlighted read-only CodeMirror, tool input/output, downloads, and fullscreen code views.
- **Attachments:** image/file picker, clipboard paste, drag and drop, and managed local file storage.
- **Appearance:** system/light/dark themes, adjustable text and chat width, custom background images, and a background-visibility toggle.
- **Desktop integration:** frameless window chrome, external links, folder actions, and optional response-completion notifications.

## Requirements

- **Windows:** the current installer target is Windows NSIS. A working WebView2 runtime is required.
- **Pi:** install the [Pi coding-agent CLI](https://github.com/earendil-works/pi) and ensure the `pi` executable is available on `PATH`.
- **Models:** configure a model provider/authentication through Pi. Molten Forge uses those settings instead of maintaining a separate model catalog.

To install Pi with npm (see Pi's official documentation for other installation methods):

```cmd
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
```

The `pi` command should work in a terminal before launching Molten Forge.

## Install

Once a release is published, download the Windows installer from [GitHub Releases](https://github.com/arlagonix/molten-forge/releases). The installer contains Molten Forge, **not** the Pi CLI.

**Upgrading from earlier Tauri development builds:** the installer display name changed from “Molten Forge Pi” to “Molten Forge”. Windows may treat them as two separate installations. Uninstall the old development build first if necessary, without deleting its application data. The Tauri identifier and application-data paths are unchanged.

**Migrating from the original Electron Molten Forge:** v2.0.0 replaces the previous architecture and does not promise automatic migration of Electron-specific settings. The original source is preserved in the [`legacy/electron` branch](https://github.com/arlagonix/molten-forge/tree/legacy/electron) and the [`electron-final` tag](https://github.com/arlagonix/molten-forge/tree/electron-final).

## Build from source

Prerequisites: a supported Node.js version for Vite 7, npm, Rust/Cargo, the Windows MSVC build tools, and the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/). Pi must also be installed and configured.

```cmd
npm install
npm run tauri:dev
```

To create a release installer:

```cmd
npm run check
npm run tauri:build
```

`npm run check` runs Node and Vitest tests, TypeScript checking, the frontend build, and Rust tests. Browser regression scripts under `tests/` require additional tooling and are separate from the default check. The Tauri bundle currently targets NSIS.

## Architecture

| Component | Responsibility |
| --- | --- |
| Pi CLI | Agent loop, models, tools, sessions, skills, extensions, provider configuration |
| Tauri / Rust | Process lifecycle, JSONL RPC bridge, native filesystem and desktop integration |
| React / TypeScript | Transcript, composer, navigation, settings, appearance, and rendering |

Molten Forge intentionally uses Pi's existing storage and APIs rather than implementing a second agent runtime. See [the Pi RPC lifecycle contract](docs/pi-rpc-lifecycle.md), [integration audit](docs/pi-integration-audit.md), and [agent development guide](AGENTS.md).

## Data and privacy

Pi controls its own session history and provider credentials. Molten Forge stores UI preferences and managed attachments locally. The Tauri application identifier is `com.moltenforge.pi` and has **not** changed with the public-facing rename. See [attachments](docs/attachments.md) and [appearance](docs/appearance.md) for storage behavior.

## Development and contributing

Read [AGENTS.md](AGENTS.md) before editing, then consult the relevant [feature documentation](docs/README.md) and project skills in `.agents/skills/`. Keep changes focused and run the appropriate checks before opening a pull request. See [releasing instructions](docs/releasing.md) for version and changelog conventions.

## License

A repository license has not yet been selected for this source tree. Check licensing before redistributing or reusing the project. Third-party assets retain their own license notices.
