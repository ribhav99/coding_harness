#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home } from './lib/config.mjs';
import { currentPanel } from './lib/presence.mjs';
import { controllerId, normalizeAgent } from './lib/sessions.mjs';
import { codexSessionArgs } from './lib/launch.mjs';
import { CLAUDE_MODEL } from './lib/provider-model.mjs';
import { effortFor, normalizeEffort } from './lib/effort.mjs';
import { providerExecutable } from './lib/provider-command.mjs';
import { shellQuote } from './lib/shell.mjs';
import { tabtailEnabled, tabtailStop, tabtailPython, tabtailEnv, tabtailCleanPrefix, tabtailCleanEnv } from './lib/tabtail.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function supervisorHookConfig(agent = 'claude', id = process.env.FM2_TASK) {
  normalizeAgent(agent);
  const start = { hooks: [{ type: 'command', command: `node ${shellQuote(join(HERE, 'hooks/supervisor-start.mjs'))}` }] };
  const stop = { hooks: [{ type: 'command', command: tabtailStop(`node ${shellQuote(join(HERE, 'hooks/supervisor-stop.mjs'))}`, agent, id) }] };
  return { hooks: { SessionStart: [start],
    UserPromptSubmit: [start], Stop: [stop] } };
}

function hasOnlyLegacyControllerHooks(cwd) {
  try {
    const file = join(cwd, '.claude/settings.json');
    if (!existsSync(file)) return false;
    const settings = JSON.parse(readFileSync(file, 'utf8'));
    if (Object.keys(settings).some((key) => key !== 'hooks')) return false;
    return Object.entries(settings.hooks ?? {}).every(([event, groups]) =>
      ['UserPromptSubmit', 'Stop'].includes(event) && groups.every((group) =>
        Object.keys(group).every((key) => key === 'hooks') && group.hooks.every((hook) =>
          Object.keys(hook).every((key) => ['type', 'command'].includes(key))
          && hook.type === 'command' && hook.command === `exec node "$CLAUDE_PROJECT_DIR"/fm2/hooks/supervisor-${event === 'Stop' ? 'stop' : 'start'}.mjs`)));
  } catch { return false; }
}

function invocation({ agent = 'claude', id, panel = currentPanel(), resume = null, cwd = process.cwd(), effort = null } = {}) {
  const provider = normalizeAgent(agent);
  const target = currentPanel({ panel, pane: null });
  if (!target) throw new Error('a controller needs --panel <tmux-session> or FM2_PANEL');
  const identity = id ?? controllerId(target);
  if (!/^controller:[A-Za-z0-9_.-]+$/.test(identity)) throw new Error('invalid controller identity');
  if (resume !== null && (typeof resume !== 'string' || !resume.trim())) throw new Error('resume needs an exact provider session id');
  const reasoning = effort === null ? effortFor(identity, provider) : normalizeEffort(provider, effort);
  const config = supervisorHookConfig(provider, identity);
  const args = provider === 'claude'
    ? ['--dangerously-skip-permissions', '--effort', reasoning, '--model', CLAUDE_MODEL,
        ...(hasOnlyLegacyControllerHooks(cwd) ? ['--setting-sources', 'user,local'] : []),
        '--settings', JSON.stringify(config), ...(resume ? ['--resume', resume] : [])]
    : [
        ...(resume ? ['resume'] : []),
        ...(tabtailEnabled('codex', identity) ? ['--no-daemon'] : []), '--no-alt-screen',
        // Named, not inherited - see codexSessionArgs in lib/launch.mjs for why
        // the desktop app's own settings are the wrong ones for a harness pane.
        ...codexSessionArgs(reasoning, config.hooks, identity),
        ...(resume ? [resume] : []),
      ];
  return {
    command: tabtailEnabled(provider, identity) ? tabtailPython(identity) : providerExecutable(provider),
    args: tabtailEnabled(provider, identity) ? [join(HERE, 'tabtail.py'), 'launch', '--', providerExecutable(provider), ...args] : args,
    env: { ...tabtailEnv(identity), FM2_HOME: home(), FM2_AGENT: provider, FM2_TASK: identity, FM2_PANEL: target, FM2_EFFORT: reasoning,
      ...(provider === 'codex' ? { FM2_CODEX_BACKEND: 'embedded' } : {}) },
  };
}

export function supervisorCommand({ briefPath = null, ...options } = {}) {
  const launch = invocation(options);
  const env = Object.entries(launch.env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ');
  const args = launch.args.map(shellQuote).join(' ');
  return `${tabtailCleanPrefix()} ${env} ${shellQuote(launch.command)} ${args}${briefPath ? ` "$(cat ${shellQuote(briefPath)})"` : ''}`;
}

export function main(argv = process.argv.slice(2)) {
  const hasAgent = argv[0] && !argv[0].startsWith('-');
  const options = { agent: hasAgent ? argv[0] : 'claude', id: process.env.FM2_TASK || undefined };
  for (let at = hasAgent ? 1 : 0; at < argv.length; at += 2) {
    const key = { '--panel': 'panel', '--id': 'id', '--brief': 'briefPath', '--resume': 'resume', '--effort': 'effort' }[argv[at]];
    if (!key || !argv[at + 1]) throw new Error('usage: supervisor.mjs [claude|codex] [--panel <session>] [--id <controller:id>] [--brief <file>] [--resume <exact-id>] [--effort <level>]');
    options[key] = argv[at + 1];
  }
  const launch = invocation(options);
  if (options.briefPath) launch.args.push(readFileSync(options.briefPath, 'utf8'));
  if (launch.command === 'codex') {
    process.stderr.write('firstmate: review new or changed lifecycle hooks with /hooks in Codex; untrusted hooks are skipped until approved.\n');
  }
  const result = spawnSync(launch.command, launch.args, {
    stdio: 'inherit', env: { ...tabtailCleanEnv(process.env), ...launch.env },
  });
  if (result.error) throw new Error(`could not start ${launch.command}: ${result.error.message}`);
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    process.stderr.write(`firstmate: ${error.message}\n`);
    process.exitCode = 1;
  }
}
