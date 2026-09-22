import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_EFFORT,
  claimEffort,
  effortFor,
  finishEffort,
  normalizeEffort,
  pendingEffort,
  requestEffort,
  schedulePendingEffort,
} from '../lib/effort.mjs';
import { launchCommand } from '../lib/tasks.mjs';
import { supervisorCommand } from '../supervisor.mjs';
import { installInstructions } from '../install-instructions.mjs';
import { pending } from '../lib/notify.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fm-effort-'));
  const previous = process.env.FM2_HOME;
  process.env.FM2_HOME = root;
  t.after(() => {
    if (previous === undefined) delete process.env.FM2_HOME;
    else process.env.FM2_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('provider vocabularies are validated before any transition is queued', t => {
  fixture(t);
  assert.equal(DEFAULT_EFFORT, 'high');
  assert.equal(normalizeEffort('claude', 'MAX'), 'max');
  assert.equal(normalizeEffort('codex', 'ULTRA'), 'ultra');
  assert.throws(() => normalizeEffort('claude', 'ultra'), /invalid claude effort/u);
  assert.throws(() => normalizeEffort('codex', 'auto'), /invalid codex effort/u);
  assert.equal(pendingEffort('controller:test'), null);
});

test('a queued change is scheduled once, claimed once, and becomes the next default', t => {
  const home = fixture(t);
  const requested = requestEffort('controller:test', 'codex', 'ultra', { current: 'high' });
  assert.equal(requested.changed, true);
  let invocation;
  const scheduled = schedulePendingEffort('controller:test', 'codex', {
    hookPid: 123,
    run(command, args) { invocation = { command, args }; },
  });
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(invocation.command, 'tmux');
  assert.deepEqual(invocation.args.slice(0, 2), ['run-shell', '-b']);
  assert.match(invocation.args[2], /effort-apply\.mjs/u);
  assert.match(invocation.args[2], /controller:test/u);
  assert.match(invocation.args[2], new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  assert.equal(schedulePendingEffort('controller:test', 'codex', { run() { throw new Error('twice'); } }), null);
  assert.equal(claimEffort('controller:test', requested.token).effort, 'ultra');
  assert.equal(claimEffort('controller:test', requested.token), null);
  assert.equal(finishEffort('controller:test', requested.token), true);
  assert.equal(effortFor('controller:test', 'codex'), 'ultra');
  assert.equal(requestEffort('controller:test', 'codex', 'ultra').changed, false);
});

test('launch commands preserve fixed models while applying explicit effort', t => {
  const home = fixture(t);
  const settings = join(home, 'hooks.json');
  writeFileSync(settings, JSON.stringify({ hooks: {} }));
  const codex = launchCommand({ agent: 'codex', id: 'wo-one', settingsFile: settings, effort: 'ultra' });
  assert.match(codex, /model="gpt-5\.6-sol"/u);
  assert.match(codex, /model_reasoning_effort="ultra"/u);
  assert.match(codex, /FM2_EFFORT='ultra'/u);
  assert.throws(
    () => launchCommand({ agent: 'claude', id: 'wo-one', settingsFile: settings, effort: 'ultra' }),
    /invalid claude effort/u,
  );
  const claude = launchCommand({ agent: 'claude', id: 'wo-one', settingsFile: settings, effort: 'low' });
  assert.match(claude, /--effort low --model opus/u);
  const controller = supervisorCommand({ agent: 'codex', id: 'controller:panel', panel: 'panel', effort: 'max' });
  assert.match(controller, /model_reasoning_effort="max"/u);
  assert.doesNotMatch(controller, /--model/u);
});

test('a pending effort stop schedules the external restart and suppresses the task report', t => {
  const home = fixture(t);
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const calls = join(home, 'tmux.calls');
  const fakeTmux = join(bin, 'tmux');
  writeFileSync(fakeTmux, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\n`);
  chmodSync(fakeTmux, 0o700);
  requestEffort('wo-hook', 'claude', 'low', { current: 'high' });
  const hook = new URL('../hooks/worker-stop.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [hook.pathname], {
    input: JSON.stringify({
      session_id: '11111111-1111-1111-1111-111111111111',
      cwd: home,
      last_assistant_message: 'This is an intermediate lifecycle stop.',
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FM2_HOME: home,
      FM2_TASK: 'wo-hook',
      FM2_AGENT: 'claude',
      FM2_PANEL: 'test-panel',
      TMUX_PANE: '',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(calls, 'utf8'), /^run-shell -b /u);
  assert.equal(pending('test-panel').length, 0);
  assert.equal(pendingEffort('wo-hook', 'claude').status, 'scheduled');
});

test('global instruction installation updates only its managed blocks', t => {
  const root = fixture(t);
  const claudeFile = join(root, 'claude', 'CLAUDE.md');
  const codexFile = join(root, 'codex', 'AGENTS.md');
  mkdirSync(join(root, 'claude'));
  mkdirSync(join(root, 'codex'));
  writeFileSync(claudeFile, '# Personal Claude rules\n');
  writeFileSync(codexFile, '# Personal Codex rules\n');
  assert.equal(installInstructions({ claudeFile, codexFile }).length, 2);
  const claude = readFileSync(claudeFile, 'utf8');
  const codex = readFileSync(codexFile, 'utf8');
  assert.match(claude, /Personal Claude rules/u);
  assert.match(claude, /low.*medium.*high.*xhigh.*max/u);
  assert.doesNotMatch(claude, /`ultra`/u);
  assert.match(codex, /Personal Codex rules/u);
  assert.match(codex, /`ultra`/u);
  assert.equal(installInstructions({ claudeFile, codexFile, check: true }).length, 0);
  assert.equal(installInstructions({ claudeFile, codexFile }).length, 0);
});
