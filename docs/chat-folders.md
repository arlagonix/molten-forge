# Chat folders and default workspaces

Chat folders organize existing chats and can also define a default workspace for new chats created inside that folder.

## Folder menu

Each folder exposes its actions from the three-dots menu.

Without a default workspace, the menu contains:

```text
New chat
Rename folder
---
Set workspace
---
Delete folder
```

With a default workspace, the menu contains:

```text
New chat
Rename folder
---
Workspace: <workspace name>
Change workspace
Remove workspace
---
Delete folder
```

The separate plus button on the folder row is intentionally not shown. Creating a chat from a folder is handled through `New chat` in the folder menu.

## Default workspace behavior

A folder can have one default workspace. This uses the existing `ChatFolder.workspaceRoots` field, but only the first root is treated as the active folder default. Folder workspaces are persisted in app settings and are restored after reload.

When a user creates a new chat from a folder:

- the new chat draft is assigned to that folder,
- the draft inherits the folder's default workspace, if one is set,
- the inherited workspace is visible in the composer footer,
- the workspace is saved on the chat when the first message is sent.

Changing or removing a folder workspace affects only future chats created from that folder.

Existing chats are not automatically changed when:

- a folder workspace is changed,
- a folder workspace is removed,
- a chat is moved into a folder.

## Chat menu

The chat three-dots menu keeps chat actions separate from workspace editing:

```text
Rename
Pin
Generate title
Clone
New with same settings
---
Move to folder
---
Clear chat
Delete
```

Chat workspaces are not shown in this menu. Changing or removing a chat workspace is handled by the workspace control in the composer footer.


## New with same settings behavior

`New with same settings` does not create or persist a chat immediately. It opens the same unsaved draft state as the main `New chat` action, then preloads the selected chat's defaults.

The draft copies:

- provider/model settings,
- mode,
- tool, skill, and agent permissions,
- active skills,
- workspace roots,
- file-tool auto-approval settings,
- thinking mode,
- folder assignment, if the source folder still exists.

Messages are not copied. The real chat is created only when the user sends the first message. If the source chat is inside a folder, the future chat is saved into that same folder on first send.

## Clone behavior

`Clone` creates a new chat from the selected chat and opens it immediately.

The cloned chat copies:

- messages,
- provider/model settings,
- mode,
- tool, skill, and agent permissions,
- active skills,
- workspace roots,
- file-tool auto-approval settings,
- thinking mode,
- folder assignment.

The cloned chat receives a new chat id and fresh `createdAt` / `updatedAt` timestamps, so it appears as a recent chat.

Attachment files are not physically duplicated. The clone copies attachment metadata and references, including existing storage paths.

## Rename behavior

Renaming a chat updates only the chat title and title mode. It does not update `updatedAt`, so a renamed chat does not jump to the top of the sidebar.
