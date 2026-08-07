#!/usr/bin/env node
// fm - the whole harness.
//
//   fm review <pr> [--project <dir>]   open a cold review on a PR
//   fm ship <id> --spec <text|@file>   put a worker on a task
//   fm attach <worktree> [--spec ...]  a session on a worktree that already exists
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
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTasks, loadTask, saveTask, capabilities, projectConfig, dir } from './lib/config.mjs';
import { spawnTask, adoptTask, closeTask, sendToPane, paneAlive, unlandedWork, missingReport } from './lib/tasks.mjs';
import { drain, count } from './lib/notify.mjs';
import { pr, reviewState, outcomeWord, repoOf, fetchPrHead, inlineCommentCount } from './lib/forge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function die(msg, code = 1) {
  process.stderr.write(`fm: ${msg}\n`);
  process.exit(code);
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REVIEW_BRIEF = (prUrl, id, reportPath, specPath) => `You are an autonomous worker. Work on your own; do not wait for a human.

Review pull request ${prUrl}.
You did not write this code and have not seen it before. That is the point: read it cold.

Run the \`full-review\` skill against that PR and follow it to completion.

You are in an isolated git worktree checked out at the PR's head. Do not merge it, and
leave its branch alone unless the captain's decisions ask otherwise. Post NOTHING to
the forge until the captain has approved it finding by finding.

Write your outcome to ${reportPath}: the verdict, every finding you are confident in,
and the evidence for each. That report is the deliverable that survives this session.

Write your review spec to ${specPath} — NOT to .review/ inside the worktree. The
project's own pre-push gate formats and lints everything it finds in its tree, and
the harness's scaffolding is not the project's to check: left there it fails the
author's gate on files that have nothing to do with their code. Your decisions
file lands beside the spec, so both stay out of their way.

When your review exists, open it for the captain:

    surface open ${specPath}

Then STOP. Do not poll and do not wait. When the captain sends their decisions the
server wakes you; read them with \`surface read ${specPath}\`, act on exactly
what they approved, and stop again.

Two fields in those decisions are easy to swap, and swapping them changes the
outcome. \`verdict\` is the captain's call on the PR and the review you post -
an approve-with-comments verdict means you submit an APPROVE. \`mode\` says what
you may do to the code, never what to post. Neither one downgrades the other:
post the verdict you were given.

\`mode: comment\` is the default and means exactly that - inline comments, and the
branch untouched. \`mode: change\` means the captain read the findings and asked
for them applied, so commit and push them TO THE PR'S OWN BRANCH. Do not invent a
side branch: a fix the author has to go and cherry-pick is a fix that did not
land, and landing it is what was asked for. Push plainly - no force, no rebase,
nothing of theirs rewritten - and if it will not fast-forward, stop and say so.
Anything you judge unsafe to apply stays a comment, and you say which and why.

Approval is the only review state that carries meaning here. A COMMENT event and
a REQUEST_CHANGES event are read the same way, because the back-and-forth happens
in chat rather than through the forge - so never ask which of those two to use,
and never escalate between them. Getting an APPROVE right does matter.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches the captain, so make it two or three lines saying what you
concluded and what, if anything, you need.`;

const SHIP_BRIEF = (spec, id) => `You are an autonomous worker. Work on your own; do not wait for a human.

${spec}

You are in an isolated git worktree on your own branch. Implement it, push, and open a
PR. Do not merge it.

You never write a status line. Stopping IS your report - your last message before you
stop is what reaches the captain, so end with two or three lines saying what you built
and the PR's full URL.`;

const [, , command] = process.argv;

// --- review ------------------------------------------------------------------

if (command === 'review') {
  const number = process.argv[3] ?? die('usage: fm review <pr-number> [--project <dir>]');
  const project = resolve(arg('--project', process.cwd()));
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
    window: 'reviews',
    env: { pr: number, repo, pr_url: meta.url, pr_author: meta.author?.login ?? null },
  });
  process.stdout.write(`${id}\t${task.pane}\t${task.worktree}\n`);
  process.exit(0);
}

// --- ship --------------------------------------------------------------------

if (command === 'ship') {
  const id = process.argv[3] ?? die('usage: fm ship <id> --spec <text|@file>');
  const project = resolve(arg('--project', process.cwd()));
  let spec = arg('--spec') ?? die('a ship task needs --spec');
  if (spec.startsWith('@')) spec = readFileSync(spec.slice(1), 'utf8');
  const task = spawnTask({ id, project, brief: SHIP_BRIEF(spec, id), window: 'workers' });
  process.stdout.write(`${id}\t${task.pane}\t${task.worktree}\n`);
  process.exit(0);
}

// --- attach ------------------------------------------------------------------
// A session on a branch the captain already has open. `ship` is for work that
// does not exist yet and makes the worktree to hold it; `attach` is for work
// that does. Without --spec the session comes up idle, which is what a branch
// you want to sit down with looks like.

if (command === 'attach') {
  const target = process.argv[3] ?? die('usage: fm attach <worktree> [--project <dir>] [--id <id>] [--spec <text|@file>]');
  const worktree = resolve(target);
  const project = resolve(arg('--project', process.cwd()));
  // Named for the worktree, minus the project prefix the convention already puts
  // there: bnl-packpilot-wo-213 is simply wo-213.
  const base = worktree.split('/').pop();
  const prefix = `${project.split('/').pop()}-`;
  const id = arg('--id', base.startsWith(prefix) ? base.slice(prefix.length) : base);
  let spec = arg('--spec');
  if (spec && spec.startsWith('@')) spec = readFileSync(spec.slice(1), 'utf8');
  let task;
  try {
    task = adoptTask({ id, project, worktree, brief: spec ? SHIP_BRIEF(spec, id) : null });
  } catch (err) {
    die(err.message);
  }
  process.stdout.write(`${task.id}\t${task.pane}\t${task.branch ?? 'detached'}\t${task.worktree}\n`);
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
  const number = task.pr ?? die(`"${id}" has no PR recorded; nothing to review`);
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
