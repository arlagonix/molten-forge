import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { executePiTool } from "./pi-tools";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

describe("Pi-style attachment file access", () => {
  it("allows read access to an exact attached file outside the workspace", async () => {
    const workspace = await mkdtemp(
      path.join(tmpdir(), "molten-forge-workspace-"),
    );
    const external = path.join(
      await mkdtemp(path.join(tmpdir(), "molten-forge-external-")),
      "notes.txt",
    );
    await writeFile(external, "secret attachment text", "utf8");

    const result = await executePiTool(
      "read",
      { path: external },
      {
        workspaceRoots: [
          { id: "workspace", name: "Workspace", path: workspace },
        ],
        allowedExactFilePaths: [external],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.content).toContain("secret attachment text");
  });

  it("allows read access inside an attachment temp root", async () => {
    const workspace = await mkdtemp(
      path.join(tmpdir(), "molten-forge-workspace-"),
    );
    const tempRoot = await mkdtemp(
      path.join(tmpdir(), "molten-forge-attachments-"),
    );
    const stagedFile = path.join(tempRoot, "pasted.txt");
    await writeFile(stagedFile, "temporary attachment text", "utf8");

    const result = await executePiTool(
      "read",
      { path: stagedFile },
      {
        workspaceRoots: [
          { id: "workspace", name: "Workspace", path: workspace },
        ],
        allowedReadRoots: [
          { id: "attachments", name: "Attachments", path: tempRoot },
        ],
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.content).toContain("temporary attachment text");
  });

  it("returns image reads as data URL image payloads", async () => {
    const workspace = await mkdtemp(
      path.join(tmpdir(), "molten-forge-workspace-"),
    );
    const imagePath = path.join(workspace, "pixel.png");
    await writeFile(imagePath, onePixelPng);

    const result = await executePiTool(
      "read",
      { path: "pixel.png" },
      {
        workspaceRoots: [
          { id: "workspace", name: "Workspace", path: workspace },
        ],
      },
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.content) as {
      type?: string;
      dataUrl?: string;
    };
    expect(parsed.type).toBe("image");
    expect(parsed.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
