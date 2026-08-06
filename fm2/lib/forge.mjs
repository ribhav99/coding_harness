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
