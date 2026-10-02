import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { saveTask, loadTask } from '../lib/config.mjs';
import { providerExecutable } from '../lib/provider-command.mjs';
import {
  activeProviderSession,
  executeProviderUpdate,
  prepareProviderUpdate,
  providerUpdatePlan,
} from '../lib/provider-update.mjs';
import {
  claimProviderUpdate,
  finishProviderUpdate,
  providerUpdateInProgress,
  providerUpdateOwnsStop,
  requestProviderUpdate,
  schedulePendingProviderUpdate,
  setProviderUpdatePhase,
} from '../lib/provider-update-state.mjs';
import { recordSupervisor } from '../lib/presence.mjs';
import { rememberSession } from '../lib/sessions.mjs';
import { pending } from '../lib/notify.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fm-provider-update-'));
  const previous = Object.fromEntries(['FM2_HOME', 'PATH'].map((key) => [key, process.env[key]]));
  process.env.FM2_HOME = join(root, 'home');
  mkdirSync(process.env.FM2_HOME);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function gitRepo(root) {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'fixture@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Fixture']);
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  execFileSync('git', ['-C', repo, 'add', 'README.md']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'fixture']);
  return repo;
}

function claudeTranscript(root, id, cwd) {
  const path = join(root, `${id}.jsonl`);
  writeFileSync(path, JSON.stringify({
    type: 'user', sessionId: id, cwd, message: { content: `opening request for ${id}` },
  }) + '\n');
  return path;
}

function codexTranscript(root, id, cwd) {
  const path = join(root, `${id}.jsonl`);
  writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { id, cwd } }) + '\n');
  return path;
}

test('provider lookup survives the desktop app moving its Codex executable', t => {
  const root = fixture(t);
  const nested = join(root, 'CodexCLI.app', 'Contents', 'MacOS');
  mkdirSync(nested, { recursive: true });
  const binary = join(nested, 'codex');
  writeFileSync(binary, '#!/bin/sh\nexit 0\n');
  chmodSync(binary, 0o700);
  assert.equal(providerExecutable('codex', { path: '', codexCandidates: ['/missing/codex', binary], required: true }), binary);
  assert.throws(() => providerExecutable('claude', { path: '', required: true }), /not installed/u);
});

test('a controller request is scheduled once and only suppresses the provider being updated', t => {
  const root = fixture(t);
  const requested = requestProviderUpdate('codex', {
    requestedBy: 'controller:panel-one', requesterAgent: 'claude', panel: 'panel-one',
  });
  let invocation;
  const scheduled = schedulePendingProviderUpdate('controller:panel-one', 'claude', {
    hookPid: 123,
    run(command, args) { invocation = { command, args }; return '%91\n'; },
  });
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(scheduled.maintenance_pane, '%91');
  assert.equal(invocation.command, 'tmux');
  assert.equal(invocation.args[0], 'new-window');
  assert.ok(invocation.args.includes('update-codex'));
  assert.match(invocation.args.at(-1), /provider-update-apply\.mjs/u);
  assert.match(invocation.args.at(-1), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  assert.equal(providerUpdateInProgress('codex'), true);
  assert.equal(providerUpdateInProgress('claude'), false);
  assert.equal(providerUpdateOwnsStop('codex', 'worker-one'), false);
  assert.equal(schedulePendingProviderUpdate('controller:panel-one', 'claude', { run() { throw new Error('twice'); } }), null);
  assert.equal(claimProviderUpdate('codex', requested.token).status, 'preparing');
  assert.equal(setProviderUpdatePhase('codex', requested.token, 'stopping', { stopping_task: 'worker-one' }).status, 'stopping');
  assert.equal(providerUpdateOwnsStop('codex', 'worker-one'), true);
  assert.equal(providerUpdateOwnsStop('codex', 'worker-two'), false);
  assert.equal(setProviderUpdatePhase('codex', requested.token, 'updating').status, 'updating');
  assert.equal(finishProviderUpdate('codex', requested.token, { result: { sessions: 2 } }).status, 'complete');
  assert.equal(providerUpdateInProgress('codex'), false);
});

test('the provider updater prefers each CLI self-update command', t => {
  const root = fixture(t);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const provider of ['claude', 'codex']) {
    const path = join(bin, provider);
    writeFileSync(path, '#!/bin/sh\n[ "$1" = --help ] && { echo "  update  Update provider"; exit 0; }\n[ "$1" = update ] && exit 0\n[ "$1" = --version ] && { echo fixture; exit 0; }\nexit 1\n');
    chmodSync(path, 0o700);
  }
  process.env.PATH = `${bin}:${process.env.PATH}`;
  for (const provider of ['claude', 'codex']) {
    const plan = providerUpdatePlan(provider);
    assert.equal(plan.method, 'self-update');
    assert.deepEqual(plan.steps[0].args, ['update']);
    assert.equal(plan.steps[0].command, join(bin, provider));
  }
});

test('Codex fallback updates only the installation that supplied the active binary', t => {
  const root = fixture(t);
  const script = '#!/bin/sh\n[ "$1" = --help ] && { echo "Codex without self update"; exit 0; }\nexit 0\n';
  const npmBin = join(root, 'node_modules', '@openai', 'codex', 'bin');
  mkdirSync(npmBin, { recursive: true });
  writeFileSync(join(npmBin, 'codex'), script, { mode: 0o700 });
  process.env.PATH = `${npmBin}:${process.env.PATH}`;
  assert.equal(providerUpdatePlan('codex').method, 'npm');

  const brewBin = join(root, 'Caskroom', 'codex', '1.0.0');
  mkdirSync(brewBin, { recursive: true });
  writeFileSync(join(brewBin, 'codex'), script, { mode: 0o700 });
  process.env.PATH = `${brewBin}:${process.env.PATH.split(':').slice(1).join(':')}`;
  assert.equal(providerUpdatePlan('codex').method, 'homebrew');
});

test('intentional update stops do not become worker completion reports', t => {
  const root = fixture(t);
  const repo = gitRepo(root);
  const transcript = claudeTranscript(root, 'worker-session', repo);
  saveTask({ id: 'worker-one', agent: 'claude', pane: '%1', panel: 'panel', worktree: repo, project: repo });
  const requested = requestProviderUpdate('claude', {
    requestedBy: 'controller:panel', requesterAgent: 'claude', panel: 'panel',
  });
  schedulePendingProviderUpdate('controller:panel', 'claude', {
    hookPid: 123, run: () => '%90\n',
  });
  claimProviderUpdate('claude', requested.token);
  setProviderUpdatePhase('claude', requested.token, 'stopping', { stopping_task: 'worker-one' });
  const hook = new URL('../hooks/worker-stop.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [hook.pathname], {
    input: JSON.stringify({
      session_id: 'worker-session', transcript_path: transcript, cwd: repo,
      last_assistant_message: 'This is only the update lifecycle stop.',
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      FM2_HOME: process.env.FM2_HOME,
      FM2_TASK: 'worker-one',
      FM2_AGENT: 'claude',
      FM2_PANEL: 'panel',
      TMUX_PANE: '',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(pending('panel').length, 0);
  finishProviderUpdate('claude', requested.token, { result: {} });
});

test('all managed sessions stop before one update and resume exact ids in their original panes', t => {
  const root = fixture(t);
  const repo = gitRepo(root);
  const workerTranscript = claudeTranscript(root, 'worker-session', repo);
  const controllerTranscript = claudeTranscript(root, 'controller-session', repo);
  saveTask({
    id: 'worker-one', agent: 'claude', pane: '%1', panel: 'panel-one',
    worktree: repo, project: repo, brief: null, kind: 'adopted', adopted: true,
  });
  rememberSession({
    task: 'worker-one', agent: 'claude', sessionId: 'worker-session',
    transcriptPath: workerTranscript, cwd: repo, panel: 'panel-one', pane: '%1',
    providerPid: 101,
  });
  recordSupervisor('%2', {
    panel: 'panel-two', task: 'controller:panel-two', agent: 'claude',
    sessionId: 'controller-session', cwd: repo,
  });
  rememberSession({
    task: 'controller:panel-two', agent: 'claude', sessionId: 'controller-session',
    transcriptPath: controllerTranscript, cwd: repo, panel: 'panel-two', pane: '%2',
    providerPid: 202,
  });

  const events = [];
  let updated = false;
  const runtime = {
    plan: () => ({ provider: 'claude', method: 'fixture', executable: 'claude', steps: [] }),
    version: () => updated ? 'claude 2' : 'claude 1',
    panes: () => [
      { id: '%1', pid: 11, dead: false, cwd: repo, panel: 'panel-one', window: 'workers', index: 0 },
      { id: '%2', pid: 22, dead: false, cwd: repo, panel: 'panel-two', window: 'control', index: 0 },
    ],
    ownership: (_pane, source) => source.backend ?? 'embedded',
    stop: (entry) => { events.push(`stop:${entry.task.id}`); },
    update: () => { events.push('update'); updated = true; },
    start: (entry, command) => { events.push(`start:${entry.task.id}`); entry.startedCommand = command; },
  };
  const request = {
    token: 'token', provider: 'claude', requested_by: 'controller:panel-one',
    requested_at: new Date().toISOString(), manifest: join(root, 'manifest.json'), log: join(root, 'update.log'),
  };
  const manifest = prepareProviderUpdate(request, { runtime });
  assert.deepEqual(manifest.entries.map((entry) => entry.task.id), ['worker-one', 'controller:panel-two']);
  const result = executeProviderUpdate(manifest, { runtime });
  assert.deepEqual(events, [
    'stop:worker-one', 'stop:controller:panel-two', 'update',
    'start:worker-one', 'start:controller:panel-two',
  ]);
  assert.equal(result.after_version, 'claude 2');
  assert.match(manifest.entries[0].startedCommand, /--resume 'worker-session'/u);
  assert.match(manifest.entries[1].startedCommand, /--resume' 'controller-session'|--resume 'controller-session'/u);
  for (const entry of manifest.entries) {
    assert.doesNotMatch(entry.startedCommand, /continue\.md|--continue| -c /u);
  }
  assert.equal(loadTask('worker-one').pane, '%1');
  assert.ok(loadTask('worker-one').handoffs.includes(manifest.entries[0].preserved.manifestPath));
  const persisted = JSON.parse(readFileSync(request.manifest, 'utf8'));
  assert.equal(persisted.phase, 'complete');
  assert.deepEqual(persisted.resumed.map((item) => item.session), ['worker-session', 'controller-session']);
});

test('a failed upgrade still reopens every session that was stopped', t => {
  const root = fixture(t);
  const repo = gitRepo(root);
  const transcript = claudeTranscript(root, 'worker-session', repo);
  saveTask({ id: 'worker-one', agent: 'claude', pane: '%1', panel: 'panel', worktree: repo, project: repo, brief: null });
  rememberSession({ task: 'worker-one', agent: 'claude', sessionId: 'worker-session', transcriptPath: transcript,
    cwd: repo, panel: 'panel', pane: '%1', providerPid: 101 });
  const events = [];
  const runtime = {
    plan: () => ({ provider: 'claude', method: 'fixture', executable: 'claude', steps: [] }),
    version: () => 'claude 1',
    panes: () => [{ id: '%1', pid: 11, dead: false, cwd: repo, panel: 'panel', window: 'workers', index: 0 }],
    ownership: () => 'embedded',
    stop: (entry) => { events.push(`stop:${entry.task.id}`); },
    update: () => { events.push('update'); throw new Error('fixture upgrade failed'); },
    start: (entry) => { events.push(`start:${entry.task.id}`); },
  };
  const request = { token: 'token', provider: 'claude', requested_by: 'controller:panel', requested_at: new Date().toISOString(),
    manifest: join(root, 'manifest.json'), log: join(root, 'update.log') };
  const manifest = prepareProviderUpdate(request, { runtime });
  assert.throws(() => executeProviderUpdate(manifest, { runtime }), /fixture upgrade failed/u);
  assert.deepEqual(events, ['stop:worker-one', 'update', 'start:worker-one']);
  assert.equal(JSON.parse(readFileSync(request.manifest, 'utf8')).phase, 'failed');
});

test('Codex update resumes its exact native thread without --last or a synthetic prompt', t => {
  const root = fixture(t);
  const repo = gitRepo(root);
  const transcript = codexTranscript(root, '11111111-2222-3333-4444-555555555555', repo);
  saveTask({ id: 'codex-worker', agent: 'codex', pane: '%4', panel: 'codex-panel', worktree: repo, project: repo, brief: null });
  rememberSession({
    task: 'codex-worker', agent: 'codex', sessionId: '11111111-2222-3333-4444-555555555555',
    transcriptPath: transcript, cwd: repo, panel: 'codex-panel', pane: '%4', providerPid: 404,
    backend: 'embedded',
  });
  let resumed = null;
  const runtime = {
    plan: () => ({ provider: 'codex', method: 'fixture', executable: 'codex', steps: [] }),
    version: () => 'codex 1',
    panes: () => [{ id: '%4', pid: 44, dead: false, cwd: repo, panel: 'codex-panel', window: 'workers', index: 0 }],
    ownership: () => 'embedded',
    stop: () => null,
    update: () => {},
    start: (_entry, command) => { resumed = command; },
  };
  const request = {
    token: 'token', provider: 'codex', requested_by: 'controller:codex-panel', requested_at: new Date().toISOString(),
    manifest: join(root, 'manifest.json'), log: join(root, 'update.log'),
  };
  const manifest = prepareProviderUpdate(request, { runtime });
  executeProviderUpdate(manifest, { runtime });
  assert.match(resumed, /codex' resume |codex resume /u);
  assert.match(resumed, /'11111111-2222-3333-4444-555555555555'/u);
  assert.doesNotMatch(resumed, /--last|--continue|continue\.md|\$\(cat/u);
});

test('an unmanaged provider pane is identified by its one open native transcript and resumed without fm hooks', t => {
  const root = fixture(t);
  const repo = gitRepo(root);
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const sessionDir = join(root, '.codex', 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const transcript = codexTranscript(sessionDir, id, repo);
  const pane = { id: '%9', pid: 900, dead: false, cwd: repo, panel: 'panel', window: 'control', index: 1 };
  const table = [
    { pid: 900, parent: 1, command: '/bin/zsh' },
    { pid: 901, parent: 900, command: '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex' },
    { pid: 902, parent: 901, command: '/opt/homebrew/bin/codex-code-mode-host' },
  ];
  const active = activeProviderSession(pane, 'codex', {
    table,
    filesForPid: (pid) => pid === 901 ? [transcript] : [],
  });
  assert.equal(active.id, id);
  assert.equal(active.provider_pid, 901);
  assert.equal(active.backend, 'embedded');

  let resumed = null;
  const runtime = {
    plan: () => ({ provider: 'codex', method: 'fixture', executable: 'codex', steps: [] }),
    version: () => 'codex 1',
    panes: () => [pane],
    activeSession: () => active,
    ownership: (_pane, source) => source.backend,
    stop: () => null,
    update: () => {},
    start: (_entry, command) => { resumed = command; },
  };
  const request = {
    token: 'token', provider: 'codex', requested_by: 'controller:panel', requested_at: new Date().toISOString(),
    manifest: join(root, 'manifest.json'), log: join(root, 'update.log'),
  };
  const manifest = prepareProviderUpdate(request, { runtime });
  assert.equal(manifest.entries[0].unmanaged, true);
  executeProviderUpdate(manifest, { runtime });
  assert.match(resumed, /codex' resume 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'|codex resume 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'/u);
  assert.doesNotMatch(resumed, /FM2_TASK|hooks\.|--last|continue\.md/u);
});
