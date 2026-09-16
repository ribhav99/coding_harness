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

// A forge that is briefly down is not an answer about the repository.
//
// GitHub's GraphQL endpoint 503s in bursts - four refusals and then a clean
// reply, inside a minute. Every helper here used to read that burst as a fact:
// `prForBranch` returned null, and `handoff --stage swap` told Ribhav the
// task "has no PR recorded, and its branch has none open" about a PR that was
// open and mergeable in the next tab. The chain stopped, and the message was
// worse than the stall, because it was wrong.
//
// So ride out the burst, and if it outlasts us, let the error out. The one thing
// never to do is hand a caller a value it cannot tell from a real answer.
const TRANSIENT = /HTTP (429|50[0234])|timeout|TLS handshake|connection reset|unexpected EOF|no such host/i;

function pause(ms) {
  // Synchronous, because everything downstream of here is.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function gh(args, { attempts = 4 } = {}) {
  for (let i = 0; ; i += 1) {
    try {
      return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (err) {
      const text = `${err.stderr || ''}\n${err.message || ''}`;
      if (i >= attempts - 1 || !TRANSIENT.test(text)) throw err;
      pause(1000 * 2 ** i);
    }
  }
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
// Null means asked and told none. A forge that would not answer throws, because
// the caller's next move is to say there is nothing to review - and it must not
// say that on the strength of a question nobody got to ask.
export function prForBranch(repo, branch) {
  if (!repo || !branch) return null;
  const rows = JSON.parse(gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number']));
  return rows.length ? rows[0].number : null;
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

// The PR a branch opened, once it has landed.
//
// `prForBranch` asks only for open ones, which is right when you are looking for
// something to work on and exactly wrong when you are looking for something to
// put away: a merged PR is invisible to it, and merged is precisely when the
// task wants closing. A ship task carries no PR number of its own - the worker
// opens the PR, so `fm` never learns the number - which leaves the branch as the
// only thread back to it.
export function landedPrForBranch(repo, branch) {
  if (!repo || !branch) return null;
  try {
    const rows = JSON.parse(gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'merged', '--json', 'number', '--limit', '1']));
    return rows.length ? rows[0].number : null;
  } catch {
    // No `gh`, no network, no answer - and an unanswered question is not a yes.
    return null;
  }
}

// The same question asked of a PR rather than a branch.
//
// A review worktree is detached, so it has no branch to ask about - and a review
// task that Ribhav redirected into building ends up holding the work that
// landed, with nothing to prove it by. It carries its PR number, which is the
// better question anyway: the branch may have been auto-deleted on merge.
export function prIsMerged(repo, number) {
  if (!repo || !number) return false;
  try {
    return JSON.parse(gh(['pr', 'view', String(number), '--repo', repo, '--json', 'state'])).state === 'MERGED';
  } catch {
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

// The one-line outcome Ribhav's vocabulary uses, derived from the forge and
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
