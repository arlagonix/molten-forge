import type { CommandInfo } from "./chat-logic";

export type PiStartupSection = {
  title: "Skills" | "Prompts" | "Extensions";
  items: string[];
};

export function formatPiStartupVersion(version: string | null | undefined): string {
  const value = version?.trim() ?? "";
  if (!value || /^pi detected$/i.test(value) || /^not found:/i.test(value)) return "pi";

  const withoutName = value.replace(/^pi\s*/i, "").trim();
  const normalized = withoutName.startsWith("v") ? withoutName : `v${withoutName}`;
  return `pi ${normalized}`;
}

function extensionLabelFromPath(path: string | undefined, fallback: string): string {
  if (!path?.trim()) return fallback;

  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return fallback;

  let label = parts.at(-1) ?? fallback;
  if (/^index\.(?:[cm]?[jt]sx?)$/i.test(label) && parts.length > 1) {
    label = parts.at(-2) ?? label;
  }

  return label.replace(/\.(?:[cm]?[jt]sx?)$/i, "") || fallback;
}

function sortedUnique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function piStartupSections(commands: CommandInfo[]): PiStartupSection[] {
  const skills = sortedUnique(
    commands
      .filter((command) => command.source === "skill")
      .map((command) => command.name.replace(/^skill:/, "")),
  );
  const prompts = sortedUnique(
    commands
      .filter((command) => command.source === "prompt")
      .map((command) => `/${command.name}`),
  );
  const extensions = sortedUnique(
    commands
      .filter((command) => command.source === "extension")
      .map((command) => extensionLabelFromPath(command.sourceInfo?.path, command.name)),
  );

  return [
    ...(skills.length > 0 ? [{ title: "Skills" as const, items: skills }] : []),
    ...(prompts.length > 0 ? [{ title: "Prompts" as const, items: prompts }] : []),
    ...(extensions.length > 0 ? [{ title: "Extensions" as const, items: extensions }] : []),
  ];
}
