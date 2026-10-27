import { describe, expect, it } from "vitest";
import type { CommandInfo } from "./chat-logic";
import { formatPiStartupVersion, piStartupSections } from "./pi-startup";

describe("Pi startup welcome", () => {
  it("formats the detected runtime like Pi's interactive header", () => {
    expect(formatPiStartupVersion("0.87.1")).toBe("pi v0.87.1");
    expect(formatPiStartupVersion("v0.87.1")).toBe("pi v0.87.1");
    expect(formatPiStartupVersion("pi v0.87.1")).toBe("pi v0.87.1");
    expect(formatPiStartupVersion("Pi detected")).toBe("pi");
    expect(formatPiStartupVersion(null)).toBe("pi");
  });

  it("mirrors Pi's compact loaded-resource sections from RPC-discoverable commands", () => {
    const commands: CommandInfo[] = [
      { name: "skill:slides-for-telegram", source: "skill" },
      { name: "skill:find-skills", source: "skill" },
      { name: "cover", source: "prompt" },
      {
        name: "calc",
        source: "extension",
        sourceInfo: { path: "C:\\Users\\Acer\\.pi\\agent\\extensions\\calculator-tool\\index.ts" },
      },
      {
        name: "calc-more",
        source: "extension",
        sourceInfo: { path: "C:\\Users\\Acer\\.pi\\agent\\extensions\\calculator-tool\\index.ts" },
      },
    ];

    expect(piStartupSections(commands)).toEqual([
      { title: "Skills", items: ["find-skills", "slides-for-telegram"] },
      { title: "Prompts", items: ["/cover"] },
      { title: "Extensions", items: ["calculator-tool"] },
    ]);
  });

  it("falls back to the command name when RPC provenance has no extension path", () => {
    expect(piStartupSections([{ name: "hello", source: "extension" }])).toEqual([
      { title: "Extensions", items: ["hello"] },
    ]);
  });
});
