import type { LoadedAgentInfo } from "@/lib/ai-chat/types";

export const BUILTIN_GENERAL_AGENT_NAME = "general";
export const BUILTIN_GENERAL_FULL_AGENT_NAME = "general_full";

export const BUILTIN_AGENT_NAMES = [
  BUILTIN_GENERAL_AGENT_NAME,
  BUILTIN_GENERAL_FULL_AGENT_NAME,
] as const;

export function isBuiltInAgentName(name: string) {
  return (BUILTIN_AGENT_NAMES as readonly string[]).includes(name);
}

function normalizeBuiltInAgentMaxNestingDepth(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue)
    ? Math.min(Math.max(Math.round(numberValue), 1), 8)
    : 2;
}

export function createBuiltInAgents(
  maxNestingDepths: Partial<Record<string, number>> = {},
): LoadedAgentInfo[] {
  const generalMaxNestingDepth = normalizeBuiltInAgentMaxNestingDepth(
    maxNestingDepths[BUILTIN_GENERAL_AGENT_NAME],
  );
  const generalFullMaxNestingDepth = normalizeBuiltInAgentMaxNestingDepth(
    maxNestingDepths[BUILTIN_GENERAL_FULL_AGENT_NAME],
  );

  return [
    {
      id: "builtin-agent-general",
      name: BUILTIN_GENERAL_AGENT_NAME,
      enabled: true,
      description:
        "Default general-purpose helper with the same effective tools and skills as the main chat. Receives only the delegated task, not the full chat history.",
      instructions:
        "Complete the delegated task directly. Use only the details included in the task unless you need tools to inspect more information.",
      contextMode: "task_only",
      maxNestingDepth: generalMaxNestingDepth,
      loadedSkillNames: [],
      allowedToolNames: [],
      allowedAgentNames: [],
    },
    {
      id: "builtin-agent-general-full",
      name: BUILTIN_GENERAL_FULL_AGENT_NAME,
      enabled: true,
      description:
        "Default general-purpose helper with the same effective tools and skills as the main chat. Receives the full chat context.",
      instructions:
        "Complete the delegated task directly. Use the full chat context when it matters, but keep the result focused on the requested subtask.",
      contextMode: "full_chat",
      maxNestingDepth: generalFullMaxNestingDepth,
      loadedSkillNames: [],
      allowedToolNames: [],
      allowedAgentNames: [],
    },
  ];
}
