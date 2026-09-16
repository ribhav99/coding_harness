import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { descendants, processTable, stopProvider } from '../lib/provider-processes.mjs';

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function fixture(t, lines) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'fm-target-cleanup-')));
  const socket = `fm-target-cleanup-${randomUUID()}`;
  const tmux = (args) => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, TMUX: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const ownedChildren = [];
  t.after(() => {
    try { tmux(['kill-server']); } catch { /* startup may have failed */ }
    for (const pid of ownedChildren) {
      try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    rmSync(base, { recursive: true, force: true });
  });
  const script = join(base, 'launch.sh');
  writeFileSync(script, ['#!/bin/sh', ...lines(base)].join('\n'));
  const id = tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fixture', '-c', base, '/bin/sh', script,
    ';', 'set-option', '-t', 'fixture', 'destroy-unattached', 'off',
    ';', 'set-option', '-g', 'default-shell', '/bin/sh',
    ';', 'set-option', '-g', 'default-command', 'exec /bin/sh']);
  const pane = { id, pid: Number(tmux(['display-message', '-p', '-t', id, '#{pane_pid}'])), cwd: base, dead: false };
  return { base, tmux, pane, ownedChildren,
    source: { id: 'failed-target-fixture', agent: 'claude', pane: id, provider_pid: null } };
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('isolated tmux fixture did not become ready');
}

test('a failed Claude target leaving only a bare shell can be cleaned up for source recovery', async (t) => {
  const f = fixture(t, () => ['/bin/sh -c "exit 127"', 'exec /bin/sh']);
  await waitFor(() => {
    const table = processTable();
    return table.find((entry) => entry.pid === f.pane.pid)?.command === '/bin/sh'
      && descendants(f.pane.pid, table).length === 0;
  });
  assert.throws(() => stopProvider(f.pane, { tmux: f.tmux, agent: 'claude', source: f.source, explicit: true }),
    /no identifiable claude process/);
  assert.equal(stopProvider(f.pane, {
    tmux: f.tmux, agent: 'claude', source: f.source, explicit: true, allowMissingProvider: true,
  }), null);
  assert.equal(f.tmux(['display-message', '-p', '-t', f.pane.id, '#{pane_dead}']), '0');
  const replacementPid = Number(f.tmux(['display-message', '-p', '-t', f.pane.id, '#{pane_pid}']));
  assert.ok(processTable().some((entry) => entry.pid === replacementPid), 'recovery pane must remain usable');
});

test('failed-target cleanup refuses a bare shell with a surviving tool and leaves both processes running', async (t) => {
  const f = fixture(t, (base) => [
    '/bin/sleep 10000 &',
    `printf '%s' "$!" > ${quote(join(base, 'tool.pid'))}`,
    'wait',
  ]);
  const pidFile = join(f.base, 'tool.pid');
  await waitFor(() => existsSync(pidFile) && Number(readFileSync(pidFile, 'utf8')) > 0);
  const toolPid = Number(readFileSync(pidFile, 'utf8'));
  f.ownedChildren.push(toolPid);
  assert.equal(processTable().find((entry) => entry.pid === toolPid)?.parent, f.pane.pid);
  assert.throws(() => stopProvider(f.pane, {
    tmux: f.tmux, agent: 'claude', source: f.source, explicit: true, allowMissingProvider: true,
  }), /no identifiable claude process/);
  const remaining = processTable();
  assert.ok(remaining.some((entry) => entry.pid === f.pane.pid), 'original shell must remain alive');
  assert.ok(remaining.some((entry) => entry.pid === toolPid), 'surviving tool must remain alive');
  assert.equal(Number(f.tmux(['display-message', '-p', '-t', f.pane.id, '#{pane_pid}'])), f.pane.pid);
  for (const pid of [f.pane.pid, toolPid]) {
    const state = execFileSync('ps', ['-p', String(pid), '-o', 'state='], { encoding: 'utf8' }).trim();
    assert.ok(!state.includes('T'), 'refused cleanup must not leave a process suspended');
  }
});
