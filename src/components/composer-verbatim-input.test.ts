import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = fs.readFileSync(path.resolve("src/styles.css"), "utf8");
const app = fs.readFileSync(path.resolve("src/App.tsx"), "utf8");

describe("literal composer punctuation", () => {
  it("disables discretionary font glyph substitution in the composer", () => {
    expect(styles).toMatch(/\.composer textarea\s*\{[^}]*font-variant-ligatures:\s*none/);
    expect(styles).toMatch(/\.composer textarea\s*\{[^}]*font-feature-settings:[^}]*"liga" 0[^}]*"calt" 0/);
  });

  it("does not rewrite repeated punctuation on textarea input", () => {
    expect(app).toContain('onChange={(event) => setInput(event.target.value)}');
  });
});
