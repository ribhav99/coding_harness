import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerHookConfig, writeWorkerSettings, launchCommand } from '../lib/launch.mjs';
import { supervisorCommand, supervisorHookConfig } from '../supervisor.mjs';
import { rememberSession, recordedSession } from '../lib/sessions.mjs';
import { beginTabtailHandoff } from '../lib/tabtail.mjs';
import { seedModelCatalog } from './model-fixture.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'fm-tabtail-'));
  const values = { FM2_HOME: home, FM2_PANEL: '', FM2_TASK: 'worker', FM2_AGENT: 'codex',
    TMUX: '', TMUX_PANE: '', FM_REMOTE: 'yes', FM2_TABTAIL: '1', FM2_TABTAIL_FINAL: '1', FM2_TABTAIL_BOOTSTRAPPED: '1',
    TABTAIL_AGENT_PROVIDER: 'codex', TABTAIL_AGENT_PID: String(process.pid), TABTAIL_RUN: 'run-11111111',
    TABTAIL_CODEX_EMBEDDED: '1' };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  seedModelCatalog(home, t);
  mkdirSync(join(home, 'tasks'));
  writeFileSync(join(home, 'tasks/worker.json'), JSON.stringify({ id: 'worker', agent: 'codex' }));
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  const payload = { hook_event_name: 'Stop', session_id: 'session-11111111', turn_id: 'turn-11111111',
    last_assistant_message: 'Built the fixture.', stop_hook_active: false };
  const hook = (kind, input = payload, env = {}, initial = '') => {
    const outcome = join(home, 'outcome');
    writeFileSync(outcome, initial);
    const fd = openSync(outcome, 'r+');
    let result;
    try {
      result = spawnSync(process.execPath, [join(ROOT, 'hooks', `${kind}-stop.mjs`)], {
        input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe', fd], env: { ...process.env,
          FM2_TASK: kind === 'supervisor' ? 'controller:fixture' : 'worker',
          ...env, TABTAIL_STOP_OUTCOME_FD: '3' },
      });
    } finally { closeSync(fd); }
    return { ...result, outcome: readFileSync(outcome, 'utf8') };
  };
  return { home, payload, hook };
}

for (const kind of ['worker', 'supervisor']) {
  test(`${kind}: accepted aggregate writes one completion without changing provider control`, t => {
    const f = fixture(t);
    const result = f.hook(kind);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '{}\n');
    assert.deepEqual(JSON.parse(result.outcome), { version: 1, outcome: 'completed' });
    assert.equal(result.stderr, '');
    if (kind === 'worker') {
      assert.equal(readdirSync(join(f.home, 'notify')).length, 1, 'existing report was lost');
    }
  });
  test(`${kind}: unrelated background work and active goals do not redefine the root turn`, t => {
    const f = fixture(t);
    const result = f.hook(kind, { ...f.payload, goal: { status: 'active' },
      background_tasks: [{ status: 'running' }], session_crons: [{ id: 'wake' }] });
    assert.deepEqual(JSON.parse(result.outcome), { version: 1, outcome: 'completed' });
  });
  const rejected = {
    'permission wait': p => { p.permission_request = {}; },
    'attention': p => { p.attention = true; },
    'error': p => { p.error = 'fixture'; },
    'nested event': p => { p.hook_event_name = 'SubagentStop'; p.agent_id = 'child'; },
    'nested Stop': p => { p.agent_id = 'child'; },
    'missing identity': p => { delete p.session_id; },
    'blocked control': p => { p.decision = 'block'; },
  };
  for (const [name, mutate] of Object.entries(rejected)) {
    test(`${kind}: ${name} preserves Stop but supplies no completion`, t => {
      const f = fixture(t), payload = structuredClone(f.payload);
      mutate(payload);
      const result = f.hook(kind, payload);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '{}\n');
      assert.equal(result.outcome, '');
    });
  }
  for (const env of [{ FM2_TABTAIL: '' }, { FM2_TABTAIL_FINAL: '' }, { FM2_TABTAIL_BOOTSTRAPPED: '' }, { TABTAIL_CODEX_EMBEDDED: '' }]) {
    test(`${kind}: missing opt-in, inventory or local owner fails closed: ${JSON.stringify(env)}`, t => {
      const f = fixture(t), result = f.hook(kind, f.payload, env);
      assert.equal(result.status, 0);
      assert.equal(result.outcome, '');
    });
  }
  test(`${kind}: malformed input and existing descriptor contents cannot become completion`, t => {
    const f = fixture(t);
    assert.equal(f.hook(kind, '{').outcome, '');
    assert.equal(f.hook(kind, f.payload, {}, 'existing').outcome, 'existing');
  });
  for (const phase of ['requested', 'scheduled', 'applying']) {
    test(`${kind}: an effort ${phase} remains a handoff`, t => {
      const f = fixture(t), task = kind === 'supervisor' ? 'controller:fixture' : 'worker';
      mkdirSync(join(f.home, 'efforts'));
      writeFileSync(join(f.home, 'efforts', `${encodeURIComponent(task)}.json`), JSON.stringify({
        pending: { agent: 'codex', status: phase, effort: 'high', token: 'fixture' } }));
      // Scheduled/applying cannot launch anything. Requested schedules only a
      // disposable fake tmux command, never an actual effort transition.
      const bin = join(f.home, 'bin'); mkdirSync(bin);
      writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const result = f.hook(kind, f.payload, { PATH: `${bin}:${process.env.PATH}` });
      assert.equal(result.status, 0);
      assert.deepEqual(JSON.parse(result.outcome), { version: 1, outcome: 'handoff' });
    });
  }
  test(`${kind}: fleet-owned lifecycle Stop supplies handoff and no report`, t => {
    const f = fixture(t), task = kind === 'supervisor' ? 'controller:fixture' : 'worker';
    mkdirSync(join(f.home, 'provider-updates'));
    writeFileSync(join(f.home, 'provider-updates/state.json'), JSON.stringify({
      current: { provider: 'codex', status: 'stopping', stopping_task: task } }));
    const result = f.hook(kind);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.outcome), { version: 1, outcome: 'handoff' });
  });
  test(`${kind}: lifecycle state read error never grants completion`, t => {
    const f = fixture(t);
    mkdirSync(join(f.home, 'provider-updates'));
    writeFileSync(join(f.home, 'provider-updates/state.json'), 'null');
    assert.equal(f.hook(kind).outcome, '');
  });
}

test('quiet worker stays silent and an unread report blocks the controller without outcome', t => {
  const f = fixture(t);
  writeFileSync(join(f.home, 'tasks/worker.json'), JSON.stringify({ id: 'worker', agent: 'codex', quiet: true }));
  assert.equal(f.hook('worker').outcome, '');
  mkdirSync(join(f.home, 'notify'));
  writeFileSync(join(f.home, 'notify', '1-worker.json'), JSON.stringify({ task: 'worker', text: 'report', panel: null }));
  const result = f.hook('supervisor');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Run `fm read`/);
  assert.equal(result.outcome, '');
});

test('invalid, standard, tty and pipe descriptors cannot alter Stop stdout or block it', t => {
  const f = fixture(t);
  for (const fd of ['0', '1', '2', '3', '-1', 'abc', '99999999999999999']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {stopOutcome} from ${JSON.stringify(join(ROOT, 'lib/tabtail.mjs'))}; stopOutcome('completed'); console.log('original');`], {
      env: { ...process.env, TABTAIL_STOP_OUTCOME_FD: fd }, encoding: 'utf8', timeout: 1000,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'original\n');
    assert.equal(result.output[3], '');
  }
});

test('future worker/controller opt-in preserves exact resumes, hooks, effort and remote identity', t => {
  const f = fixture(t);
  for (const enabled of ['', '1']) {
    process.env.FM2_TABTAIL = enabled;
    const settingsFile = writeWorkerSettings('worker', 'codex');
    const worker = launchCommand({ agent: 'codex', id: 'worker', settingsFile, resume: 'exact-session', effort: 'xhigh', project: f.home });
    const controller = supervisorCommand({ agent: 'codex', panel: 'fixture', resume: 'exact-controller', effort: 'xhigh' });
    for (const command of [worker, controller]) {
      assert.equal(command.includes('--no-daemon'), enabled === '1');
      assert.equal(command.includes('--dangerously-bypass-hook-trust'), enabled !== '1');
      assert.equal(command.includes('tabtail.py'), enabled === '1');
      assert.match(command, /xhigh/);
      assert.doesNotMatch(command, /--last|--continue/);
    }
    assert.match(worker, /FM_REMOTE='yes'/);
    assert.match(worker, /exact-session/);
    assert.match(controller, /exact-controller/);
    for (const config of [workerHookConfig('worker', 'codex'), supervisorHookConfig('codex')]) {
      assert.equal(config.hooks.Stop.length, 1);
      assert.equal(config.hooks.Stop[0].hooks.length, 1);
      assert.equal(config.hooks.Stop[0].hooks[0].command.includes('tabtail.py'), enabled === '1');
      assert.ok(config.hooks.SessionStart);
    }
  }
});

for (const kind of ['worker', 'supervisor']) {
  test(`${kind}: panel and exact-run task switch suppress completion without requiring caller opt-in`, t => {
    const f = fixture(t), task = kind === 'supervisor' ? 'controller:fixture' : 'worker';
    process.env.FM2_TABTAIL = '';
    const end = beginTabtailHandoff(task, { tabtail_run: 'run-11111111' });
    process.env.FM2_TABTAIL = '1';
    assert.equal(JSON.parse(f.hook(kind).outcome).outcome, 'handoff');
    end();
    assert.equal(JSON.parse(f.hook(kind).outcome).outcome, 'completed');
    mkdirSync(join(f.home, 'panel-locks', 'fixture'), { recursive: true });
    assert.equal(JSON.parse(f.hook(kind, f.payload, { FM2_PANEL: 'fixture' }).outcome).outcome, 'handoff');
  });
  test(`${kind}: payload cannot select the outcome descriptor or finality environment`, t => {
    const f = fixture(t);
    const payload = { ...f.payload, TABTAIL_STOP_OUTCOME_FD: '1', FM2_TABTAIL_FINAL: '1' };
    const result = f.hook(kind, payload, { FM2_TABTAIL_FINAL: '' });
    assert.equal(result.stdout, '{}\n');
    assert.equal(result.outcome, '');
  });
}

test('controller schedules a provider update as handoff, while scheduling failure cannot complete', t => {
  const f = fixture(t);
  mkdirSync(join(f.home, 'provider-updates'));
  const file = join(f.home, 'provider-updates/state.json');
  const current = { provider: 'codex', requester_agent: 'codex', requested_by: 'controller:fixture', status: 'requested', token: 'fixture', panel: 'fixture' };
  const bin = join(f.home, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nprintf "%s\\n" "%99"\n', { mode: 0o755 });
  writeFileSync(file, JSON.stringify({ current }));
  assert.equal(JSON.parse(f.hook('supervisor', f.payload, { PATH: `${bin}:${process.env.PATH}` }).outcome).outcome, 'handoff');
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(file, JSON.stringify({ current }));
  assert.equal(f.hook('supervisor', f.payload, { PATH: `${bin}:${process.env.PATH}` }).outcome, '');
});

test('ordinary session bookkeeping preserves a tracked run, and an explicit untracked launch clears it', t => {
  const f = fixture(t);
  const identity = { task: 'worker', agent: 'codex', sessionId: 'session-11111111', cwd: f.home };
  rememberSession({ ...identity, tabtailRun: 'run-11111111' });
  rememberSession(identity);
  assert.equal(recordedSession({ id: 'worker' }, 'codex').tabtail_run, 'run-11111111');
  rememberSession({ ...identity, tabtailRun: null });
  assert.equal(recordedSession({ id: 'worker' }, 'codex').tabtail_run, null);
});
