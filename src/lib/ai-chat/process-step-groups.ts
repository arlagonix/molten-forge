import type { ChatAssistantProcessStep } from "@/lib/ai-chat/types";

export type VisibleAssistantProcessStep = ChatAssistantProcessStep & {
  sourceStepIds: string[];
};

export type VisibleAssistantProcessStepBaseGroup =
  | { kind: "single"; step: VisibleAssistantProcessStep }
  | {
      kind: "tool_batch";
      toolBatchId: string;
      steps: VisibleAssistantProcessStep[];
    };

export type VisibleAssistantProcessStepGroup =
  | VisibleAssistantProcessStepBaseGroup
  | {
      kind: "thinking_tool_group";
      thinkingStep: VisibleAssistantProcessStep;
      toolGroups: VisibleAssistantProcessStepBaseGroup[];
    };

export function getToolBatchGroupLabel(
  group: Extract<VisibleAssistantProcessStepBaseGroup, { kind: "tool_batch" }>,
) {
  const hasCallAgentTool = group.steps.some(
    (step) =>
      step.type === "tool_execution" &&
      step.toolCall.function.name === "call_agent",
  );
  const hasAgentBlock = group.steps.some((step) => step.type === "agent_call");
  const hasApprovalStep = group.steps.some(
    (step) => step.type === "approval" || step.type === "file_approval",
  );
  const hasToolExecutionStep = group.steps.some(
    (step) => step.type === "tool_execution",
  );

  if (hasCallAgentTool && hasAgentBlock) return "Agent delegation";
  if (hasApprovalStep && hasToolExecutionStep) return "Tool approval";
  return "Parallel tool calls";
}

function getVisibleStepToolBatchId(step: VisibleAssistantProcessStep) {
  return "toolBatchId" in step ? step.toolBatchId : undefined;
}

function isToolRelatedVisibleStep(step: VisibleAssistantProcessStep) {
  return (
    step.type === "tool_building" ||
    step.type === "tool_execution" ||
    step.type === "agent_call" ||
    step.type === "user_input" ||
    step.type === "approval" ||
    step.type === "file_approval" ||
    step.type === "tasks"
  );
}

function groupToolRelatedVisibleSteps(
  steps: VisibleAssistantProcessStep[],
): VisibleAssistantProcessStepBaseGroup[] {
  const groups: VisibleAssistantProcessStepBaseGroup[] = [];
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];
    const toolBatchId = getVisibleStepToolBatchId(step);

    if (!toolBatchId) {
      groups.push({ kind: "single", step });
      index += 1;
      continue;
    }

    const batchSteps: VisibleAssistantProcessStep[] = [];
    while (
      index < steps.length &&
      getVisibleStepToolBatchId(steps[index]) === toolBatchId
    ) {
      batchSteps.push(steps[index]);
      index += 1;
    }

    if (batchSteps.length > 1) {
      groups.push({ kind: "tool_batch", toolBatchId, steps: batchSteps });
    } else {
      groups.push({ kind: "single", step: batchSteps[0] });
    }
  }

  return groups;
}

function isAssistantTextVisibleStep(step: VisibleAssistantProcessStep) {
  return step.type === "assistant_message" && step.content.trim().length > 0;
}

function isThinkingToolGroupBoundary(step: VisibleAssistantProcessStep) {
  return step.type === "thinking" || isAssistantTextVisibleStep(step);
}

export function getVisibleAssistantProcessSteps(
  processSteps: ChatAssistantProcessStep[],
): VisibleAssistantProcessStep[] {
  const visibleSteps: VisibleAssistantProcessStep[] = [];

  for (const step of processSteps) {
    if (step.type === "thinking" && !step.content.trim()) {
      continue;
    }

    const previousStep = visibleSteps[visibleSteps.length - 1];

    if (
      step.type === "assistant_message" &&
      previousStep?.type === "assistant_message"
    ) {
      previousStep.content = `${previousStep.content}${step.content}`;
      previousStep.sourceStepIds = [...previousStep.sourceStepIds, step.id];
      continue;
    }

    visibleSteps.push({ ...step, sourceStepIds: [step.id] });
  }

  return visibleSteps;
}

export function groupVisibleAssistantProcessSteps(
  steps: VisibleAssistantProcessStep[],
): VisibleAssistantProcessStepGroup[] {
  const groups: VisibleAssistantProcessStepGroup[] = [];
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];

    if (step.type === "thinking") {
      const toolSteps: VisibleAssistantProcessStep[] = [];
      let lookaheadIndex = index + 1;

      while (lookaheadIndex < steps.length) {
        const lookaheadStep = steps[lookaheadIndex];

        if (isThinkingToolGroupBoundary(lookaheadStep)) break;

        if (isToolRelatedVisibleStep(lookaheadStep)) {
          toolSteps.push(lookaheadStep);
        }

        lookaheadIndex += 1;
      }

      if (toolSteps.length > 0) {
        groups.push({
          kind: "thinking_tool_group",
          thinkingStep: step,
          toolGroups: groupToolRelatedVisibleSteps(toolSteps),
        });
        index = lookaheadIndex;
        continue;
      }
    }

    if (isToolRelatedVisibleStep(step)) {
      const toolBatchId = getVisibleStepToolBatchId(step);

      if (toolBatchId) {
        const batchSteps: VisibleAssistantProcessStep[] = [];
        while (
          index < steps.length &&
          getVisibleStepToolBatchId(steps[index]) === toolBatchId
        ) {
          batchSteps.push(steps[index]);
          index += 1;
        }

        if (batchSteps.length > 1) {
          groups.push({ kind: "tool_batch", toolBatchId, steps: batchSteps });
        } else {
          groups.push({ kind: "single", step: batchSteps[0] });
        }
        continue;
      }
    }

    groups.push({ kind: "single", step });
    index += 1;
  }

  return groups;
}
