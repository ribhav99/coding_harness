// The review server. One process, many pages, no held connections.
//
// The architecture is one decision: nothing waits. The tool this replaces had
// the reviewing agent block in a foreground long-poll until Ribhav acted.
// That connection died on its own roughly every half hour, and each death fed an
// idle session an input it did not need, which produced a turn, which woke the
// supervisor. Hundreds of wakes, none of them work.
//
// Here a review writes its page, opens it, and stops. When Ribhav sends,
// this server writes decisions.json and pushes one line into that review's tmux
// pane. The reviewer wakes exactly once per thing Ribhav sends, and never
// otherwise.
//
// No dependencies. node:http is enough, and a surface with no install step is a
// surface a second machine reproduces by cloning.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { renderPage, findingId, ACCEPTED } from './lib/render.mjs';
import { embeddedHtml, assertPageSize } from './lib/page.mjs';
import { isDesign, designQuestions, parseDesignFeedback } from './lib/design.mjs';
import { buildStamp } from './lib/build.mjs';
import {
  lookup,
  writeDecisions,
  listReviews,
  readReview,
  readReceipt,
  receiptPath,
  isSubmissionId,
  atomicJson,
  paneIdentity,
} from './lib/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, 'static');
const PORT = Number(process.env.SURFACE_PORT || 4390);
const HOST = '127.0.0.1';
const BUILD = buildStamp();
const submitting = new Map();

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function json(res, status, obj) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
}

// Push one line into the reviewer's pane. This is the whole notification
// mechanism: the reviewer is a stopped session, and typing into its pane is
// exactly what Ribhav would do by hand.
function sendKeys(args) {
  return new Promise((resolve) => {
    execFile('tmux', args, { timeout: 3000 }, (error, stdout) => resolve(error ||
      (stdout.trim() === 'SURFACE_SENT' ? null : new Error('Reviewer notification blocked: the pane changed or has synchronized input enabled.'))));
  });
}

// Codex treats a rapid literal key stream as a paste and suppresses submission
// for 120ms afterward. Without a gap, Enter becomes a newline and Ribhav's
// decision sits visibly in the composer without ever waking the reviewer.
const SUBMIT_SETTLE_MS = 250;
const settleComposer = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function wakePane(pane, line, { send = sendKeys, wait = settleComposer, identity = null, socket = null } = {}) {
  if (!pane) return { woke: false, reason: 'no pane recorded for this review' };
  const pid = identity?.split(':')[0];
  if (!/^%\d+$/.test(pane) || !/^\d+$/.test(pid || '')) return { woke: false, reason: 'The original reviewer identity is unavailable. Reopen the review from its worker.' };
  const guarded = text => {
    const hex = Array.from(Buffer.from(text, 'utf8'), byte => byte.toString(16).padStart(2, '0')).join(' ');
    const command = `send-keys -t ${pane} -H ${hex} ; display-message -p SURFACE_SENT`;
    const condition = `#{&&:#{==:#{pane_pid},${pid}},#{!=:#{synchronize-panes},1}}`;
    return [...(socket ? ['-S', socket] : []), 'if-shell', '-F', '-t', pane, condition,
      command, 'display-message -p SURFACE_BLOCKED'];
  };
  const typed = await send(guarded(line));
  if (typed) return { woke: false, reason: typed.message };
  await wait(SUBMIT_SETTLE_MS);
  const submitted = await send(guarded('\r'));
  if (submitted) return { woke: false, reason: submitted.message };
  return { woke: true };
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Server-side validation repeats the client's rules on purpose. The client can
// be bypassed, and a partial payload written to disk would be posted under the
// Ribhav's name. Refusing here is the last place that can be prevented.
function validate(spec, payload) {
  const problems = [];
  if (!payload || typeof payload !== 'object') return ['the payload was not an object'];
  if (!ACCEPTED.verdicts.includes(payload.verdict)) problems.push('no valid verdict was chosen');
  // An absent or unknown mode is comments. The dangerous option is never the
  // one you get by default, or by sending a malformed payload.
  if (payload.mode && !ACCEPTED.modes.includes(payload.mode)) {
    problems.push(`unknown mode "${payload.mode}"`);
  }

  const design = isDesign(spec);
  if (design && payload.mode !== 'comment') problems.push('design feedback cannot authorize branch changes');
  const findings = Array.isArray(spec.findings) ? spec.findings : [];
  if (payload.findings != null && (typeof payload.findings !== 'object' || Array.isArray(payload.findings))) problems.push('findings must be an object');
  const decided = payload.findings && typeof payload.findings === 'object' && !Array.isArray(payload.findings) ? payload.findings : {};
  const allowed = payload.mode === 'change' ? ACCEPTED.decisions.change : ACCEPTED.decisions.comment;
  const ids = new Set();
  findings.forEach((finding, index) => {
    const id = findingId(finding, index);
    ids.add(id);
    const choice = Object.hasOwn(decided, id) ? decided[id] : null;
    if (!choice || !choice.decision) {
      problems.push(`finding ${id} has no decision`);
      return;
    }
    if (!allowed.includes(choice.decision)) problems.push(`finding ${id} has an invalid decision for this mode`);
    if (typeof choice.comment !== 'string' || choice.comment.length > 65536) problems.push(`finding ${id} has invalid comment text`);
    if (choice.decision !== 'drop' && choice.decision !== 'fix' && !String(choice.comment ?? '').trim()) {
      problems.push(`finding ${id} is set to "${choice.decision}" with an empty comment`);
    }
  });
  for (const question of designQuestions(spec)) {
    ids.add(question.id);
    const choice = Object.hasOwn(decided, question.id) ? decided[question.id] : null;
    const feedback = parseDesignFeedback(choice?.comment);
    if (choice?.decision !== 'summary' || typeof choice?.comment !== 'string' || choice.comment.length > 65536 || !feedback ||
        (feedback.choice !== null && !question.options.some(o => o.id === feedback.choice))) {
      problems.push(`design question ${question.id} needs a valid choice and feedback record`);
    } else if (String(payload.verdict).startsWith('approve') && feedback.choice === null) {
      problems.push(`choose a design for ${question.id} before approving`);
    }
  }
  if (design && payload.nits != null) problems.push('design feedback cannot carry nits');
  if (Object.keys(decided).some(id => !ids.has(id))) problems.push('decisions contain an unknown finding');
  if (payload.nits != null && !ACCEPTED.nits.includes(payload.nits)) problems.push('invalid nits decision');
  if (payload.message != null && (typeof payload.message !== 'string' || payload.message.length > 65536)) problems.push('invalid reviewer message');
  return problems;
}

function summary(entry, review = readReview(entry)) {
  const { spec, round, decided } = review;
  return {
    id: entry.id, title: String(spec.title || entry.id), pr: typeof spec.pr === 'string' ? spec.pr : null,
    project: entry.project ? entry.project.split('/').filter(Boolean).at(-1) : 'Reviews',
    remote: entry.remote === true, round, status: decided ? 'sent' : 'waiting',
    registered_at: entry.registered_at, submitted_at: decided?.submitted_at || null,
    submission_id: decided?.submission_id || null,
  };
}

async function submit(entry, round, payload) {
  // Hash only the decision contract, with a stable finding order. Transport
  // identifiers never change the words approved by the user.
  const content = { mode: payload.mode || 'comment', verdict: payload.verdict,
    findings: Object.fromEntries(Object.entries(payload.findings || {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([id, choice]) => [id, { decision: choice.decision, comment: choice.comment }])),
    nits: payload.nits ?? null, message: payload.message ?? '' };
  const hash = createHash('sha256').update(JSON.stringify({ round, ...content })).digest('hex');
  const previous = readReceipt(entry, payload.submission_id);
  if (previous && previous.hash !== hash) return { code: 409, body: { error: 'This submission id already belongs to different decisions.' } };
  const key = `${entry.id}/${payload.submission_id}`;
  if (submitting.has(key)) return submitting.get(key);
  if (previous && previous.phase !== 'reserved') return { code: 200, body: previous.result };
  const current = readReview(entry);
  if (current.round !== round) return { code: 409, body: { error: 'This review changed before it could be saved. Reload the latest round.' } };
  if (current.decided && current.decided.submission_id !== payload.submission_id)
    return { code: 409, body: { error: 'Decisions were already saved for this round. Reload to see them before continuing.' } };
  if (current.images.length) {
    try {
      assertPageSize({ html: embeddedHtml(current.spec, { id: entry.id, images: current.images, round, decided: { ...content, submitted_at: new Date().toISOString() } }) }, 4096);
    } catch (error) { return { code: 413, body: { error: error.message } }; }
  }
  const operation = (async () => {
    const path = receiptPath(entry, payload.submission_id);
    atomicJson(path, { hash, round, phase: 'reserved' });
    const submitted_at = new Date().toISOString();
      // `_fields` travels with the decisions because the reviewer reads this file
      // long after its brief, often across a compaction, and the two names are
      // close enough to swap: a reviewer once read `mode: comment` as "post a
      // COMMENTED review" and withheld an approval Ribhav had given in
      // `verdict`. The file has to say which is which at the point it is read.
    const record = {
      ...(isDesign(current.spec) ? { review_type: 'design' } : {}),
      _fields: isDesign(current.spec) ? {
        mode: 'Always comment. Design feedback never authorizes code edits, GitHub reviews or merging.',
        verdict: 'Design approval/change/discussion feedback only, not a PR verdict.',
        findings: 'Design question IDs, not code findings. Each summary comment is JSON {choice: option ID or null, comment: exact user feedback}. Resolve option/media references against this round of the spec.',
      } : {
        mode: 'comment = never touch the branch; change = apply approved fixes. Not a review action.',
        verdict: "Ribhav's call on the PR, and the review action to post.",
      },
      ...content, round, submission_id: payload.submission_id, submitted_at,
    };
    const written = writeDecisions(entry, record);
    // Commit a durable receipt before notification. Retrying a send whose
    // acknowledgment was lost must never type into the worker a second time.
    let result = { status: 'saved', submission_id: payload.submission_id, submitted_at,
      woke: false, reason: 'Saved; reviewer notification was not confirmed.' };
    atomicJson(path, { hash, round, phase: 'saved', result });
    const identity = paneIdentity(entry.pane, entry.pane_socket);
    const woke = entry.pane_identity && identity === entry.pane_identity
      ? await wakePane(entry.pane, `Ribhav has decided on this review. Read ${written} and act on it.`, { identity, socket: entry.pane_socket })
      : { woke: false, reason: 'The original reviewer pane is unavailable. Reopen the review from its worker to restore notification.' };
    result = { ...result, ...woke };
    atomicJson(path, { hash, round, phase: 'done', result });
    return { code: 200, body: result };
  })();
  submitting.set(key, operation);
  try { return await operation; } finally { submitting.delete(key); }
}

// A review whose spec has gone from disk is a review that was closed: the
// worktree went with the session that held it. That is a final state, not a
// transient failure, and it must not read like one — Ribhav types decisions
// into a page that can never accept them, and "unreadable" invites a retry.
// Where the durable record went is part of the answer, because the page they are
// looking at is not it.
function closedMessage(id) {
  return (
    `the review "${id}" has been closed — its worktree went with the session that held it, ` +
    'so nothing more can be sent to it. Its findings, verdict and evidence are in the report ' +
    `at ~/.fm2/briefs/${id}/report.md, and anything it already posted is on the pull request.`
  );
}

async function handle(req, res) {
  // The surface is a loopback service, not a network login endpoint. Reject
  // DNS rebinding and cross-site form/fetch submissions at the boundary.
  const host = req.headers.host;
  if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(host)) return json(res, 403, { error: 'invalid review host' });
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'cross-origin review requests are refused' });
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  // `build` is how a caller tells this process apart from the source on disk;
  // `pid` is how it stops exactly this process and no other. Matching on the
  // command line instead does not work: a server started by hand from the repo
  // root has a relative path in its argv and no pattern built from an absolute
  // one will find it, while a pattern loose enough to match would also kill a
  // server a test is running on another port.
  if (path === '/health')
    return json(res, 200, { ok: true, service: 'firstmate-surface', protocol: 1, reviews: listReviews().length, build: BUILD, pid: process.pid });

  if (path === '/api/reviews' && req.method === 'GET') {
    const reviews = [], warnings = [];
    for (const entry of listReviews()) {
      try { reviews.push(summary(entry)); } catch { warnings.push(`Review ${entry.id} could not be read. Reopen it from its worker.`); }
    }
    reviews.sort((a, b) => b.registered_at.localeCompare(a.registered_at));
    return json(res, 200, { protocol: 1, reviews, warnings });
  }

  const bundleMatch = path.match(/^\/api\/([^/]+)\/page$/);
  if (bundleMatch && req.method === 'GET') {
    const entry = lookup(decodeURIComponent(bundleMatch[1]));
    if (!entry) return json(res, 404, { error: 'This review is not registered.' });
    if (!existsSync(entry.spec)) return json(res, 410, { error: closedMessage(entry.id) });
    let review;
    try { review = readReview(entry); }
    catch (error) { return json(res, 422, { error: `This review's media or spec is unavailable: ${error.message}. Ask its owning worker to repair and reopen it.` }); }
    const { spec, images, round, decided } = review;
    const html = embeddedHtml(spec, { id: entry.id, round, decided, images });
    const bundle = { ...summary(entry, review), html,
      receipt: decided?.submission_id ? readReceipt(entry, decided.submission_id)?.result || null : null };
    try { assertPageSize(bundle); } catch (error) { return json(res, 413, { error: error.message }); }
    return json(res, 200, bundle);
  }

  if (path.startsWith('/static/')) {
    const file = join(STATIC, path.slice('/static/'.length));
    if (!file.startsWith(STATIC) || !existsSync(file)) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, MIME[extname(file)] ?? 'application/octet-stream', readFileSync(file));
  }

  if (path === '/') {
    const items = listReviews()
      .map((e) => `<li><a href="/r/${encodeURIComponent(e.id)}">${e.id}</a></li>`)
      .join('');
    return send(res, 200, 'text/html; charset=utf-8',
      `<!doctype html><meta charset="utf-8"><title>Reviews</title>
       <link rel="stylesheet" href="/static/surface.css"><main><h1>Open reviews</h1><ul>${items}</ul></main>`);
  }

  const pageMatch = path.match(/^\/r\/([^/]+)$/);
  if (pageMatch && req.method === 'GET') {
    const id = decodeURIComponent(pageMatch[1]);
    const entry = lookup(id);
    if (!entry) return send(res, 404, 'text/plain', `no review registered as "${id}"`);
    if (!existsSync(entry.spec)) return send(res, 410, 'text/plain', closedMessage(id));
    let review;
    try {
      review = readReview(entry);
    } catch (err) {
      // A malformed spec is the review's bug, and saying so beats a blank page.
      return send(res, 500, 'text/plain', `the review spec for "${id}" is not valid JSON: ${err.message}`);
    }
    return send(res, 200, 'text/html; charset=utf-8', renderPage(review.spec, { id, round: review.round, decided: review.decided, images: review.images }));
  }

  const apiMatch = path.match(/^\/api\/([^/]+)\/decisions$/);
  if (apiMatch && req.method === 'POST') {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Review submissions require JSON.' });
    const id = decodeURIComponent(apiMatch[1]);
    const entry = lookup(id);
    if (!entry) return json(res, 404, { error: `no review registered as "${id}"` });

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, 400, { error: `could not read the decisions: ${err.message}` });
    }

    // Checked before the spec is read, because a closed review and a corrupt one
    // need opposite responses: one is final and the other is worth retrying, and
    // an ENOENT surfaced as "unreadable" reads as the second.
    if (!existsSync(entry.spec)) return json(res, 410, { error: closedMessage(id) });

    let review;
    try {
      review = readReview(entry);
    } catch (err) {
      return json(res, 500, { error: `the review spec is unreadable: ${err.message}` });
    }

    if (payload?.round !== review.round) return json(res, 409, { error: 'This review has changed. Reload the latest round before sending.' });
    if (!isSubmissionId(payload?.submission_id || '')) return json(res, 422, { error: 'A unique submission id is required.' });
    const problems = validate(review.spec, payload);
    if (problems.length) return json(res, 422, { error: problems.join('; '), problems });

    const response = await submit(entry, review.round, payload);
    return json(res, response.code, response.body);
  }

  send(res, 404, 'text/plain', 'not found');
}

const server = createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) json(res, 500, { error: 'The review could not be read or saved. Reopen it from its worker and try again.' });
    else res.destroy();
  });
});

// Listen only when run as a script. Importing this file - which the tests do, to
// exercise validate() directly - must not start a server, or a second one races
// the real one for the port.
const runAsScript =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runAsScript) {
  server.listen(PORT, HOST, () => {
    process.stdout.write(`surface listening on http://${HOST}:${PORT}\n`);
  });
}

export { server, validate, wakePane };
