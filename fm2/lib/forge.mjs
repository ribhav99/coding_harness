// The forge is the record.
//
// v1 kept a status vocabulary and then had a rule saying to confirm the forge
// rather than trust it - which was an admission the bookkeeping was never the
// truth. v2 keeps no bookkeeping, so this is not a cross-check. It is where
// state comes from.
//
// This matters concretely: a review once reported it had requested changes when
// a plain comment had landed, and only reading the PR caught it.

import { execFileSync } from 'node:child_process';

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function pr(repo, number, fields = ['number', 'state', 'reviewDecision', 'title', 'author', 'url', 'headRefName']) {
  try {
    return JSON.parse(gh(['pr', 'view', String(number), '--repo', repo, '--json', fields.join(',')]));
  } catch (err) {
    throw new Error(`could not read PR ${number} on ${repo}: ${err.message}`);
  }
}

// The PR a branch has open, if any.
//
// A ship task opens its own PR, so nothing in the harness ever learns the
// number - the worker knows it and the task record does not. That broke the
// automatic chain at its last step: `handoff --stage swap` needs a number to
// open the cold review on, and died on a task that had done everything right.
// Asking the forge which PR the branch has is better than recording it anyway,
// because a worker that opened a PR and then had it closed and reopened would
// leave the record wrong, and the forge is never wrong about this.
export function prForBranch(repo, branch) {
  if (!branch) return null;
  try {
    const rows = JSON.parse(gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number']));
    return rows.length ? rows[0].number : null;
  } catch {
    return null;
  }
}

// Whether a branch's work is already on the main line.
//
// Not answerable from git: the repo squash-merges, so a landed branch's commits
// are nowhere in the base's history and `merge-base --is-ancestor` says no for
// work that shipped an hour ago. The forge is the only thing that knows.
export function branchIsMerged(repo, branch) {
  if (!repo || !branch) return false;
  try {
    const rows = JSON.parse(gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'merged', '--json', 'number']));
    return rows.length > 0;
  } catch {
    // No `gh`, no network, no answer - and an unanswered question is not a yes.
    return false;
  }
}

// What actually landed, as opposed to what a worker says it did.
export function reviewState(repo, number) {
  const data = pr(repo, number, ['state', 'reviewDecision', 'reviews']);
  const mine = (data.reviews || []).filter((r) => r.state !== 'COMMENTED' || true);
  return {
    prState: data.state,
    decision: data.reviewDecision,
    approved: data.reviewDecision === 'APPROVED',
    changesRequested: data.reviewDecision === 'CHANGES_REQUESTED',
    lastReview: mine.length ? mine[mine.length - 1] : null,
  };
}

export function inlineCommentCount(repo, number) {
  try {
    return Number(gh(['api', `repos/${repo}/pulls/${number}/comments`, '--jq', 'length']) || 0);
  } catch {
    return 0;
  }
}

// The one-line outcome the captain's vocabulary uses, derived from the forge and
// nothing else.
export function outcomeWord(repo, number) {
  const state = reviewState(repo, number);
  const comments = inlineCommentCount(repo, number);
  if (state.approved) return comments > 0 ? 'approved with comments' : 'approved';
  return 'comments up';
}

export function repoOf(projectPath) {
  try {
    const url = execFileSync('git', ['-C', projectPath, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function fetchPrHead(projectPath, number, ref) {
  execFileSync('git', ['-C', projectPath, 'fetch', '--quiet', 'origin', `+refs/pull/${number}/head:${ref}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return ref;
}
