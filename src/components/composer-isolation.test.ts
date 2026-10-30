import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
const composerStart = appSource.indexOf("const Composer = memo(function Composer");
const appStart = appSource.indexOf("export default function App()");
const composerSource = appSource.slice(composerStart, appStart);
const rootAppSource = appSource.slice(appStart);

describe("composer render isolation", () => {
  it("keeps draft state inside the memoized Composer instead of root App", () => {
    expect(composerStart).toBeGreaterThanOrEqual(0);
    expect(composerSource).toContain('const [input, setInput] = useState("")');
    expect(composerSource).toContain("const [suggestionIndex, setSuggestionIndex] = useState(0)");
    expect(rootAppSource).not.toContain('const [input, setInput] = useState("")');
    expect(rootAppSource).not.toContain("setSuggestionIndex(");
  });

  it("keeps textarea typing updates local to Composer", () => {
    expect(composerSource).toContain("onChange={(event) => setInput(event.target.value)}");
    expect(rootAppSource).not.toContain("onChange={(event) => setInput(event.target.value)}");
    expect(rootAppSource).not.toContain("setInput(");
  });

  it("routes extension editor-text updates through an imperative composer ref", () => {
    expect(rootAppSource).toContain("composerDraftSetterRef.current(record.text ?? \"\")");
    expect(composerSource).toContain("draftSetterRef.current = setInput");
  });

  it("keeps command-menu navigation state local to Composer", () => {
    expect(composerSource).toContain("const commandMenuRef = useRef<HTMLDivElement | null>(null)");
    expect(composerSource).toContain("const suggestions = useMemo(() => {");
    expect(rootAppSource).not.toContain("commandMenuRef");
    expect(rootAppSource).not.toContain("const suggestions = useMemo(() => {");
  });

  it("keeps textarea auto-resize local to Composer", () => {
    expect(composerSource).toContain("const textareaRef = useRef<HTMLTextAreaElement | null>(null)");
    expect(composerSource).toContain('textarea.style.height = "auto"');
    expect(rootAppSource).not.toContain("composerTextareaRef");
  });

  it("keeps transcript rendering memoized independently of Composer", () => {
    expect(appSource).toContain("const TranscriptView = memo(function TranscriptView");
    expect(appSource).toContain("const MemoTranscriptTurn = memo(");
    expect(rootAppSource).toContain("<Composer");
  });

  it("routes Composer stop through the lifecycle-safe interrupt handler", () => {
    expect(rootAppSource).toMatch(/onAbort=\{async \(\) => \{\s*await interruptGeneration\(\);\s*\}\}/);
    expect(rootAppSource).not.toMatch(/onAbort=\{[^}]*sendRecord\(\{ type: "abort"/);
  });
});
