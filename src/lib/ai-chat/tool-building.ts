import type { ChatToolCall } from "@/lib/ai-chat/types";

export type ToolBuildingVisibleMetadata = {
  toolCallIds: string[];
  toolNames: string[];
  toolCallCount: number;
};

export function getToolBuildingVisibleMetadata(
  toolCalls: ChatToolCall[],
): ToolBuildingVisibleMetadata {
  const toolCallIds: string[] = [];
  const toolNames: string[] = [];
  const seenNames = new Set<string>();

  for (const toolCall of toolCalls) {
    toolCallIds.push(toolCall.id);

    const toolName = toolCall.function.name.trim();
    if (toolName && !seenNames.has(toolName)) {
      seenNames.add(toolName);
      toolNames.push(toolName);
    }
  }

  return {
    toolCallIds,
    toolNames,
    toolCallCount: toolCalls.length,
  };
}

export function areToolBuildingVisibleMetadataEqual(
  left: ToolBuildingVisibleMetadata,
  right: ToolBuildingVisibleMetadata,
) {
  return (
    left.toolCallCount === right.toolCallCount &&
    areStringArraysEqual(left.toolCallIds, right.toolCallIds) &&
    areStringArraysEqual(left.toolNames, right.toolNames)
  );
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}
