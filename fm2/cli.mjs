#!/usr/bin/env node
// fm - the whole harness.
//
//   fm review <pr> [--project <dir>]   open a cold review on a PR  [--window <name>]
//   fm ship <id> --spec <text|@file>   put a worker on a task  [--window <name>]
//                        [--investigate]  an open question to think through, not ship
//   fm attach <worktree> [--spec ...]  a session on a worktree that already exists
//                        [--resume]    carrying on the last conversation held there
//   fm handoff <id>                    close a finished ship task, open its cold review
//   fm read                            take the worker reports you have not read
//   fm status                          what is alive, and what the forge says
//   fm close <id> [--force]            take a task down, refusing to strand work
//   fm announce <id>                   post the outcome where the review was asked for
//   fm caps                            what this machine can reach
//
// There is no poll, no watcher, no daemon, and no status file. A worker stopping
// is the only trigger; it knocks on the supervisor's pane as it goes, and
// `fm read` is how its words reach you.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTasks, loadTask, saveTask, capabilities, projectConfig, dir } from './lib/config.mjs';
import { spawnTask, adoptTask, closeTask, sendToPane, paneAlive, unlandedWork, missingReport, lastSessionFor } from './lib/tasks.mjs';
import { drain, count } from './lib/notify.mjs';
import { pr, reviewState, outcomeWord, repoOf, fetchPrHead, inlineCommentCount, prForBranch } from './lib/forge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// What branch a worktree is on right now. Null when it has gone, or when the
// checkout is detached - a review worktree, which never needs this.
function branchOf(worktree) {
  if (!worktree || !existsSync(worktree)) return null;
  try {
    return execFileSync('git', ['-C', worktree, 'symbolic-ref', '-q', '--short', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() || null;
  } catch {
    return null;
  }
}

// The checkout a worktree hangs off, from git rather than from a naming
// convention: `--git-common-dir` resolves to the main checkout's .git, whose
// parent is the checkout itself.
function mainCheckoutOf(worktree) {
  if (!existsSync(worktree)) return null;
  try {
    const common = execFileSync('git', ['-C', worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return common.endsWith('/.git') ? dirname(common) : null;
  } catch {
    return null;
  }
}

function die(msg, code = 1) {
  process.stderr.write(`fm: ${msg}\n`);
  process.exit(code);
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Kicking off a review is invoking the review skill on the PR. Nothing else.
//
// This brief was once fifty lines re-deriving the skill's own rules - the modes,
// the surface, comments-only by default, what an approve means, where fixes get
// pushed. All of it already lives in `full-review`, which is the thing that
// actually runs. A second copy in the launch prompt does not reinforce the skill,
// it competes with it: the moment the skill changes, the brief is stale
// instructions arriving first and outranking it by being in the prompt.
//
// What stays is only what the skill cannot know, because it belongs to the
// harness rather than the review: where the report goes so the findings outlive
// the session, and that stopping is how a worker reports at all.
const REVIEW_BRIEF = (prUrl, id, reportPath, specPath) => `Run the \`full-review\` skill against ${prUrl}, and follow it to completion.

Two things the skill does not know about, because they are this harness's and not its:

Keep your review's own files out of the worktree - put the spec at ${specPath} and
write your outcome to ${reportPath}. The project's pre-push gate lints everything it
finds in its tree and will fail the author's gate on scaffolding that is not theirs,
and the report is what survives this session.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches Ribhav, so make it two or three lines saying what you
concluded and what, if anything, you need.`;

const SHIP_BRIEF = (spec, id) => `You are an autonomous worker. Work on your own; do not wait for a human.

${spec}

You are in an isolated git worktree on your own branch. Implement it, push, and open a
PR. Do not merge it.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches Ribhav, so end with two or three lines saying what you built
and the PR's full URL.`;

// Not every worker is shipping something. An open question - how should this
// work, what is this costing us, is this approach even right - handed the brief
// above gets a worker that opens a PR to look finished, which is the opposite of
// what an unanswered question needs.
const INVESTIGATE_BRIEF = (spec, id) => `You are a worker on an open question. Think it through. Do not implement it.

${spec}

You are in an isolated git worktree on your own branch. Read as widely across the project
as the question needs, and keep whatever you produce - notes, a proposal, a throwaway
prototype used only as evidence - inside this worktree. Do not open a PR, and do not
change how the project works to prove a point.

Ribhav is going to work this through WITH you, so what this first pass owes them is
a proposal worth arguing with: what the real constraint is, the options you can actually
see and what each costs, and which one you would pick and why. Where you are guessing,
say you are guessing - a confident wrong answer costs more here than an open question.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches Ribhav, so end with two or three lines saying what you found
and the call you would make.`;

const [, , command] = process.argv;

// --- review ------------------------------------------------------------------

if (command === 'review') {
  const number = process.argv[3] ?? die('usage: fm review <pr-number> [--project <dir>] [--window <name>]');
  const project = resolve(arg('--project', process.cwd()));
  // A batch of reviews Ribhav wants kept apart from the day's work gets its
  // own window, the same way `ship` batches do. Naming one that does not exist
  // yet is how you get it.
  const window = arg('--window', 'reviews');
  const repo = repoOf(project) ?? die(`no github remote on ${project}`);
  const caps = capabilities();
  if (!caps.gh) die('gh is not authenticated, so the PR cannot be read');

  const meta = pr(repo, number);
  const slug = String(meta.headRefName || '').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40);
  const id = `pr-${number}${slug ? `-${slug}` : ''}`;

  const ref = `refs/fm2/${id}`;
  fetchPrHead(project, number, ref);

  const reportPath = join(dir('briefs', id), 'report.md');
  const specPath = join(dir('briefs', id), 'review.json');
  const task = spawnTask({
    id,
    project,
    brief: REVIEW_BRIEF(meta.url, id, reportPath, specPath),
    baseRef: ref,
    window,
    env: { pr: number, repo, pr_url: meta.url, pr_author: meta.author?.login ?? null },
  });
  process.stdout.write(`${id}\t${task.pane}\t${task.worktree}\n`);
  process.exit(0);
}

// --- ship --------------------------------------------------------------------

if (command === 'ship') {
  const id = process.argv[3] ?? die('usage: fm ship <id> --spec <text|@file> [--window <name>] [--investigate]');
  const project = resolve(arg('--project', process.cwd()));
  let spec = arg('--spec') ?? die('a ship task needs --spec');
  if (spec.startsWith('@')) spec = readFileSync(spec.slice(1), 'utf8');
  // A window per batch, when Ribhav wants one. `fm` creates it on demand, so
  // naming one that does not exist yet is how you get it.
  const window = arg('--window', 'workers');
  // An open question gets a worker told to answer it, not one told to open a PR.
  const investigate = process.argv.includes('--investigate');
  const brief = investigate ? INVESTIGATE_BRIEF(spec, id) : SHIP_BRIEF(spec, id);
  const task = spawnTask({ id, project, brief, window });
  process.stdout.write(`${id}\t${task.pane}\t${task.worktree}\n`);
  process.exit(0);
}

// --- attach ------------------------------------------------------------------
// A session on a branch Ribhav already has open. `ship` is for work that
// does not exist yet and makes the worktree to hold it; `attach` is for work
// that does. Without --spec the session comes up idle, which is what a branch
// you want to sit down with looks like.
//
// And a branch that already exists usually has a conversation behind it. `--resume`
// opens the pane on that conversation instead of a blank one, which is nearly
// always what sitting back down with a branch means: an idle session that has to
// be told the history again is the same session started twice.

if (command === 'attach') {
  const target = process.argv[3] ?? die('usage: fm attach <worktree> [--project <dir>] [--id <id>] [--spec <text|@file>] [--window <name>] [--resume [<session>]]');
  const worktree = resolve(target);
  // A worktree knows which checkout it belongs to, so asking it beats defaulting
  // to whatever directory the supervisor happens to be standing in. Attaching to
  // a bnl-packpilot worktree from the harness checkout used to fail with "is not
  // a worktree of coding_harness" - true, unhelpful, and about a directory nobody
  // named. --project still wins when it is given.
  const project = resolve(arg('--project') ?? mainCheckoutOf(worktree) ?? process.cwd());
  // Named for the worktree, minus the project prefix the convention already puts
  // there: bnl-packpilot-wo-213 is simply wo-213.
  const base = worktree.split('/').pop();
  const prefix = `${project.split('/').pop()}-`;
  const id = arg('--id', base.startsWith(prefix) ? base.slice(prefix.length) : base);
  let spec = arg('--spec');
  if (spec && spec.startsWith('@')) spec = readFileSync(spec.slice(1), 'utf8');
  const window = arg('--window', 'workers');
  // Bare `--resume` means the last conversation in that worktree; a value names
  // one exactly. Refusing when there is nothing to resume is deliberate: the
  // alternative is a pane that comes up cold looking exactly like one that
  // resumed, and Ribhav finds out by asking it something it cannot answer.
  let resume = null;
  if (process.argv.includes('--resume')) {
    const named = arg('--resume');
    resume = named && !named.startsWith('--') ? named : lastSessionFor(worktree);
    if (!resume) die(`no past conversation in ${worktree} to resume`);
  }
  let task;
  try {
    task = adoptTask({ id, project, worktree, window, brief: spec ? SHIP_BRIEF(spec, id) : null, resume });
  } catch (err) {
    die(err.message);
  }
  process.stdout.write(`${task.id}\t${task.pane}\t${task.branch ?? 'detached'}\t${task.worktree}${resume ? `\t${resume}` : ''}\n`);
  process.exit(0);
}

// --- handoff -----------------------------------------------------------------
// The automatic chain: a ship task that opened a PR reviews its own work once,
// then is closed and replaced by a session that never saw it written.

if (command === 'handoff') {
  const id = process.argv[3] ?? die('usage: fm handoff <id>');
  const task = loadTask(id) ?? die(`no task "${id}"`);
  const stage = arg('--stage', task.handoff_stage ?? 'self-review');

  if (stage === 'self-review') {
    if (!paneAlive(task.pane)) die(`"${id}" has no live session to self-review`);
    sendToPane(
      task.pane,
      'Before this hands off: review your own work on this PR as if you did not write it. ' +
        'Push any fixes you are confident in, then stop and say what you found.',
    );
    saveTask({ ...task, handoff_stage: 'awaiting-self-review' });
    process.stdout.write(`${id}: asked to self-review; it will report when it stops\n`);
    process.exit(0);
  }

  // Stage two and three are one operation, so the swap cannot half-happen and
  // leave the work with no session at all.
  // A review task carries its PR number; a ship task never does, because the
  // worker is the one that opened it. So ask the forge what the branch has open
  // before giving up - the whole point of the chain is that a finished ship task
  // becomes a cold review without Ribhav doing it by hand.
  // The worktree is asked first, because the branch a task ENDS on is not the
  // one it was created with: a worker that names its own branch leaves the task
  // record pointing at nothing, and the chain then dies on a PR that is sitting
  // right there. Same reason the PR number is asked of the forge rather than
  // recorded - what the worker actually did beats what we wrote down.
  let number = task.pr ?? null;
  if (number == null) {
    try {
      number = prForBranch(task.repo ?? repoOf(task.project), branchOf(task.worktree) ?? task.branch ?? id);
    } catch (err) {
      // Distinct from the refusal below on purpose: "the forge would not say" and
      // "there is no PR" lead Ribhav to opposite next moves, and only one of
      // them is worth acting on.
      die(`could not ask the forge what "${id}" has open: ${String(err.stderr || err.message).trim().split('\n')[0]}\nNothing changed; run this again.`);
    }
  }
  if (number == null) die(`"${id}" has no PR recorded, and its branch has none open; nothing to review`);
  let closed;
  try {
    closed = closeTask(id);
  } catch (err) {
    die(`${err.message}\nThe handoff changed nothing.`);
  }
  const project = closed.project;
  const repo = closed.repo ?? repoOf(project);
  const meta = pr(repo, number);
  const reviewId = `pr-${number}-${String(meta.headRefName || '').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40)}`;
  const ref = `refs/fm2/${reviewId}`;
  fetchPrHead(project, number, ref);
  const reportPath = join(dir('briefs', reviewId), 'report.md');
  const specPath = join(dir('briefs', reviewId), 'review.json');
  const review = spawnTask({
    id: reviewId,
    project,
    brief: REVIEW_BRIEF(meta.url, reviewId, reportPath, specPath),
    baseRef: ref,
    window: 'reviews',
    env: { pr: number, repo, pr_url: meta.url, pr_author: meta.author?.login ?? null },
  });
  process.stdout.write(`${id} closed; ${reviewId} now reviewing ${meta.url}\n`);
  process.exit(0);
}

// --- read --------------------------------------------------------------------

if (command === 'read') {
  const items = drain();
  if (!items.length) {
    process.stdout.write('nothing new\n');
    process.exit(0);
  }
  for (const item of items) {
    process.stdout.write(`\n=== ${item.task} — ${item.at} ===\n${item.text}\n`);
  }
  process.exit(0);
}

// --- status ------------------------------------------------------------------

if (command === 'status') {
  const tasks = allTasks();
  if (!tasks.length) {
    process.stdout.write('no tasks\n');
    process.exit(0);
  }
  const caps = capabilities();
  for (const task of tasks) {
    const alive = paneAlive(task.pane) ? 'alive' : 'DEAD';
    let forge = '';
    if (task.pr && caps.gh) {
      try {
        const s = reviewState(task.repo, task.pr);
        forge = ` | PR ${task.pr} ${s.prState}/${s.decision ?? '-'}`;
      } catch { forge = ` | PR ${task.pr} unreadable`; }
    }
    // An adopted task has no PR of its own to read state from, so the branch it
    // sits on is the only thing that says which one it is.
    const where = task.adopted && task.branch ? ` | ${task.branch}` : '';
    process.stdout.write(`${task.id}\t${task.pane}\t${alive}${where}${forge}\n`);
  }
  const n = count();
  if (n) process.stdout.write(`\n${n} unread report(s) — fm read\n`);
  process.exit(0);
}

// --- close -------------------------------------------------------------------

if (command === 'close') {
  const id = process.argv[3] ?? die('usage: fm close <id> [--force]');
  const force = process.argv.includes('--force');
  try {
    closeTask(id, { force });
    process.stdout.write(`closed ${id}\n`);
  } catch (err) {
    die(err.message);
  }
  process.exit(0);
}

// --- announce ----------------------------------------------------------------

if (command === 'announce') {
  const id = process.argv[3] ?? die('usage: fm announce <id>');
  const task = loadTask(id) ?? die(`no task "${id}"`);
  if (!task.pr) die(`"${id}" has no PR`);
  const caps = capabilities();
  if (!caps.gh) die('gh is not authenticated, so the outcome cannot be confirmed');

  // Confirm on the forge. Never relay what a worker said it did.
  const word = outcomeWord(task.repo, task.pr);
  const cfg = projectConfig(task.project);

  if (!caps.slack || !cfg.review_channel) {
    process.stdout.write(
      `PR ${task.pr} — ${word}\n` +
        `(no Slack on this machine${cfg.review_channel ? '' : ' and no review channel configured'}; ` +
        'nothing was posted)\n',
    );
    process.exit(0);
  }
  // The supervisor posts it; this prints exactly what to say and where.
  process.stdout.write(JSON.stringify({ channel: cfg.review_channel, author: task.pr_author, text: `PR ${task.pr} — ${word}` }) + '\n');
  process.exit(0);
}

if (command === 'caps') {
  process.stdout.write(`${JSON.stringify(capabilities({ refresh: true }), null, 2)}\n`);
  process.exit(0);
}

die('usage: fm review|ship|attach|handoff|read|status|close|announce|caps');
