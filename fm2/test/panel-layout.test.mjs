import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capturePanel, createPanel, applyPanelLayout, openITermPanel } from '../lib/panel-layout.mjs';

const SLEEP = 'exec /bin/sleep 2147483647';

function fixture(t) {
  const socket = `fm2-panel-test-${randomUUID()}`;
  const dir = mkdtempSync(join(tmpdir(), 'fm2-panel-test-'));
  const tmux = (args) => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, TMUX: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\n$/, '');
  t.after(() => {
    try { tmux(['kill-server']); } catch { /* creation may have failed */ }
    rmSync(dir, { recursive: true, force: true });
  });
  return { tmux, dir };
}

function newSession(tmux, name, dir, width = 120, height = 40) {
  return tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', name,
    '-n', 'source-window', '-x', String(width), '-y', String(height), '-c', dir, SLEEP]);
}

function split(tmux, pane, dir, vertical = false) {
  return tmux(['split-window', '-d', vertical ? '-v' : '-h', '-P', '-F', '#{pane_id}',
    '-t', pane, '-c', dir, SLEEP]);
}

function geometry(snapshot, map = {}) {
  return snapshot.windows.map((window) => ({
    index: window.index, name: window.name, width: window.width, height: window.height,
    zoomed: window.zoomed, active: window.id === snapshot.activeWindow,
    activePane: map[window.activePane] ?? window.activePane,
    panes: window.panes.map((pane) => ({
      id: map[pane.id] ?? pane.id, index: pane.index, cwd: pane.cwd,
      width: pane.width, height: pane.height, left: pane.left, top: pane.top,
    })),
  }));
}

test('round-trips all windows, nested splits, pane order, cwd, active pane and zoom', (t) => {
  const { tmux, dir } = fixture(t);
  const quotedDir = join(dir, "space and 'quote");
  mkdirSync(quotedDir);
  const main = newSession(tmux, 'source', dir);
  tmux(['set-option', '-w', '-t', main, 'automatic-rename', 'off']);
  tmux(['rename-window', '-t', main, ' main "quoted" ']);
  const right = split(tmux, main, quotedDir);
  const bottom = split(tmux, main, dir, true);
  split(tmux, right, quotedDir, true);
  tmux(['resize-pane', '-t', main, '-x', '43']);
  tmux(['select-pane', '-t', bottom]);
  const second = tmux(['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', 'source:4',
    '-n', 'second', '-c', dir, SLEEP]);
  const zoom = split(tmux, second, quotedDir, true);
  tmux(['resize-pane', '-Z', '-t', zoom]);
  const last = tmux(['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', 'source:7',
    '-n', 'second', '-c', dir, SLEEP]);
  tmux(['set-option', '-w', '-t', last, 'pane-base-index', '1']);
  split(tmux, last, dir);
  tmux(['select-window', '-t', second]);
  const original = capturePanel('source', { tmux });
  const map = createPanel(original, 'destination', { tmux });
  const restored = capturePanel('destination', { tmux });
  assert.deepEqual(geometry(restored), geometry(original, map));
  assert.deepEqual(geometry(capturePanel('source', { tmux })), geometry(original));
  assert.equal(tmux(['show-options', '-v', '-t', '=destination:', 'destroy-unattached']), 'off');
});

test('rebuilds a narrow vertical stack that cannot fit all horizontal placeholders', (t) => {
  const { tmux, dir } = fixture(t);
  const main = newSession(tmux, 'source', dir, 10, 80);
  for (let n = 0; n < 7; n += 1) {
    split(tmux, main, dir, true);
    tmux(['select-layout', '-t', main, 'even-vertical']);
  }
  const original = capturePanel('source', { tmux });
  const map = createPanel(original, 'destination', { tmux });
  assert.deepEqual(geometry(capturePanel('destination', { tmux })), geometry(original, map));
});

test('reapplying after process swaps preserves source process IDs and positions', (t) => {
  const { tmux, dir } = fixture(t);
  const main = newSession(tmux, 'source', dir);
  split(tmux, main, dir);
  split(tmux, main, dir, true);
  const original = capturePanel('source', { tmux });
  const map = createPanel(original, 'destination', { tmux });
  const [first, , last] = original.windows[0].panes;
  tmux(['swap-pane', '-d', '-s', map[first.id], '-t', map[last.id]]);
  const transferred = original.windows[0].panes[1];
  tmux(['swap-pane', '-d', '-s', transferred.id, '-t', map[transferred.id]]);
  map[transferred.id] = transferred.id;
  applyPanelLayout(original, map, 'destination', { tmux });
  const restored = capturePanel('destination', { tmux });
  assert.deepEqual(geometry(restored), geometry(original, map));
  assert.equal(restored.windows[0].panes.find((pane) => pane.id === transferred.id).pid, transferred.pid);
});

test('overrides inherited auto-destruction and preserves nonzero window indices', (t) => {
  const { tmux, dir } = fixture(t);
  const main = newSession(tmux, 'source', dir);
  tmux(['set-option', '-t', 'source:', 'destroy-unattached', 'off']);
  tmux(['set-option', '-t', 'source:', 'renumber-windows', 'off']);
  tmux(['move-window', '-s', main, '-t', 'source:3']);
  tmux(['set-option', '-g', 'destroy-unattached', 'on']);
  tmux(['set-option', '-g', 'renumber-windows', 'on']);
  tmux(['set-option', '-g', 'base-index', '1']);
  const original = capturePanel('source', { tmux });
  const map = createPanel(original, 'destination', { tmux });
  assert.deepEqual(geometry(capturePanel('destination', { tmux })), geometry(original, map));
  assert.equal(tmux(['show-options', '-v', '-t', '=destination:', 'destroy-unattached']), 'off');
});

test('captures dead state and full scrollback into private files', async (t) => {
  const { tmux, dir } = fixture(t);
  const main = newSession(tmux, 'source', dir, 80, 12);
  tmux(['set-option', '-w', '-t', main, 'remain-on-exit', 'on']);
  tmux(['respawn-pane', '-k', '-t', main, '/bin/sh -c \'for n in $(seq 1 90); do printf "line-%s\\n" "$n"; done; exit 7\'']);
  for (let n = 0; n < 50; n += 1) {
    if (tmux(['display-message', '-p', '-t', main, '#{pane_dead}']) === '1') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const snapshot = capturePanel('source', { tmux, scrollbackDir: join(dir, 'history') });
  const pane = snapshot.windows[0].panes[0];
  assert.equal(pane.dead, true);
  assert.ok(pane.pid > 0);
  assert.ok(pane.historySize > 0);
  const history = readFileSync(pane.scrollbackPath, 'utf8');
  assert.ok(history.includes('line-1\n'));
  assert.ok(history.includes('line-90\n'));
  assert.equal(statSync(pane.scrollbackPath).mode & 0o777, 0o600);
});

test('refuses an existing destination and bad pane maps before altering it', (t) => {
  const { tmux, dir } = fixture(t);
  newSession(tmux, 'source', dir);
  newSession(tmux, 'destination', dir);
  const original = capturePanel('source', { tmux });
  const destination = capturePanel('destination', { tmux });
  assert.throws(() => createPanel(original, 'destination', { tmux }), /already exists/);
  const sourceId = original.windows[0].panes[0].id;
  assert.throws(() => applyPanelLayout(original, {}, 'destination', { tmux }), /no target pane/);
  assert.throws(() => applyPanelLayout(original, { [sourceId]: sourceId }, 'destination', { tmux }), /outside/);
  assert.deepEqual(geometry(capturePanel('destination', { tmux })), geometry(destination));
});

test('cleans up only its new destination when creating a split fails', (t) => {
  const { tmux, dir } = fixture(t);
  const main = newSession(tmux, 'source', dir);
  split(tmux, main, dir);
  const original = capturePanel('source', { tmux });
  const failing = (args) => {
    if (args[0] === 'split-window') throw new Error('injected split failure');
    return tmux(args);
  };
  assert.throws(() => createPanel(original, 'destination', { tmux: failing }), /injected split/);
  assert.throws(() => tmux(['has-session', '-t', '=destination']));
  assert.deepEqual(geometry(capturePanel('source', { tmux })), geometry(original));
});

test('creates safely quoted iTerm control commands without interpolating AppleScript', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fm2-iterm-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const executable = join(dir, "fake tmux's executable");
  writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  const session = 'panel$(touch SHOULD_NOT_EXIST)\'";echo injected';
  const socket = join(dir, "socket '$(touch SHOULD_NOT_EXIST)");
  let invocation;
  const result = openITermPanel(session, {
    tmuxPath: executable, socketPath: socket, platform: 'darwin', placement: 'window',
    runAppleScript: (script, args) => { invocation = { script, args }; },
  });
  assert.ok(!invocation.script.includes(session));
  assert.deepEqual(invocation.args, [result.command, 'window']);
  const output = execFileSync('/bin/sh', ['-c', result.command], { encoding: 'utf8', cwd: dir });
  assert.deepEqual(output.trimEnd().split('\n'), ['-S', socket, '-CC', 'attach-session', '-t', `=${session}`]);
  assert.throws(() => statSync(join(dir, 'SHOULD_NOT_EXIST')), { code: 'ENOENT' });
  assert.throws(() => openITermPanel('panel', { platform: 'linux' }), /require macOS/);
});
