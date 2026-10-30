import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const toml = read('src-tauri/Cargo.toml');
const cargoLock = read('src-tauri/Cargo.lock');

function ownCargoVersion(source, marker) {
  const block = source.match(marker);
  assert.ok(block, 'Could not find the application package block');
  const version = block[1].match(/^version\s*=\s*"([^"]+)"/m);
  assert.ok(version, 'Application package lacks a version');
  return version[1];
}

test('release version matches frontend, Tauri and Rust metadata', () => {
  const version = pkg.version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  assert.equal(tauri.version, version);
  assert.equal(ownCargoVersion(toml, /\[package\]([\s\S]*?)(?=\n\[|$)/), version);
  assert.equal(ownCargoVersion(cargoLock, /\[\[package\]\]\s*\nname = "molten-forge-pi"([\s\S]*?)(?=\n\[\[package\]\]|$)/), version);
});

test('the rename preserves the native app identity and canonical release docs', () => {
  assert.equal(tauri.productName, 'Molten Forge');
  assert.equal(tauri.identifier, 'com.moltenforge.pi');
  assert.ok(fs.existsSync(path.join(root, 'docs/releases', `v${pkg.version}.md`)));
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/release-notes/SKILL.md')));
});
