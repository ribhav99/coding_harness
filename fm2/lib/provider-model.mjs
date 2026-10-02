import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerExecutable } from './provider-command.mjs';

export const CLAUDE_MODEL = 'opus';
const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_TTL_MS = 60_000;

// Compare numeric components, so 6.10 sorts after 6.9. Only stable Sol
// releases belong to this policy; Astra, Luna, snapshots and previews do not.
export function newestSol(models) {
  const choices = models.flatMap((entry) => {
    const id = entry.slug ?? entry.model ?? entry.id;
    const match = /^gpt-(\d+(?:\.\d+)*)-sol$/u.exec(id ?? '');
    return match && entry.hidden !== true && entry.visibility !== 'hide'
      ? [{ id, version: match[1].split('.').map(Number) }] : [];
  });
  choices.sort((a, b) => {
    for (let at = 0; at < Math.max(a.version.length, b.version.length); at += 1) {
      const delta = (b.version[at] ?? 0) - (a.version[at] ?? 0);
      if (delta) return delta;
    }
    return 0;
  });
  if (!choices.length) throw new Error('Codex catalog has no visible stable Sol model');
  return choices[0].id;
}

function queryModels() {
  return JSON.parse(execFileSync(process.execPath, [join(HERE, 'codex-model-catalog.mjs'),
    providerExecutable('codex', { required: true })], {
    encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

// Read on each launch, including resume after an upgrade. There is no version
// constant to bump and no machine/user-config model that can pin the fleet.
export function latestCodexModel({
  cachePath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'),
  query = queryModels,
  now = Date.now(),
} = {}) {
  let cached = null;
  try { cached = JSON.parse(readFileSync(cachePath, 'utf8')); } catch { /* first launch */ }
  if (cached && now - Date.parse(cached.fetched_at) >= 0
      && now - Date.parse(cached.fetched_at) < CATALOG_TTL_MS) {
    try { return newestSol(cached.models); } catch { /* refresh an incomplete cache */ }
  }
  try { return newestSol(query()); }
  catch (error) {
    if (cached?.models) {
      const model = newestSol(cached.models);
      process.stderr.write(`firstmate: model catalog refresh failed; using cached latest Sol ${model}.\n`);
      return model;
    }
    throw new Error(`cannot resolve latest Sol from Codex: ${error.message}`);
  }
}
