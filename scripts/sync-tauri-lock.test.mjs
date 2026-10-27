import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertJsRustCompatibility,
  declaredRustVersion,
  lockedVersion,
  lockfileNeedsUpdate,
} from "./sync-tauri-lock.mjs";

const toml = `tauri-build = { version = "=2.7.2", features = [] }
tauri = { version = "=2.12.3", features = [] }
tauri-plugin-notification = "=2.6.0"`;
const pkg = {
  dependencies: { "@tauri-apps/api": "2.12.3", "@tauri-apps/plugin-notification": "2.6.0" },
  devDependencies: { "@tauri-apps/cli": "2.12.2" },
};
const locked = (tauri, build, notification = "2.6.0") =>
  `[[package]]\nname = "tauri"\nversion = "${tauri}"\n\n` +
  `[[package]]\nname = "tauri-build"\nversion = "${build}"\n\n` +
  `[[package]]\nname = "tauri-plugin-notification"\nversion = "${notification}"\n`;

test("all Tauri versions are read by exact crate name", () => {
  assert.equal(declaredRustVersion(toml, "tauri"), "2.12.3");
  assert.equal(declaredRustVersion(toml, "tauri-build"), "2.7.2");
  assert.equal(declaredRustVersion(toml, "tauri-plugin-notification"), "2.6.0");
  assert.equal(lockedVersion(locked("2.11.6", "2.6.3"), "tauri"), "2.11.6");
  assert.equal(lockedVersion(locked("2.11.6", "2.6.3"), "tauri-plugin-notification"), "2.6.0");
});

test("prebuild sync is skipped for a matching lockfile", () => {
  assert.equal(lockfileNeedsUpdate(toml, locked("2.12.3", "2.7.2")), false);
});

test("prebuild sync is requested for old or missing crate versions", () => {
  assert.equal(lockfileNeedsUpdate(toml, locked("2.11.6", "2.6.3")), true);
  assert.equal(lockfileNeedsUpdate(toml, locked("2.12.3", "2.6.3")), true);
  assert.equal(lockfileNeedsUpdate(toml, locked("2.12.3", "2.7.2", "2.5.1")), true);
  assert.equal(lockfileNeedsUpdate(toml, locked("2.12.3", "2.7.2").replace('[[package]]\nname = "tauri-plugin-notification"\nversion = "2.6.0"', '')), true);
});

test("npm and Rust pins must match, including plugin patch version", () => {
  assert.equal(assertJsRustCompatibility(pkg, toml), "2.12.3");
  assert.throws(() => assertJsRustCompatibility({ ...pkg, dependencies: { ...pkg.dependencies, "@tauri-apps/api": "2.11.1" } }, toml), /mismatch/);
  assert.throws(() => assertJsRustCompatibility({ ...pkg, devDependencies: { "@tauri-apps/cli": "^2.12.2" } }, toml), /pinned/);
  assert.throws(() => assertJsRustCompatibility({ ...pkg, dependencies: { ...pkg.dependencies, "@tauri-apps/plugin-notification": "2.5.1" } }, toml), /plugin mismatch/);
});
