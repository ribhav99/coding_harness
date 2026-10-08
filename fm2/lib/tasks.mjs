// A task is a tmux pane, a git worktree, and a brief. Spawning one, and taking
// one down without destroying work.
//
// The rails here are not general safety theatre. Each one caught a real mistake
// in the two days before this was written, and each refusal is loud.

import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { saveTask, loadTask, removeTask, projectConfig, dir } from './config.mjs';
import { syncSkills } from './skills.mjs';
import { branchIsMerged, prIsMerged, repoOf } from './forge.mjs';
import { configurePanelQuotaStatus } from './quota-status.mjs';
import { normalizeAgent } from './sessions.mjs';
import { git } from './git.mjs';
import { tmux, paneAlive } from './tmux.mjs';
import { writeWorkerSettings } from './launch.mjs';
import { assertStarted, clearStartupPrompts, openPane, sessionName } from './panes.mjs';

// What a new task branches FROM.
//
// A project that declares this wins over the remote, and that order is the whole
// point: origin/HEAD is whatever the forge was set to once, while a declared
// branch is someone saying where work actually starts today. fitness_agent
// develops on a release branch 14 commits ahead of the master origin/HEAD still
// points at - honouring the remote there cuts every task from a stale base, and
// nothing says so.
// A new branch starts from the remote's tip, not the local branch of the same
// name. The checkout's own develop is whatever was last pulled into it - ten
// merges behind after a week away - and a worker built on that starts on code
// the team has already replaced. The local branch is the fallback only when the
// remote cannot be reached.
function startPoint(project) {
  const branch = defaultBranch(project);
  try {
    git(project, ['fetch', '--quiet', 'origin', branch]);
    git(project, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    return `origin/${branch}`;
  } catch {
    return branch;
  }
}

export function defaultBranch(project) {
  const declared = projectConfig(project).default_branch;
  if (declared) return declared;
  try {
    const head = git(project, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    return head.split('/').pop();
  } catch {
    return 'main';
  }
}

// The worktree sits beside the project, named for the task, following the
// convention the project already uses by hand.
export function worktreePath(project, id) {
  const cfg = projectConfig(project);
  const parent = cfg.worktree_parent || dirname(resolve(project));
  return join(parent, `${basename(resolve(project))}-${id}`);
}

// A task never runs in the primary checkout. Asserted before an agent exists,
// because by the time one does it has already started editing.
function assertIsolated(project, worktree) {
  const primary = resolve(project);
  const wt = resolve(worktree);
  if (wt === primary) throw new Error(`refusing to run task in the primary checkout: ${primary}`);
  if (!wt.startsWith(dirname(primary))) throw new Error(`worktree ${wt} is not beside the project`);
}
export function spawnTask({
  id,
  project,
  brief,
  baseRef = null,
  window = 'workers',
  agent = 'claude',
  env = {},
}) {
  const provider = normalizeAgent(agent);
  if (loadTask(id)) throw new Error(`task "${id}" already exists`);
  // Before anything is launched: a worker told to run a skill must resolve it to
  // THIS checkout, not to whatever an old symlink still points at.
  syncSkills({ agent: provider });
  const wt = worktreePath(project, id);
  assertIsolated(project, wt);
  if (existsSync(wt)) throw new Error(`worktree already exists: ${wt}`);

  if (baseRef) {
    git(project, ['worktree', 'add', '--detach', wt, baseRef]);
  } else {
    git(project, ['worktree', 'add', '--no-track', '-b', id, wt, startPoint(project)]);
  }

  const briefDir = dir('briefs', id);
  const briefPath = join(briefDir, 'brief.md');
  writeFileSync(briefPath, brief);
  const settingsFile = writeWorkerSettings(id, provider);

  // One pane per task in a named window, so Ribhav can watch a row of them.
  // Everything from here can fail, and a half-made task is worse than none: it
  // leaves a worktree nobody owns and a branch nobody will finish. So the rest
  // rolls back.
  let pane;
  try {
    pane = openPane(window, wt, briefPath, id, settingsFile, null, provider, project);
    clearStartupPrompts(pane, { agent: provider });
    assertStarted(pane, id);
  } catch (err) {
    try { git(project, ['worktree', 'remove', '--force', wt]); } catch { /* never made it */ }
    throw new Error(`could not start "${id}": ${err.message.split('\n')[0]}`);
  }

  return saveTask({
    id,
    project: resolve(project),
    worktree: wt,
    pane,
    brief: briefPath,
    kind: baseRef ? 'review' : 'ship',
    agent: provider,
    panel: sessionName(),
    created_at: new Date().toISOString(),
    ...env,
  });
}

// --- adoption ----------------------------------------------------------------

// A session on a worktree Ribhav already has.
//
// Every rail in spawnTask assumes the worktree is the harness's own: it creates
// it, and closing destroys it. A branch Ribhav has had open for a week is
// the opposite kind of thing. It exists, it may hold uncommitted work, and it
// must still be there afterwards - so adoption is its own path rather than a
// flag on spawn, and the record carries `adopted` so teardown can tell them
// apart. Getting that backwards would delete real work on `fm close`.
// And a task whose PANE has died is the same shape of thing again. The tmux
// server going takes every pane in the panel with it and touches nothing else:
// the worktrees are all still on disk and every conversation is still in
// ~/.claude/projects. What is missing is only the pane. Refusing that as
// "already exists" left no way back at all - `attach` would not move, and `close`
// was the only command that would, which throws the record away to get a session
// back and takes the review's PR and the report rail with it. So a dead pane is
// REOPENED, keeping the record: a review stays a review, an adopted worktree
// stays Ribhav's. A pane that is alive is still refused, because that is
// genuinely the same session started twice.
export function adoptTask({
  id,
  project,
  worktree,
  window = null,
  brief = null,
  resume = null,
  agent = 'claude',
  env = {},
}) {
  const provider = normalizeAgent(agent);
  const existing = loadTask(id);
  if (existing && paneAlive(existing.pane)) throw new Error(`task "${id}" already exists`);
  // A reopened review belongs back in the reviews window, not among the workers.
  const target = window ?? (existing?.kind === 'review' ? 'reviews' : 'workers');
  syncSkills({ agent: provider });
  const wt = resolve(worktree);
  if (!existsSync(wt)) throw new Error(`no worktree at ${wt}`);
  assertIsolated(project, wt);

  // It must be a worktree of THIS project. Attaching to a checkout of something
  // else would put the pane in a panel it has nothing to do with, and `fm status`
  // would then read it against the wrong repository.
  const known = git(project, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => resolve(line.slice('worktree '.length)));
  if (!known.includes(wt)) throw new Error(`${wt} is not a worktree of ${resolve(project)}`);

  let briefPath = null;
  if (brief) {
    briefPath = join(dir('briefs', id), 'brief.md');
    writeFileSync(briefPath, brief);
  }
  const settingsFile = writeWorkerSettings(id, provider);

  // Nothing to roll back. The worktree was not ours to make, so a launch that
  // fails leaves it exactly as it was found - which is the whole point.
  const pane = openPane(target, wt, briefPath, id, settingsFile, resume, provider, project);
  clearStartupPrompts(pane, { agent: provider });
  assertStarted(pane, id);

  // symbolic-ref, not `rev-parse --abbrev-ref`, which answers the literal string
  // "HEAD" for a detached checkout. A review worktree is always detached, and a
  // record claiming it sits on a branch called HEAD is a record that lies.
  let branch = null;
  try { branch = git(wt, ['symbolic-ref', '-q', '--short', 'HEAD']) || null; } catch { /* detached */ }

  return saveTask(
    reopened(existing, {
      id,
      project: resolve(project),
      worktree: wt,
      pane,
      brief: briefPath,
      kind: 'adopted',
      adopted: true,
      agent: provider,
      panel: sessionName(),
      branch,
      resumed: resume,
      created_at: new Date().toISOString(),
      ...env,
    }),
  );
}

// What a task's record looks like after its pane has been reopened: everything
// it already knew, with a new pane.
//
// Its own function because the risk here is silent. A reopen that quietly
// rewrites a review as `adopted` gives it back its session and takes away
// everything else - `fm status` stops reading its PR, `fm announce` has nothing
// to confirm, `missingReport` loses the path it reads the report beside, and
// `fm close` stops removing the worktree it made. The pane comes up looking
// perfectly fine either way, so nothing would show it until one of those failed.
export function reopened(existing, fresh) {
  if (!existing) return fresh;
  return {
    ...existing,
    ...fresh,
    // A spec given now replaces the old brief; without one, the task keeps the
    // brief it was launched with rather than losing the file beside its report.
    brief: fresh.brief ?? existing.brief ?? null,
    kind: existing.kind,
    // Never inferred from `fresh`, which always says adopted: whether a worktree
    // is Ribhav's or the harness's was settled when the task was made, and
    // it decides whether closing removes it.
    adopted: existing.adopted === true,
    resumed: fresh.resumed ?? existing.resumed ?? null,
    agent: fresh.agent ?? existing.agent ?? 'claude',
    sessions: { ...(existing.sessions ?? {}), ...(fresh.sessions ?? {}) },
    created_at: existing.created_at ?? fresh.created_at,
  };
}
// --- teardown ----------------------------------------------------------------

// The PR's own head, as a remote-tracking ref. A review worktree is detached at
// the PR head, and once the author pushes again the reviewer fetches that head
// by `refs/pull/N/head` - which updates no remote-tracking branch. The author's
// commits then look like they are on no remote, and closing the review refused
// over two commits that were sitting on GitHub the whole time (#516).
function fetchPullHead(wt, pr) {
  git(wt, ['fetch', '-q', 'origin', `+refs/pull/${pr}/head:refs/remotes/origin/pr/${pr}`]);
}

// Unlanded work is work that exists nowhere but this worktree. Uncommitted
// changes, or commits no remote has. Refusing is the point: a worktree removed
// with either is gone.
export function unlandedWork(task, { isMerged = branchIsMerged, mergedPr = prIsMerged, fetchPr = fetchPullHead } = {}) {
  const wt = task.worktree;
  if (!existsSync(wt)) return [];
  // An adopted worktree outlives its session, so closing strands nothing: the
  // changes are exactly where Ribhav left them. Refusing here would be
  // refusing to put a pane away over work that is in no danger.
  if (task.adopted) return [];
  const problems = [];
  const dirty = git(wt, ['status', '--porcelain']).split('\n').filter((l) => l.trim() && !l.startsWith('??'));
  if (dirty.length) problems.push(`${dirty.length} uncommitted change(s)`);
  try {
    // HEAD, not --branches. A review worktree sits on a detached PR head with no
    // branch of its own, and --branches would count every unpushed commit in the
    // whole repository against it - refusing every close for work that is not
    // this task's and is not even in this worktree.
    //
    // Every other local branch is excluded too, because a branch cut from a
    // master that is itself ahead of its remote inherits those commits, and they
    // are not this task's to strand - they are sitting in the real checkout,
    // which this close does not touch. Only what is reachable from here and
    // nowhere else dies with the worktree.
    // Its own branch is not an escape hatch, so it is the one ref not excluded.
    // A detached review head has none, and `symbolic-ref` exits non-zero saying
    // so - which must not take the whole check down with it.
    let own = '';
    try { own = git(wt, ['symbolic-ref', '-q', '--short', 'HEAD']).trim(); } catch { /* detached */ }

    // A squash-merged branch keeps commits that are on no remote forever - the
    // merge rewrote them into one new commit on the main line, so the originals
    // are unreachable by design and this check would refuse every landed ship
    // task for the rest of time. The content shipped; there is nothing to strand.
    //
    // Asked of the PR when there is one, because a review worktree is detached
    // and has no branch to ask about - and a review Ribhav redirected into
    // building is exactly the case that ends up holding landed work with nothing
    // to prove it by.
    const repo = task.repo ?? repoOf(task.project);
    if (task.pr && mergedPr(repo, task.pr)) return problems;
    if (own && isMerged(repo, own)) return problems;
    // What the PR holds is on a remote by definition. A fetch that fails proves
    // nothing either way, so the check below still runs on what is known.
    if (task.pr) {
      try { fetchPr(wt, task.pr); } catch { /* offline, or no such PR ref */ }
    }

    const others = git(wt, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
      .split('\n').map((l) => l.trim()).filter((b) => b && b !== own);
    // `--` ends the revisions. Without it, a branch whose name is also a path in
    // the tree makes git refuse the whole list as ambiguous - fitness_agent has
    // both a `marketing` branch and a `marketing/` directory - and this check
    // then reported a clean worktree. Three commits of review fixes Ribhav
    // had approved were sitting behind that, one `fm close` from gone.
    let unpushed;
    try {
      unpushed = git(wt, ['log', '--oneline', 'HEAD', '--not', '--remotes', ...others, '--'])
        .split('\n').filter(Boolean);
    } catch {
      // And a question git would not answer is not an answer. This is the one
      // check standing between a worktree and its own unpushed commits; the only
      // safe reading of a failure is that it might be holding some.
      problems.push('could not tell what is on no remote here');
      return problems;
    }
    if (unpushed.length) problems.push(`${unpushed.length} commit(s) on no remote`);
  } catch { /* no commits reachable, or no remotes: nothing to strand */ }
  return problems;
}

// A review whose findings live only in a session is a review that dies with it.
export function missingReport(task) {
  if (task.kind !== 'review') return null;
  const report = join(dirname(task.brief), 'report.md');
  return existsSync(report) ? null : report;
}

export function closeTask(id, { force = false } = {}) {
  const task = loadTask(id);
  if (!task) throw new Error(`no task "${id}"`);

  if (!force) {
    const unlanded = unlandedWork(task);
    if (unlanded.length) {
      throw new Error(
        `refusing to close "${id}": ${unlanded.join(', ')}. ` +
          'That work exists nowhere else. Land it, or say so explicitly.',
      );
    }
    const report = missingReport(task);
    if (report) {
      throw new Error(
        `refusing to close review "${id}": no report at ${report}. ` +
          'Its findings would go with the worktree.',
      );
    }
  }

  // Closing the last task in a window takes the window with it, because tmux has
  // no concept of an empty one. Ribhav navigates by tab, so a `reviews` that
  // disappears the moment its queue empties is a tab they have to rebuild by hand
  // to use again. Leave a placeholder shell behind instead - `openPane` already
  // treats a lone shell as a placeholder and replaces it, so the next task lands
  // in the same window rather than beside a stray pane.
  let window = null;
  try {
    window = tmux(['display-message', '-p', '-t', task.pane, '#{window_id}']).trim();
    const panes = tmux(['list-panes', '-t', window, '-F', '#{pane_id}']).split('\n').filter(Boolean);
    if (panes.length === 1) tmux(['split-window', '-d', '-t', window, '-c', task.project]);
  } catch { /* the pane is already gone, so there is no window to keep */ }
  try { tmux(['kill-pane', '-t', task.pane]); } catch { /* pane already gone */ }
  // Killing a pane hands its space to whichever neighbour happens to adjoin it,
  // so the survivors keep a shape built for a window that no longer exists - one
  // pane spanning the full width under three, and worse as more come and go.
  // `openPane` already tiles on the way in; tiling on the way out too is what
  // makes the grid a property of the window rather than of its history.
  if (window) {
    try { tmux(['select-layout', '-t', window, 'tiled']); } catch { /* window went with the pane */ }
  }
  // Closing an adopted task takes the session down and nothing else. The
  // worktree and its branch were Ribhav's before this and remain theirs
  // after; `--force` here would remove a week of work and call it teardown.
  //
  // Unless it has landed. Once the PR is merged there is no week of work to
  // protect - the branch is on the main line and the worktree is a stale copy of
  // it, one of two dozen Ribhav then clears by hand. Merged work is the one
  // case where taking the worktree with the session is the whole point.
  if (!task.adopted || branchIsMerged(repoOf(task.project), task.branch)) {
    try { git(task.project, ['worktree', 'remove', '--force', task.worktree]); } catch { /* already removed */ }
  }
  removeTask(id);
  // Closing the final Codex worker in a mixed panel has the same cleanup need
  // as switching it. A Codex controller or another Codex task keeps the bar.
  configurePanelQuotaStatus(task.panel, 'claude');
  return task;
}
