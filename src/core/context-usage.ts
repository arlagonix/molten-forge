export type PiContextUsage = {
  tokens?: number | null;
  contextWindow?: number | null;
  percent?: number | null;
};

export type ResolvedContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  estimated: boolean;
};

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function contextEstimateAfterCompaction(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  return finiteNonNegative((result as { estimatedTokensAfter?: unknown }).estimatedTokensAfter);
}

export function resolveContextUsage(
  usage: PiContextUsage | null | undefined,
  modelContextWindow: number | null | undefined,
  postCompactionEstimate: number | null | undefined,
): ResolvedContextUsage {
  const contextWindow = finitePositive(usage?.contextWindow) ?? finitePositive(modelContextWindow) ?? 0;
  const authoritativeTokens = finiteNonNegative(usage?.tokens);

  if (authoritativeTokens !== null) {
    const reportedPercent = finiteNonNegative(usage?.percent);
    return {
      tokens: authoritativeTokens,
      contextWindow,
      percent: reportedPercent ?? (contextWindow > 0 ? (authoritativeTokens / contextWindow) * 100 : null),
      estimated: false,
    };
  }

  const estimatedTokens = finiteNonNegative(postCompactionEstimate);
  if (estimatedTokens !== null) {
    return {
      tokens: estimatedTokens,
      contextWindow,
      percent: contextWindow > 0 ? (estimatedTokens / contextWindow) * 100 : null,
      estimated: true,
    };
  }

  return {
    tokens: null,
    contextWindow,
    percent: null,
    estimated: false,
  };
}
