import type { LoadedToolInfo, ToolExecutionStatus } from "./types";

export type ToolExecutionPolicy = Pick<
  LoadedToolInfo,
  "maxConcurrentRuns" | "delayBetweenRunsMs"
>;

type NormalizedToolExecutionPolicy = {
  maxConcurrentRuns: number;
  delayBetweenRunsMs: number;
};

type QueuedToolRun<T> = {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  onStatusChange?: (status: Extract<ToolExecutionStatus, "pending" | "running">) => void;
  signal?: AbortSignal;
};

type ToolQueueState = {
  running: number;
  lastStartedAt: number;
  queue: QueuedToolRun<unknown>[];
  timer: ReturnType<typeof setTimeout> | null;
  policy: NormalizedToolExecutionPolicy;
};

const toolQueues = new Map<string, ToolQueueState>();

function normalizeExecutionPolicy(
  policy?: Partial<ToolExecutionPolicy>,
): NormalizedToolExecutionPolicy | null {
  const maxConcurrentRuns =
    typeof policy?.maxConcurrentRuns === "number" &&
    Number.isFinite(policy.maxConcurrentRuns) &&
    policy.maxConcurrentRuns > 0
      ? Math.max(1, Math.floor(policy.maxConcurrentRuns))
      : undefined;
  const delayBetweenRunsMs =
    typeof policy?.delayBetweenRunsMs === "number" &&
    Number.isFinite(policy.delayBetweenRunsMs) &&
    policy.delayBetweenRunsMs > 0
      ? Math.max(0, Math.round(policy.delayBetweenRunsMs))
      : 0;

  if (maxConcurrentRuns === undefined && delayBetweenRunsMs <= 0) {
    return null;
  }

  return {
    maxConcurrentRuns: maxConcurrentRuns ?? 1,
    delayBetweenRunsMs,
  };
}

function createAbortError() {
  return new DOMException("Tool execution was cancelled.", "AbortError");
}

function removeQueuedRun(state: ToolQueueState, queuedRun: QueuedToolRun<unknown>) {
  const index = state.queue.indexOf(queuedRun);
  if (index >= 0) state.queue.splice(index, 1);
}

function cleanupQueueIfIdle(toolName: string, state: ToolQueueState) {
  if (state.queue.length === 0 && state.running === 0 && !state.timer) {
    toolQueues.delete(toolName);
  }
}

function scheduleToolQueue(toolName: string) {
  const state = toolQueues.get(toolName);
  if (!state || state.timer) return;

  const { policy } = state;

  while (state.running < policy.maxConcurrentRuns && state.queue.length > 0) {
    const now = Date.now();
    const elapsedSinceLastStart = state.lastStartedAt
      ? now - state.lastStartedAt
      : Number.POSITIVE_INFINITY;

    if (
      policy.delayBetweenRunsMs > 0 &&
      elapsedSinceLastStart < policy.delayBetweenRunsMs
    ) {
      state.timer = setTimeout(() => {
        const current = toolQueues.get(toolName);
        if (current) current.timer = null;
        scheduleToolQueue(toolName);
      }, policy.delayBetweenRunsMs - elapsedSinceLastStart);
      return;
    }

    const queuedRun = state.queue.shift();
    if (!queuedRun) return;

    if (queuedRun.signal?.aborted) {
      queuedRun.reject(createAbortError());
      continue;
    }

    state.running += 1;
    state.lastStartedAt = Date.now();
    queuedRun.onStatusChange?.("running");

    Promise.resolve()
      .then(queuedRun.operation)
      .then(queuedRun.resolve, queuedRun.reject)
      .finally(() => {
        const current = toolQueues.get(toolName);
        if (!current) return;

        current.running = Math.max(0, current.running - 1);

        if (current.queue.length === 0 && current.running === 0 && !current.timer) {
          toolQueues.delete(toolName);
          return;
        }

        scheduleToolQueue(toolName);
      });
  }
}

export function runQueuedTool<T>(
  toolName: string,
  policy: Partial<ToolExecutionPolicy> | undefined,
  operation: () => Promise<T>,
  onStatusChange?: (status: Extract<ToolExecutionStatus, "pending" | "running">) => void,
  signal?: AbortSignal,
): Promise<T> {
  const normalizedPolicy = normalizeExecutionPolicy(policy);

  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  if (!normalizedPolicy) {
    onStatusChange?.("running");
    return operation();
  }

  return new Promise<T>((resolve, reject) => {
    const existingState = toolQueues.get(toolName);
    const state =
      existingState ??
      ({
        running: 0,
        lastStartedAt: 0,
        queue: [],
        timer: null,
        policy: normalizedPolicy,
      } satisfies ToolQueueState);

    state.policy = normalizedPolicy;
    toolQueues.set(toolName, state);

    const queuedRun: QueuedToolRun<unknown> = {
      operation,
      resolve: resolve as (value: unknown) => void,
      reject,
      onStatusChange,
      signal,
    };

    const abortHandler = () => {
      removeQueuedRun(state, queuedRun);
      reject(createAbortError());
      cleanupQueueIfIdle(toolName, state);
    };

    const canStartImmediately =
      state.running < normalizedPolicy.maxConcurrentRuns &&
      (!state.lastStartedAt ||
        normalizedPolicy.delayBetweenRunsMs <= 0 ||
        Date.now() - state.lastStartedAt >= normalizedPolicy.delayBetweenRunsMs) &&
      state.queue.length === 0;

    if (!canStartImmediately) {
      onStatusChange?.("pending");
    }

    state.queue.push(queuedRun);

    signal?.addEventListener("abort", abortHandler, { once: true });

    const cleanup = () => {
      signal?.removeEventListener("abort", abortHandler);
    };

    const originalResolve = queuedRun.resolve;
    const originalReject = queuedRun.reject;
    queuedRun.resolve = (value) => {
      cleanup();
      originalResolve(value);
    };
    queuedRun.reject = (error) => {
      cleanup();
      originalReject(error);
    };

    scheduleToolQueue(toolName);
  });
}
