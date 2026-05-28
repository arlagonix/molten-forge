import { isTaskToolName } from "@/lib/ai-chat/builtin-tools";
import { getActiveVariant } from "@/lib/ai-chat/chat-utils";
import type {
  AgentTask,
  ChatAssistantProcessStep,
  ChatMessage,
  ChatToolResult,
} from "@/lib/ai-chat/types";

export type DerivedTaskState = {
  tasks: AgentTask[];
  nextTaskId: number;
};

export function normalizeTaskSubject(subject: string) {
  return subject.trim().replace(/\s+/g, " ");
}

export function normalizeTaskSubjectKey(subject: string) {
  return normalizeTaskSubject(subject).toLocaleLowerCase();
}

export function dedupeTaskList(tasks: AgentTask[]) {
  const tasksBySubjectKey = new Map<string, AgentTask>();

  for (const task of tasks) {
    const subject = normalizeTaskSubject(task.subject);
    const subjectKey = normalizeTaskSubjectKey(subject);
    if (!subjectKey) continue;

    const existingTask = tasksBySubjectKey.get(subjectKey);
    if (!existingTask) {
      tasksBySubjectKey.set(subjectKey, { ...task, subject });
      continue;
    }

    tasksBySubjectKey.set(subjectKey, {
      ...existingTask,
      done: existingTask.done || task.done,
    });
  }

  return [...tasksBySubjectKey.values()];
}

export function normalizeTaskCounter(tasks: AgentTask[], nextTaskId?: number) {
  const maxTaskId = tasks.reduce(
    (maxId, task) => Math.max(maxId, task.id),
    0,
  );
  return Math.max(nextTaskId ?? 1, maxTaskId + 1);
}

function parseTaskToolResult(toolResult?: ChatToolResult): AgentTask[] | undefined {
  if (!toolResult?.content || toolResult.isError) return undefined;
  if (!isTaskToolName(toolResult.toolName)) return undefined;

  try {
    const parsed = JSON.parse(toolResult.content) as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return undefined;

    const tasks = parsed.tasks.filter((task): task is AgentTask => {
      if (!task || typeof task !== "object" || Array.isArray(task)) {
        return false;
      }

      const source = task as Record<string, unknown>;
      return (
        typeof source.id === "number" &&
        typeof source.subject === "string" &&
        typeof source.done === "boolean"
      );
    });

    return dedupeTaskList(tasks);
  } catch {
    return undefined;
  }
}

function getTaskSnapshotFromStep(
  step: ChatAssistantProcessStep,
): AgentTask[] | undefined {
  if (step.type === "tasks") {
    return parseTaskToolResult(step.toolResult);
  }

  if (step.type === "tool_execution") {
    return parseTaskToolResult(step.toolResult);
  }

  return undefined;
}

export function deriveTaskStateFromMessages(
  messages: ChatMessage[],
): DerivedTaskState {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message?.role !== "assistant") continue;

    const activeVariant = getActiveVariant(message);
    const processSteps = activeVariant?.processSteps ?? [];

    for (let stepIndex = processSteps.length - 1; stepIndex >= 0; stepIndex -= 1) {
      const tasks = getTaskSnapshotFromStep(processSteps[stepIndex]);
      if (!tasks) continue;

      return {
        tasks,
        nextTaskId: normalizeTaskCounter(tasks),
      };
    }
  }

  return {
    tasks: [],
    nextTaskId: 1,
  };
}
