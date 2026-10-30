import type { CommandInfo } from "./chat-logic";

export type ResourceRecord = {
  name: string;
  path: string;
  scope: string;
  description: string;
  kind: "skill" | "extension" | "package";
  runtimeCommand?: string;
};

function identity(path: string) {
  return path.replaceAll("\\", "/").replace(/\/SKILL\.md$/i, "").replace(/\/$/, "").toLowerCase();
}

/** Augment on-disk resource discovery with commands reported by this Pi process.
 * get_commands describes only callable commands, not every active extension.
 */
export function mergePiCommands(resources: readonly ResourceRecord[], commands: readonly CommandInfo[], kind: "skill" | "extension") {
  const merged = resources.map((resource) => ({ ...resource }));
  for (const command of commands) {
    if (command.source !== kind || !command.sourceInfo?.path) continue;
    const path = command.sourceInfo.path;
    const match = merged.find((resource) => identity(resource.path) === identity(path));
    if (match) {
      match.runtimeCommand = `/${command.name}`;
    } else {
      merged.push({
        name: kind === "skill" ? command.name.replace(/^skill:/, "") : command.name,
        path,
        scope: command.sourceInfo.scope === "user" ? "Global" : command.sourceInfo.scope === "project" ? "Project" : "Temporary",
        description: command.description ?? "",
        kind,
        runtimeCommand: `/${command.name}`,
      });
    }
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}


/** Render only populated scope sections, in the same order as General Settings. */
export function groupResourcesByScope(resources: readonly ResourceRecord[]): Array<{ scope: string; title: string; items: ResourceRecord[] }> {
  const scopes = [
    { scope: "Global", title: "Global" },
    { scope: "Project", title: "Project" },
    { scope: "Temporary", title: "Other" },
  ];
  const result = scopes.map(({ scope, title }) => ({ scope, title, items: resources.filter((item) => item.scope === scope) }))
    .filter((group) => group.items.length > 0);
  const unknown = resources.filter((item) => !scopes.some((scope) => scope.scope === item.scope));
  if (unknown.length > 0) result.push({ scope: "Unclassified", title: "Other", items: unknown });
  return result;
}
