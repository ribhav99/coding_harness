// fm2's contract. Every test here is a rail that caught a real mistake, or the
// notification mechanism that replaces v1's watcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'fm2-home-'));
  process.env.FM2_HOME = home;
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

// --- the supervisor hook: the only thing that may interrupt ------------------

function runHook(hook, payload, env = {}) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'hooks', hook)], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, ...env },
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
