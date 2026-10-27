import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cargoLock = readFileSync(
  fileURLToPath(new URL("../../src-tauri/Cargo.lock", import.meta.url)),
  "utf8",
);

function packageBlock(name: string): string {
  const blocks = cargoLock.split("[[package]]");
  const block = blocks.find((candidate) =>
    new RegExp(`^\\s*name = "${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"`, "m").test(candidate),
  );
  if (!block) throw new Error(`Missing ${name} package in Cargo.lock`);
  return block;
}

describe("Rust lockfile integrity regressions", () => {
  it("guards the previously corrupted tao 0.35.2 checksum", () => {
    const tao = packageBlock("tao");
    const version = tao.match(/^version = "(\d+\.\d+\.\d+)"$/m)?.[1];
    // A supported Tauri upgrade can legitimately select a newer tao version.
    // Only lock the historical checksum when the historical crate version remains.
    if (version === "0.35.2") {
      expect(tao).toContain(
        'checksum = "a33f7f9e486ade65fcf1e45c440f9236c904f5c1002cdc7fc6ae582777345ce4"',
      );
    }
    expect(tao).toMatch(/^checksum = "[a-f0-9]{64}"$/m);
    expect(tao).not.toContain(
      'checksum = "d1c93047acf68669466a34690ac58cca7010bd1b201e1ec86f1fd0a75d3dd4a9"',
    );
  });
});
