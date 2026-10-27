import { describe, expect, it } from "vitest";
import {
  calculateDocumentChange,
  codeLanguageFromClassName,
  codePayload,
  filenameForLanguage,
  normalizeCodeLanguage,
  normalizeCodeMirrorLanguage,
} from "./code-rendering";

describe("code block metadata", () => {
  it("removes only the Markdown fence trailing newline", () => {
    expect(codePayload("const x = 1;\n")).toBe("const x = 1;");
    expect(codePayload("a\n\nb")).toBe("a\n\nb");
  });

  it("normalizes display aliases from the old renderer", () => {
    expect(normalizeCodeLanguage("TS")).toBe("typescript");
    expect(normalizeCodeLanguage("py")).toBe("python");
    expect(normalizeCodeLanguage("mmd")).toBe("mermaid");
    expect(normalizeCodeLanguage()).toBe("text");
  });

  it("normalizes CodeMirror language aliases separately", () => {
    expect(normalizeCodeMirrorLanguage("cs")).toBe("c#");
    expect(normalizeCodeMirrorLanguage("yml")).toBe("yaml");
    expect(normalizeCodeMirrorLanguage("text")).toBeUndefined();
  });

  it("derives useful download filenames", () => {
    expect(filenameForLanguage("typescript")).toBe("file.ts");
    expect(filenameForLanguage("python")).toBe("file.py");
    expect(filenameForLanguage("dockerfile")).toBe("Dockerfile");
    expect(filenameForLanguage("unknown-lang")).toBe("file.txt");
  });

  it("extracts fenced language classes without matching unrelated classes", () => {
    expect(codeLanguageFromClassName("foo language-ts bar")).toBe("ts");
    expect(codeLanguageFromClassName("language-python")).toBe("python");
    expect(codeLanguageFromClassName("foo bar")).toBeUndefined();
  });
});

describe("incremental CodeMirror document updates", () => {
  it("appends streaming content without replacing the whole document", () => {
    expect(calculateDocumentChange("abc", "abcdef")).toEqual({ from: 3, to: 3, insert: "def" });
  });

  it("handles truncation as one suffix deletion", () => {
    expect(calculateDocumentChange("abcdef", "abc")).toEqual({ from: 3, to: 6, insert: "" });
  });

  it("replaces only the changed middle region", () => {
    expect(calculateDocumentChange("hello OLD world", "hello NEW world")).toEqual({ from: 6, to: 9, insert: "NEW" });
  });

  it("handles completely different documents", () => {
    expect(calculateDocumentChange("abc", "xyz")).toEqual({ from: 0, to: 3, insert: "xyz" });
  });

  it("returns an empty edit for equal documents", () => {
    expect(calculateDocumentChange("same", "same")).toEqual({ from: 4, to: 4, insert: "" });
  });
});

describe("code rendering edge cases", () => {
  it.each([
    ["js", "javascript"],
    ["jsx", "jsx"],
    ["rs", "rust"],
    ["sh", "shell"],
    ["ps1", "powershell"],
    ["md", "markdown"],
  ])("normalizes display alias %s", (input, expected) => {
    expect(normalizeCodeLanguage(input)).toBe(expected);
  });

  it.each([
    ["js", "file.js"],
    ["tsx", "file.tsx"],
    ["yaml", "file.yaml"],
    ["ps1", "file.ps1"],
    ["mmd", "file.mmd"],
  ])("maps %s to a stable download filename", (input, expected) => {
    expect(filenameForLanguage(input)).toBe(expected);
  });

  it("preserves all but one terminal Markdown fence newline", () => {
    expect(codePayload("line\n\n")).toBe("line\n");
  });

  it("preserves a shared suffix when streamed text mutates near the start", () => {
    expect(calculateDocumentChange("aaa shared suffix", "bbb shared suffix")).toEqual({
      from: 0,
      to: 3,
      insert: "bbb",
    });
  });

  it("handles unicode content in incremental edits", () => {
    expect(calculateDocumentChange("const owl = '🦉';", "const owl = '🦉🦉';")).toEqual({
      from: 15,
      to: 15,
      insert: "🦉",
    });
  });
});
