import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendToPane } from '../lib/pane-input.mjs';
import { knock, knockLine } from '../lib/knock.mjs';

// Protocol and error handling are shared by fm tell and Stop notifications.
test('pane input uses a private bracketed paste and exactly one Enter', () => {
  const calls = [];
  const line = 'FIRST\nUnicode: café 🐈; Enter; $(literal)\nLAST';
  const run = (args, options) => { calls.push({ args, options }); };
  sendToPane('%7', line, { run });
  const buffer = calls[0].args[2];
  assert.match(buffer, /^fm-send-/);
  assert.deepEqual(calls, [
    { args: ['load-buffer', '-b', buffer, '-'], options: { input: line } },
    { args: ['paste-buffer', '-p', '-d', '-b', buffer, '-t', '%7'], options: undefined },
    { args: ['send-keys', '-t', '%7', 'Enter'], options: undefined },
  ]);
  sendToPane('%8', line, { run });
  assert.notEqual(calls[3].args[2], buffer, 'sends in one process reused a buffer');
});

for (const failed of ['load-buffer', 'paste-buffer', 'send-keys']) {
  test(`a ${failed} failure is reported without a second Enter or a leftover buffer`, async () => {
    const calls = [];
    const send = (pane, line) => sendToPane(pane, line, { run: args => {
      calls.push(args);
      if (args[0] === failed) throw new Error('fixture failure');
    } });
    const result = await knock('worker', { panel: null, pane: '%7', send });
    assert.equal(result.knocked, false);
    assert.equal(result.reason, failed === 'send-keys'
      ? 'the line was typed but never submitted' : 'the supervisor pane did not take the line');
    assert.equal(calls.filter(args => args[0] === 'send-keys').length, failed === 'send-keys' ? 1 : 0);
    if (failed !== 'send-keys') {
      assert.deepEqual(calls.at(-1), ['delete-buffer', '-b', calls[0][2]]);
    }
  });
}

test('fm tell retains its actionable submission failure', () => {
  assert.throws(() => sendToPane('%7', 'message', { run: args => {
    if (args[0] === 'send-keys') throw new Error('lost pane');
  } }), /typed into %7 but not submitted/);
});

for (const command of ['tell', 'handoff']) {
  test(`fm ${command} uses the shared pane sender and reports a failed submission`, () => {
    for (const failSubmit of [false, true]) {
      const home = mkdtempSync(join(tmpdir(), 'fm-cli-pane-input-'));
      const bin = join(home, 'bin');
      const log = join(home, 'tmux.jsonl');
      mkdirSync(bin);
      mkdirSync(join(home, 'tasks'));
      writeFileSync(join(home, 'tasks', 'worker.json'), JSON.stringify({ id: 'worker', pane: '%7' }));
      writeFileSync(join(bin, 'tmux'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = args[0] === 'load-buffer' ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input }) + '\\n');
if (args[0] === 'list-panes') process.stdout.write('%7\\n');
if (args[0] === 'send-keys' && ${failSubmit}) process.exit(1);
`, { mode: 0o755 });
      const line = 'FIRST\nUnicode: café 🐈; $(literal)\nLAST';
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../cli.mjs', import.meta.url)),
        command, 'worker', ...(command === 'tell' ? [line] : [])], {
        encoding: 'utf8',
        env: { ...process.env, FM2_HOME: home, FM2_TASK: '', FM2_PANEL: '', FM2_AGENT: '',
          FM2_CODEX_BACKEND: '', TMUX: '', TMUX_PANE: '', PATH: `${bin}:${process.env.PATH}` },
      });
      assert.equal(result.status, failSubmit ? 1 : 0, result.stderr);
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(calls.map(call => call.args[0]), ['list-panes', 'load-buffer', 'paste-buffer', 'send-keys']);
      const buffer = calls[1].args[2];
      assert.match(buffer, /^fm-send-\d+-[0-9a-f-]{36}$/, 'CLI used the obsolete process-only buffer');
      assert.deepEqual(calls[2].args, ['paste-buffer', '-p', '-d', '-b', buffer, '-t', '%7']);
      assert.deepEqual(calls[3].args, ['send-keys', '-t', '%7', 'Enter']);
      if (command === 'tell') assert.equal(calls[1].input, line);
      else assert.match(calls[1].input, /review your own work on this PR/);
      if (failSubmit) {
        assert.match(result.stderr, /typed into %7 but not submitted/);
        assert.equal(result.stdout, '');
      }
      if (command === 'handoff') {
        const task = JSON.parse(readFileSync(join(home, 'tasks', 'worker.json'), 'utf8'));
        assert.equal(task.handoff_stage, failSubmit ? undefined : 'awaiting-self-review');
      }
    }
  });
}

test('panel handoff protection runs before any pane input', async () => {
  const previous = process.env.FM2_HOME;
  process.env.FM2_HOME = mkdtempSync(join(tmpdir(), 'fm-knock-lock-'));
  try {
    const { dir } = await import('../lib/config.mjs');
    writeFileSync(join(dir('panel-locks'), 'locked'), '{}');
    const result = await knock('worker', { panel: 'locked', pane: '%7', send: () => {
      assert.fail('input during panel handoff');
    } });
    assert.deepEqual(result, { knocked: false, reason: 'panel handoff in progress; report remains queued' });
  } finally {
    if (previous === undefined) delete process.env.FM2_HOME;
    else process.env.FM2_HOME = previous;
  }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description, screen = () => '') {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  assert.fail(`${description}\n${screen()}`);
}

test('worker Stop reports reach a real raw PTY using the Claude/Codex paste protocol', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-knock-pty-'));
  const socket = `fm-knock-pty-${process.pid}`;
  const tmux = args => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], {
    encoding: 'utf8', timeout: 5000,
  }).trim();
  try {
    const out = join(root, 'arrived');
    const pane = tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fixture',
      'sh', '-c', `stty -icanon -echo min 1 time 0; printf '\\033[?2004h'; cat > "$1"`, 'fixture', out]);
    await until(() => existsSync(out), 'raw PTY did not start');
    const tmuxAddress = `${tmux(['display-message', '-p', '-t', pane, '#{socket_path}'])},0,0`;
    for (const workerAgent of ['claude', 'codex']) {
      const home = join(root, workerAgent);
      mkdirSync(home);
      // Deliberately opposite to the stopping worker. The pane routes the knock,
      // while these labels must never select a different transport or destination.
      writeFileSync(join(home, 'supervisor-pane.json'), JSON.stringify({
        pane, panel: null, agent: workerAgent === 'codex' ? 'claude' : 'codex',
      }));
      const before = readFileSync(out, 'utf8');
      for (const task of ['first', 'second']) {
        const output = execFileSync(process.execPath, [fileURLToPath(new URL('../hooks/worker-stop.mjs', import.meta.url))], {
          input: JSON.stringify({ last_assistant_message: `${task} report` }), encoding: 'utf8',
          env: { ...process.env, FM2_HOME: home, TMUX: tmuxAddress, TMUX_PANE: '',
            FM2_PANEL: '', FM2_TASK: task, FM2_AGENT: workerAgent, FM2_CODEX_BACKEND: '' },
        });
        assert.equal(output, workerAgent === 'codex' ? '{}\n' : '');
      }
      const expected = `\x1b[200~${knockLine('first')}\x1b[201~\n`;
      await until(() => readFileSync(out, 'utf8').slice(before.length) === expected,
        `${workerAgent} Stop input was not one intact paste and one Enter`);
      assert.equal(readdirSync(join(home, 'notify')).filter(file => file.endsWith('.json')).length, 2,
        'queue deduplication lost a worker report');
      assert.equal(tmux(['list-buffers']), '', 'the message was left on the paste stack');
    }
  } finally {
    try { tmux(['kill-server']); } catch { /* only this fixture socket */ }
  }
});

// Opt in: starts only a disposable Codex TUI, with an empty home, no daemon,
// no hooks/auth and a localhost-only model endpoint. No live panes are touched.
// SIGSTOP makes receiver scheduling deterministic: all input is waiting when
// it resumes. A sender-side sleep cannot separate that input into key bursts.
test('real Codex accepts idle and busy knocks after receiver backpressure', {
  skip: process.env.FM2_CODEX_TUI_TEST !== '1' && 'set FM2_CODEX_TUI_TEST=1 to exercise the installed Codex TUI',
  timeout: 60_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-knock-codex-'));
  const socket = `fm-knock-${process.pid}`;
  const tmux = args => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], {
    encoding: 'utf8', timeout: 5000,
  }).trim();
  // No model requests leave the machine; keep the first turn busy at localhost.
  const { createServer } = await import('node:http');
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  writeFileSync(join(root, 'config.toml'), `model = "fixture-model"
model_provider = "fixture"
check_for_update_on_startup = false
[model_providers.fixture]
name = "Local fixture"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
requires_openai_auth = false
[projects.${JSON.stringify(root)}]
trust_level = "trusted"
`);
  const previous = process.env.TMUX;
  let suspended = null;
  try {
    const pane = tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fixture', '-x', '160', '-y', '40',
      'env', '-u', 'FM2_TASK', '-u', 'FM2_PANEL', '-u', 'FM2_AGENT', '-u', 'FM2_CODEX_BACKEND',
      '-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY',
      `CODEX_HOME=${root}`, 'codex', '--no-daemon', '--no-alt-screen', '-C', root]);
    process.env.TMUX = `${tmux(['display-message', '-p', '-t', pane, '#{socket_path}'])},0,0`;
    const screen = () => tmux(['capture-pane', '-p', '-t', pane]);
    await until(() => screen().includes('Ask Codex to do anything'), 'Codex did not become ready', screen);
    const parent = Number(tmux(['display-message', '-p', '-t', pane, '#{pane_pid}']));
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' })
      .trim().split('\n').map(row => row.trim().split(/\s+/));
    const descendants = new Set([parent]);
    for (let i = 0; i < rows.length; i++) {
      for (const [pid, ppid] of rows) if (descendants.has(Number(ppid))) descendants.add(Number(pid));
    }
    const native = rows.find(([pid, , command]) => descendants.has(Number(pid)) && /(?:^|\/)codex$/.test(command));
    assert.ok(native, 'could not identify disposable Codex native process');
    const codexPid = Number(native[0]);
    const history = () => {
      try { return readFileSync(join(root, 'history.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); }
      catch { return []; }
    };
    for (const state of ['idle', 'busy']) {
      const task = `receiver-${state}`;
      // Suspend only the native process we launched, never a discovered live session.
      process.kill(codexPid, 'SIGSTOP');
      suspended = codexPid;
      const result = await knock(task, { panel: null, pane });
      process.kill(codexPid, 'SIGCONT');
      suspended = null;
      assert.equal(result.knocked, true);
      // History is written by Codex on submit, not by tmux or the test sender.
      await until(() => history().some(item => item.text === knockLine(task)), `${state} knock stayed in the composer`, screen);
      assert.equal(history().filter(item => item.text === knockLine(task)).length, 1);
      if (state === 'idle') await until(() => screen().includes('esc to interrupt'), 'first turn did not start', screen);
    }
  } finally {
    if (suspended) process.kill(suspended, 'SIGCONT');
    try { tmux(['kill-server']); } catch { /* only this fixture socket */ }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.TMUX;
    else process.env.TMUX = previous;
  }
});
