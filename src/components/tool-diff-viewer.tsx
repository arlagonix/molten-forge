import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  type DecorationSet,
} from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import {
  diffSummary,
  inlineDiffPairs,
  languageFromFilePath,
  type InlineDiffSpan,
  type ToolDiff,
  type ToolDiffLine,
} from "../core/tool-diff";
import { codeHighlightStyle, loadCodeMirrorLanguage } from "./code-viewer";
import { ToolTextViewer } from "./tool-text-viewer";

type SourceDisplayRow = {
  kind: "source";
  text: string;
  line: ToolDiffLine;
  inlineSpans?: InlineDiffSpan[];
};

type GapDisplayRow = {
  kind: "gap";
  text: string;
};

type DisplayRow = SourceDisplayRow | GapDisplayRow;

class DiffLineMarker extends GutterMarker {
  constructor(
    private oldLine: number | undefined,
    private newLine: number | undefined,
    private type: "context" | "remove" | "add" | "gap",
  ) {
    super();
  }

  toDOM() {
    const root = document.createElement("span");
    root.className = `tool-diff-gutter-marker ${this.type}`;
    const oldNumber = document.createElement("span");
    oldNumber.className = "tool-diff-old-line";
    oldNumber.textContent = this.oldLine === undefined ? "" : String(this.oldLine);
    const newNumber = document.createElement("span");
    newNumber.className = "tool-diff-new-line";
    newNumber.textContent = this.newLine === undefined ? "" : String(this.newLine);
    const sign = document.createElement("span");
    sign.className = "tool-diff-sign";
    sign.textContent = this.type === "remove" ? "−" : this.type === "add" ? "+" : "";
    root.append(oldNumber, newNumber, sign);
    return root;
  }
}

function gapLabel(count: number) {
  return `⋯ ${count} unchanged ${count === 1 ? "line" : "lines"}`;
}

function buildDisplayRows(diff: ToolDiff): DisplayRow[] {
  const rows: DisplayRow[] = [];

  for (const hunk of diff.hunks) {
    if (hunk.skippedBefore > 0) rows.push({ kind: "gap", text: gapLabel(hunk.skippedBefore) });

    const pairs = inlineDiffPairs(hunk.lines);
    const pairByRemove = new Map(pairs.map((pair) => [pair.removeIndex, pair.removed]));
    const pairByAdd = new Map(pairs.map((pair) => [pair.addIndex, pair.added]));

    hunk.lines.forEach((line, index) => {
      rows.push({
        kind: "source",
        text: line.text,
        line,
        inlineSpans: line.type === "remove"
          ? pairByRemove.get(index)
          : line.type === "add"
            ? pairByAdd.get(index)
            : undefined,
      });
    });
  }

  if ((diff.skippedAfter ?? 0) > 0) rows.push({ kind: "gap", text: gapLabel(diff.skippedAfter ?? 0) });
  return rows;
}

function buildDiffDecorations(rows: DisplayRow[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  let lineStart = 0;

  rows.forEach((row, index) => {
    if (row.kind === "gap") {
      ranges.push(Decoration.line({ class: "tool-diff-line tool-diff-line-gap" }).range(lineStart));
    } else {
      ranges.push(Decoration.line({ class: `tool-diff-line tool-diff-line-${row.line.type}` }).range(lineStart));
      if (row.inlineSpans) {
        for (const span of row.inlineSpans) {
          if (span.to > span.from) {
            ranges.push(
              Decoration.mark({ class: `tool-diff-inline tool-diff-inline-${row.line.type}` })
                .range(lineStart + span.from, lineStart + span.to),
            );
          }
        }
      }
    }
    lineStart += row.text.length + (index < rows.length - 1 ? 1 : 0);
  });

  return Decoration.set(ranges, true);
}

function DiffEditor({ diff, language }: { diff: ToolDiff; language: string }) {
  const rows = useMemo(() => buildDisplayRows(diff), [diff]);

  if (import.meta.env.MODE === "test") {
    return (
      <pre className="tool-diff-test-fallback" data-language={language}>
        {rows.map((row) => row.kind === "gap"
          ? `\t\tgap\t${row.text}`
          : `${row.line.oldLine ?? ""}\t${row.line.newLine ?? ""}\t${row.line.type}\t${row.text}`).join("\n")}
      </pre>
    );
  }

  return <CodeMirrorDiffEditor rows={rows} language={language} />;
}

function CodeMirrorDiffEditor({ rows, language }: { rows: DisplayRow[]; language: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !rows.length) return;
    const doc = rows.map((row) => row.text).join("\n");
    const languageCompartment = new Compartment();
    const decorations = buildDiffDecorations(rows);
    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({
        "aria-label": "File diff",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      syntaxHighlighting(codeHighlightStyle, { fallback: true }),
      languageCompartment.of([]),
      EditorView.decorations.of(decorations),
      EditorView.lineWrapping,
      gutter({
        class: "tool-diff-gutter",
        lineMarker(view, line) {
          const number = view.state.doc.lineAt(line.from).number;
          const row = rows[number - 1];
          if (!row) return null;
          if (row.kind === "gap") return new DiffLineMarker(undefined, undefined, "gap");
          return new DiffLineMarker(row.line.oldLine, row.line.newLine, row.line.type);
        },
      }),
      EditorView.theme({
        "&": {
          width: "100%",
          maxWidth: "100%",
          backgroundColor: "transparent",
          color: "var(--code-fg)",
          fontSize: "0.8125rem",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": {
          fontFamily: "var(--app-font-code)",
          lineHeight: "1.34rem",
          overflowX: "hidden",
          overflowY: "hidden",
        },
        ".cm-content": {
          minWidth: "0",
          maxWidth: "100%",
          padding: "0",
          caretColor: "transparent",
        },
        ".cm-line": {
          minHeight: "1.34rem",
          padding: "0 10px",
          overflowWrap: "anywhere",
        },
        ".cm-gutters": {
          border: "0",
          backgroundColor: "transparent",
          color: "inherit",
        },
        ".cm-gutterElement": { padding: "0" },
        ".cm-content ::selection": { backgroundColor: "var(--code-editor-selection-background)" },
        ".cm-selectionBackground": { backgroundColor: "var(--code-editor-selection-background)" },
      }),
    ];

    const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent: container });
    let cancelled = false;
    void loadCodeMirrorLanguage(language).then((support) => {
      if (cancelled || !support) return;
      view.dispatch({ effects: languageCompartment.reconfigure(support) });
    });

    return () => {
      cancelled = true;
      view.destroy();
    };
  }, [language, rows]);

  return <div ref={containerRef} className="tool-diff-editor" />;
}


export function ToolWriteContentViewer({ path, content }: { path: string; content: string }) {
  return (
    <div className="tool-diff-viewer tool-write-content-viewer" data-kind="write-content-fallback">
      <div className="tool-diff-notice">Previous file state unavailable; showing written content.</div>
      <ToolTextViewer
        text={content}
        toolName="write"
        filePath={path}
        lineNumbers
        lineNumberStart={1}
        ariaLabel="Written file content"
        className="tool-write-content-editor"
      />
    </div>
  );
}

export function ToolDiffViewer({ diff }: { diff: ToolDiff }) {
  const language = languageFromFilePath(diff.path);
  const notices = [
    diff.lineEndingChange ? `Line endings: ${diff.lineEndingChange}` : "",
    diff.finalNewlineChange ? `Final newline ${diff.finalNewlineChange}` : "",
  ].filter(Boolean);

  return (
    <div className="tool-diff-viewer" data-kind={diff.kind}>
      {diff.kind === "preview" && <div className="tool-diff-notice">Line numbers and surrounding context appear after the edit is applied.</div>}
      {diff.executionError && diff.applied && <div className="tool-diff-notice warning">The file changed, but Pi reported an error after the operation.</div>}
      {notices.map((notice) => <div className="tool-diff-notice" key={notice}>{notice}</div>)}
      {!diff.truncated && !diff.hunks.length && !notices.length && (
        <div className="tool-diff-notice">{diff.kind === "create" ? "New empty file." : "No textual changes."}</div>
      )}
      {diff.truncated && !diff.hunks.length ? (
        <div className="tool-diff-too-large">Diff is too large or complex to render compactly · {diffSummary(diff)}</div>
      ) : diff.hunks.length ? (
        <DiffEditor diff={diff} language={language} />
      ) : null}
    </div>
  );
}
