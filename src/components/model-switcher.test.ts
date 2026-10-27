import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
const switcherSource = readFileSync(fileURLToPath(new URL("./model-switcher.tsx", import.meta.url)), "utf8");

describe("model switcher integration contracts", () => {
  it("renders the current model as an interactive switcher rather than plain text", () => {
    expect(appSource).toContain("<ModelSwitcher");
    expect(appSource).not.toContain('<span className="composer-model"');
  });

  it("refreshes available models silently when the picker opens", () => {
    expect(appSource).toMatch(/get_available_models" \}, \{ silent: true \}/);
    expect(switcherSource).toContain("if (next) void onRefreshModels()");
  });

  it("switches through set_model silently so no chat block is generated", () => {
    expect(appSource).toMatch(/sendRecordAndWait\(createSetModelRecord\(model\), \{ silent: true \}\)/);
    expect(switcherSource).not.toContain("submitRaw");
    expect(switcherSource).not.toContain("append(");
  });

  it("keeps the existing response renderer silent for silent set_model requests", () => {
    expect(appSource).toMatch(/if \(record\.command === "set_model"\)[\s\S]*?if \(!wasSilent\) \{[\s\S]*?title: "model"/);
  });

  it("keeps picker open/close state local to the memoized ModelSwitcher", () => {
    expect(switcherSource).toContain("export const ModelSwitcher = memo(function ModelSwitcher");
    expect(switcherSource).toContain("const [open, setOpen] = useState(false)");
    expect(appSource).not.toContain("const [modelOpen, setModelOpen]");
  });


  it("keeps search state local and filters before provider grouping", () => {
    expect(switcherSource).toContain('const [query, setQuery] = useState("")');
    expect(switcherSource).toContain("filterModels(models, query)");
    expect(switcherSource).toContain('placeholder="Search models"');
    expect(appSource).not.toContain("const [modelSearch");
  });

  it("renders compact one-line model rows without friendly-name descriptions", () => {
    expect(switcherSource).toContain('className="model-option-id"');
    expect(switcherSource).not.toContain("<small>{model.name}</small>");
    expect(switcherSource).not.toContain('className="model-option-copy"');
  });

  it("resets search after the picker closes", () => {
    expect(switcherSource).toMatch(/if \(!open\) \{[\s\S]*?if \(query\) setQuery\(""\)/);
  });

  it("groups rendered options under provider headings", () => {
    expect(switcherSource).toContain("groupModelsByProvider(filteredModels)");
    expect(switcherSource).toContain('className="model-provider-heading"');
  });


  it("selects the highlighted model when Enter is pressed in search", () => {
    expect(switcherSource).toContain('event.key === "Enter"');
    expect(switcherSource).toContain("selectHighlighted()");
    expect(switcherSource).toContain("highlightedKey === key");
  });

  it("supports ArrowUp and ArrowDown keyboard highlight navigation", () => {
    expect(switcherSource).toContain('event.key === "ArrowDown"');
    expect(switcherSource).toContain("moveHighlight(1)");
    expect(switcherSource).toContain('event.key === "ArrowUp"');
    expect(switcherSource).toContain("moveHighlight(-1)");
  });

  it("keeps the keyboard-highlighted option visible while arrowing through long lists", () => {
    expect(switcherSource).toContain("const listRef = useRef<HTMLDivElement | null>(null)");
    expect(switcherSource).toContain("const optionRefs = useRef(new Map<string, HTMLButtonElement>())");
    expect(switcherSource).toContain("highlightedOptionScrollDelta(");
    expect(switcherSource).toContain("list.scrollTop += delta");
    expect(switcherSource).toContain("requestAnimationFrame(() =>");
  });

  it("does not scroll the list merely because pointer hover changes highlight", () => {
    expect(switcherSource).toContain("onMouseEnter={() => setHighlightedKey(key)}");
    expect(switcherSource).not.toMatch(/onMouseEnter={[\s\S]{0,120}scrollTop/);
  });

  it("lets pointer hover update the same highlight used by Enter", () => {
    expect(switcherSource).toContain("onMouseEnter={() => setHighlightedKey(key)}");
    expect(switcherSource).toContain('highlighted ? "highlighted" : ""');
  });

  it("closes on Escape and outside pointer input", () => {
    expect(switcherSource).toContain('if (event.key === "Escape") setOpen(false)');
    expect(switcherSource).toContain('document.addEventListener("pointerdown", onPointerDown)');
  });
});
