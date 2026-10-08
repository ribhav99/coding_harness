// git, asked from Node. Quiet by default: a failed question is the caller's
// to interpret, not something to print over the pane.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function git(cwd, args, { quiet = true } = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  }).trim();
}

// What branch a checkout is on right now. Null when it has gone, or when it is
// detached - a review worktree, which sits on a PR head with no branch.
//
// symbolic-ref, not `rev-parse --abbrev-ref`, which answers the literal string
// "HEAD" for a detached checkout. A record claiming a review sits on a branch
// called HEAD is a record that lies.
export function currentBranch(worktree) {
  if (!worktree || !existsSync(worktree)) return null;
  try { return git(worktree, ['symbolic-ref', '-q', '--short', 'HEAD']) || null; } catch { return null; }
}

// Every worktree of the repository a checkout belongs to, the main checkout
// first - which is the order git lists them in.
export function worktreePaths(checkout) {
  return git(checkout, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => resolve(line.slice('worktree '.length)));
}

// The name the forge knows this branch by, which is not always the local one.
//
// A worker that pushes `HEAD:ribhav/wo-354-match-quantity` leaves its worktree on
// a branch called `wo-354-match-quantity` and a PR whose head is the prefixed
// name. `gh pr list --head` matches only what was pushed, so asking with the
// local name gets "no PR open on that branch" for a branch that plainly has one -
// and `handoff --stage swap` then refuses to open the cold review on a task that
// did everything right.
//
// git already records where a branch pushes to, so ask it rather than guessing at
// the convention. A branch with no upstream has not been pushed anywhere, and its
// local name is the only name there is.
export function pushedBranchOf(worktree, local = currentBranch(worktree)) {
  if (!worktree || !local || !existsSync(worktree)) return local;
  try {
    const upstream = git(worktree, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${local}@{upstream}`]);
    if (!upstream) return local;
    // "origin/ribhav/wo-354" -> "ribhav/wo-354". Only the remote comes off; a
    // branch name with its own slashes keeps every one of them.
    const cut = upstream.indexOf('/');
    return cut === -1 ? upstream : upstream.slice(cut + 1);
  } catch {
    // No upstream recorded - never pushed, or pushed without tracking.
    return local;
  }
}

// The checkout a worktree hangs off, from git rather than from a naming
// convention: `--git-common-dir` resolves to the main checkout's .git, whose
// parent is the checkout itself.
export function mainCheckoutOf(worktree) {
  if (!existsSync(worktree)) return null;
  try {
    const common = git(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return common.endsWith('/.git') ? dirname(common) : null;
  } catch {
    return null;
  }
}
