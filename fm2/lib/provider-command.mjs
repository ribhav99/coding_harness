import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// The desktop app has shipped the Codex CLI at both of these locations. Keep
// the lookup here rather than baking one app-bundle layout into every launch
// path; app updates are precisely when a stale symlink is most likely.
export const CODEX_APP_EXECUTABLES = Object.freeze([
  '/Applications/ChatGPT.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
]);

function executable(path) {
  try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
}

function onPath(name, path = process.env.PATH || '') {
  for (const folder of path.split(delimiter).filter(Boolean)) {
    const candidate = join(folder, name);
    if (executable(candidate)) return candidate;
  }
  return null;
}

export function providerExecutable(agent, {
  path = process.env.PATH || '',
  codexCandidates = CODEX_APP_EXECUTABLES,
  required = false,
} = {}) {
  const provider = String(agent || '').toLowerCase();
  if (!['claude', 'codex'].includes(provider)) throw new Error(`unknown agent "${agent}" (use claude or codex)`);
  const found = onPath(provider, path)
    ?? (provider === 'codex' ? codexCandidates.find(executable) ?? null : null);
  if (found) return found;
  if (required) throw new Error(`${provider} is not installed`);
  // Command construction remains deterministic in isolated tests and produces
  // the ordinary shell error on machines without the provider.
  return provider;
}

export function providerAvailable(agent, options = {}) {
  try { providerExecutable(agent, { ...options, required: true }); return true; }
  catch { return false; }
}
