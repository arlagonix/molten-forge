import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { FONT_URL, MIRACODE_SHA256, MIRACODE_VERSION, isValidMiracode, isValidLicense } from './prepare-miracode.mjs';

test('Miracode uses an exact, pinned release asset and Homebrew-verified SHA-256', () => {
  assert.equal(MIRACODE_VERSION, 'v1.0');
  assert.equal(FONT_URL, 'https://github.com/IdreesInc/Miracode/releases/download/v1.0/Miracode.ttf');
  assert.equal(MIRACODE_SHA256, '43efc3fd33e5a8eb7befda984bf745eda844777326e1ae06fb074707e1aeb66a');
});

test('rejects HTML/404/invalid or unverified font bytes instead of caching them', () => {
  assert.equal(isValidMiracode(Buffer.from('<html>Not found</html>'.repeat(1000))), false);
  const forged = Buffer.alloc(100_000);
  forged.writeUInt32BE(0x00010000, 0);
  assert.equal(isValidMiracode(forged), false);
  assert.notEqual(createHash('sha256').update(forged).digest('hex'), MIRACODE_SHA256);
});

test('checks upstream OFL metadata', () => {
  assert.equal(isValidLicense(Buffer.from('Copyright (c) 2022, Idrees Hassan\nSIL OPEN FONT LICENSE Version 1.1')), true);
  assert.equal(isValidLicense(Buffer.from('404: Not Found')), false);
});
