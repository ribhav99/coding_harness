// fm2's contract. Every test here is a rail that caught a real mistake, or the
// notification mechanism that replaces v1's watcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, utimesSync } from 'node:fs';
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

  recordSupervisor('%3');
  const first = await knock('pr-9', { send });
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
  const second = await knock('pr-9', { send });
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
        env: { ...process.env, FM2_HOME: home, TMUX_PANE: pane },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return 0;
    } catch (err) { return err.status; }
  };

  assert.equal(run('%3'), 0);
  assert.equal(supervisorPane(), '%3');

  // A restarted supervisor lands in a new pane, and a stale id knocks on
  // somebody else's door - so it is rewritten on every stop, not just the first.
  assert.equal(run('%77'), 0);
  assert.equal(supervisorPane(), '%77', 'a moved supervisor kept its old address');
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

// Reopening a branch you have worked on should carry its conversation, and the
// id that names it is a filename under a folder derived from the cwd. Two things
// are easy to get wrong: the encoding (underscores become dashes, same as
// slashes), and which file wins.
test('the last conversation in a worktree is found by cwd, newest first', async () => {
  freshHome();
  const { lastSessionFor } = await import(join(ROOT, 'lib/tasks.mjs'));

  const root = mkdtempSync(join(tmpdir(), 'fm2-projects-'));
  const wt = join(tmpdir(), 'fitness_agent-fm-volume_score');
  // Underscores are dashed exactly like the separators, which is what made
  // fitness_agent-marketing resolve to ...-fitness-agent-marketing.
  const folder = join(root, wt.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(folder, { recursive: true });

  assert.equal(lastSessionFor(wt, root), null, 'an empty folder claimed a conversation');

  const older = join(folder, '11111111-1111-1111-1111-111111111111.jsonl');
  const newer = join(folder, '22222222-2222-2222-2222-222222222222.jsonl');
  writeFileSync(older, '{}\n');
  writeFileSync(newer, '{}\n');
  utimesSync(older, new Date(1e9), new Date(1e9));
  utimesSync(newer, new Date(2e9), new Date(2e9));

  assert.equal(lastSessionFor(wt, root), '22222222-2222-2222-2222-222222222222');
  // A worktree nobody has opened has nothing to resume, and saying so is how
  // `fm attach --resume` refuses instead of coming up cold and looking resumed.
  assert.equal(lastSessionFor(join(tmpdir(), 'never-opened'), root), null);
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
