import { describe, expect, it } from "vitest";
import {
  createSetModelRecord,
  filterModels,
  findModelMatch,
  groupModelsByProvider,
  isSameModel,
  highlightedOptionScrollDelta,
  modelKey,
  stepHighlightedModel,
  type ModelOption,
} from "./model-switcher";

const models: ModelOption[] = [
  { provider: "openai", id: "gpt-5", name: "GPT 5" },
  { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
  { provider: "openai", id: "gpt-4.1", name: "GPT 4.1" },
  { provider: "local", id: "qwen3.5-9b" },
];

describe("model switcher logic", () => {
  it("builds an exact provider/model identity", () => {
    expect(modelKey(models[0])).toBe("openai/gpt-5");
    expect(modelKey(null)).toBe("");
  });

  it("compares provider and id rather than display name", () => {
    expect(isSameModel({ provider: "openai", id: "gpt-5", name: "A" }, { provider: "openai", id: "gpt-5", name: "B" })).toBe(true);
    expect(isSameModel({ provider: "openai", id: "gpt-5" }, { provider: "other", id: "gpt-5" })).toBe(false);
  });


  it("filters models by model id", () => {
    expect(filterModels(models, "gpt-4").map((model) => model.id)).toEqual(["gpt-4.1"]);
  });

  it("filters models by provider", () => {
    expect(filterModels(models, "openai").map((model) => model.id)).toEqual(["gpt-5", "gpt-4.1"]);
  });

  it("filters models by full provider/id key", () => {
    expect(filterModels(models, "LOCAL/QWEN3.5").map((model) => model.id)).toEqual(["qwen3.5-9b"]);
  });

  it("search is case-insensitive, trims whitespace, and preserves all models for an empty query", () => {
    expect(filterModels(models, "  GPT-5 ")).toEqual([models[0]]);
    expect(filterModels(models, "   ")).toBe(models);
  });

  it("does not search hidden friendly-name descriptions", () => {
    expect(filterModels(models, "Claude Sonnet")).toEqual([]);
  });

  it("groups models by provider", () => {
    const groups = groupModelsByProvider(models);
    expect(groups.map((group) => group.provider)).toEqual(["anthropic", "local", "openai"]);
    expect(groups.find((group) => group.provider === "openai")?.models).toHaveLength(2);
  });

  it("sorts models inside each provider without changing the source array", () => {
    const source = models.slice();
    const groups = groupModelsByProvider(source);
    expect(groups.find((group) => group.provider === "openai")?.models.map((model) => model.id)).toEqual(["gpt-4.1", "gpt-5"]);
    expect(source).toEqual(models);
  });

  it("deduplicates exact provider/id pairs", () => {
    const groups = groupModelsByProvider([...models, { provider: "openai", id: "gpt-5", name: "Duplicate" }]);
    expect(groups.find((group) => group.provider === "openai")?.models.filter((model) => model.id === "gpt-5")).toHaveLength(1);
  });

  it("drops incomplete model records rather than rendering empty groups", () => {
    const groups = groupModelsByProvider([
      ...models,
      { provider: "", id: "broken" },
      { provider: "broken", id: "" },
    ]);
    expect(groups.some((group) => group.provider === "broken")).toBe(false);
  });

  it("resolves slash-command matches by full key, id, or display name", () => {
    expect(findModelMatch(models, "openai/gpt-5")?.id).toBe("gpt-5");
    expect(findModelMatch(models, "QWEN3.5-9B")?.provider).toBe("local");
    expect(findModelMatch(models, "claude sonnet")?.id).toBe("claude-sonnet");
  });

  it("does not resolve an empty or unknown model query", () => {
    expect(findModelMatch(models, "")).toBeUndefined();
    expect(findModelMatch(models, "missing")).toBeUndefined();
  });


  it("moves the keyboard highlight down and wraps at the end", () => {
    expect(stepHighlightedModel(models, null, 1)).toEqual(models[0]);
    expect(stepHighlightedModel(models, modelKey(models[0]), 1)).toEqual(models[1]);
    expect(stepHighlightedModel(models, modelKey(models.at(-1)), 1)).toEqual(models[0]);
  });

  it("moves the keyboard highlight up and wraps at the start", () => {
    expect(stepHighlightedModel(models, null, -1)).toEqual(models.at(-1));
    expect(stepHighlightedModel(models, modelKey(models[1]), -1)).toEqual(models[0]);
    expect(stepHighlightedModel(models, modelKey(models[0]), -1)).toEqual(models.at(-1));
  });

  it("returns no highlighted model for an empty visible list", () => {
    expect(stepHighlightedModel([], null, 1)).toBeUndefined();
    expect(stepHighlightedModel([], "missing/model", -1)).toBeUndefined();
  });

  it("does not scroll when the highlighted option is fully visible below the sticky heading", () => {
    expect(highlightedOptionScrollDelta(
      { top: 100, bottom: 400 },
      { top: 150, bottom: 180 },
      30,
    )).toBe(0);
  });

  it("scrolls upward enough to clear the sticky provider heading", () => {
    expect(highlightedOptionScrollDelta(
      { top: 100, bottom: 400 },
      { top: 115, bottom: 145 },
      30,
    )).toBe(-15);
  });

  it("scrolls downward only by the overflow beyond the list viewport", () => {
    expect(highlightedOptionScrollDelta(
      { top: 100, bottom: 400 },
      { top: 390, bottom: 425 },
      30,
    )).toBe(25);
  });

  it("clamps a negative sticky-heading clearance to zero", () => {
    expect(highlightedOptionScrollDelta(
      { top: 100, bottom: 400 },
      { top: 95, bottom: 125 },
      -20,
    )).toBe(-5);
  });

  it("creates the same set_model RPC shape used by /model", () => {
    expect(createSetModelRecord(models[0])).toEqual({
      type: "set_model",
      provider: "openai",
      modelId: "gpt-5",
    });
  });
});
