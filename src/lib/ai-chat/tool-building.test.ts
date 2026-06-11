import { describe, expect, it } from "vitest";

import {
  areToolBuildingVisibleMetadataEqual,
  getToolBuildingVisibleMetadata,
} from "@/lib/ai-chat/tool-building";
import type { ChatToolCall } from "@/lib/ai-chat/types";

function toolCall(
  id: string,
  name: string,
  args: string,
): ChatToolCall {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: args,
    },
  };
}

describe("tool-building visible metadata", () => {
  it("uses only ids, names, and count for visible tool-building UI", () => {
    expect(
      getToolBuildingVisibleMetadata([
        toolCall("call-1", "file_read", '{"path":"a"}'),
        toolCall("call-2", "file_read", '{"path":"b"}'),
        toolCall("call-3", "bash", '{"command":"npm test"}'),
      ]),
    ).toEqual({
      toolCallIds: ["call-1", "call-2", "call-3"],
      toolNames: ["file_read", "bash"],
      toolCallCount: 3,
    });
  });

  it("treats argument-only deltas as unchanged visible metadata", () => {
    const previous = getToolBuildingVisibleMetadata([
      toolCall("call-1", "file_read", '{"path":"sr'),
    ]);
    const next = getToolBuildingVisibleMetadata([
      toolCall("call-1", "file_read", '{"path":"src/App.tsx"}'),
    ]);

    expect(areToolBuildingVisibleMetadataEqual(previous, next)).toBe(true);
  });

  it("detects visible changes when tool ids or names change", () => {
    const previous = getToolBuildingVisibleMetadata([
      toolCall("call-1", "file_read", "{}"),
    ]);
    const next = getToolBuildingVisibleMetadata([
      toolCall("call-1", "file_read", "{}"),
      toolCall("call-2", "bash", "{}"),
    ]);

    expect(areToolBuildingVisibleMetadataEqual(previous, next)).toBe(false);
  });
});
