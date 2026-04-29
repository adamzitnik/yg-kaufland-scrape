import fs from 'node:fs';
import path from 'node:path';

export function storageFileExists(absPath) {
  return fs.existsSync(absPath);
}

export function ensureStorageDir(absPath) {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Uloží cookies + localStorage (Playwright) pro příští běh.
 * @param {import('playwright').BrowserContext} context
 */
export async function saveStorageState(context, absPath) {
  ensureStorageDir(absPath);
  await context.storageState({ path: absPath });
}

export function removeStorageStateFile(absPath) {
  try {
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }
  } catch {
    /* ignore */
  }
}
