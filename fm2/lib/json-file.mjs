// JSON records on disk. Everything fm keeps is one of these.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// A record that is missing or half-written reads as absent, never as a throw:
// every caller already has an answer for "nothing recorded".
export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// Private to this user when the file is created; an existing file keeps its mode.
export function writeJson(path, value, { mode = 0o600 } = {}) {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode });
}

// Written beside the target and renamed over it, so a reader racing a hook
// sees the old record or the new one and never a truncated one.
export function writeJsonAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeJson(temporary, value);
  renameSync(temporary, path);
  return value;
}
