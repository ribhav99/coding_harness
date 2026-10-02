import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { paneProcesses, sharedCodexServer, processTable, providerProcess, providerAt, sessionOwnership, stopProvider } from '../lib/provider-processes.mjs';

test('a shared Codex daemon and its tools are not owned by its original terminal client', () => {
  const daemon = { pid: 113, parent: 110, command: '/bin/codex' };
  const updater = { pid: 115, parent: 110, command: '/bin/codex' };
  const table = [...TABLE, daemon, { pid: 114, parent: 113, command: '/bin/sh' }, updater];
  const args = new Map([[113, '/bin/codex app-server --listen unix:// --managed-daemon'],
    [115, '/bin/codex app-server daemon pid-update-loop']]);
  const isSharedServer = entry => sharedCodexServer(entry, pid => args.get(pid) ?? entry.command);
  assert.equal(isSharedServer(daemon), true);
  assert.equal(isSharedServer(updater), true);
  assert.equal(sharedCodexServer(daemon, () => '/bin/codex explain app-server --listen unix:// --managed-daemon'), false);
  assert.deepEqual(paneProcesses(PANE, table, { protectSharedServers: true, isSharedServer })
    .map(entry => entry.pid), [110, 111, 112, 120]);
  assert.ok(paneProcesses(PANE, table).some(entry => entry.pid === 113));
});

const TABLE = [
  { pid: 100, parent: 1, command: '/bin/sh' },
  { pid: 110, parent: 100, command: '/Applications/ChatGPT.app/Contents/Resources/codex' },
  { pid: 111, parent: 110, command: '/bin/sh' },
  { pid: 112, parent: 111, command: '/opt/homebrew/bin/node' },
  { pid: 120, parent: 100, command: '/bin/sleep' },
  { pid: 200, parent: 1, command: '/bin/sh' },
  { pid: 210, parent: 200, command: '/Applications/ChatGPT.app/Contents/Resources/codex' },
  { pid: 211, parent: 210, command: '/bin/sh' },
  { pid: 212, parent: 211, command: '/opt/homebrew/bin/node' },
  { pid: 300, parent: 1, command: '/bin/sh' },
  { pid: 310, parent: 300, command: '/Users/test/.local/bin/claude' },
  { pid: 311, parent: 310, command: '/bin/sh' },
  { pid: 312, parent: 311, command: '/opt/homebrew/bin/node' },
];
const PANE = { id: '%4', pid: 100, cwd: '/tmp/project', dead: false };
const SOURCE = { id: 'recorded-session', agent: 'codex', pane: '%4', provider_pid: 110, backend: 'embedded' };

test('hook ancestry identifies its own controller or worker provider, not another pane', () => {
  assert.equal(providerProcess('codex', { pid: 112, table: TABLE }), 110);
  assert.equal(providerProcess('codex', { pid: 212, table: TABLE }), 210);
  assert.equal(providerProcess('claude', { pid: 312, table: TABLE }), 310);
  assert.equal(providerProcess('codex', { pid: 312, table: TABLE }), null);
  assert.equal(providerProcess('codex', { pid: 120, table: TABLE }), null);
  assert.equal(providerAt(PANE, TABLE), 'codex');
  assert.equal(providerAt({ ...PANE, pid: 300 }, TABLE), 'claude');
});

test('stale process, foreign pane and foreign provider records refuse ownership', () => {
  for (const changes of [{ provider_pid: 999 }, { pane: '%99' }, { provider_pid: 210 }, { provider_pid: null }]) {
    assert.throws(() => sessionOwnership(PANE, { ...SOURCE, ...changes }, { table: TABLE }), /hook-recorded session identity/);
  }
  assert.throws(() => sessionOwnership(PANE, { ...SOURCE, provider_pid: 999 }, { table: TABLE, explicit: true }), /hook-recorded session identity/);
  assert.equal(sessionOwnership(PANE, { ...SOURCE, provider_pid: null }, { table: TABLE, explicit: true }), 'daemon');
});

test('only a matching live provider record can authorize the embedded backend', () => {
  assert.equal(sessionOwnership(PANE, SOURCE, { table: TABLE }), 'embedded');
  assert.throws(() => sessionOwnership(PANE, { ...SOURCE, provider_pid: 120 }, { table: TABLE }), /hook-recorded session identity/);
  assert.throws(() => sessionOwnership(PANE, { ...SOURCE, agent: 'claude' }, { table: TABLE }), /hook-recorded session identity/);
  const promptWithConfigFlag = TABLE.map((entry) => ({ ...entry,
    args: entry.pid === 110 ? 'codex please explain -c shell_environment_policy.set in this prompt' : entry.command }));
  assert.equal(sessionOwnership(PANE, { ...SOURCE, backend: null }, { table: promptWithConfigFlag }), 'daemon');
  assert.equal(sessionOwnership(PANE, { ...SOURCE, backend: 'daemon' }, { table: promptWithConfigFlag }), 'daemon');
});

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

test('a pane-spawned daemon stops only after exclusive ownership is verified and is not queried after exit', t => {
  const entries = [
    { pid: 100, parent: 1, command: '/bin/sh' },
    { pid: 110, parent: 100, command: '/bin/codex' },
    { pid: 113, parent: 110, command: '/bin/codex' },
    { pid: 114, parent: 113, command: '/bin/sh' },
    { pid: 115, parent: 110, command: '/bin/codex' },
  ];
  const alive = new Map(entries.map(entry => [entry.pid, entry]));
  const signalled = [];
  let rpcCount = 0;
  let rejectExclusive = true;
  t.mock.method(childProcess, 'execFileSync', (file, args) => {
    if (file === 'ps' && args.includes('-A')) {
      return [...alive.values()].map(entry => `${entry.pid} ${entry.parent} ${entry.command}`).join('\n');
    }
    if (file === 'ps') {
      const pid = Number(args[1]);
      return pid === 113 ? '/bin/codex app-server --listen unix:// --managed-daemon'
        : pid === 115 ? '/bin/codex app-server daemon pid-update-loop' : alive.get(pid).command;
    }
    if (file === process.execPath && args[0].endsWith('/codex-control.mjs')) {
      assert.equal(args.at(-1), '--exclusive-server');
      assert.equal(args[1], SOURCE.id);
      if (rejectExclusive) throw new Error('other loaded conversations');
      rpcCount += 1;
      assert.ok(alive.has(113), 'must not query a server that has already exited');
      return JSON.stringify({ id: SOURCE.id, goal: null, children: [] });
    }
    assert.fail(`unexpected command ${file}`);
  });
  t.mock.method(process, 'kill', (pid, signal) => {
    signalled.push({ pid, signal });
    if (signal === 'SIGTERM') alive.delete(pid);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const options = { tmux: () => '', agent: 'codex', source: { ...SOURCE, backend: 'daemon' } };
  assert.throws(() => stopProvider(PANE, options), /other loaded conversations/u);
  assert.deepEqual(signalled, [], 'failed exclusivity must not signal any process');
  rejectExclusive = false;
  stopProvider(PANE, options);
  assert.equal(rpcCount, 1);
  assert.deepEqual(new Set(signalled.filter(entry => entry.signal === 'SIGTERM').map(entry => entry.pid)),
    new Set([110, 113, 114, 115]));
  assert.ok(alive.has(100), 'the pane shell is not a provider tool');
});

test('embedded stop returns only after the real provider and sibling tool exit', async (t) => {
  const execute = childProcess.execFileSync;
  t.mock.method(childProcess, 'execFileSync', (file, args, options) => {
    if (file === process.execPath && args?.some((arg) => String(arg).endsWith('/codex-control.mjs'))) {
      throw new Error('Codex RPC is forbidden in this isolated fixture');
    }
    return execute(file, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'fm-provider-stop-')));
  const socket = `fm-provider-stop-${randomUUID()}`;
  const tmux = (args) => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], {
    encoding: 'utf8', timeout: 5_000, env: { ...process.env, TMUX: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  let observedPids = [];
  t.after(() => {
    try { tmux(['kill-server']); } catch { /* startup may have failed */ }
    for (const pid of observedPids) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    rmSync(base, { recursive: true, force: true });
  });
  const binary = join(base, 'codex');
  const providerPidPath = join(base, 'provider.pid');
  const toolPidPath = join(base, 'tool.pid');
  const script = join(base, 'launch.sh');
  symlinkSync('/bin/sleep', binary);
  writeFileSync(script, [
    '#!/bin/sh',
    `${quote(binary)} 10000 &`,
    `printf '%s' "$!" > ${quote(providerPidPath)}`,
    '/bin/sleep 10000 &',
    `printf '%s' "$!" > ${quote(toolPidPath)}`,
    'wait',
  ].join('\n'));
  const paneId = tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fixture', '-c', base, '/bin/sh', script,
    ';', 'set-option', '-t', 'fixture', 'destroy-unattached', 'off',
    ';', 'set-option', '-g', 'default-shell', '/bin/sh',
    ';', 'set-option', '-g', 'default-command', 'exec /bin/sleep 10000']);
  for (let attempt = 0; attempt < 200 && (!existsSync(providerPidPath) || !existsSync(toolPidPath)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const providerPid = Number(readFileSync(providerPidPath, 'utf8'));
  const toolPid = Number(readFileSync(toolPidPath, 'utf8'));
  assert.ok(providerPid > 0 && toolPid > 0);
  observedPids = [providerPid, toolPid];
  const pane = { id: paneId, pid: Number(tmux(['display-message', '-p', '-t', paneId, '#{pane_pid}'])), cwd: base, dead: false };
  const table = processTable();
  assert.equal(table.find((entry) => entry.pid === providerPid).parent, pane.pid);
  assert.equal(table.find((entry) => entry.pid === toolPid).parent, pane.pid);
  const source = { id: randomUUID(), agent: 'codex', pane: pane.id, provider_pid: providerPid, backend: 'embedded' };
  assert.equal(sessionOwnership(pane, source, { table }), 'embedded');
  assert.equal(stopProvider(pane, { tmux, agent: 'codex', source }), null);
  const remaining = new Set(processTable().map((entry) => entry.pid));
  assert.ok(!remaining.has(providerPid), 'provider still exists after stop returned');
  assert.ok(!remaining.has(toolPid), 'writing tool still exists after stop returned');
  observedPids = [];
  assert.equal(tmux(['display-message', '-p', '-t', paneId, '#{pane_dead}']), '0', 'pane should remain usable');
});
