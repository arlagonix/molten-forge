# Skills settings

Skills are filesystem folders that contain a `SKILL.md` file. Chat Forge discovers skills from:

- the global skills folder: `~/.agents/skills`
- the active workspace skills folder: `<workspace>/.agents/skills`

## Searching skills

Use the search field in **Settings → Skills** to filter the list by skill name or frontmatter description. The search does not scan the full `SKILL.md` body or files inside the skill folder. The clear button inside the search field clears the query.

## Creating skills

Use **Settings → Skills → Create skill**.

During creation, choose where the skill should be stored:

- **Global** creates `~/.agents/skills/<skill-name>/SKILL.md`.
- **Workspace** creates `<workspace>/.agents/skills/<skill-name>/SKILL.md`. This option is only available when the current chat has a workspace.

The skill name comes from the `name` field inside `SKILL.md` frontmatter. The name and description fields shown in the UI are readonly previews derived from `SKILL.md`, so the manifest remains the single source of truth.

Skill names must be unique across global and workspace skills and must use 1–64 letters, numbers, underscores, or hyphens. `skill` is reserved for the built-in loader tool. Name validation appears directly under the readonly name preview because `SKILL.md` is the source of truth.

Newly created skills are allowed by default because loading a skill only injects instructions into the model context.

## Editing skills

Existing skills are edited as raw `SKILL.md` content so custom frontmatter fields are preserved. The readonly name and description previews update immediately as the raw manifest changes.

The readonly location field shows the skill manifest location. Use the folder button beside it to open the selected skill folder.

Use:

- **Open editor** to edit `SKILL.md` in a larger focused modal.
- **Save** to write changes to disk.
- **Reset** to restore the last saved version.

If the `name` in `SKILL.md` changes, Chat Forge attempts to rename the skill folder on save. If the folder rename fails, the save is aborted and the current on-disk skill is left unchanged when possible.

## Cloning skills

Use the selected skill's options menu and choose **Clone**. This opens the create form with the selected skill's `SKILL.md` content prefilled. Extra files from the source skill folder are not copied.

The cloned draft must be saved as a unique skill name before it can be created.

## Moving skills

When the current chat has a workspace, the selected skill's options menu includes:

- **Move to workspace** for global skills.
- **Make global** for workspace skills.

Moving transfers the entire skill folder. The operation fails if another skill with the same name already exists in the target/global-workspace skill set.

## Deleting skills

Use the selected skill's options menu and choose **Delete**. Deleting a skill removes the entire skill folder from disk after a warning confirmation.

## Reloading and file structure

Skills reload silently when the Skills settings dialog opens. Manual reload is available from the bottom options menu. Reload success does not show a toast to avoid repeated notifications.

The selected skill shows a level-one file structure preview so users can see which files are present beside `SKILL.md`.

## Permissions

The Skills master permission controls the whole skill category. Individual skills can be set to:

- **Allow**: load without asking.
- **Ask**: ask the user before loading that skill.
- **Deny**: hide/block that skill.

Missing per-skill permission entries default to **Allow**. Skill approval requests show only the requested skill name, source, and short description, not the full `SKILL.md` body.
