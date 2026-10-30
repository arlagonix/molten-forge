// Provision one pinned upstream Miracode font, if available.
// Network failures must NEVER block an unrelated frontend or Tauri build.
// The app keeps a JetBrains Mono fallback; users can manually supply the
// official Miracode.ttf in public/fonts/ when GitHub is not reachable.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIRACODE_VERSION = 'v1.0';
export const MIRACODE_SHA256 = '43efc3fd33e5a8eb7befda984bf745eda844777326e1ae06fb074707e1aeb66a';
export const FONT_URL = `https://github.com/IdreesInc/Miracode/releases/download/${MIRACODE_VERSION}/Miracode.ttf`;
export const LICENSE_URL = `https://raw.githubusercontent.com/IdreesInc/Miracode/${MIRACODE_VERSION}/LICENSE`;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FONT_FOLDER = join(ROOT, 'public', 'fonts');
const FONT_FILE = join(FONT_FOLDER, 'Miracode.ttf');
const LICENSE_FILE = join(FONT_FOLDER, 'Miracode-OFL.txt');

export function isValidMiracode(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 10_000 || bytes.length > 10_000_000) return false;
  const header = bytes.subarray(0, 4).toString('hex');
  if (!['00010000', '74727565', '4f54544f'].includes(header)) return false;
  return createHash('sha256').update(bytes).digest('hex') === MIRACODE_SHA256;
}

export function isValidLicense(bytes) {
  const text = bytes.toString('utf8');
  return text.includes('SIL OPEN FONT LICENSE Version 1.1') && text.includes('Idrees Hassan');
}

async function download(url, validate, timeoutMs = 8000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!validate(bytes)) throw new Error('content or checksum verification failed');
  return bytes;
}

async function saveAtomically(file, bytes) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function existingIfValid(path, valid) {
  try {
    const bytes = await readFile(path);
    if (valid(bytes)) return true;
    throw new Error(`Unverified asset found at ${path}. Replace it with the original v1.0 release file.`);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function prepareMiracode({ downloadFont = download } = {}) {
  await mkdir(FONT_FOLDER, { recursive: true });
  try {
    let source = 'cached';
    if (!await existingIfValid(FONT_FILE, isValidMiracode)) {
      const bytes = await downloadFont(FONT_URL, isValidMiracode);
      await saveAtomically(FONT_FILE, bytes);
      source = 'downloaded';
    }
    // Include upstream OFL with the font when it is available. If network
    // access fails here, avoid breaking the build, but explain how to supply it.
    try {
      if (!await existingIfValid(LICENSE_FILE, isValidLicense)) {
        await saveAtomically(LICENSE_FILE, await downloadFont(LICENSE_URL, isValidLicense));
      }
    } catch (error) {
      console.warn(`Miracode license notice unavailable (${error.message}). See https://github.com/IdreesInc/Miracode/blob/main/LICENSE`);
    }
    return { available: true, source };
  } catch (error) {
    console.warn(`Miracode font not provisioned (${error.message}). Build will continue using JetBrains Mono fallback. To use Miracode, download Miracode.ttf from https://github.com/IdreesInc/Miracode/releases/tag/v1.0 and put it at public/fonts/Miracode.ttf`);
    return { available: false, reason: error.message };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await prepareMiracode();
  if (result.available) console.log(`Miracode ${MIRACODE_VERSION}: ${result.source}, verified SHA-256.`);
}
