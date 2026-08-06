// The surface's contract, tested through what it produces and serves.
//
// The first three tests exist because each one is a bug that shipped and posted
// something the captain did not choose. They assert on the generated page rather
// than on the generator's source, because the page is what the browser gets.
//
// Run: node --test surface/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

const SPEC = {
  id: 'pr-1',
  title: 'PR #1 review',
  recommendation: { value: 'request-changes', why: 'one thing' },
  findings: [
    { id: 'f1', title: 'first', severity: 'medium', blocks_merge: true, comment: 'draft one', default: 'inline' },
    { id: 'f2', title: 'second', severity: 'low', comment: 'draft two', default: 'summary' },
  ],
  nits: ['a nit'],
};

const { renderPage } = await import(join(ROOT, 'lib/render.mjs'));

test('every control that carries a decision has a name', () => {
  const html = renderPage(SPEC, { id: 'pr-1' });
  const controls = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];
  assert.ok(controls.length > 0, 'the page rendered no controls at all');
  const unnamed = controls.filter((c) => !/\bname="/.test(c));
  assert.deepEqual(unnamed, [], 'a control without a name is invisible to FormData');
});

test('comment drafts are textareas, and never inside a collapsed container', () => {
  const html = renderPage(SPEC, { id: 'pr-1' });
  for (const id of ['f1', 'f2']) {
    assert.match(html, new RegExp(`<textarea[^>]*name="${id}-comment"`), `${id} draft is not a textarea`);
  }
  assert.ok(!/<details/.test(html), 'a draft inside <details> reads back empty when collapsed');
});

test('the client never reads rendered text out of the DOM', () => {
  const client = readFileSync(join(ROOT, 'static/surface.js'), 'utf8');
  // A property read, not the word: the file explains the rule in prose and that
  // explanation must not trip its own check.
  assert.ok(!/\.innerText\b/.test(client), 'the client reads .innerText, which returns "" when not rendered');
  assert.ok(/new FormData\(/.test(client), 'the client does not collect through FormData');
});

test('the same review renders identically every time - there is no per-load token', () => {
  const a = renderPage(SPEC, { id: 'pr-1' });
  const b = renderPage(SPEC, { id: 'pr-1' });
  assert.equal(a, b, 'two renders differ, so something negotiated is embedded in the page');
  assert.ok(!/token/i.test(a), 'the page carries a token, which is what made stale tabs blank');
});

test('content is escaped, so a finding cannot inject markup', () => {
  const html = renderPage(
    { id: 'x', title: '<script>bad()</script>', findings: [{ id: 'f1', title: 'a & b', comment: '"quoted"' }] },
    { id: 'x' },
  );
  assert.ok(!/<script>bad\(\)<\/script>/.test(html), 'a title was rendered as live markup');
  assert.match(html, /a &amp; b/);
});

// --- the server refuses what it must ----------------------------------------

const { validate } = await import(join(ROOT, 'server.mjs'));

test('a payload with no verdict is refused', () => {
  const problems = validate(SPEC, { findings: { f1: { decision: 'drop' }, f2: { decision: 'drop' } } });
  assert.ok(problems.some((p) => /verdict/.test(p)), problems.join('; '));
});

test('a finding with no decision is refused', () => {
  const problems = validate(SPEC, { verdict: 'approve', findings: { f1: { decision: 'drop' } } });
  assert.ok(problems.some((p) => /f2 has no decision/.test(p)), problems.join('; '));
});

test('a finding raised with an empty comment is refused', () => {
  const problems = validate(SPEC, {
    verdict: 'request-changes',
    findings: { f1: { decision: 'inline', comment: '   ' }, f2: { decision: 'drop' } },
  });
  assert.ok(problems.some((p) => /f1 .*empty comment/.test(p)), problems.join('; '));
});

test('a dropped finding needs no comment', () => {
  const problems = validate(SPEC, {
    verdict: 'approve',
    findings: { f1: { decision: 'drop', comment: '' }, f2: { decision: 'drop', comment: '' } },
  });
  assert.deepEqual(problems, []);
});

// --- end to end over HTTP ----------------------------------------------------

test('a valid send writes the decisions; an invalid one writes nothing', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'surface-home-'));
  const work = mkdtempSync(join(tmpdir(), 'surface-work-'));
  mkdirSync(join(work, 'pr-1'), { recursive: true });
  const specPath = join(work, 'pr-1', 'review.json');
  writeFileSync(specPath, JSON.stringify(SPEC));

  const port = 4402;
  process.env.SURFACE_HOME = home;
  process.env.SURFACE_PORT = String(port);

  const { register } = await import(`${join(ROOT, 'lib/store.mjs')}?home=${encodeURIComponent(home)}`);
  register(specPath, { pane: null });

  const { spawn } = await import('node:child_process');
  const server = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    env: { ...process.env, SURFACE_HOME: home, SURFACE_PORT: String(port) },
    stdio: 'ignore',
  });
  t.after(() => server.kill('SIGKILL'));

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  const decisionsFile = join(work, 'pr-1', 'decisions.json');

  const bad = await fetch(`${base}/api/pr-1/decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verdict: 'approve', findings: { f1: { decision: 'inline', comment: '' } } }),
  });
  assert.equal(bad.status, 422, 'a partial payload was accepted');
  assert.ok(!existsSync(decisionsFile), 'a refused send still wrote decisions to disk');

  const good = await fetch(`${base}/api/pr-1/decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      verdict: 'request-changes',
      findings: { f1: { decision: 'inline', comment: 'say this' }, f2: { decision: 'drop', comment: '' } },
      nits: 'batched',
      message: '',
    }),
  });
  assert.equal(good.status, 200);
  const body = await good.json();
  assert.equal(body.status, 'saved');
  // No pane was recorded, so the wake must be reported as not done rather than
  // claimed - the captain is told when the reviewer was not reached.
  assert.equal(body.woke, false);
  assert.ok(existsSync(decisionsFile), 'an accepted send did not write decisions');

  const written = JSON.parse(readFileSync(decisionsFile, 'utf8'));
  assert.equal(written.findings.f1.comment, 'say this');
  assert.ok(written.submitted_at, 'the record carries no timestamp');
});

// The wake types into a tmux pane, so a wrong binding types into someone else's
// session. This happened for real while building: a register run from the
// supervisor's own session rebound the review, and the next send landed in the
// captain's chat instead of the reviewer's pane.
test('a pane already claimed by another review is refused, not stolen', async () => {
  const home = mkdtempSync(join(tmpdir(), 'surface-home-'));
  const work = mkdtempSync(join(tmpdir(), 'surface-work-'));
  const specs = {};
  for (const id of ['pr-a', 'pr-b']) {
    mkdirSync(join(work, id), { recursive: true });
    specs[id] = join(work, id, 'review.json');
    writeFileSync(specs[id], JSON.stringify({ ...SPEC, id }));
  }
  const { register } = await import(`${join(ROOT, 'lib/store.mjs')}?claim=${encodeURIComponent(home)}`);
  process.env.SURFACE_HOME = home;

  register(specs['pr-a'], { pane: '%7' });
  assert.throws(
    () => register(specs['pr-b'], { pane: '%7' }),
    /already belongs to review "pr-a"/,
    'a second review silently took over another review\'s pane',
  );

  // Moving a review to a new pane is legitimate - it gets respawned - but must
  // be reported rather than done silently.
  const moved = register(specs['pr-a'], { pane: '%9' });
  assert.equal(moved.pane, '%9');
  assert.equal(moved.rebound_from, '%7', 'a rebind was not reported to the caller');
});

test('a page for an unknown review says so instead of rendering blank', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'surface-home-'));
  const port = 4403;
  const { spawn } = await import('node:child_process');
  const server = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    env: { ...process.env, SURFACE_HOME: home, SURFACE_PORT: String(port) },
    stdio: 'ignore',
  });
  t.after(() => server.kill('SIGKILL'));

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const res = await fetch(`${base}/r/nope`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /no review registered/);
});
