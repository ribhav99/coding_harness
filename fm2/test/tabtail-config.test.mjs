import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { tabtailChoice, rememberTabtailChoice } from '../lib/tabtail-config.mjs';
import { launchCommand, writeWorkerSettings } from '../lib/launch.mjs';
import { supervisorCommand } from '../supervisor.mjs';
import { TABTAIL_LAUNCH_STATE } from '../lib/tabtail.mjs';
import { loadTask, removeTask, saveTask } from '../lib/config.mjs';
import { requestEffort, schedulePendingEffort } from '../lib/effort.mjs';
import { shellQuote } from '../lib/shell.mjs';
import { seedModelCatalog } from './model-fixture.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fm-tabtail-config-'));
  const relay = join(root, "Relay's runtime");
  mkdirSync(join(relay, 'venv/bin'), { recursive: true });
  mkdirSync(join(relay, 'adapter/relay_adapter'), { recursive: true });
  // Inspect only the named integration keys, never the inherited environment.
  const inspector = `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),state:Object.fromEntries(${JSON.stringify(TABTAIL_LAUNCH_STATE)}.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]])),choice:process.env.FM2_TABTAIL,relay:process.env.FM2_TABTAIL_RELAY}));\n`;
  writeFileSync(join(relay, 'venv/bin/python'), inspector, { mode: 0o700 });
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'codex'), inspector, { mode: 0o700 });
  const keys = ['FM2_HOME', 'FM2_TASK', 'FM2_AGENT', 'FM2_TABTAIL', 'FM2_TABTAIL_RELAY', 'FM2_PANEL', 'PATH', ...TABTAIL_LAUNCH_STATE];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys.filter(key => key !== 'PATH')) delete process.env[key];
  Object.assign(process.env, { FM2_HOME: root, FM2_TASK: '', FM2_PANEL: '', PATH: `${bin}:${process.env.PATH}` });
  seedModelCatalog(root, t);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const config = value => writeFileSync(join(root, 'tabtail.json'), JSON.stringify(value), { mode: 0o600 });
  const worker = (id = 'one', agent = 'codex') => launchCommand({ agent, id,
    settingsFile: writeWorkerSettings(id, agent), resume: 'exact-native-id', project: null });
  return { root, relay, config, worker };
}

test('absent/invalid/disabled config and absent runtime preserve ordinary launch and hook paths', t => {
  const f = fixture(t);
  const bad = [null, [], {}, { version: 2, enabled: true, relay: f.relay },
    { version: 1, enabled: 'true', relay: f.relay }, { version: 1, enabled: true, relay: 'relative' },
    { version: 1, enabled: true, relay: '/absent/runtime' }, { version: 1, enabled: false }];
  for (const value of [undefined, ...bad]) {
    if (value !== undefined) f.config(value);
    const command = f.worker();
    assert.equal(tabtailChoice('one').enabled, false);
    assert.match(command, /--dangerously-bypass-hook-trust/);
    assert.doesNotMatch(command, /tabtail\.py/);
    assert.doesNotMatch(readFileSync(join(f.root, 'hooks/one-codex.json'), 'utf8'), /tabtail\.py/);
  }
  writeFileSync(join(f.root, 'tabtail.json'), '{broken');
  assert.equal(tabtailChoice('one').enabled, false);
  f.config({ version: 1, enabled: true, relay: f.relay });
  chmodSync(join(f.root, 'tabtail.json'), 0o666);
  assert.equal(tabtailChoice('one').enabled, false);
  rmSync(join(f.root, 'tabtail.json'));
  symlinkSync(join(f.root, 'hooks/one-codex.json'), join(f.root, 'tabtail.json'));
  assert.equal(tabtailChoice('one').enabled, false);
});

test('app config automatically composes both launch paths, and disabled config revokes saved choice without erasing it', t => {
  const f = fixture(t);
  f.worker(); // Default-off is not persisted as an explicit opt-out.
  assert.equal(existsSync(join(f.root, 'tabtail-launches/one.json')), false);
  f.config({ version: 1, enabled: true, relay: f.relay });
  for (const command of [f.worker(), supervisorCommand({ agent: 'codex', panel: 'test' })]) {
    assert.match(command, /tabtail\.py/);
    assert.match(command, /--no-daemon/);
    assert.doesNotMatch(command, /--dangerously-bypass-hook-trust/);
  }
  const saved = readFileSync(join(f.root, 'tabtail-launches/one.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), { version: 1, enabled: true, relay: f.relay });
  f.config({ version: 1, enabled: false });
  assert.doesNotMatch(f.worker(), /tabtail\.py/);
  assert.equal(readFileSync(join(f.root, 'tabtail-launches/one.json'), 'utf8'), saved);
  f.config({ version: 1, enabled: true, relay: f.relay });
  assert.match(f.worker(), /tabtail\.py/);
});

test('explicit choice and quoted runtime survive a clean caller and provider round trip without infecting other tasks', t => {
  const f = fixture(t);
  Object.assign(process.env, { FM2_TASK: 'one', FM2_TABTAIL: '1', FM2_TABTAIL_RELAY: f.relay });
  assert.match(f.worker(), /tabtail\.py/);
  assert.doesNotMatch(f.worker('two'), /tabtail\.py/);
  delete process.env.FM2_TABTAIL; delete process.env.FM2_TABTAIL_RELAY;
  assert.match(f.worker(), /tabtail\.py/);
  assert.doesNotMatch(f.worker('one', 'claude'), /tabtail\.py/);
  assert.match(f.worker(), /tabtail\.py/);
  Object.assign(process.env, { FM2_TABTAIL: '0' });
  assert.doesNotMatch(f.worker(), /tabtail\.py/);
  delete process.env.FM2_TABTAIL;
  assert.equal(tabtailChoice('one').enabled, false);
  saveTask({ id: 'one' }); removeTask('one');
  assert.equal(existsSync(join(f.root, 'tabtail-launches/one.json')), false);
});

test('both launch executors strip stale owner/source/readiness while retaining exact native argv', t => {
  const f = fixture(t);
  for (const key of TABTAIL_LAUNCH_STATE) process.env[key] = 'stale-fixture';
  for (const enabled of [true, false]) {
    f.config({ version: 1, enabled, relay: f.relay });
    for (const command of [f.worker(), supervisorCommand({ agent: 'codex', panel: 'test', resume: 'exact-native-id' })]) {
      const result = spawnSync('/bin/sh', ['-c', command], { env: process.env, encoding: 'utf8', timeout: 2000 });
      assert.equal(result.status, 0, result.stderr);
      const observed = JSON.parse(result.stdout);
      assert.deepEqual(observed.state, {});
      assert.equal(observed.choice, enabled ? '1' : undefined);
      assert.ok(observed.args.includes('exact-native-id'));
      if (enabled) assert.equal(observed.relay, f.relay);
    }
  }
});

test('optional persistence failure and unusable runtime remain bounded, with valid provider commands', t => {
  const f = fixture(t);
  f.config({ version: 1, enabled: true, relay: f.relay });
  const python = join(f.relay, 'venv/bin/python');
  chmodSync(python, 0o600);
  assert.equal(tabtailChoice('one').enabled, false);
  chmodSync(python, 0o700);
  const interpreter = readFileSync(python);
  rmSync(python); mkdirSync(python);
  assert.equal(tabtailChoice('one').enabled, false);
  rmSync(python, { recursive: true }); writeFileSync(python, interpreter, { mode: 0o700 });
  writeFileSync(join(f.root, 'tabtail-launches'), 'blocked');
  assert.equal(rememberTabtailChoice('one').enabled, false);
  assert.doesNotMatch(f.worker(), /tabtail\.py/);
  rmSync(join(f.relay, 'venv/bin/python'));
  assert.doesNotMatch(f.worker(), /tabtail\.py/);
  assert.equal(tabtailChoice('one').enabled, false);
});

for (const selection of ['default', 'explicit-off', 'machine-disabled']) {
  test(`effort scheduling preserves ${selection} selection across later app enable`, t => {
    const f = fixture(t);
    const probe = join(f.root, 'replacement-launch.mjs');
    writeFileSync(probe, `
      import { launchCommand, writeWorkerSettings } from ${JSON.stringify(new URL('../lib/launch.mjs', import.meta.url).href)};
      import { supervisorCommand } from ${JSON.stringify(new URL('../supervisor.mjs', import.meta.url).href)};
      const id = process.env.FM2_TASK;
      if (id.startsWith('controller:')) supervisorCommand({ agent: 'codex', id, panel: 'test', resume: 'exact-native-id' });
      else launchCommand({ agent: 'codex', id, settingsFile: writeWorkerSettings(id, 'codex'), resume: 'exact-native-id', project: null });
    `);
    for (const id of ['worker', 'controller:test']) {
      rmSync(join(f.root, 'tabtail.json'), { force: true });
      process.env.FM2_TASK = id;
      if (selection !== 'default') {
        f.config({ version: 1, enabled: true, relay: f.relay });
        if (selection === 'explicit-off') process.env.FM2_TABTAIL = '0';
        f.worker(id);
        delete process.env.FM2_TABTAIL;
        if (selection === 'machine-disabled') f.config({ version: 1, enabled: false });
      }
      requestEffort(id, 'codex', 'xhigh', { current: 'high' });
      let command;
      schedulePendingEffort(id, 'codex', { run: (_, args) => { command = args[2]; } });
      // Execute the real scheduler environment with an isolated launch builder
      // instead of stopping a provider. The native suite covers actual apply.
      const replacement = command.replace(shellQuote(new URL('../effort-apply.mjs', import.meta.url).pathname), shellQuote(probe));
      assert.notEqual(replacement, command);
      const result = spawnSync('/bin/sh', ['-c', replacement], {
        env: { ...process.env, FM2_TABTAIL: '1', FM2_TABTAIL_RELAY: '/stale-server-runtime' },
        encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.status, 0, result.stderr);
      const saved = join(f.root, 'tabtail-launches', `${encodeURIComponent(id)}.json`);
      if (selection === 'default') assert.equal(existsSync(saved), false, 'ordinary default became a saved opt-out');
      f.config({ version: 1, enabled: true, relay: f.relay });
      assert.equal(tabtailChoice(id).enabled, selection !== 'explicit-off');
    }
  });
}

test('task closure tolerates absent optional storage and retains a retryable record on cleanup failure', t => {
  const f = fixture(t);
  saveTask({ id: 'one' });
  writeFileSync(join(f.root, 'tabtail-launches'), 'blocked');
  assert.equal(removeTask('one'), true);
  assert.equal(loadTask('one'), null);
  rmSync(join(f.root, 'tabtail-launches'));
  mkdirSync(join(f.root, 'tabtail-launches/one.json'), { recursive: true });
  saveTask({ id: 'one' });
  assert.throws(() => removeTask('one'), { code: 'ERR_FS_EISDIR' });
  assert.deepEqual(loadTask('one'), { id: 'one' });
  rmSync(join(f.root, 'tabtail-launches/one.json'), { recursive: true });
  assert.equal(removeTask('one'), true);
});
