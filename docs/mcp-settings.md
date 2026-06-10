# MCP settings requirements and tests

## Purpose

MCP settings manage external Model Context Protocol servers and the tools discovered from them. The MCP dialog is responsible for connection configuration and discovery. Tool execution permission remains owned by Tools settings.

## Global MCP behavior

- The global MCP switch controls whether MCP tools are loaded into model context at all.
- The global MCP switch is not part of the currently selected server form.
- Toggling global MCP applies immediately through saved MCP settings.
- Toggling global MCP must not activate the selected server form Save button.
- When global MCP is off:
  - every server switch in the MCP sidebar is disabled;
  - every server switch is displayed as off;
  - the saved per-server enabled values are preserved internally.
- When global MCP is turned back on:
  - server switches become interactive again;
  - each server switch returns to its previously saved value.

## Sidebar behavior

- The MCP sidebar shows saved server state, not unsaved form state.
- The sidebar header is `MCP servers` only. It must not show `m/n enabled`.
- The Add server button is fixed at the bottom of the sidebar, outside the scrollable server list.
- The Add server button is 36px tall for alignment with the surrounding sidebar controls.
- The Add server button follows the same layout idea as the chat sidebar: the list scrolls, while the add action stays available.
- The dialog footer actions belong only to the selected server form area. They do not span the sidebar.
- MCP server icons in the sidebar use `margin-top: 5px` for vertical alignment.
- The selected server row is clickable and toggles that server switch; inactive server rows still select/switch the edited MCP server.
- Server rows have a hover background effect.
- Per-server sidebar switches apply immediately and independently from the selected server form Save button.
- Per-server sidebar switch changes must not dirty the selected server form.

## Selected server form behavior

- Every configurable form field has an info icon beside its label. Hovering the icon shows a concise explanation of what the field controls and when to use it. Tooltips use the app default tooltip styling and keep the arrow.
- The form edits only the selected server details:
  - name;
  - transport;
  - command/args/cwd/env for stdio servers;
  - URL/headers/TLS behavior for HTTP servers;
  - timeout;
  - discovered tool visibility switches.
- Server enabled state is controlled from the sidebar, not from the form.
- Editing the server name must not immediately rename the sidebar item.
- The sidebar shows the new server name only after the server form is saved.
- Reset discards the current server form draft and returns it to the latest saved state.
- Save validates the active server draft and writes it to MCP settings.
- In Create server mode, the primary action is `Create`, not `Save`.
- In Create server mode, the secondary action is `Cancel`, not `Reset`.
- Cancel leaves Create server mode and returns to the saved server list without creating a server.
- An untouched new server draft does not count as unsaved changes.

## Server name restrictions

Server names are intentionally strict because they are used to create MCP tool names.

Allowed server names:

- length: 1–48 characters;
- characters: `a-z`, `A-Z`, `0-9`, `_`, `-`;
- no spaces;
- no dots;
- no other punctuation or Unicode characters;
- unique case-insensitively across all MCP servers.

Examples:

- valid: `serena`, `Serena_2`, `github-mcp`;
- invalid: `Serena Tools`, `serena.tools`, `серена`, empty string.

Existing invalid saved names are not silently renamed. If a user edits or saves such a server, validation blocks Save and explains the requirement.

## MCP tool visibility behavior

Each discovered MCP tool has its own visibility switch in MCP settings.

- Newly discovered MCP tools default to disabled.
- Disabled MCP tools remain visible in MCP settings so the user can enable them later.
- Disabled MCP tools are hidden from Tools settings.
- Disabled MCP tools are hidden from model context.
- Disabled MCP tools cannot be executed through normal MCP loaded-tool discovery.
- Enabled MCP tools become available to Tools settings and model context if global MCP and the server are also enabled.
- Ask/Allow/Deny permission is still configured in Tools settings after the MCP tool is enabled.
- MCP settings must not show the old `Permission in Tools` label in tool rows.
- The Discovered tools heading uses the same larger label scale as the rest of the form.
- The Discovered tools heading has an info icon explaining that MCP tool visibility is configured here while Ask/Allow/Deny permissions remain in Tools settings.
- Tool names use medium font weight.
- The entire MCP tool row is clickable and toggles the tool visibility switch.
- Tool rows have a hover background effect.
- Tool rows use non-selectable text to avoid accidental text highlighting while toggling visibility.

## MCP exposed tool names

The exposed tool name is generated from the server name and original MCP tool name:

```text
mcp_<server-name>_<tool-name>
```

Examples:

```text
server: Serena, tool: edit_memory -> mcp_Serena_edit_memory
server: serena, tool: edit_memory -> mcp_serena_edit_memory
```

When a server is renamed and saved, all exposed names for that server are regenerated from the saved server name. This fixes stale names such as `mcp_Serena_edit_memory` remaining after the server is renamed to `serena`.

## Permission migration on rename

When a server rename changes exposed MCP tool names:

- existing Tools settings permissions are copied from the old exposed name to the new exposed name;
- stale old exposed-name permissions are removed when they no longer match any current MCP tool;
- unrelated tool permissions are not changed.

This preserves user choices such as Ask/Allow/Deny across MCP server renames.

## Unsaved changes modal

MCP settings uses a reusable unsaved-changes confirmation component.

The modal appears when the current server form has unsaved changes and the user tries to:

- close the MCP dialog;
- select another server;
- add a new server;
- discard/switch away from a new unsaved server.

The modal does not appear for an untouched new server draft. For example, clicking Add server and then selecting an existing server should switch without confirmation if no fields were changed.

Default text:

- title: `Discard unsaved changes?`
- description: `You have unsaved changes. If you leave now, they may be lost.`
- buttons: `Stay`, `Discard changes`

The component is reusable outside MCP settings.

## Current test setup

The project now includes Vitest and React Testing Library:

```bash
npm run test
npm run test:watch
```

Test configuration:

- `vitest.config.ts` defines the React plugin, `@` alias, jsdom environment, and setup file.
- `src/test/setup.ts` installs jest-dom matchers and a small `ResizeObserver` mock.

## Current test coverage

### `src/lib/ai-chat/mcp.test.ts`

Covers:

- strict server name validation;
- duplicate-name detection, case-insensitive;
- unique default name generation;
- exposed MCP tool name generation;
- disabled MCP tools excluded from loaded tools;
- global MCP disabled excludes all MCP tools;
- server disabled excludes server tools.

### `src/components/mcp-dialog.test.tsx`

Covers:

- global MCP toggle does not dirty the server form;
- unsaved server name edits do not update the sidebar;
- switching servers with unsaved edits opens the unsaved-changes modal;
- global MCP off disables server switches and displays them as unchecked;
- MCP tool rows render enable switches;
- clicking the active server row toggles that server switch;
- old `Permission in Tools` label is absent.
- Create server mode uses `Create` and `Cancel` actions;
- untouched new server drafts do not show the unsaved-changes modal when switching away.

## Manual testing checklist

1. Open MCP settings.
2. Confirm the sidebar no longer shows `m/n enabled`.
3. Confirm Add server is fixed at the bottom of the sidebar.
4. Confirm the Reset/Save footer spans only the form area, not the sidebar.
5. Toggle global MCP off and confirm Save stays disabled.
6. Confirm server switches are disabled and displayed off while global MCP is off.
7. Toggle global MCP back on and confirm server switches restore their previous saved values.
8. Toggle a server switch and confirm Save stays disabled.
9. Click Add server and confirm the form shows `Cancel` and `Create`.
10. Without editing the new server, select an existing server and confirm no unsaved-changes modal appears.
11. Click Add server again, edit a field, then select an existing server and confirm the unsaved-changes modal appears.
12. Edit a server name and confirm Save becomes enabled.
13. Confirm the sidebar still shows the saved name until Save.
14. Try switching to another server and confirm the unsaved-changes modal appears.
15. Save a rename from `Serena` to `serena` and confirm exposed tool names regenerate.
16. Confirm Tools settings permissions migrate to the new exposed tool names.
17. Load tools and confirm newly discovered tools default disabled.
18. Enable one MCP tool by clicking the row or switch, save, and confirm it appears in Tools settings.
19. Disable that tool, save, and confirm it disappears from Tools settings and model context.
20. Hover each MCP field info icon and confirm the tooltip explains the field and uses the app default styling with an arrow.
21. Hover the Discovered tools info icon and confirm it explains MCP tool visibility.
22. Confirm the Add server button remains 36px tall.
