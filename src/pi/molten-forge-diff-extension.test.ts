import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import moltenForgeDiffExtension, { buildFileDiff, diffLineOperations } from "./molten-forge-diff-extension";

describe("Molten Forge Pi diff extension", () => {
  it("keeps a tiny change in a huge file to three lines of context", () => {
    const before = Array.from({ length: 10000 }, (_, index) => `line ${index + 1}`);
    const after = [...before];
    after[4999] = "line five thousand changed";

    const diff = buildFileDiff("huge.ts", `${before.join("\n")}\n`, `${after.join("\n")}\n`);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].lines.map((line: any) => line.oldLine ?? line.newLine)).toEqual([4997, 4998, 4999, 5000, 5000, 5001, 5002, 5003]);
    expect(diff.hunks[0].skippedBefore).toBe(4996);
    expect(diff.skippedAfter).toBe(4997);
  });

  it("splits distant edits into separate hunks", () => {
    const before = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`);
    const after = [...before];
    after[9] = "ten changed";
    after[39] = "forty changed";
    const diff = buildFileDiff("file.txt", before.join("\n"), after.join("\n"));
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[1].skippedBefore).toBeGreaterThan(0);
  });

  it("marks a new file as additions", () => {
    const diff = buildFileDiff("new.ts", null, "one\ntwo\n");
    expect(diff.kind).toBe("create");
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(0);
    expect(diff.hunks[0].lines.every((line: any) => line.type === "add")).toBe(true);
  });

  it("reports newline-only changes without inventing changed source lines", () => {
    const diff = buildFileDiff("file.txt", "a\r\nb\r\n", "a\nb\n");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.lineEndingChange).toBe("CRLF → LF");
  });

  it("tracks a final-newline-only change without fake source rows", () => {
    const diff = buildFileDiff("file.txt", "a\n", "a");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.finalNewlineChange).toBe("removed");
  });

  it("reports mixed line-ending normalization explicitly", () => {
    const diff = buildFileDiff("file.txt", "a\r\nb\nc\r", "a\nb\nc\n");
    expect(diff.lineEndingChange).toBe("MIXED → LF");
  });

  it("does not persist enormous changed lines such as minified files", () => {
    const before = `const payload = "${"a".repeat(120_000)}";`;
    const after = `const payload = "${"b".repeat(120_000)}";`;
    const diff = buildFileDiff("bundle.js", before, after);
    expect(diff.truncated).toBe(true);
    expect(diff.hunks).toHaveLength(0);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
  });

  it("falls back instead of running an unbounded expensive rewrite diff", () => {
    const oldLines = Array.from({ length: 1000 }, (_, index) => `old ${index}`);
    const newLines = Array.from({ length: 1000 }, (_, index) => `new ${index}`);
    expect(diffLineOperations(oldLines, newLines, 10)).toBeNull();
    const diff = buildFileDiff("rewrite.ts", oldLines.join("\n"), newLines.join("\n"), { maxDistance: 10 });
    expect(diff.truncated).toBe(true);
    expect(diff.exactLineDiff).toBe(false);
    expect(diff.hunks).toHaveLength(0);
  });

  it("captures write state before mutation and persists only the compact result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "molten-forge-diff-"));
    const file = join(directory, "server.ts");
    const before = "const timeout = 5000;\nconst keep = true;\n";
    const after = "const timeout = 10000;\nconst keep = true;\n";
    await writeFile(file, before, "utf8");

    const handlers = new Map<string, (event: any, ctx?: any) => Promise<any>>();
    moltenForgeDiffExtension({ on: (name: string, handler: any) => handlers.set(name, handler) });
    const call = { toolName: "write", toolCallId: "write-1", input: { path: "server.ts", content: after } };

    try {
      await handlers.get("tool_call")!(call, { cwd: directory });
      await writeFile(file, after, "utf8");
      const result = await handlers.get("tool_result")!({ ...call, details: undefined, isError: false });
      expect(await readFile(file, "utf8")).toBe(after);
      expect(result.details.moltenForgeDiff.added).toBe(1);
      expect(result.details.moltenForgeDiff.removed).toBe(1);
      expect(JSON.stringify(result.details)).not.toContain(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not manufacture a diff when a failed write did not reach disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "molten-forge-diff-fail-"));
    const file = join(directory, "server.ts");
    await writeFile(file, "before\n", "utf8");
    const handlers = new Map<string, (event: any, ctx?: any) => Promise<any>>();
    moltenForgeDiffExtension({ on: (name: string, handler: any) => handlers.set(name, handler) });
    const call = { toolName: "write", toolCallId: "write-fail", input: { path: "server.ts", content: "after\n" } };

    try {
      await handlers.get("tool_call")!(call, { cwd: directory });
      const result = await handlers.get("tool_result")!({ ...call, details: {}, isError: true });
      expect(result).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a diff when write reached disk before Pi reported an error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "molten-forge-diff-late-error-"));
    const file = join(directory, "server.ts");
    await writeFile(file, "before\n", "utf8");
    const handlers = new Map<string, (event: any, ctx?: any) => Promise<any>>();
    moltenForgeDiffExtension({ on: (name: string, handler: any) => handlers.set(name, handler) });
    const call = { toolName: "write", toolCallId: "write-late-error", input: { path: "server.ts", content: "after\n" } };

    try {
      await handlers.get("tool_call")!(call, { cwd: directory });
      await writeFile(file, "after\n", "utf8");
      const result = await handlers.get("tool_result")!({ ...call, details: {}, isError: true });
      expect(result.details.moltenForgeDiff.applied).toBe(true);
      expect(result.details.moltenForgeDiff.executionError).toBe(true);
      expect(result.details.moltenForgeDiff.added).toBe(1);
      expect(result.details.moltenForgeDiff.removed).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not show a failed edit preview when the file stayed unchanged", async () => {
    const directory = await mkdtemp(join(tmpdir(), "molten-forge-edit-fail-"));
    const file = join(directory, "server.ts");
    await writeFile(file, "before\n", "utf8");
    const handlers = new Map<string, (event: any, ctx?: any) => Promise<any>>();
    moltenForgeDiffExtension({ on: (name: string, handler: any) => handlers.set(name, handler) });
    const call = { toolName: "edit", toolCallId: "edit-fail", input: { path: "server.ts", oldText: "missing", newText: "after" } };

    try {
      await handlers.get("tool_call")!(call, { cwd: directory });
      const result = await handlers.get("tool_result")!({ ...call, details: {}, isError: true });
      expect(result).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the actual before/after diff when a failed edit changed the file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "molten-forge-edit-late-error-"));
    const file = join(directory, "server.ts");
    await writeFile(file, "before\n", "utf8");
    const handlers = new Map<string, (event: any, ctx?: any) => Promise<any>>();
    moltenForgeDiffExtension({ on: (name: string, handler: any) => handlers.set(name, handler) });
    const call = { toolName: "edit", toolCallId: "edit-late-error", input: { path: "server.ts", oldText: "before", newText: "after" } };

    try {
      await handlers.get("tool_call")!(call, { cwd: directory });
      await writeFile(file, "after\n", "utf8");
      const result = await handlers.get("tool_result")!({ ...call, details: {}, isError: true });
      expect(result.details.moltenForgeDiff.applied).toBe(true);
      expect(result.details.moltenForgeDiff.executionError).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prefers no diff over a stale baseline for overlapping same-path mutations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "molten-forge-diff-overlap-"));
    const file = join(directory, "server.ts");
    await writeFile(file, "zero\n", "utf8");
    const handlers = new Map<string, (event: any, ctx?: any) => Promise<any>>();
    moltenForgeDiffExtension({ on: (name: string, handler: any) => handlers.set(name, handler) });
    const first = { toolName: "write", toolCallId: "write-first", input: { path: "server.ts", content: "one\n" } };
    const second = { toolName: "write", toolCallId: "write-second", input: { path: "server.ts", content: "two\n" } };

    try {
      await handlers.get("tool_call")!(first, { cwd: directory });
      await handlers.get("tool_call")!(second, { cwd: directory });
      await writeFile(file, "one\n", "utf8");
      const firstResult = await handlers.get("tool_result")!({ ...first, details: {}, isError: false });
      await writeFile(file, "two\n", "utf8");
      const secondResult = await handlers.get("tool_result")!({ ...second, details: {}, isError: false });
      expect(firstResult.details.moltenForgeDiff).toBeTruthy();
      expect(secondResult).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

});
