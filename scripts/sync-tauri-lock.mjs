/**
 * Reconcile the Rust lockfile before the Tauri CLI performs its JS/Rust
 * version check. Only runs Cargo when the bundled lockfile is outdated.
 * Cargo, not this script, owns crate resolution and checksums.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function lockedVersion(contents, crate) {
  const entry = contents.split("[[package]]").find((block) =>
    block.split("\n").some((line) => line.trim() === `name = "${crate}"`),
  );
  return entry?.match(/^version = "(\d+\.\d+\.\d+)"$/m)?.[1] ?? null;
}

export function declaredRustVersion(contents, crate) {
  const declaration = contents.split("\n").find((line) =>
    new RegExp(`^${crate}\\s*=\\s*`).test(line),
  );
  const version = declaration?.match(/version\s*=\s*"=(\d+\.\d+\.\d+)"/)?.[1]
    ?? declaration?.match(/^\S+\s*=\s*"=(\d+\.\d+\.\d+)"/)?.[1];
  if (!version) throw new Error(`Expected an exact ${crate} version pin in Cargo.toml`);
  return version;
}

export function assertJsRustCompatibility(packageJson, cargoToml) {
  const rust = declaredRustVersion(cargoToml, "tauri");
  const api = packageJson.dependencies["@tauri-apps/api"];
  const cli = packageJson.devDependencies["@tauri-apps/cli"];
  const jsNotification = packageJson.dependencies["@tauri-apps/plugin-notification"];
  const rustNotification = declaredRustVersion(cargoToml, "tauri-plugin-notification");
  for (const [name, value] of Object.entries({ api, cli, jsNotification })) {
    if (!/^\d+\.\d+\.\d+$/.test(value ?? "")) {
      throw new Error(`Tauri ${name} must be pinned to an exact release`);
    }
  }
  const minor = (version) => version.split(".").slice(0, 2).join(".");
  if (minor(api) !== minor(rust) || minor(cli) !== minor(rust)) {
    throw new Error(`Tauri npm/Rust version mismatch (Rust ${rust}, API ${api}, CLI ${cli})`);
  }
  if (jsNotification !== rustNotification) {
    throw new Error(`Notification plugin mismatch (npm ${jsNotification}, Rust ${rustNotification})`);
  }
  return rust;
}

export function lockfileNeedsUpdate(cargoToml, cargoLock) {
  return ["tauri", "tauri-build", "tauri-plugin-notification"].some((crate) =>
    declaredRustVersion(cargoToml, crate) !== lockedVersion(cargoLock, crate),
  );
}

function main() {
  const manifestPath = join(projectRoot, "src-tauri", "Cargo.toml");
  const lockPath = join(projectRoot, "src-tauri", "Cargo.lock");
  const cargoToml = readFileSync(manifestPath, "utf8");
  const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  const rust = assertJsRustCompatibility(packageJson, cargoToml);
  const cargoLock = readFileSync(lockPath, "utf8");
  if (!lockfileNeedsUpdate(cargoToml, cargoLock)) return;

  process.stdout.write(`Refreshing Rust Tauri dependencies to ${rust} before starting Tauri...\n`);
  const result = spawnSync("cargo", [
    "update", "--manifest-path", manifestPath,
    "--package", "tauri", "--precise", rust,
  ], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`Cargo could not refresh src-tauri/Cargo.lock: ${result.error?.message ?? `exit ${result.status}`}`);
  }
  const refreshed = readFileSync(lockPath, "utf8");
  if (lockfileNeedsUpdate(cargoToml, refreshed)) {
    throw new Error("Cargo returned successfully, but src-tauri/Cargo.lock still has outdated Tauri packages");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
