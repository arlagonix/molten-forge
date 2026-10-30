import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};
const cargoToml = readFileSync(new URL("src-tauri/Cargo.toml", root), "utf8");

function exactRustVersion(crate: string): string {
  const line = cargoToml.split("\n").find((candidate) => candidate.startsWith(`${crate} = `));
  const version = line?.match(/version\s*=\s*"=(\d+\.\d+\.\d+)"/)?.[1]
    ?? line?.match(/^\S+\s*=\s*"=(\d+\.\d+\.\d+)"/)?.[1];
  if (!version) throw new Error(`Missing exact version for ${crate}`);
  return version;
}

const minor = (version: string) => version.split(".").slice(0, 2).join(".");

describe("Tauri dependency compatibility", () => {
  it("pins the API, CLI and Rust core to compatible exact releases", () => {
    const rustVersion = exactRustVersion("tauri");
    expect(rustVersion).toBe("2.12.3");
    for (const version of [
      manifest.dependencies["@tauri-apps/api"],
      manifest.devDependencies["@tauri-apps/cli"],
    ]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(minor(version)).toBe(minor(rustVersion));
    }
    expect(manifest.dependencies["@tauri-apps/api"]).toBe("2.12.3");
    expect(manifest.devDependencies["@tauri-apps/cli"]).toBe("2.12.2");
    expect(exactRustVersion("tauri-build")).toBe("2.7.2");
  });

  it("keeps notification JS and Rust plugin patch versions identical", () => {
    expect(manifest.dependencies["@tauri-apps/plugin-notification"]).toBe("2.6.0");
    expect(exactRustVersion("tauri-plugin-notification")).toBe("2.6.0");
  });

  it("reconciles an old Rust lockfile before the Tauri CLI checks versions", () => {
    expect(manifest.scripts["pretauri:dev"]).toBe("node scripts/sync-tauri-lock.mjs");
    expect(manifest.scripts["pretauri:build"]).toBe("node scripts/sync-tauri-lock.mjs");
    const preflight = readFileSync(new URL("scripts/sync-tauri-lock.mjs", root), "utf8");
    expect(preflight).toContain('"--package", "tauri", "--precise", rust');
    expect(preflight).toContain("lockfileNeedsUpdate(cargoToml, cargoLock)");
  });
});
