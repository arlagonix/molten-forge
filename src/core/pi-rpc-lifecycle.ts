export type PiRuntimeSnapshot = {
  busy: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  pendingMessageCount: number;
};

export type ExtensionWidgetUpdate = {
  key: string;
  placement: "aboveEditor" | "belowEditor";
  lines: string[] | null;
};

export function piRuntimeSnapshot(data: unknown): PiRuntimeSnapshot {
  if (!data || typeof data !== "object") {
    return { busy: false, isStreaming: false, isCompacting: false, pendingMessageCount: 0 };
  }
  const record = data as Record<string, unknown>;
  const rawPending = typeof record.pendingMessageCount === "number"
    ? record.pendingMessageCount
    : Number(record.pendingMessageCount ?? 0);
  const pendingMessageCount = Number.isFinite(rawPending) ? Math.max(0, rawPending) : 0;
  const isStreaming = record.isStreaming === true;
  const isCompacting = record.isCompacting === true;
  return {
    busy: isStreaming || isCompacting || pendingMessageCount > 0,
    isStreaming,
    isCompacting,
    pendingMessageCount,
  };
}

export function extensionUiBlocksAgent(method: unknown): boolean {
  return method === "select" || method === "confirm" || method === "input" || method === "editor";
}

export function normalizeExtensionWidget(record: unknown): ExtensionWidgetUpdate | null {
  if (!record || typeof record !== "object") return null;
  const value = record as Record<string, unknown>;
  const key = typeof value.widgetKey === "string" ? value.widgetKey.trim() : "";
  if (!key) return null;
  const placement = value.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor";
  if (!Array.isArray(value.widgetLines)) return { key, placement, lines: null };
  return {
    key,
    placement,
    lines: value.widgetLines.filter((line): line is string => typeof line === "string"),
  };
}
