import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTasks, loadTask, saveTask } from '../lib/config.mjs';
import { currentPanel, recordSupervisor, supervisorPane, supervisorRecord } from '../lib/presence.mjs';
import { controllerId, recordedSession, rememberSession, resolveSession, resumableSession } from '../lib/sessions.mjs';
import { supervisorCommand, supervisorHookConfig } from '../supervisor.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'fm2-provider-sessions-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const values = {
    FM2_HOME: home, FM2_PANEL: 'fm-one', FM2_AGENT: 'codex', FM2_TASK: 'controller:fm-one',
    TMUX_PANE: '%11', FM2_TEST_PANES: join(home, 'panes.json'), FM2_TEST_ARGS: join(home, 'args.json'),
    PATH: `${bin}:${process.env.PATH}`,
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  const script = (name, body) => writeFileSync(join(bin, name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  script('tmux', `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'display-message') process.exit(1);
const panel = JSON.parse(fs.readFileSync(process.env.FM2_TEST_PANES, 'utf8'))[args[args.indexOf('-t') + 1]];
if (!panel) process.exit(1);
process.stdout.write(panel + '\\n');\n`);
  for (const provider of ['claude', 'codex']) {
    script(provider, `require('node:fs').writeFileSync(process.env.FM2_TEST_ARGS, JSON.stringify({args: process.argv.slice(2), env: Object.fromEntries(['FM2_HOME','FM2_TASK','FM2_PANEL','FM2_AGENT'].map(k => [k,process.env[k]]))}));\n`);
  }
  const setPanes = (panes) => writeFileSync(values.FM2_TEST_PANES, JSON.stringify(panes));
  setPanes({ '%11': 'fm-one', '%22': 'fm-two' });
  const transcript = (agent, id, cwd = home, events = []) => {
    const file = join(home, `${agent}-${id}.jsonl`);
    const meta = agent === 'codex'
      ? { type: 'session_meta', payload: { id, cwd } }
      : { type: 'user', sessionId: id, cwd, message: { content: 'fixture opening request' } };
    writeFileSync(file, [meta, ...events].map(JSON.stringify).join('\n') + '\n');
    return file;
  };
  const hook = (name, payload, env = {}) => spawnSync(process.execPath, [join(ROOT, 'hooks', name)], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { home, setPanes, transcript, hook, args: () => JSON.parse(readFileSync(values.FM2_TEST_ARGS, 'utf8')) };
}

test('controller commands deliver exact identity, full resume prompt, and a named model and permissions', (t) => {
  const f = fixture(t);
  const brief = join(f.home, "handoff ' brief.md");
  const prompt = 'Read the preserved fixture history.\nKeep its unresolved request.';
  writeFileSync(brief, prompt);
  const command = supervisorCommand({ agent: 'codex', id: 'controller:original-panel', panel: 'fm-two', briefPath: brief, resume: 'exact-codex-session' });
  execFileSync('/bin/sh', ['-c', command], { env: process.env });
  const { args, env } = f.args();
  assert.equal(args[0], 'resume');
  assert.deepEqual(args.slice(-2), ['exact-codex-session', prompt]);
  assert.equal(env.FM2_TASK, 'controller:original-panel');
  assert.equal(env.FM2_PANEL, 'fm-two');
  assert.equal(env.FM2_AGENT, 'codex');
  assert.equal(env.FM2_HOME, f.home);
  assert.ok(args.some((arg) => arg.startsWith('hooks.SessionStart=')));
  assert.ok(args.some((arg) => arg.startsWith('hooks.Stop=')));
  assert.ok(args.some((arg) => arg.startsWith('hooks.UserPromptSubmit=')));
  // The controller is launched on a named model at a named effort, and without
  // the approval gate that would otherwise stop an unattended pane on its first
  // command outside the workspace. `--last` is still never used: a resume names
  // its session exactly or does not happen.
  assert.ok(args.includes('model="gpt-5.6-sol"'));
  assert.ok(args.includes('model_reasoning_effort="ultra"'));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('sandbox_mode="danger-full-access"'));
  assert.ok(args.includes('--dangerously-bypass-hook-trust'));
  assert.ok(args.every((arg) => !/--last/.test(arg)));
  const next = supervisorCommand({ agent: 'codex', panel: 'fm-one' });
  execFileSync('/bin/sh', ['-c', next], { env: process.env });
  assert.deepEqual(f.args().args, args.slice(1, -2), 'panel changes should reuse the same hook definitions and trust');
});

test('the direct controller launcher supplies explicit Claude startup hooks and exact resume', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [join(ROOT, 'supervisor.mjs'), 'claude', '--panel', 'fm-two', '--id', 'controller:fm-one', '--resume', 'exact-claude-session'], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
  const { args, env } = f.args();
  assert.equal(args[args.indexOf('--resume') + 1], 'exact-claude-session');
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.deepEqual(Object.keys(settings.hooks), ['SessionStart', 'UserPromptSubmit', 'Stop']);
  assert.equal(env.FM2_TASK, 'controller:fm-one');
  assert.equal(env.FM2_PANEL, 'fm-two');
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, /supervisor-start\.mjs/);
});

test('a resumed harness controller replaces legacy project hooks while preserving other project settings', (t) => {
  const f = fixture(t);
  const folder = join(f.home, '.claude'); mkdirSync(folder);
  const settings = join(folder, 'settings.json');
  const legacy = { hooks: Object.fromEntries(['Stop', 'UserPromptSubmit'].map((event) => [event, [{ hooks: [{ type: 'command', command: `exec node "$CLAUDE_PROJECT_DIR"/fm2/hooks/supervisor-${event === 'Stop' ? 'stop' : 'start'}.mjs` }] }]])) };
  writeFileSync(settings, JSON.stringify(legacy));
  let command = supervisorCommand({ agent: 'claude', panel: 'fm-one', cwd: f.home });
  execFileSync('/bin/sh', ['-c', command], { env: process.env });
  assert.equal(f.args().args[f.args().args.indexOf('--setting-sources') + 1], 'user,local');
  assert.deepEqual(Object.keys(JSON.parse(f.args().args[f.args().args.indexOf('--settings') + 1]).hooks), ['SessionStart', 'UserPromptSubmit', 'Stop']);
  writeFileSync(settings, JSON.stringify({ ...legacy, permissions: { deny: ['Bash(custom-command)'] } }));
  command = supervisorCommand({ agent: 'claude', panel: 'fm-one', cwd: f.home });
  execFileSync('/bin/sh', ['-c', command], { env: process.env });
  assert.ok(!f.args().args.includes('--setting-sources'), 'custom project settings must remain loaded');
});

test('SessionStart records controller identity and pane without creating a worker task', (t) => {
  const f = fixture(t);
  const path = f.transcript('codex', 'controller-session');
  const started = f.hook('supervisor-start.mjs', { hook_event_name: 'SessionStart', source: 'startup', session_id: 'controller-session', transcript_path: path, cwd: f.home });
  assert.equal(started.status, 0, started.stderr);
  assert.deepEqual(allTasks(), []);
  const task = { id: controllerId('fm-one'), worktree: f.home, panel: 'fm-one', agent: 'codex' };
  const session = resolveSession(task);
  assert.equal(session.id, 'controller-session');
  assert.equal(session.transcript, path);
  assert.equal(session.pane, '%11');
  assert.equal(supervisorRecord('fm-one').task, task.id);
  assert.equal(supervisorRecord('fm-one').session_id, session.id);
  f.setPanes({ '%33': 'fm-one', '%22': 'fm-two' });
  const prompted = f.hook('supervisor-start.mjs', { hook_event_name: 'UserPromptSubmit', session_id: session.id, cwd: f.home }, { TMUX_PANE: '%33' });
  assert.equal(prompted.status, 0);
  assert.equal(recordedSession(task, 'codex').transcript, path, 'a partial event discarded the full transcript');
  assert.equal(supervisorPane('fm-one'), '%33');
  assert.equal(recordedSession(task, 'codex').pane, '%33');
});

test('both controller providers record identity through their configured startup command', (t) => {
  const f = fixture(t);
  for (const agent of ['claude', 'codex']) {
    const path = f.transcript(agent, `${agent}-identity`);
    const command = supervisorHookConfig(agent).hooks.SessionStart[0].hooks[0].command;
    const result = spawnSync('/bin/sh', ['-c', command], {
      input: JSON.stringify({ session_id: `${agent}-identity`, transcript_path: path, cwd: f.home, source: 'resume' }),
      encoding: 'utf8', env: { ...process.env, FM2_AGENT: agent },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(recordedSession({ id: 'controller:fm-one' }, agent).id, `${agent}-identity`);
  }
  assert.deepEqual(allTasks(), []);
});

test('actual pane location wins stale inherited panel state while explicit targets stay exact', (t) => {
  const f = fixture(t);
  process.env.FM2_PANEL = 'fm-two';
  assert.equal(currentPanel(), 'fm-one');
  assert.equal(currentPanel({ panel: 'fm-two' }), 'fm-two');
  assert.equal(currentPanel({ panel: null }), null);
  f.setPanes({});
  assert.equal(currentPanel(), 'fm-two');
  delete process.env.FM2_PANEL;
  assert.equal(currentPanel(), null, 'an unknown pane must never adopt some other tmux session');
});

test('supervisor lookup isolates panels and rejects a pane reused by another panel', (t) => {
  const f = fixture(t);
  recordSupervisor('%11', { panel: 'fm-one', task: 'controller:fm-one' });
  recordSupervisor('%22', { panel: 'fm-two', task: 'controller:fm-two' });
  recordSupervisor('%99', { panel: null });
  assert.equal(supervisorPane('fm-one'), '%11');
  assert.equal(supervisorPane('fm-two'), '%22');
  assert.equal(supervisorPane('fm-unknown'), null);
  f.setPanes({ '%11': 'fm-two', '%22': 'fm-two' });
  assert.equal(supervisorPane('fm-one'), null, 'the stale record redirected a report into another project');
});

test('worker SessionStart refreshes its live pane before the first Stop', (t) => {
  const f = fixture(t);
  saveTask({ id: 'worker-one', agent: 'codex', worktree: f.home, pane: '%old' });
  const path = f.transcript('codex', 'worker-session');
  const result = f.hook('worker-session.mjs', { session_id: 'worker-session', transcript_path: path, cwd: f.home }, { FM2_TASK: 'worker-one' });
  assert.equal(result.status, 0);
  assert.equal(loadTask('worker-one').pane, '%11');
  assert.equal(loadTask('worker-one').sessions.codex.panel, 'fm-one');
  f.hook('supervisor-start.mjs', { session_id: 'worker-session', transcript_path: path, cwd: f.home }, { FM2_TASK: 'worker-one' });
  assert.equal(supervisorRecord('fm-one'), null, 'inherited project hooks registered a worker as controller');
});

test('a recorded session with stale or conflicting transcript metadata cannot be resumed', (t) => {
  const f = fixture(t);
  const task = { id: 'controller:fm-one', worktree: f.home, agent: 'codex' };
  const path = f.transcript('codex', 'exact-session');
  rememberSession({ task: task.id, agent: 'codex', sessionId: 'exact-session', transcriptPath: path, cwd: f.home });
  assert.equal(resumableSession(task, 'codex').id, 'exact-session');
  writeFileSync(path, JSON.stringify({ type: 'session_meta', payload: { id: 'different-session', cwd: f.home } }) + '\n');
  assert.throws(() => resumableSession(task, 'codex'), /does not match/);
  writeFileSync(path, 'not a transcript\n');
  assert.throws(() => resumableSession(task, 'codex'), /invalid or conflicting/);
  rmSync(path);
  assert.throws(() => resumableSession(task, 'codex'), /no readable full transcript/);
});

// A session is not pinned to one directory. A worker that runs `cd mobile` and
// carries on records a second cwd, and that used to make its whole transcript
// invisible: `fm switch` refused the session even when handed its exact id,
// because the transcript was never a candidate. A sibling directory is still a
// different project and must still be refused.

test('a worker that worked in a subdirectory of its worktree keeps its session', (t) => {
  const f = fixture(t);
  const worktree = mkdtempSync(join(tmpdir(), 'fm2-wt-'));
  const root = join(f.home, 'projects', worktree.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(root, { recursive: true });
  const write = (id, cwds) => writeFileSync(
    join(root, `${id}.jsonl`),
    cwds.map((cwd) => JSON.stringify({ sessionId: id, cwd, type: 'user', message: { content: 'go' } })).join('\n') + '\n',
  );

  // Real directories on both sides: canonicalCwd resolves a path that exists and
  // falls back to a merely-normalized one that does not, and on macOS those two
  // differ (/var vs /private/var) for the same place.
  const nested = join(worktree, 'mobile');
  mkdirSync(nested, { recursive: true });
  const sibling = `${worktree}-other`;
  mkdirSync(sibling, { recursive: true });

  // Worked at the root, then inside it. Still one session, still this worktree.
  write('nested-session', [worktree, nested, worktree]);
  const task = { id: 'wo-nested', worktree, agent: 'claude' };
  const resolved = resolveSession(task, 'claude', { claudeRoot: join(f.home, 'projects'), explicit: 'nested-session' });
  assert.equal(resolved.id, 'nested-session');
  assert.equal(resolved.cwd, realpathSync(worktree), 'the session was tied to the subdirectory it visited');

  // A sibling is a different project, and `-other` must not read as inside it.
  rmSync(join(root, 'nested-session.jsonl'));
  write('strayed-session', [worktree, sibling]);
  assert.throws(
    () => resolveSession(task, 'claude', { claudeRoot: join(f.home, 'projects'), explicit: 'strayed-session' }),
    /belongs to/,
    'a transcript that strayed into a sibling worktree was accepted',
  );
});

test('controller history never adopts the only unrelated conversation in the shared harness cwd', (t) => {
  const f = fixture(t);
  const task = { id: 'controller:fm-one', worktree: f.home, agent: 'codex' };
  f.transcript('codex', 'unrelated-session');
  assert.throws(() => resolveSession(task, 'codex', { codexRoot: f.home }), /needs a recorded session/);
  assert.equal(resolveSession(task, 'codex', { codexRoot: f.home, explicit: 'unrelated-session' }).id, 'unrelated-session');
});

test('a new provider session cannot inherit a prior session transcript from a partial event', (t) => {
  const f = fixture(t);
  const task = { id: 'controller:fm-one', worktree: f.home };
  rememberSession({ task: task.id, agent: 'codex', sessionId: 'old-session', transcriptPath: f.transcript('codex', 'old-session'), cwd: f.home });
  rememberSession({ task: task.id, agent: 'codex', sessionId: 'new-session', cwd: f.home });
  assert.equal(recordedSession(task, 'codex').transcript, null);
});
