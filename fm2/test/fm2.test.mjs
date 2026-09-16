// fm2's contract. Every test here is a rail that caught a real mistake, or the
// notification mechanism that replaces v1's watcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'fm2-home-'));
  process.env.FM2_HOME = home;
  process.env.CLAUDE_SKILLS_DIR = join(home, 'claude-skills');
  process.env.CODEX_SKILLS_DIR = join(home, 'codex-skills');
  return home;
}

// --- the notification mechanism ---------------------------------------------

test('a worker report is its own last message, taken from the transcript', async () => {
  const home = freshHome();
  const { lastAssistantMessage, record, pending, drain } = await import(join(ROOT, 'lib/notify.mjs'));

  const transcript = join(home, 't.jsonl');
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: 'user', message: { content: 'go' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'starting' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'REQUEST CHANGES on PR 12' }] } }),
      '',
    ].join('\n'),
  );

  // The last message with actual text wins - a trailing tool call is not a report.
  assert.equal(lastAssistantMessage(transcript), 'REQUEST CHANGES on PR 12');
  assert.equal(lastAssistantMessage(join(home, 'nope.jsonl')), null, 'a missing transcript must not throw');

  record({ task: 'pr-12', text: 'REQUEST CHANGES on PR 12' });
  assert.equal(pending().length, 1);
  const taken = drain();
  assert.equal(taken[0].task, 'pr-12');
  assert.equal(pending().length, 0, 'draining did not consume the report');
});

test('reading a report archives it rather than deleting it', async () => {
  const home = freshHome();
  const { record, drain } = await import(join(ROOT, 'lib/notify.mjs'));
  record({ task: 'x', text: 'something worth keeping' });
  const [taken] = drain();
  const archived = join(home, 'notify-read', taken.file.split('/').pop());
  assert.ok(existsSync(archived), 'a read report was destroyed instead of archived');
});

// --- telling the supervisor a worker stopped ---------------------------------
// The supervisor's Stop hook can only block a turn that is ending, so it cannot
// reach one already sitting between turns - which is where a report is most
// likely to land. The worker knocks as it goes, unconditionally: whether a stop
// is worth acting on is the supervisor's judgement, not the hook's.

test('a stopping worker knocks on the supervisor, whatever it is doing', async () => {
  const home = freshHome();
  const { recordSupervisor } = await import(join(ROOT, 'lib/presence.mjs'));
  const { knock } = await import(join(ROOT, 'lib/knock.mjs'));

  const sent = [];
  const send = async (args) => { sent.push(args); return true; };

  // Panel named explicitly, like the hook tests: run from inside a pane, a bare
  // currentPanel() answers about the REAL panel, and supervisorPane() then
  // refuses a recorded pane that does not live in it. That made this test depend
  // on whether a pane called %3 happened to exist on the developer's machine.
  recordSupervisor('%3', { panel: null });
  const first = await knock('pr-9', { panel: null, send });
  assert.equal(first.knocked, true);
  assert.equal(sent[0][2], '%3', 'the knock went to the wrong pane');
  assert.match(sent[0][4], /pr-9/, 'the knock did not name the task that stopped');
  // The fact and the option to ignore it, and nothing that tells the supervisor
  // what the stop was worth.
  assert.match(sent[0][4], /stopped/);
  assert.match(sent[0][4], /or ignore/);
  assert.doesNotMatch(sent[0][4], /fm read/, 'the knock went back to prescribing an action');

  // No state says "already told them" - every stop is its own knock, because
  // every stop is its own report.
  const second = await knock('pr-9', { panel: null, send });
  assert.equal(second.knocked, true, 'a second stop went unannounced');
});

test('a knock with nowhere to go is not an error', async () => {
  const home = freshHome();
  const { knock } = await import(join(ROOT, 'lib/knock.mjs'));
  const { supervisorPane } = await import(join(ROOT, 'lib/presence.mjs'));

  assert.equal(supervisorPane(), null);
  const result = await knock('pr-1', { send: async () => true });
  assert.equal(result.knocked, false, 'knocked at a door it had no address for');

  // A dead pane is the same: the report is on disk either way, and a worker's
  // turn must never fail over the supervisor's bookkeeping.
  const { recordSupervisor } = await import(join(ROOT, 'lib/presence.mjs'));
  recordSupervisor('%404');
  const dead = await knock('pr-1', { send: async () => false });
  assert.equal(dead.knocked, false);
});

test('the supervisor records where it lives every time it stops', async () => {
  const home = freshHome();
  const { supervisorPane } = await import(join(ROOT, 'lib/presence.mjs'));
  const hook = join(ROOT, 'hooks/supervisor-stop.mjs');

  const run = (pane) => {
    try {
      execFileSync('node', [hook], {
        input: '{}',
        env: hookEnv({ FM2_HOME: home, TMUX_PANE: pane }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return 0;
    } catch (err) { return err.status; }
  };

  // Read with the panel named explicitly. The hook runs with no tmux to ask, so
  // it files under the panel-less marker; a bare supervisorPane() here would
  // resolve whatever panel the TEST RUNNER is sitting in and read a different
  // file entirely.
  assert.equal(run('%3'), 0);
  assert.equal(supervisorPane(null), '%3');

  // A restarted supervisor lands in a new pane, and a stale id knocks on
  // somebody else's door - so it is rewritten on every stop, not just the first.
  assert.equal(run('%77'), 0);
  assert.equal(supervisorPane(null), '%77', 'a moved supervisor kept its old address');
});

// --- the supervisor hook: the only thing that may interrupt ------------------

// A hook subprocess must not be able to see the tmux server, the pane, or the
// panel the test runner itself is sitting in.
//
// Every one of these hooks asks tmux where it is. Run from inside a pane - which
// is how this harness is always developed - they answered about the REAL panel:
// `supervisor-stop` filed its marker under the live panel instead of the
// panel-less one, and `pending(panel)` then filtered out the very report the
// test had just recorded. Three tests failed on a machine where the harness was
// running and passed on one where it was not, which is the worst way for a test
// to be wrong.
//
// TMUX_TMPDIR points tmux at an empty directory, so it cannot connect to any
// server and every location question answers null. Unsetting TMUX alone is not
// enough: tmux still finds the default socket and cheerfully answers about panes
// that happen to exist on this machine, which is how pane id `%3` in a test
// collided with a real one.
const HOOK_TMUX_TMPDIR = mkdtempSync(join(tmpdir(), 'fm2-no-tmux-'));

// Only the location is removed. FM2_HOME is deliberately inherited - freshHome()
// sets it on this process and several tests rely on the hook picking it up
// rather than passing it again - so stripping the whole FM2_ prefix pointed
// those hooks at the real home instead.
function hookEnv(extra = {}) {
  const base = { ...process.env, TMUX_TMPDIR: HOOK_TMUX_TMPDIR };
  for (const key of ['TMUX', 'TMUX_PANE', 'FM2_PANEL']) delete base[key];
  return { ...base, ...extra };
}

function runHook(hook, payload, env = {}) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'hooks', hook)], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: hookEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stderr: '', stdout: out };
  } catch (err) {
    return { code: err.status, stderr: err.stderr ?? '', stdout: err.stdout ?? '' };
  }
}

test('the supervisor is not interrupted when no worker has reported', async () => {
  freshHome();
  const result = runHook('supervisor-stop.mjs', {});
  assert.equal(result.code, 0, 'an idle fleet blocked the turn');
  assert.equal(result.stderr, '', 'an idle fleet printed something');
});

test('the supervisor IS interrupted when a worker has reported', async () => {
  const home = freshHome();
  const { record } = await import(join(ROOT, 'lib/notify.mjs'));
  record({ task: 'pr-99', text: 'APPROVE WITH COMMENTS — three findings, none blocking' });

  const result = runHook('supervisor-stop.mjs', {}, { FM2_HOME: home });
  assert.equal(result.code, 2, 'an unread report did not force a handling turn');
  assert.match(result.stderr, /pr-99/);
  assert.match(result.stderr, /APPROVE WITH COMMENTS/);
});

test('a worker stopping records its own words, and never fails the worker', async () => {
  const home = freshHome();
  const transcript = join(home, 'w.jsonl');
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'PR is up: https://x/y/1' }] } })}\n`,
  );
  const ok = runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-1' });
  assert.equal(ok.code, 0);

  const { pending } = await import(join(ROOT, 'lib/notify.mjs'));
  const items = pending();
  assert.equal(items.length, 1);
  assert.equal(items[0].task, 'wo-1');
  assert.match(items[0].text, /PR is up/);

  // A broken payload must never hold up a worker's turn.
  const broken = runHook('worker-stop.mjs', { transcript_path: '/does/not/exist' }, { FM2_HOME: home, FM2_TASK: 'wo-2' });
  assert.equal(broken.code, 0, 'a missing transcript failed the worker');
});

test('Codex startup records exact identity and Codex stop reports through the same task route', async () => {
  const home = freshHome();
  const worktree = mkdtempSync(join(tmpdir(), 'fm2-codex-wt-'));
  const transcript = join(home, 'codex.jsonl');
  const session = '44444444-4444-4444-4444-444444444444';
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: 'session_meta', payload: { id: session, cwd: worktree } })}\n`,
  );
  const { saveTask, loadTask } = await import(join(ROOT, 'lib/config.mjs'));
  const { pending } = await import(join(ROOT, 'lib/notify.mjs'));
  saveTask({ id: 'wo-codex-report', pane: '%1', worktree, agent: 'codex' });

  const env = { FM2_HOME: home, FM2_TASK: 'wo-codex-report', FM2_AGENT: 'codex' };
  const started = runHook('worker-session.mjs', {
    session_id: session,
    transcript_path: transcript,
    cwd: worktree,
  }, env);
  assert.equal(started.code, 0);
  assert.equal(started.stdout.trim(), '{}', 'Codex SessionStart did not receive valid JSON output');
  assert.equal(loadTask('wo-codex-report').sessions.codex.id, session);

  const stopped = runHook('worker-stop.mjs', {
    session_id: session,
    transcript_path: transcript,
    cwd: worktree,
    last_assistant_message: 'PR is ready: https://example.test/pr/1',
  }, env);
  assert.equal(stopped.code, 0);
  assert.equal(stopped.stdout.trim(), '{}', 'Codex Stop did not receive valid JSON output');
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].task, 'wo-codex-report');
  assert.match(pending()[0].text, /PR is ready/);
});

test('telling a session with no pane sends nothing and says so', async () => {
  const home = freshHome();
  const { saveTask } = await import(join(ROOT, 'lib/config.mjs'));
  saveTask({ id: 'wo-gone', pane: '%99999', worktree: '/tmp/nowhere' });

  const run = (args) =>
    spawnSync(process.execPath, [join(ROOT, 'cli.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, FM2_HOME: home },
    });

  const dead = run(['tell', 'wo-gone', 'anything']);
  assert.notEqual(dead.status, 0, 'a dead pane was reported as told');
  assert.match(dead.stderr, /has no session/);
  assert.match(dead.stderr, /nothing was sent/);

  // An unknown task is refused too, rather than addressed into the void.
  assert.notEqual(run(['tell', 'wo-nope', 'hi']).status, 0);
  // And a message is required - a bare id must not silently send an empty line.
  assert.notEqual(run(['tell', 'wo-gone']).status, 0);
});

test('a task with a report still unread does not knock again', async () => {
  const home = freshHome();
  const transcript = join(home, 'r.jsonl');
  const write = (text) =>
    writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`);

  const { pending, drain } = await import(join(ROOT, 'lib/notify.mjs'));
  const { knockLine } = await import(join(ROOT, 'lib/knock.mjs'));

  // No supervisor pane recorded, so a knock cannot land either way - what this
  // asserts is that both stops are RECORDED. Losing the second would be worse
  // than repeating it; only the interrupt is suppressed.
  write('PR is up');
  runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-9' });
  write('the last CI waiter finished, nothing changed');
  runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-9' });

  const items = pending();
  assert.equal(items.length, 2, 'a repeat stop must still be recorded');
  assert.match(items[1].text, /nothing changed/);
  assert.equal(typeof knockLine('wo-9'), 'string');

  // Reading drains the queue, so the next stop is news again.
  drain();
  const { hasUnread } = await import(join(ROOT, 'lib/notify.mjs'));
  assert.equal(hasUnread('wo-9'), false, 'reading did not clear the way for the next knock');
});

// A fake tmux on PATH, so a hook running as a real subprocess can be asked
// whether it actually knocked. Without this the only observable is "no pane
// recorded", which cannot tell a suppressed knock from a failed one.
function tmuxSpy(home) {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(home, 'tmux.log');
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\nexit 0\n`);
  execFileSync('chmod', ['+x', join(bin, 'tmux')]);
  return {
    PATH: `${bin}:${process.env.PATH}`,
    knocks: () =>
      (existsSync(log) ? readFileSync(log, 'utf8') : '')
        .split('\n')
        .filter((l) => l.includes('stopped.')),
  };
}

test('several workers stopping together knock once, and all of them are recorded', async () => {
  const home = freshHome();
  const { recordSupervisor } = await import(join(ROOT, 'lib/presence.mjs'));
  // Panel named explicitly, for the same reason the read is above: the worker
  // hooks run with no tmux to ask and look under the panel-less marker.
  recordSupervisor('%7', { panel: null });
  const spy = tmuxSpy(home);

  const transcript = join(home, 'many.jsonl');
  const write = (text) =>
    writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`);

  // Six sessions once stopped inside the same half-minute. Each knock typed a
  // line into the supervisor's pane, the first `fm read` handed over every
  // report at once, and the five lines behind it each cost a turn to discover
  // there was nothing left to take.
  for (const task of ['wo-a', 'wo-b', 'wo-c']) {
    write(`${task} is done`);
    runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: task, PATH: spy.PATH });
  }

  const { pending, drain } = await import(join(ROOT, 'lib/notify.mjs'));
  assert.equal(pending().length, 3, 'a stop went unrecorded - the knock may be deduped, the report never');
  assert.equal(spy.knocks().length, 1, 'every stop knocked again, so reading once left stale taps queued');
  assert.match(spy.knocks()[0], /wo-a/, 'the one knock was not the first stop');

  // Reading takes all three, and the queue being empty makes the next stop news.
  assert.equal(drain().length, 3);
  write('wo-a again');
  runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-a', PATH: spy.PATH });
  assert.equal(spy.knocks().length, 2, 'reading did not clear the way for the next knock');
});

test('a stop with nothing to say records nothing and knocks on nobody', async () => {
  const home = freshHome();
  const { recordSupervisor } = await import(join(ROOT, 'lib/presence.mjs'));
  recordSupervisor('%7');
  const spy = tmuxSpy(home);

  // A turn that ended on a tool call, with no final message in the payload
  // either. Stopping is the report and the last message is the content, so
  // there is no report here - and a knock would send the supervisor to `fm read`
  // for "nothing new".
  const transcript = join(home, 'silent.jsonl');
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } })}\n`,
  );

  const result = runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-mute', PATH: spy.PATH });
  assert.equal(result.code, 0, 'a contentless stop failed the hook');

  const { pending } = await import(join(ROOT, 'lib/notify.mjs'));
  assert.equal(pending().length, 0, 'an empty report was recorded');
  assert.equal(spy.knocks().length, 0, 'knocked with nothing behind it');
});

test('a quiet task reports nothing and knocks on nobody', async () => {
  const home = freshHome();
  const { saveTask } = await import(join(ROOT, 'lib/config.mjs'));
  saveTask({ id: 'wo-quiet', quiet: true });
  saveTask({ id: 'wo-loud' });

  const transcript = join(home, 'q.jsonl');
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })}\n`,
  );

  const { pending } = await import(join(ROOT, 'lib/notify.mjs'));
  assert.equal(runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-quiet' }).code, 0);
  assert.equal(pending().length, 0, 'a muted task still reported');

  // And the mute is per task, not a switch on the mechanism.
  assert.equal(runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-loud' }).code, 0);
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].task, 'wo-loud');
});

// A session restarted by hand comes back in a new pane. Reporting survives that
// - this hook finds its task through FM2_TASK - but everything addressed to the
// session does not, so the record has to follow the session rather than the
// spawn. This is the one moment the live pane is known.
test('a stop records where the session is now, muted or not', async () => {
  const home = freshHome();
  const { saveTask, loadTask } = await import(join(ROOT, 'lib/config.mjs'));
  saveTask({ id: 'wo-moved', pane: '%1' });
  saveTask({ id: 'wo-moved-quiet', pane: '%1', quiet: true });
  saveTask({ id: 'wo-still', pane: '%1' });

  const transcript = join(home, 'moved.jsonl');
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })}\n`,
  );

  runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-moved', TMUX_PANE: '%42' });
  assert.equal(loadTask('wo-moved').pane, '%42', 'the task still names the pane it was spawned in');

  // A muted task moves panes too, and unmuting it later must not find a stale id.
  runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-moved-quiet', TMUX_PANE: '%43' });
  const quiet = loadTask('wo-moved-quiet');
  assert.equal(quiet.pane, '%43', 'a muted task did not follow its session');
  assert.equal(quiet.quiet, true, 'following the session dropped the mute');

  // Negative control: outside tmux nothing is known, so nothing is written.
  // (Blank rather than absent, because the hook inherits the caller's env.)
  runHook('worker-stop.mjs', { transcript_path: transcript }, { FM2_HOME: home, FM2_TASK: 'wo-still', TMUX_PANE: '' });
  assert.equal(loadTask('wo-still').pane, '%1', 'an unknown pane overwrote a good one');
});

// --- the rails ---------------------------------------------------------------

function makeProject() {
  const parent = mkdtempSync(join(tmpdir(), 'fm2-proj-'));
  const project = join(parent, 'thing');
  mkdirSync(project);
  const g = (...a) => execFileSync('git', ['-C', project, ...a], { stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(project, 'README.md'), '# thing\n');
  g('add', '-A');
  g('commit', '-qm', 'init');
  return project;
}

test('a task switches to Codex and back without changing its work or report route', async () => {
  const home = freshHome();
  const project = makeProject();
  const origin = join(dirname(project), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['-C', project, 'remote', 'add', 'origin', origin]);
  execFileSync('git', ['-C', project, 'push', '-q', 'origin', 'HEAD:refs/heads/main']);

  const worktree = join(dirname(project), 'thing-wo-switch');
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', 'wo-switch', worktree]);
  writeFileSync(join(worktree, 'unpushed.txt'), 'must survive\n');
  execFileSync('git', ['-C', worktree, 'add', 'unpushed.txt']);
  execFileSync('git', ['-C', worktree, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'unpushed work']);
  writeFileSync(join(worktree, 'README.md'), '# dirty and must survive\n');
  writeFileSync(join(worktree, 'untracked.txt'), 'also must survive\n');

  const briefDir = join(home, 'briefs', 'wo-switch');
  mkdirSync(briefDir, { recursive: true });
  const brief = join(briefDir, 'brief.md');
  writeFileSync(brief, 'Build this exact feature.\n');
  const claudeSession = '11111111-1111-1111-1111-111111111111';
  const claudeTranscript = join(home, 'claude.jsonl');
  writeFileSync(
    claudeTranscript,
    [
      JSON.stringify({ sessionId: claudeSession, cwd: worktree, type: 'user', message: { content: 'Build this exact feature.' } }),
      JSON.stringify({ sessionId: claudeSession, cwd: worktree, type: 'assistant', message: { content: [{ type: 'text', text: 'Waiting on Ribhav to choose A or B.' }] } }),
      '',
    ].join('\n'),
  );

  const { saveTask, loadTask } = await import(join(ROOT, 'lib/config.mjs'));
  const { record, pending } = await import(join(ROOT, 'lib/notify.mjs'));
  const { switchTask } = await import(join(ROOT, 'lib/tasks.mjs'));
  saveTask({
    id: 'wo-switch',
    project,
    worktree,
    pane: '%7',
    brief,
    branch: 'wo-switch',
    kind: 'ship',
    agent: 'claude',
    sessions: {
      claude: { id: claudeSession, transcript: claudeTranscript, cwd: worktree, recorded_at: '2026-01-01' },
    },
  });
  record({ task: 'wo-switch', text: 'Waiting on Ribhav to choose A or B.', cwd: worktree });

  const launches = [];
  let interrupts = 0;
  const runtime = {
    available: () => true,
    alive: () => true,
    interrupt: () => { interrupts += 1; },
    replace: (pane, cwd, command) => { launches.push({ pane, cwd, command }); return pane; },
    open: () => { throw new Error('a live switch must reuse its pane'); },
    clear: () => {},
    assert: () => {},
  };
  const beforeHead = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const beforeStatus = execFileSync('git', ['-C', worktree, 'status', '--porcelain=v1'], { encoding: 'utf8' });

  const toCodex = switchTask('wo-switch', { agent: 'codex', runtime });
  assert.equal(toCodex.worktreePreserved, true);
  assert.equal(toCodex.resumed, null, 'a nonexistent Codex chat was guessed');
  assert.match(launches[0].command, /codex --no-alt-screen/);
  assert.equal(launches[0].cwd, worktree);
  const afterCodex = loadTask('wo-switch');
  assert.equal(afterCodex.agent, 'codex');
  assert.equal(afterCodex.id, 'wo-switch');
  assert.equal(afterCodex.worktree, worktree);
  assert.equal(afterCodex.brief, brief);
  assert.equal(afterCodex.sessions.claude.id, claudeSession);
  assert.ok(
    existsSync(join(home, 'codex-skills', 'full-review', 'SKILL.md')),
    'Codex did not receive the same harness skills',
  );
  const firstManifest = JSON.parse(readFileSync(toCodex.manifest, 'utf8'));
  assert.equal(firstManifest.source.id, claudeSession);
  assert.equal(firstManifest.reporting.task, 'wo-switch');
  assert.equal(firstManifest.reporting.unread.length, 1, 'the pending decision was dropped from the handoff');
  assert.equal(readFileSync(firstManifest.source.transcript_snapshot, 'utf8'), readFileSync(claudeTranscript, 'utf8'));

  const codexSession = '22222222-2222-2222-2222-222222222222';
  const codexTranscript = join(home, 'codex.jsonl');
  writeFileSync(
    codexTranscript,
    [
      JSON.stringify({ type: 'session_meta', payload: { id: codexSession, cwd: worktree } }),
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: 'Continue from the handoff.' }] } }),
      '',
    ].join('\n'),
  );
  const started = runHook('worker-session.mjs', {
    session_id: codexSession,
    transcript_path: codexTranscript,
    cwd: worktree,
  }, { FM2_HOME: home, FM2_TASK: 'wo-switch', FM2_AGENT: 'codex' });
  assert.equal(started.code, 0);
  const stopped = runHook('worker-stop.mjs', {
    session_id: codexSession,
    transcript_path: codexTranscript,
    cwd: worktree,
    last_assistant_message: 'Implemented the selected path; tests pass.',
  }, { FM2_HOME: home, FM2_TASK: 'wo-switch', FM2_AGENT: 'codex' });
  assert.equal(stopped.code, 0);
  assert.ok(pending().some((item) => item.task === 'wo-switch' && /tests pass/.test(item.text)));

  const toClaude = switchTask('wo-switch', { agent: 'claude', runtime });
  assert.equal(toClaude.resumed, claudeSession, 'switching back did not resume the exact prior Claude chat');
  assert.match(launches[1].command, /claude --dangerously-skip-permissions/);
  assert.match(launches[1].command, new RegExp(`--resume '${claudeSession}'`));
  const back = loadTask('wo-switch');
  assert.equal(back.agent, 'claude');
  assert.equal(back.sessions.codex.id, codexSession);
  assert.equal(back.brief, brief, 'switching providers changed the report path');
  assert.equal(interrupts, 2);

  assert.equal(execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), beforeHead);
  assert.equal(execFileSync('git', ['-C', worktree, 'status', '--porcelain=v1'], { encoding: 'utf8' }), beforeStatus);
  assert.equal(readFileSync(join(worktree, 'unpushed.txt'), 'utf8'), 'must survive\n');
  assert.equal(readFileSync(join(worktree, 'untracked.txt'), 'utf8'), 'also must survive\n');

  let touched = false;
  assert.throws(
    () => switchTask('wo-switch', {
      agent: 'codex',
      runtime: {
        available: () => false,
        alive: () => true,
        interrupt: () => { touched = true; },
      },
    }),
    /codex is not installed/,
  );
  assert.equal(touched, false, 'the source was interrupted before target availability was known');
});

test('a task with uncommitted work refuses to close', async () => {
  const home = freshHome();
  const project = makeProject();
  const { unlandedWork, missingReport } = await import(join(ROOT, 'lib/tasks.mjs'));

  const wt = join(dirname(project), 'thing-wo-1');
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', 'wo-1', wt], { stdio: 'ignore' });
  writeFileSync(join(wt, 'README.md'), '# changed but never committed\n');

  const problems = unlandedWork({ worktree: wt });
  assert.ok(problems.some((p) => /uncommitted/.test(p)), problems.join('; '));
});

test('a task whose commits are on no remote refuses to close', async () => {
  const home = freshHome();
  const project = makeProject();
  const { unlandedWork } = await import(join(ROOT, 'lib/tasks.mjs'));

  const wt = join(dirname(project), 'thing-wo-2');
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', 'wo-2', wt], { stdio: 'ignore' });
  writeFileSync(join(wt, 'new.txt'), 'work\n');
  execFileSync('git', ['-C', wt, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'work'], { stdio: 'ignore' });

  const problems = unlandedWork({ worktree: wt });
  assert.ok(problems.some((p) => /no remote/.test(p)), problems.join('; '));
});

// A branch name that is also a path in the tree makes `git log` refuse the whole
// revision list. That refusal used to be read as "nothing is unpushed", which is
// the one wrong answer this check must never give.

test('a branch named like a path does not hide unpushed commits', async () => {
  freshHome();
  const project = makeProject();
  const { unlandedWork } = await import(join(ROOT, 'lib/tasks.mjs'));
  const g = (...a) => execFileSync('git', ['-C', project, ...a], { stdio: 'ignore' });

  // The shape fitness_agent has: a `marketing/` directory tracked in the tree,
  // and a branch called `marketing` too. Every worktree then holds a path with
  // the same name as a ref, which is what git calls ambiguous.
  mkdirSync(join(project, 'marketing'), { recursive: true });
  writeFileSync(join(project, 'marketing', 'page.md'), '# a landing page\n');
  g('add', '-A');
  g('commit', '-qm', 'a marketing site');
  g('branch', 'marketing');

  // Judged from a different worktree, so `marketing` is one of the OTHER
  // branches whose commits get excluded - the position that made the list
  // ambiguous, and where the failure was read as "nothing to strand".
  const wt = join(dirname(project), 'thing-stranded');
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', 'stranded', wt], { stdio: 'ignore' });
  writeFileSync(join(wt, 'note.md'), 'this commit is on no remote\n');
  execFileSync('git', ['-C', wt, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'work'], { stdio: 'ignore' });

  const problems = unlandedWork({ worktree: wt });
  // Counted, not just mentioned. "could not tell what is on no remote here" is
  // the refusal git's failure now produces, and matching on the phrase alone
  // would let the very bug this test exists for pass as a pass.
  assert.ok(
    problems.some((p) => /^1 commit\(s\) on no remote$/.test(p)),
    `an ambiguous branch name hid a commit that exists nowhere else: ${problems.join('; ') || 'reported clean'}`,
  );
});

// An adopted worktree is Ribhav's, not the harness's. The refusals that
// protect a task's own worktree are exactly wrong for one that outlives its
// session: nothing is stranded by closing, because closing removes nothing.

test('an adopted worktree is never blamed for the work sitting in it', async () => {
  const home = freshHome();
  const project = makeProject();
  const { unlandedWork } = await import(join(ROOT, 'lib/tasks.mjs'));

  const wt = join(dirname(project), 'thing-mine');
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', 'mine', wt], { stdio: 'ignore' });
  writeFileSync(join(wt, 'README.md'), '# a week of uncommitted work\n');

  // The same worktree, judged both ways.
  assert.ok(unlandedWork({ worktree: wt }).length, 'a task worktree should still refuse');
  assert.deepEqual(
    unlandedWork({ worktree: wt, adopted: true }),
    [],
    'an adopted worktree refused to close over changes that were in no danger',
  );
});

test('closing an adopted task takes the session down and leaves the worktree', async () => {
  const home = freshHome();
  const project = makeProject();
  const { closeTask } = await import(join(ROOT, 'lib/tasks.mjs'));
  const { saveTask, loadTask } = await import(join(ROOT, 'lib/config.mjs'));

  const wt = join(dirname(project), 'thing-keepme');
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', 'keepme', wt], { stdio: 'ignore' });
  writeFileSync(join(wt, 'README.md'), '# must survive teardown\n');

  // A pane id that does not resolve: kill-pane fails and is swallowed, which is
  // the same path a pane Ribhav already closed by hand takes.
  saveTask({ id: 'keepme', project, worktree: wt, pane: '%99999', kind: 'adopted', adopted: true });
  closeTask('keepme');

  assert.ok(existsSync(wt), 'closing an adopted task destroyed Ribhav\'s worktree');
  assert.ok(existsSync(join(wt, 'README.md')), 'the uncommitted work went with the session');
  assert.equal(loadTask('keepme'), null, 'the task record outlived the close');
});

// A tmux server going takes every pane with it and nothing else. What comes back
// has to be the same task, not a new one wearing its id.

test('reopening a task keeps everything but the pane', async () => {
  freshHome();
  const { reopened } = await import(join(ROOT, 'lib/tasks.mjs'));

  const review = {
    id: 'pr-306-x',
    kind: 'review',
    pane: '%78',
    brief: '/home/.fm2/briefs/pr-306-x/brief.md',
    pr: '306',
    repo: 'r/p',
    pr_url: 'https://example/306',
    created_at: 'the-first-time',
  };
  // What adoptTask offers for any worktree it is pointed at: adopted, and now.
  const fresh = {
    id: 'pr-306-x',
    kind: 'adopted',
    adopted: true,
    pane: '%91',
    brief: null,
    branch: null,
    resumed: 'abc',
    created_at: 'now',
  };

  const back = reopened(review, fresh);
  assert.equal(back.pane, '%91', 'the one thing that should change did not');
  assert.equal(back.resumed, 'abc');
  assert.equal(back.kind, 'review', 'a reopened review was rewritten as a worker');
  assert.equal(back.adopted, false, 'a review worktree became Ribhav\'s, so close would leave it behind');
  assert.equal(back.pr, '306', 'the PR went with the pane');
  assert.equal(back.brief, review.brief, 'the report path went with the pane');
  assert.equal(back.created_at, 'the-first-time', 'reopening restarted the task\'s clock');

  // An adopted task keeps being adopted, and keeps its earlier conversation when
  // this reopen names none.
  const carried = reopened({ ...fresh, resumed: 'older', pane: '%1' }, { ...fresh, resumed: null, pane: '%2' });
  assert.equal(carried.adopted, true);
  assert.equal(carried.resumed, 'older', 'a reopen with no --resume forgot the conversation');

  // Nothing to merge is the plain adoption path, untouched.
  assert.deepEqual(reopened(null, fresh), fresh);
});

// A worktree can have several conversations. Recency is not identity: a quick
// unrelated chat opened later in the same folder must not steal a task.
test('a legacy Claude session is selected by exact cwd and brief, never newest', async () => {
  freshHome();
  const { resolveSession } = await import(join(ROOT, 'lib/sessions.mjs'));

  const root = mkdtempSync(join(tmpdir(), 'fm2-projects-'));
  const wt = join(tmpdir(), 'fitness_agent-fm-volume_score');
  const folder = join(root, wt.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(folder, { recursive: true });
  const brief = join(freshHome(), 'brief.md');
  writeFileSync(brief, 'Implement the exact assigned change.\n');

  const wanted = '11111111-1111-1111-1111-111111111111';
  const unrelated = '22222222-2222-2222-2222-222222222222';
  writeFileSync(
    join(folder, `${wanted}.jsonl`),
    `${JSON.stringify({ sessionId: wanted, cwd: wt, type: 'user', message: { content: 'Implement the exact assigned change.' } })}\n`,
  );
  writeFileSync(
    join(folder, `${unrelated}.jsonl`),
    `${JSON.stringify({ sessionId: unrelated, cwd: wt, type: 'user', message: { content: 'Unrelated scratch question' } })}\n`,
  );

  const task = { id: 'volume-score', worktree: wt, brief };
  assert.equal(resolveSession(task, 'claude', { claudeRoot: root }).id, wanted);
  assert.equal(
    resolveSession({ id: 'scratch', worktree: wt }, 'claude', { claudeRoot: root, explicit: unrelated }).id,
    unrelated,
  );

  const duplicate = '33333333-3333-3333-3333-333333333333';
  writeFileSync(
    join(folder, `${duplicate}.jsonl`),
    `${JSON.stringify({ sessionId: duplicate, cwd: wt, type: 'user', message: { content: 'Implement the exact assigned change.' } })}\n`,
  );
  assert.throws(
    () => resolveSession(task, 'claude', { claudeRoot: root }),
    /ambiguous Claude history|ambiguous claude history/i,
    'two plausible histories were silently ordered by time',
  );
});

// A review worktree sits on a detached PR head with no branch of its own. Asking
// git for unpushed commits across --branches counts the whole repository against
// it, which refused every close for work that was not the task's.
test("a detached review worktree is not blamed for the repo's other branches", async () => {
  freshHome();
  const project = makeProject();
  const { unlandedWork } = await import(join(ROOT, 'lib/tasks.mjs'));
  const g = (...a) => execFileSync('git', ['-C', project, ...a], { stdio: 'ignore' });

  // A real project has a remote, and its main line is on it.
  const origin = join(dirname(project), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin], { stdio: 'ignore' });
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'HEAD:refs/heads/main');
  g('fetch', '-q', 'origin');

  // An unrelated branch carrying an unpushed commit, exactly like a busy repo.
  g('checkout', '-q', '-b', 'someone-elses-work');
  writeFileSync(join(project, 'theirs.txt'), 'not mine\n');
  g('add', '-A');
  g('commit', '-qm', 'theirs');
  g('checkout', '-q', '-');

  // The review worktree: detached at a commit the remote already has.
  const head = execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const wt = join(dirname(project), 'thing-pr-9');
  g('worktree', 'add', '-q', '--detach', wt, head);

  assert.deepEqual(
    unlandedWork({ worktree: wt }),
    [],
    "a clean review worktree was blamed for another branch's unpushed commits",
  );
});

test('a branch cut from an unpushed main is not blamed for what it inherited', async () => {
  freshHome();
  const project = makeProject();
  const { unlandedWork } = await import(join(ROOT, 'lib/tasks.mjs'));
  const g = (...a) => execFileSync('git', ['-C', project, ...a], { stdio: 'ignore' });

  const origin = join(dirname(project), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin], { stdio: 'ignore' });
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'HEAD:refs/heads/main');
  g('fetch', '-q', 'origin');

  // Ribhav's own checkout, ahead of its remote - the normal state of a repo
  // being worked in. A task branched from here starts life carrying these.
  writeFileSync(join(project, 'mine.txt'), 'not pushed yet\n');
  g('add', '-A');
  g('commit', '-qm', 'work in the real checkout');

  const wt = join(dirname(project), 'thing-wo-1');
  g('worktree', 'add', '-q', '-b', 'wo-1', wt, 'HEAD');

  assert.deepEqual(
    unlandedWork({ worktree: wt }),
    [],
    'a fresh worktree was blamed for commits sitting safely in the real checkout',
  );

  // Its own commit is a different matter: that one exists nowhere else.
  writeFileSync(join(wt, 'task.txt'), 'only here\n');
  execFileSync('git', ['-C', wt, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', wt, 'commit', '-qm', 'the task did this'], { stdio: 'ignore' });

  assert.deepEqual(
    unlandedWork({ worktree: wt }),
    ['1 commit(s) on no remote'],
    'the commit that would actually be stranded was not counted, or the inherited ones were',
  );
});

test('a squash-merged branch has landed, however its commits look', async () => {
  freshHome();
  const project = makeProject();
  const { unlandedWork } = await import(join(ROOT, 'lib/tasks.mjs'));
  const g = (...a) => execFileSync('git', ['-C', project, ...a], { stdio: 'ignore' });

  const origin = join(dirname(project), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin], { stdio: 'ignore' });
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'HEAD:refs/heads/main');
  g('fetch', '-q', 'origin');

  // The shape a squash merge leaves behind: the branch's own commit is on no
  // remote and never will be, because the merge rewrote it into a new one.
  const wt = join(dirname(project), 'thing-wo-2');
  g('worktree', 'add', '-q', '-b', 'wo-2', wt, 'HEAD');
  writeFileSync(join(wt, 'shipped.txt'), 'this content is on main under another sha\n');
  execFileSync('git', ['-C', wt, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', wt, 'commit', '-qm', 'the work'], { stdio: 'ignore' });

  const task = { worktree: wt, project };
  assert.deepEqual(
    unlandedWork(task, { isMerged: () => false }),
    ['1 commit(s) on no remote'],
    'an unmerged branch stopped refusing, which is the rail this whole check is',
  );
  assert.deepEqual(
    unlandedWork(task, { isMerged: () => true }),
    [],
    'a landed ship task still refused to close, so every merge leaves a worktree behind',
  );

  // Merged is not a blanket amnesty: what was never committed never landed.
  writeFileSync(join(wt, 'shipped.txt'), 'edited after the merge, saved nowhere\n');
  assert.deepEqual(
    unlandedWork(task, { isMerged: () => true }),
    ['1 uncommitted change(s)'],
    'a merged branch was allowed to take uncommitted changes down with it',
  );
});

// A review Ribhav redirects into building ends up holding the work that
// landed - on a detached head, so there is no branch to ask the forge about.
test('a merged review task can be put away, detached head and all', async () => {
  freshHome();
  const project = makeProject();
  const { unlandedWork } = await import(join(ROOT, 'lib/tasks.mjs'));
  const g = (...a) => execFileSync('git', ['-C', project, ...a], { stdio: 'ignore' });

  const origin = join(dirname(project), 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin], { stdio: 'ignore' });
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'HEAD:refs/heads/main');
  g('fetch', '-q', 'origin');

  const wt = join(dirname(project), 'thing-pr-7');
  g('worktree', 'add', '-q', '--detach', wt, 'HEAD');
  writeFileSync(join(wt, 'built.txt'), 'authored in a review worktree\n');
  execFileSync('git', ['-C', wt, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', wt, 'commit', '-qm', 'the work that landed'], { stdio: 'ignore' });

  const task = { worktree: wt, project, kind: 'review', pr: 7, repo: 'owner/thing' };
  assert.deepEqual(
    unlandedWork(task, { mergedPr: () => false }),
    ['1 commit(s) on no remote'],
    'an unmerged review task stopped refusing, which is the rail this check is',
  );
  assert.deepEqual(
    unlandedWork(task, { mergedPr: () => true }),
    [],
    'a merged review task still refused - the branch check cannot help, there is no branch',
  );
});

test('a review with no report refuses to close; a ship task is not asked for one', async () => {
  const home = freshHome();
  const { missingReport } = await import(join(ROOT, 'lib/tasks.mjs'));
  const briefDir = mkdtempSync(join(tmpdir(), 'fm2-brief-'));
  const brief = join(briefDir, 'brief.md');
  writeFileSync(brief, 'x');

  assert.ok(missingReport({ kind: 'review', brief }), 'a review with no report was allowed to close');
  writeFileSync(join(briefDir, 'report.md'), '# findings');
  assert.equal(missingReport({ kind: 'review', brief }), null);
  assert.equal(missingReport({ kind: 'ship', brief: join(briefDir, 'nothing.md') }), null, 'a ship task was asked for a report');
});

test('capabilities resolve once, and Slack absent is not an error', async () => {
  const home = freshHome();
  const { capabilities, setSlackAvailable } = await import(join(ROOT, 'lib/config.mjs'));
  const caps = capabilities({ refresh: true });
  assert.equal(caps.slack, false, 'slack defaulted to available with nothing configured');
  assert.equal(typeof caps.git, 'boolean');
  setSlackAvailable(true);
  assert.equal(capabilities({ refresh: true }).slack, true);
});

test('a project declares its own tracker, and none is the default', async () => {
  const home = freshHome();
  const { projectConfig } = await import(join(ROOT, 'lib/config.mjs'));
  const project = mkdtempSync(join(tmpdir(), 'fm2-cfg-'));
  assert.equal(projectConfig(project).tracker, 'none');
  writeFileSync(join(project, '.fm2.json'), JSON.stringify({ tracker: 'github-issues', review_channel: 'C123' }));
  const cfg = projectConfig(project);
  assert.equal(cfg.tracker, 'github-issues');
  assert.equal(cfg.review_channel, 'C123');
});

// The skills live in this repo, which is the point of the repo — but a worker
// runs in some other project's worktree, so it can only find them in
// ~/.claude/skills. That link was made by hand, so it went stale the moment the
// checkout moved: a review told to "run the full-review skill" resolved it to an
// abandoned checkout and improvised instead of reviewing.

test('every launch relinks the skills to this checkout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fm2-skills-'));
  const { syncSkills, repoSkills } = await import(join(ROOT, 'lib/skills.mjs'));

  const found = repoSkills();
  assert.ok(found.length > 10, `expected this repo to carry skills, found ${found.length}`);

  // First run creates them all.
  const made = syncSkills({ root });
  assert.equal(made.length, found.length, 'a fresh machine did not get every skill');
  const full = join(root, 'full-review', 'SKILL.md');
  assert.ok(existsSync(full), 'full-review, the one a review actually runs, is missing');
  assert.match(readFileSync(full, 'utf8'), /Full Review/);

  // Second run is silent: nothing to repair, nothing rewritten.
  assert.deepEqual(syncSkills({ root }), [], 'a correct link was relinked anyway');

  // A link left pointing at an abandoned checkout is repaired, not trusted.
  const stale = mkdtempSync(join(tmpdir(), 'fm2-oldcheckout-'));
  writeFileSync(join(stale, 'full-review.md'), '# an old copy\n');
  execFileSync('ln', ['-sfn', join(stale, 'full-review.md'), full]);
  const repaired = syncSkills({ root });
  assert.ok(repaired.includes('full-review'), 'a stale skill link survived a launch');
  assert.match(readFileSync(full, 'utf8'), /Full Review/, 'the stale copy is still what resolves');
});

// --- a forge that will not answer -------------------------------------------
//
// GitHub's GraphQL endpoint 503s in bursts. `prForBranch` caught that and
// returned null, which reads identically to "this branch has no PR" - so
// `handoff --stage swap` told Ribhav a finished task had nothing to review
// while its PR sat open and mergeable. The stall was survivable; the false
// statement about the state of the world was not.

function fakeGh(script) {
  const bin = mkdtempSync(join(tmpdir(), 'fm2-bin-'));
  writeFileSync(join(bin, 'gh'), script, { mode: 0o755 });
  return bin;
}

test('a burst of 503s is ridden out, not reported as "no PR"', async () => {
  const { prForBranch } = await import(`${join(ROOT, 'lib/forge.mjs')}?burst`);

  // Fails twice, then answers - the shape the real endpoint actually had.
  const counter = join(mkdtempSync(join(tmpdir(), 'fm2-count-')), 'n');
  const bin = fakeGh(
    '#!/bin/sh\n' +
      `n=$(cat ${counter} 2>/dev/null || echo 0); echo $((n+1)) > ${counter}\n` +
      'if [ "$n" -lt 2 ]; then echo "HTTP 503: No server is currently available" >&2; exit 1; fi\n' +
      'echo \'[{"number":338}]\'\n',
  );
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    assert.equal(prForBranch('o/r', 'wo-327'), 338, 'a recoverable forge was given up on');
    assert.equal(readFileSync(counter, 'utf8').trim(), '3', 'the burst was not retried the way it looks');
  } finally {
    process.env.PATH = path;
  }
});

test('a forge that never answers throws rather than inventing an absence', async () => {
  const { prForBranch } = await import(`${join(ROOT, 'lib/forge.mjs')}?down`);

  const bin = fakeGh('#!/bin/sh\necho "HTTP 503: No server is currently available" >&2\nexit 1\n');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    assert.throws(() => prForBranch('o/r', 'wo-327'), /503/, 'an unanswered question came back as an answer');
  } finally {
    process.env.PATH = path;
  }
});

test('a branch the forge says has nothing open is still null', async () => {
  const { prForBranch } = await import(`${join(ROOT, 'lib/forge.mjs')}?empty`);

  const bin = fakeGh('#!/bin/sh\necho "[]"\n');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    assert.equal(prForBranch('o/r', 'nothing-here'), null, 'a real absence stopped reading as one');
  } finally {
    process.env.PATH = path;
  }
});

// --- a landed ship task says so ---------------------------------------------
//
// `fm status` marks a session whose PR has merged, so a missed close is visible.
// It only ever fired for reviews, which carry a PR number; a ship task does not -
// the worker opens the PR, so `fm` only knows the branch. Ribhav had to spot the
// leftovers himself twice in one day. The branch is the thread back, and it has
// to be asked about MERGED PRs: the open-PR lookup goes blind at exactly the
// moment the answer becomes yes.

test('a ship task whose branch has landed is found by the branch, not a PR number', async () => {
  const { landedPrForBranch } = await import(`${join(ROOT, 'lib/forge.mjs')}?landed`);

  const argsFile = join(mkdtempSync(join(tmpdir(), 'fm2-args-')), 'argv');
  const bin = fakeGh(`#!/bin/sh\nprintf '%s\\n' "$*" > ${argsFile}\necho '[{"number":390}]'\n`);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    assert.equal(landedPrForBranch('o/r', 'ribhav/revert-348'), 390, 'a landed branch read as having nothing');
    const asked = readFileSync(argsFile, 'utf8');
    assert.match(asked, /--state merged/, 'the open-PR lookup was reused, which cannot see a merged PR');
    assert.match(asked, /--head ribhav\/revert-348/, 'the branch was not the thing asked about');
  } finally {
    process.env.PATH = path;
  }
});

test('a branch with nothing merged, or no branch at all, is not called landed', async () => {
  const { landedPrForBranch } = await import(`${join(ROOT, 'lib/forge.mjs')}?unlanded`);

  const bin = fakeGh('#!/bin/sh\necho "[]"\n');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    assert.equal(landedPrForBranch('o/r', 'still-open'), null, 'an open PR was reported as landed');
    // A review worktree is detached, so it has no branch - and a task read before
    // its project resolves has no repo. Neither is a merge.
    assert.equal(landedPrForBranch('o/r', null), null, 'a detached worktree was reported as landed');
    assert.equal(landedPrForBranch(null, 'b'), null, 'a task with no repo was reported as landed');
  } finally {
    process.env.PATH = path;
  }
});

// --- attach finds its own project -------------------------------------------
//
// `fm attach <worktree>` defaulted --project to the supervisor's cwd, so
// attaching to a bnl-packpilot worktree from the harness checkout died with
// "is not a worktree of coding_harness" - a true sentence about a directory
// nobody had named. A worktree knows its own checkout; ask it.

test('a worktree names the checkout it belongs to', async () => {
  const { execFileSync: run } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'fm2-proj-'));
  const repo = join(root, 'somerepo');
  mkdirSync(repo);
  run('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'f.txt'), 'x\n');
  run('git', ['-C', repo, 'add', '.']);
  run('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  const wt = join(root, 'somerepo-feature');
  run('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'feature', wt]);

  const cli = readFileSync(join(ROOT, 'cli.mjs'), 'utf8');
  assert.match(cli, /mainCheckoutOf\(worktree\)/, 'attach no longer asks the worktree where it belongs');

  // The mechanism itself: git resolves the shared .git, whose parent is the checkout.
  const common = run('git', ['-C', wt, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  // realpath both sides: on macOS /var is a symlink to /private/var and git
  // reports the resolved path.
  const { realpathSync } = await import('node:fs');
  assert.equal(dirname(common), realpathSync(repo), 'a worktree failed to name its own checkout');
});

test("a long message reaches the worker's prompt whole", async () => {
  freshHome();
  const { sendToPane } = await import(join(ROOT, 'lib/tasks.mjs'));

  // A real pane, in a session of this test's own, running `cat` into a file so
  // what ARRIVED can be compared byte for byte against what was sent. Reading
  // the screen instead would only prove what fit on it. Ribhav's words are
  // carried by exactly this call, so the only honest test of it is a live one.
  const session = `fm2-send-${process.pid}`;
  const out = join(mkdtempSync(join(tmpdir(), 'fm2-send-')), 'arrived.txt');
  const tmux = (args) => execFileSync('tmux', args, { encoding: 'utf8' }).trim();
  let pane;
  try {
    // Chained with the create, because ~/.tmux.conf sets destroy-unattached on
    // and a detached session dies before the next command can address it - the
    // same reason openPane chains it.
    pane = tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', session, '-x', '200', '-y', '50',
      // Two things make this stand in for Claude Code. -icanon, because Claude
      // Code reads its input in raw mode and a cooked tty would drop any single
      // line over ~1KB before sendToPane was ever involved - the test would be
      // measuring the line discipline instead of the thing it is about. And
      // ESC[?2004h, because tmux only brackets a paste for an application that
      // has asked for bracketed paste; a receiver that never asks is sent the
      // bytes bare, and the test would pass on the broken path for a reason
      // that has nothing to do with the message.
      'sh', '-c', `stty -icanon -echo min 1 time 0; printf '\\033[?2004h'; cat > ${out}`,
      ';', 'set-option', '-t', session, 'destroy-unattached', 'off']);
  } catch {
    return; // no tmux server here; a live test is the point, so skip rather than fake one
  }

  try {
    // Long enough to overrun what a keystroke stream survives, and multi-line,
    // which is the half that used to join words across the break. The message
    // that broke this arrived with its first two thirds gone and "Backoffice
    // names" welded into "Backofficenames".
    const message = [
      'FIRST-LINE-MARKER the instruction that must not be dropped from the front.',
      'Keep the Backoffice names in CC as they are set up.',
      'padding so the message is far longer than one keystroke burst survives. '.repeat(20).trim(),
      'LAST-LINE-MARKER open the PR when it is green.',
    ].join('\n');

    // The receiver has to have asked for bracketed paste before anything is
    // sent, and `new-session` returns as soon as the pane exists - well before
    // its shell has run. `cat`'s redirect creates the file only after the printf
    // above it, so the file appearing is the signal that the pane is ready.
    for (let i = 0; i < 50 && !existsSync(out); i += 1) execFileSync('sleep', ['0.1']);
    assert.ok(existsSync(out), 'the test receiver never started');

    sendToPane(pane, message);
    execFileSync('sleep', ['1']);

    // The tty passes the bracketed-paste markers through untouched - only an
    // application that understands them takes them off - so they are stripped
    // here rather than being counted as corruption.
    const arrived = readFileSync(out, 'utf8');

    // What this pins is the PROTOCOL, and it is worth being exact about why.
    // The receiver here is `cat`, which drains its tty as fast as bytes appear;
    // Claude Code is a TUI that does not, and the corruption in production came
    // out of that difference. A test cannot honestly reproduce the race, but it
    // can hold the mechanism that removes it: the message must arrive announced
    // as a paste, not as a keystroke stream the application is free to coalesce,
    // drop the front of, and eat the newlines out of. Reverting sendToPane to
    // `send-keys -l` fails on these two lines and passes every other assertion
    // here, which is the honest shape of what changed.
    assert.ok(arrived.startsWith('\u001b[200~'), 'the message was typed, not pasted');
    assert.ok(arrived.includes('\u001b[201~'), 'the paste was never closed');

    // And inside the markers it is byte for byte what was sent - the front
    // intact, and the line breaks still line breaks rather than welded joins.
    const body = arrived.slice('\u001b[200~'.length, arrived.indexOf('\u001b[201~'));
    assert.equal(body, message, 'the message did not arrive as it was sent');
  } finally {
    try { tmux(['kill-session', '-t', session]); } catch { /* already gone */ }
  }
});

test('a worker is launched on Opus, not on whatever the CLI defaults to', async () => {
  freshHome();
  const { launchCommand } = await import(join(ROOT, 'lib/tasks.mjs'));

  const cmd = launchCommand({ id: 'wo-9', settingsFile: '/s.json' });

  // The default moved to Fable under us and every worker spawned after that came
  // up on it silently - nothing in the pane, the report or `fm status` says which
  // model a session is. Naming it is the only thing that makes the choice real.
  assert.match(cmd, /--model opus\b/, 'the launch left the model to the CLI default');
  assert.match(cmd, /--effort max\b/);
  assert.match(cmd, /--dangerously-skip-permissions\b/);
  assert.match(cmd, /--settings '\/s\.json'/);
  assert.match(cmd, /FM2_TASK='wo-9'/, 'the hook could not find its task');
  assert.match(cmd, /FM2_AGENT='claude'/);

  // An idle pane and a resumed one differ only in these two flags, and both are
  // easy to pass by accident: an empty brief would start a turn on nothing, and
  // a stray --resume would silently reopen an unrelated conversation.
  assert.doesNotMatch(cmd, /--resume/);
  assert.doesNotMatch(cmd, /\$\(cat/);
  const full = launchCommand({ id: 'wo-9', settingsFile: '/s.json', briefPath: '/b.md', resume: 'abc' });
  assert.match(full, /--resume 'abc'/);
  assert.match(full, /"\$\(cat '\/b\.md'\)"/);
});

test('a Codex worker names its model, effort, permissions and status line and uses exact resume and hook contracts', async () => {
  const home = freshHome();
  const { launchCommand, writeWorkerSettings } = await import(join(ROOT, 'lib/tasks.mjs'));
  const settings = writeWorkerSettings('wo-codex', 'codex');
  const prompt = join(home, 'prompt.md');
  writeFileSync(prompt, 'continue the same task\n');

  const fresh = launchCommand({ agent: 'codex', id: 'wo-codex', settingsFile: settings, briefPath: prompt });
  assert.match(fresh, /\bcodex --no-alt-screen\b/);
  // Said outright, never inherited. The desktop app's config is the wrong
  // configuration for an unattended pane: its default approval policy stops a
  // worker to ask a human before its first command outside the workspace, and
  // its model follows whatever the app is pointed at today.
  assert.match(fresh, /-c model="gpt-5\.6-sol"/);
  assert.match(fresh, /-c model_reasoning_effort="ultra"/);
  assert.match(fresh, /-c approval_policy="never"/);
  assert.match(fresh, /-c sandbox_mode="danger-full-access"/);
  assert.match(fresh, /-c 'tui\.status_line=\["project-name","git-branch","model-with-reasoning","fast-mode","context-used"\]'/);
  // Its own hooks: without this every pane stops on a prompt whose quiet wrong
  // answer is a worker that runs, stops, and never reports.
  assert.match(fresh, /--dangerously-bypass-hook-trust/);
  assert.match(fresh, /hooks\.SessionStart=/);
  assert.match(fresh, /hooks\.Stop=/);
  assert.match(fresh, /worker-session\.mjs/);
  assert.match(fresh, /worker-stop\.mjs/);
  assert.match(fresh, /FM2_AGENT='codex'/);
  assert.doesNotMatch(fresh, /claude --/);

  const bin = mkdtempSync(join(tmpdir(), 'fm2-worker-bin-'));
  const argsFile = join(home, 'worker-args');
  writeFileSync(
    join(bin, 'codex'),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$FM2_ARGS_FILE"\n',
    { mode: 0o755 },
  );
  const invoked = spawnSync('/bin/sh', ['-c', fresh], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FM2_ARGS_FILE: argsFile },
  });
  assert.equal(invoked.status, 0, invoked.stderr);
  const actualArgs = readFileSync(argsFile, 'utf8');
  assert.match(actualArgs, /--no-alt-screen/);
  assert.match(actualArgs, /hooks\.SessionStart=/);
  assert.match(actualArgs, /continue the same task/);

  const resumed = launchCommand({
    agent: 'codex',
    id: 'wo-codex',
    settingsFile: settings,
    briefPath: prompt,
    resume: '44444444-4444-4444-4444-444444444444',
  });
  assert.match(resumed, /codex resume /);
  assert.match(resumed, /'44444444-4444-4444-4444-444444444444'/);
});

test('the Codex controller launcher passes native hooks to the real CLI boundary', () => {
  const home = freshHome();
  const bin = mkdtempSync(join(tmpdir(), 'fm2-codex-bin-'));
  const argsFile = join(home, 'codex-args');
  writeFileSync(
    join(bin, 'codex'),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$FM2_ARGS_FILE"\n',
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [join(ROOT, 'supervisor.mjs'), 'codex'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FM2_HOME: home,
      FM2_PANEL: 'fm-launcher-test',
      FM2_ARGS_FILE: argsFile,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(argsFile, 'utf8');
  assert.match(args, /model="gpt-5\.6-sol"/);
  assert.match(args, /model_reasoning_effort="ultra"/);
  assert.match(args, /approval_policy="never"/);
  assert.match(args, /sandbox_mode="danger-full-access"/);
  assert.match(args, /tui\.status_line=\["project-name","git-branch","model-with-reasoning","fast-mode","context-used"\]/);
  assert.ok(args.includes('--dangerously-bypass-hook-trust'));
  assert.match(args, /hooks\.SessionStart=/);
  assert.match(args, /hooks\.UserPromptSubmit=/);
  assert.match(args, /supervisor-start\.mjs/);
  assert.match(args, /hooks\.Stop=/);
  assert.match(args, /supervisor-stop\.mjs/);
});
