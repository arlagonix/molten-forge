import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
  type LanguageSupport,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
  calculateDocumentChange,
  normalizeCodeMirrorLanguage,
} from "../core/code-rendering";

type ReadOnlyCodeViewerProps = {
  code: string;
  language?: string;
  wrapped: boolean;
  syntaxHighlight?: boolean;
  className?: string;
  ariaLabel?: string;
  lineNumbers?: boolean;
  lineNumberStart?: number;
};

export const codeHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: "var(--code-comment)" },
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier, tags.definitionKeyword, tags.moduleKeyword], color: "var(--code-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--code-number)" },
  { tag: [tags.heading, tags.labelName, tags.className, tags.typeName, tags.standard(tags.typeName), tags.namespace, tags.macroName], color: "var(--code-title)" },
  { tag: [tags.propertyName, tags.attributeName, tags.variableName, tags.definition(tags.variableName)], color: "var(--code-attr)" },
  { tag: [tags.function(tags.variableName), tags.standard(tags.variableName), tags.atom], color: "var(--code-built-in)" },
  { tag: tags.operator, color: "var(--pi-syntax-operator)" },
  { tag: tags.punctuation, color: "var(--pi-syntax-punctuation)" },
]);

const codeViewerTheme = EditorView.theme({
  "&": {
    width: "100%",
    maxWidth: "100%",
    backgroundColor: "transparent",
    color: "var(--code-fg)",
    fontSize: "var(--code-viewer-font-size, 0.875rem)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--app-font-code)",
    lineHeight: "var(--code-viewer-line-height, 1.25rem)",
    overflow: "auto",
  },
  ".cm-content": {
    minWidth: "100%",
    padding: "0.75rem 0",
    caretColor: "transparent",
  },
  ".cm-line": { padding: "0 0.75rem" },
  ".cm-gutters": {
    // CodeMirror keeps gutters sticky while the content scrolls horizontally.
    // They must be opaque or scrolled code remains visible underneath them.
    backgroundColor: "var(--code-bg)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
    userSelect: "none",
    zIndex: "3",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "3.25rem",
    padding: "0 0.625rem 0 0.5rem",
  },
  ".cm-content ::selection": {
    backgroundColor: "var(--code-editor-selection-background)",
    color: "var(--code-fg)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--code-editor-selection-background)",
  },
});

const languageCache = new Map<string, Promise<LanguageSupport | null>>();

export function loadCodeMirrorLanguage(language?: string) {
  const normalized = normalizeCodeMirrorLanguage(language);
  if (!normalized || normalized === "mermaid") return Promise.resolve<LanguageSupport | null>(null);
  const cached = languageCache.get(normalized);
  if (cached) return cached;

  const description = LanguageDescription.matchLanguageName(languages, normalized, true);
  const promise = description
    ? description.load().catch((error: unknown) => {
        console.warn(`Failed to load CodeMirror language "${normalized}":`, error);
        return null;
      })
    : Promise.resolve<LanguageSupport | null>(null);
  languageCache.set(normalized, promise);
  return promise;
}

export function ReadOnlyCodeViewer({
  code,
  language,
  wrapped,
  syntaxHighlight = true,
  className,
  ariaLabel = "Code block",
  lineNumbers = false,
  lineNumberStart = 1,
}: ReadOnlyCodeViewerProps) {
  if (import.meta.env.MODE === "test") {
    return (
      <pre
        className={`chat-code-viewer chat-code-viewer-test-fallback ${wrapped ? "chat-code-pre-wrap" : "chat-code-pre-nowrap"} ${className ?? ""}`.trim()}
        data-language={language || undefined}
        aria-label={ariaLabel}
      >
        {code}
      </pre>
    );
  }

  return (
    <CodeMirrorCodeViewer
      code={code}
      language={language}
      wrapped={wrapped}
      syntaxHighlight={syntaxHighlight}
      className={className}
      ariaLabel={ariaLabel}
      lineNumbers={lineNumbers}
      lineNumberStart={lineNumberStart}
    />
  );
}

function CodeMirrorCodeViewer({
  code,
  language,
  wrapped,
  syntaxHighlight = true,
  className,
  ariaLabel = "Code block",
  lineNumbers: showLineNumbers = false,
  lineNumberStart = 1,
}: ReadOnlyCodeViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codeRef = useRef(code);
  const appliedCodeRef = useRef(code);
  const languageCompartmentRef = useRef(new Compartment());
  const wrappingCompartmentRef = useRef(new Compartment());
  codeRef.current = code;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const languageCompartment = languageCompartmentRef.current;
    const wrappingCompartment = wrappingCompartmentRef.current;
    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of({
        "aria-label": ariaLabel,
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      codeViewerTheme,
      syntaxHighlighting(codeHighlightStyle, { fallback: true }),
      languageCompartment.of([]),
      wrappingCompartment.of(wrapped ? EditorView.lineWrapping : []),
      ...(showLineNumbers
        ? [lineNumbers({
            formatNumber(lineNo) {
              return String(lineNo + Math.max(1, Math.floor(lineNumberStart)) - 1);
            },
          })]
        : []),
    ];

    const initialCode = codeRef.current;
    const view = new EditorView({
      state: EditorState.create({ doc: initialCode, extensions }),
      parent: container,
    });
    viewRef.current = view;
    appliedCodeRef.current = initialCode;

    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [ariaLabel, lineNumberStart, showLineNumbers]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrappingCompartmentRef.current.reconfigure(wrapped ? EditorView.lineWrapping : []),
    });
  }, [wrapped]);

  useEffect(() => {
    let cancelled = false;
    const view = viewRef.current;
    if (!view) return;

    if (!syntaxHighlight) {
      view.dispatch({ effects: languageCompartmentRef.current.reconfigure([]) });
      return;
    }

    void loadCodeMirrorLanguage(language).then((support) => {
      if (cancelled || viewRef.current !== view) return;
      view.dispatch({ effects: languageCompartmentRef.current.reconfigure(support ?? []) });
    });

    return () => { cancelled = true; };
  }, [ariaLabel, language, syntaxHighlight]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = appliedCodeRef.current;
    if (currentValue === code) return;
    view.dispatch({ changes: calculateDocumentChange(currentValue, code) });
    appliedCodeRef.current = code;
  }, [code]);

  return (
    <div
      ref={containerRef}
      className={`chat-code-viewer ${className ?? ""}`.trim()}
      data-language={language || undefined}
    />
  );
}
