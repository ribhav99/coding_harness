import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { saveTask, loadTask } from '../lib/config.mjs';
import { rememberSession, controllerId } from '../lib/sessions.mjs';
import { recordSupervisor } from '../lib/presence.mjs';
import { record, pending } from '../lib/notify.mjs';
import { capturePanel } from '../lib/panel-layout.mjs';
import { PANEL_RUNTIME, preparePanelSwitch, executePanelSwitch } from '../lib/panel-switch.mjs';

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'fm-panel-switch-')));
  const socket = `fm-switch-${randomUUID()}`;
  const tmux = (args) => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const oldEnv = { FM2_HOME: process.env.FM2_HOME, FM2_PANEL: process.env.FM2_PANEL };
  process.env.FM2_HOME = join(base, 'state'); delete process.env.FM2_PANEL;
  t.after(() => {
    try { tmux(['kill-server']); } catch {}
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(base, { recursive: true, force: true });
  });
  const project = join(base, 'project'); mkdirSync(project);
  const git = (args) => execFileSync('git', ['-C', project, ...args], { stdio: 'ignore' });
  git(['init', '-q', '-b', 'develop']); git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'base']);
  const worker = join(base, 'project-worker'); git(['worktree', 'add', '-qb', 'worker', worker]);
  const reviewer = join(base, 'project-review'); git(['worktree', 'add', '-q', '--detach', reviewer]);
  writeFileSync(join(worker, 'uncommitted.txt'), 'must survive');
  const panel = 'fm-test';
  const agentPane = (window, cwd) => tmux(['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', panel, '-n', window, '-c', cwd, 'sleep 10000']);
  tmux(['new-session', '-d', '-s', panel, '-n', 'control', '-x', '180', '-y', '60', '-c', project, 'sleep 10000']);
  const control = tmux(['list-panes', '-t', `${panel}:control`, '-F', '#{pane_id}']);
  const shell = tmux(['split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-t', control, '-c', project, 'sleep 10000']);
  const shipPane = agentPane('workers', worker);
  const reviewPane = agentPane('reviews', reviewer);
  const extraShell = agentPane('logs-and-server', project);
  tmux(['split-window', '-d', '-v', '-t', extraShell, '-c', project, 'sleep 10000']);
  tmux(['select-window', '-t', `${panel}:workers`]);
  const providers = new Map([[control, 'claude'], [shipPane, 'claude'], [reviewPane, 'claude']]);
  const launches = [], stops = [], opens = [];
  const attachRecorder = join(base, 'tmux-attach-recorder');
  writeFileSync(attachRecorder, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  const runtime = {
    tmux, available: () => true, sync: () => {}, providerAt: (pane) => providers.get(pane.id) ?? null,
    open: (target, options) => {
      const launched = PANEL_RUNTIME.open(target, { ...options, platform: 'darwin', tmuxPath: attachRecorder,
        runAppleScript: (script, args) => opens.push({ target, options,
          args: execFileSync('/bin/sh', ['-c', args[0]], { encoding: 'utf8' }).trimEnd().split('\n') }) });
      assert.equal(launched.session, target);
    },
    stop: (pane, entry) => {
      stops.push(entry.task.id); providers.delete(pane.id);
      tmux(['respawn-pane', '-k', '-t', pane.id, '-c', pane.cwd, 'sleep 10000']);
      if (entry.source?.transcript) writeFileSync(entry.source.transcript, `${readFileSync(entry.source.transcript, 'utf8')}${JSON.stringify({ type: 'assistant', sessionId: entry.source.id, cwd: entry.task.worktree, message: { content: [{ type: 'text', text: 'final flushed event' }] } })}\n`);
    },
    start: (pane, cwd, command, agent) => {
      launches.push({ pane, cwd, command, agent }); providers.set(pane, agent);
      tmux(['respawn-pane', '-k', '-t', pane, '-c', cwd, 'sleep 10000']);
    },
  };
  const identities = [[controllerId(panel), control, project], ['worker', shipPane, worker], ['reviewer', reviewPane, reviewer]];
  for (const [id, pane, cwd] of identities) {
    const sessionId = randomUUID(), transcript = join(base, `${id.replace(':', '-')}.jsonl`);
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', cwd, sessionId, message: { content: 'Wait for the user answer and preserve all permissions.' } })}\n`);
    rememberSession({ task: id, agent: 'claude', sessionId, transcriptPath: transcript, cwd });
    if (id !== controllerId(panel)) saveTask({ id, pane, project, worktree: cwd, panel, agent: 'claude', kind: id === 'reviewer' ? 'review' : 'ship', adopted: true });
  }
  recordSupervisor(control, { panel, agent: 'claude', task: controllerId(panel) });
  record({ task: 'worker', text: 'Waiting on user.', panel });
  record({ task: 'elsewhere', text: 'Other project report.', panel: 'fm-other' });
  return { base, project, worker, reviewer, panel, control, shell, shipPane, reviewPane, runtime, launches, stops, opens, identities };
}

test('whole panel switches and back with every split, live shells, flushed transcripts, reports and worktrees preserved', (t) => {
  const f = fixture(t);
  const before = capturePanel(f.panel, { tmux: f.runtime.tmux });
  const shellPid = f.runtime.tmux(['display-message', '-p', '-t', f.shell, '#{pane_pid}']);
  const handoff = preparePanelSwitch({ panel: f.panel, agent: 'codex', targetSession: 'fm-test-codex', runtime: f.runtime });
  const result = executePanelSwitch(handoff, { runtime: f.runtime });
  assert.equal(result.phase, 'complete');
  assert.equal(f.opens.length, 1); assert.equal(f.opens[0].target, 'fm-test-codex');
  assert.equal(f.opens[0].options.socketPath, before.socketPath, 'iTerm must attach to the captured tmux server');
  assert.deepEqual(f.opens[0].args, ['-S', before.socketPath, '-CC', 'attach-session', '-t', '=fm-test-codex']);
  assert.equal(f.launches.length, 3); assert.equal(f.launches.at(-1).cwd, f.project, 'controller starts after workers');
  assert.ok(f.launches.every(({ command }) => /model_reasoning_effort="max"/.test(command)));
  assert.equal(f.runtime.tmux(['display-message', '-p', '-t', f.shell, '#{session_name}']), result.to);
  assert.equal(f.runtime.tmux(['display-message', '-p', '-t', f.shell, '#{pane_pid}']), shellPid, 'shell process restarted');
  const after = capturePanel(result.to, { tmux: f.runtime.tmux });
  assert.deepEqual(after.windows.map((w) => [w.index, w.name, w.panes.length]), before.windows.map((w) => [w.index, w.name, w.panes.length]));
  assert.equal(readFileSync(join(f.worker, 'uncommitted.txt'), 'utf8'), 'must survive');
  assert.equal(loadTask('reviewer').kind, 'review'); assert.equal(loadTask('worker').worktree, f.worker);
  assert.equal(pending(result.to).length, 1); assert.equal(pending('fm-other').length, 1);
  for (const entry of result.entries) {
    const manifest = JSON.parse(readFileSync(entry.preserved.manifestPath));
    assert.equal(readFileSync(manifest.source.transcript_snapshot, 'utf8'), readFileSync(entry.source.transcript, 'utf8'));
    assert.equal(statSync(manifest.source.transcript_snapshot).mode & 0o777, 0o600);
    assert.match(readFileSync(manifest.source.transcript_snapshot, 'utf8'), /final flushed event/);
    const targetId = randomUUID(), path = join(f.base, `${entry.task.id.replace(':', '-')}-codex.jsonl`);
    writeFileSync(path, `${JSON.stringify({ type: 'session_meta', payload: { id: targetId, cwd: entry.task.worktree } })}\n`);
    rememberSession({ task: entry.task.id, agent: 'codex', sessionId: targetId, transcriptPath: path, cwd: entry.task.worktree });
  }
  const back = preparePanelSwitch({ panel: result.to, agent: 'claude', targetSession: 'fm-test-claude-again', runtime: f.runtime });
  executePanelSwitch(back, { runtime: f.runtime, open: false });
  assert.equal(loadTask('worker').agent, 'claude');
  for (const entry of back.entries) assert.equal(entry.target.id, handoff.entries.find((old) => old.task.id === entry.task.id).source.id);
  assert.match(f.launches.at(-1).command, /--resume/);
  assert.equal(f.runtime.tmux(['display-message', '-p', '-t', f.shell, '#{pane_pid}']), shellPid);
});

test('missing or ambiguous control history refuses before stopping any source', (t) => {
  const f = fixture(t);
  const sidecar = join(process.env.FM2_HOME, 'sessions', controllerId(f.panel), 'claude.json');
  rmSync(sidecar);
  assert.throws(() => preparePanelSwitch({ panel: f.panel, agent: 'codex', runtime: f.runtime, claudeRoot: join(f.base, 'missing') }), /needs a recorded session/i);
  assert.equal(f.stops.length, 0); assert.equal(f.opens.length, 0);
});

test('target launch failure restores original provider panes and shell processes and keeps recovery snapshots', (t) => {
  const f = fixture(t);
  const handoff = preparePanelSwitch({ panel: f.panel, agent: 'codex', targetSession: 'fm-failed', runtime: f.runtime });
  const normalStart = f.runtime.start;
  f.runtime.start = (...args) => { if (args[3] === 'codex') throw new Error('target unavailable'); return normalStart(...args); };
  assert.throws(() => executePanelSwitch(handoff, { runtime: f.runtime, open: false }), /target unavailable.*Full recovery record/);
  assert.equal(loadTask('worker').agent, 'claude'); assert.equal(loadTask('worker').pane, f.shipPane);
  assert.equal(f.runtime.tmux(['display-message', '-p', '-t', f.shell, '#{session_name}']), f.panel);
  assert.equal(pending(f.panel).length, 1);
  assert.ok(handoff.entries.every((entry) => existsSync(entry.preserved.snapshot)));
  assert.ok(f.launches.filter((entry) => entry.agent === 'claude').length >= 3);
});

test('iTerm failure leaves source agents running and releases switch lock', (t) => {
  const f = fixture(t);
  const handoff = preparePanelSwitch({ panel: f.panel, agent: 'codex', runtime: f.runtime });
  f.runtime.open = () => { throw new Error('iTerm denied'); };
  assert.throws(() => executePanelSwitch(handoff, { runtime: f.runtime }), /iTerm denied/);
  assert.equal(f.stops.length, 0); assert.equal(f.launches.length, 0); assert.equal(existsSync(handoff.lock), false);
});
