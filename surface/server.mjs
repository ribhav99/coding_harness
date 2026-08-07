// The review server. One process, many pages, no held connections.
//
// The architecture is one decision: nothing waits. The tool this replaces had
// the reviewing agent block in a foreground long-poll until the captain acted.
// That connection died on its own roughly every half hour, and each death fed an
// idle session an input it did not need, which produced a turn, which woke the
// supervisor. Hundreds of wakes, none of them work.
//
// Here a review writes its page, opens it, and stops. When the captain sends,
// this server writes decisions.json and pushes one line into that review's tmux
// pane. The reviewer wakes exactly once per thing the captain sends, and never
// otherwise.
//
// No dependencies. node:http is enough, and a surface with no install step is a
// surface a second machine reproduces by cloning.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { renderPage } from './lib/render.mjs';
import {
  register,
  lookup,
  readSpec,
  readDecisions,
  writeDecisions,
  decisionsPath,
  listReviews,
} from './lib/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, 'static');
const PORT = Number(process.env.SURFACE_PORT || 4390);
const HOST = '127.0.0.1';

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
// exactly what the captain would do by hand.
function wakePane(pane, line) {
  return new Promise((resolve) => {
    if (!pane) return resolve({ woke: false, reason: 'no pane recorded for this review' });
    execFile('tmux', ['send-keys', '-t', pane, '-l', line], (err) => {
      if (err) return resolve({ woke: false, reason: err.message });
      execFile('tmux', ['send-keys', '-t', pane, 'Enter'], (err2) => {
        if (err2) return resolve({ woke: false, reason: err2.message });
        resolve({ woke: true });
      });
    });
  });
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
// captain's name. Refusing here is the last place that can be prevented.
function validate(spec, payload) {
  const problems = [];
  if (!payload || typeof payload !== 'object') return ['the payload was not an object'];
  if (!payload.verdict) problems.push('no verdict was chosen');
  // An absent or unknown mode is comments. The dangerous option is never the
  // one you get by default, or by sending a malformed payload.
  if (payload.mode && payload.mode !== 'comment' && payload.mode !== 'change') {
    problems.push(`unknown mode "${payload.mode}"`);
  }

  const findings = Array.isArray(spec.findings) ? spec.findings : [];
  const decided = payload.findings && typeof payload.findings === 'object' ? payload.findings : {};
  findings.forEach((finding, index) => {
    const id = String(finding.id ?? `f${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '-');
    const choice = decided[id];
    if (!choice || !choice.decision) {
      problems.push(`finding ${id} has no decision`);
      return;
    }
    if (choice.decision !== 'drop' && choice.decision !== 'fix' && !String(choice.comment ?? '').trim()) {
      problems.push(`finding ${id} is set to "${choice.decision}" with an empty comment`);
    }
  });
  return problems;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (path === '/health') return json(res, 200, { ok: true, reviews: listReviews().length });

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
    if (!existsSync(entry.spec)) return send(res, 410, 'text/plain', `the review "${id}" no longer exists on disk`);
    let spec;
    try {
      spec = readSpec(entry);
    } catch (err) {
      // A malformed spec is the review's bug, and saying so beats a blank page.
      return send(res, 500, 'text/plain', `the review spec for "${id}" is not valid JSON: ${err.message}`);
    }
    return send(res, 200, 'text/html; charset=utf-8', renderPage(spec, { id, decided: readDecisions(entry) }));
  }

  const apiMatch = path.match(/^\/api\/([^/]+)\/decisions$/);
  if (apiMatch && req.method === 'POST') {
    const id = decodeURIComponent(apiMatch[1]);
    const entry = lookup(id);
    if (!entry) return json(res, 404, { error: `no review registered as "${id}"` });

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, 400, { error: `could not read the decisions: ${err.message}` });
    }

    let spec;
    try {
      spec = readSpec(entry);
    } catch (err) {
      return json(res, 500, { error: `the review spec is unreadable: ${err.message}` });
    }

    const problems = validate(spec, payload);
    if (problems.length) return json(res, 422, { error: problems.join('; '), problems });

    // `_fields` travels with the decisions because the reviewer reads this file
    // long after its brief, often across a compaction, and the two names are
    // close enough to swap: a reviewer once read `mode: comment` as "post a
    // COMMENTED review" and withheld an approval the captain had given in
    // `verdict`. The file has to say which is which at the point it is read.
    const record = {
      _fields: {
        mode: 'comment = never touch the branch; change = apply approved fixes. Not a review action.',
        verdict: 'the captain\'s call on the PR, and the review action to post.',
      },
      mode: 'comment',
      ...payload,
      submitted_at: new Date().toISOString(),
    };
    const written = writeDecisions(entry, record);

    // Decisions are on disk before the reviewer is woken. If the wake fails the
    // work is not lost - the reviewer reads the file when it next runs - so the
    // response reports the wake separately rather than failing the whole send.
    const woke = await wakePane(
      entry.pane,
      `The captain has decided on this review. Read ${written} and act on it.`,
    );
    return json(res, 200, { status: 'saved', decisions: written, ...woke });
  }

  send(res, 404, 'text/plain', 'not found');
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
