import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PREVIEW_MAX_CHARS,
  cleanActivityPreviewLine,
  firstActivityPreviewLine,
  lastActivityPreviewLine,
  rollingActivityPreview,
  tailActivityPreview,
} from "./activity-preview";

describe("live activity previews", () => {
  it("concatenates recent meaningful rows into one live train", () => {
    expect(rollingActivityPreview("first row\nsecond row\ncurrent", {}, 200)).toBe("first row · second row · current");
  });

  it("drops the oldest train content without inserting a literal ellipsis", () => {
    const preview = rollingActivityPreview("0123456789\nabcdefghij", {}, 12);
    expect(preview).toBe(" · abcdefghij".slice(-12));
    expect(preview.startsWith("…")).toBe(false);
  });
  it("keeps a useful tail of the currently generated row", () => {
    expect(tailActivityPreview("abcdefghijklmnopqrstuvwxyz", 8)).toBe("…tuvwxyz");
  });

  it("leaves short live rows unchanged", () => {
    expect(tailActivityPreview("npm test", ACTIVITY_PREVIEW_MAX_CHARS)).toBe("npm test");
  });

  it("finds first and last meaningful tool rows", () => {
    const input = "{\n  \"path\": \"src/App.tsx\",\n  \"content\": \"hello\"\n}";
    expect(firstActivityPreviewLine(input, { skipStructuralOnly: true })).toBe('"path": "src/App.tsx",');
    expect(lastActivityPreviewLine(input, { skipStructuralOnly: true })).toBe('"content": "hello"');
  });

  it("removes the shell prompt marker from bash previews", () => {
    expect(cleanActivityPreviewLine("$ npm run test", { stripShellPrompt: true })).toBe("npm run test");
  });
});
