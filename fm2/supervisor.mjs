#!/usr/bin/env node
// Start a firstmate controller with provider-native lifecycle hooks. Claude is
// still fmp's default; this launcher supplies the equivalent Codex hook wiring
// without writing project-local .codex files into the harness checkout.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home } from './lib/config.mjs';
import { normalizeAgent } from './lib/sessions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const agent = normalizeAgent(process.argv[2] ?? 'claude');

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function hook(event, script) {
  const command =
    `FM2_HOME=${shellQuote(home())} FM2_AGENT=${shellQuote(agent)} ` +
    `node ${shellQuote(join(HERE, 'hooks', script))}`;
  return `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(command)}}]}]`;
}

const command = agent === 'claude' ? 'claude' : 'codex';
const args = agent === 'claude'
  ? ['--dangerously-skip-permissions', '--effort', 'max']
  : [
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      '-c', 'model_reasoning_effort="max"',
      '-c', hook('UserPromptSubmit', 'supervisor-start.mjs'),
      '-c', hook('Stop', 'supervisor-stop.mjs'),
    ];

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: { ...process.env, FM2_AGENT: agent, FM2_HOME: home() },
});
if (result.error) {
  process.stderr.write(`firstmate: could not start ${agent}: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
