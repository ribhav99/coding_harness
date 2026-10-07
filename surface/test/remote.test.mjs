import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { parseRemote, remoteReviews, setRemoteReviews } from '../../fm2/lib/remote.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const wait = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

test('project remote choices are explicit, persistent, and preserve other settings', t => {
  const project = mkdtempSync(join(tmpdir(), 'surface-project-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  for (const value of ['no', 'FALSE', 'off', '0', '', undefined]) assert.equal(parseRemote(value), false);
  for (const value of ['yes', 'TRUE', 'on', '1', true]) assert.equal(parseRemote(value), true);
  assert.throws(() => parseRemote('maybe'), /must be/);
  writeFileSync(join(project, '.fm2.json'), JSON.stringify({ tracker: 'github-issues' }));
  assert.equal(remoteReviews(project, { FM_REMOTE: 'yes' }), true);
  setRemoteReviews(project, 'yes');
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.fm2.json'))), { tracker: 'github-issues', remote: true });
  assert.equal(remoteReviews(project, { FM_REMOTE: 'no' }), true);
  execFileSync(process.execPath, [join(ROOT, 'fm2/cli.mjs'), 'remote', 'no', '--project', project]);
  assert.equal(remoteReviews(project, { FM_REMOTE: 'yes' }), false);
});

test('phone reviews preserve local delivery, route across projects, reject stale rounds, and wake once', async t => {
  const root = mkdtempSync(join(tmpdir(), 'surface-phone-'));
  const socket = join(root, 'tmux.sock');
  const otherSocket = join(root, 'other.sock');
  const seen = join(root, 'seen');
  const fake = join(root, 'worker.mjs');
  writeFileSync(fake, `import { appendFileSync } from 'node:fs';
    import { createInterface } from 'node:readline';
    for await (const line of createInterface({ input: process.stdin })) appendFileSync(${JSON.stringify(seen)}, line + '\\n');`);
  const tmux = args => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' }).trim();
  const pane = tmux(['-f', '/dev/null', 'new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fixture', `exec ${quote(process.execPath)} ${quote(fake)}`]);
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'open'), `#!/bin/sh\necho opened >> ${quote(join(root, 'opened'))}\n`);
  chmodSync(join(bin, 'open'), 0o700);
  const env = { ...process.env, SURFACE_HOME: join(root, 'registry'), SURFACE_PORT: String(port),
    FM2_TASK: '', FM_PROJECT: '', FM_REMOTE: 'no', SURFACE_PANE: '', TMUX_PANE: '',
    TMUX: `${socket},1,0`, PATH: `${bin}:${process.env.PATH}` };
  let server;
  t.after(() => {
    server?.kill(); try { tmux(['kill-server']); } catch {}
    try { execFileSync('tmux', ['-S', otherSocket, 'kill-server'], { stdio: 'ignore' }); } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const start = async () => {
    server = spawn(process.execPath, [join(ROOT, 'surface/server.mjs')], { env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
      await wait(50);
    }
    throw new Error('fixture server did not start');
  };
  await start();
  const spec = { id: 'pr-1', title: 'Phone review', own_pr: true, recommendation: { value: 'approve' },
    findings: [{ id: 'f1', title: 'A decision', comment: 'Draft' }] };
  const projectA = join(root, 'project-a'), projectB = join(root, 'project-b');
  for (const project of [projectA, projectB]) mkdirSync(project);
  const pathA = join(projectA, 'review.json'), pathB = join(projectB, 'review.json');
  writeFileSync(pathA, JSON.stringify(spec)); writeFileSync(pathB, JSON.stringify(spec));
  const open = (path, project, extra = {}) => execFileSync(process.execPath, [join(ROOT, 'surface/cli.mjs'), 'open', path],
    { env: { ...env, FM_PROJECT: project, ...extra }, encoding: 'utf8' });
  open(pathB, projectB);
  assert.equal(readFileSync(join(root, 'opened'), 'utf8').split('\n').filter(Boolean).length, 1);
  setRemoteReviews(projectA, 'yes');
  const output = open(pathA, projectA, { SURFACE_PANE: pane });
  assert.match(output, /Available in TabTail/);
  assert.equal(readFileSync(join(root, 'opened'), 'utf8').split('\n').filter(Boolean).length, 1, 'remote delivery opened the Mac browser');
  const inbox = await (await fetch(`${base}/api/reviews`)).json();
  assert.equal(inbox.reviews.length, 2);
  assert.equal(new Set(inbox.reviews.map(r => r.id)).size, 2, 'same PR number stole another project review');
  const review = inbox.reviews.find(r => r.project === 'project-a');
  const page = await (await fetch(`${base}/api/${review.id}/page`)).json();
  assert.match(page.html, /surfaceNativeReceive/);
  assert.match(page.html, /connect-src 'none'/);
  assert.doesNotMatch(page.html, /src="\/static\//);
  const payload = { round: page.round, submission_id: 'phone-send-0001', mode: 'change', verdict: 'approve',
    findings: { f1: { decision: 'fix', comment: 'My exact words 🐈' } }, nits: null, message: 'Approved by phone' };
  const post = (body, headers = {}) => fetch(`${base}/api/${review.id}/decisions`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post({ ...payload, mode: 'comment' })).status, 422, 'comment mode allowed a fix');
  assert.equal((await post(payload, { origin: 'https://evil.example' })).status, 403);
  const receipts = await Promise.all([post(payload), post(payload)]);
  for (const response of receipts) {
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.equal(receipt.status, 'saved'); assert.equal(receipt.woke, true);
  }
  await wait(200);
  assert.equal(readFileSync(seen, 'utf8').split('\n').filter(Boolean).length, 1, 'duplicate request woke the worker twice');
  const decision = JSON.parse(readFileSync(join(projectA, 'decisions.json')));
  assert.equal(decision.verdict, 'approve'); assert.equal(decision.mode, 'change');
  assert.equal(decision.findings.f1.comment, 'My exact words 🐈');
  assert.equal((await post({ ...payload, message: 'different decision' })).status, 409);
  assert.equal((await post({ ...payload, submission_id: 'desktop-send-0002', message: 'Desktop conflict' })).status, 409);
  assert.equal(JSON.parse(readFileSync(join(projectA, 'decisions.json'))).message, payload.message);
  // The singleton service must use the recorded socket, not whichever tmux
  // server happened to launch it. Both private servers reuse the name %0.
  const otherSeen = join(root, 'other-seen'), otherFake = join(root, 'other-worker.mjs');
  writeFileSync(otherFake, readFileSync(fake, 'utf8').replace(JSON.stringify(seen), JSON.stringify(otherSeen)));
  const otherPane = execFileSync('tmux', ['-S', otherSocket, '-f', '/dev/null', 'new-session', '-d', '-P', '-F', '#{pane_id}',
    '-s', 'other-fixture', `exec ${quote(process.execPath)} ${quote(otherFake)}`], { encoding: 'utf8' }).trim();
  open(pathB, projectB, { SURFACE_PANE: otherPane, TMUX: `${otherSocket},1,0`, FM_REMOTE: 'yes' });
  const otherReview = (await (await fetch(`${base}/api/reviews`)).json()).reviews.find(item => item.project === 'project-b');
  const otherReceipt = await (await fetch(`${base}/api/${otherReview.id}/decisions`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, round: otherReview.round, submission_id: 'other-mac-0005' }),
  })).json();
  assert.equal(otherReceipt.woke, true);
  await wait(100);
  assert.equal(readFileSync(otherSeen, 'utf8').split('\n').filter(Boolean).length, 1);
  assert.equal(readFileSync(seen, 'utf8').split('\n').filter(Boolean).length, 1, 'notification reached the wrong tmux socket');
  server.kill(); await once(server, 'exit'); await start();
  assert.equal((await (await post(payload)).json()).woke, true, 'receipt did not survive server restart');
  assert.equal(readFileSync(seen, 'utf8').split('\n').filter(Boolean).length, 1);
  writeFileSync(pathA, JSON.stringify({ ...spec, title: 'New round' }));
  assert.equal((await post(payload)).status, 409, 'old phone page decided a new round');
  const newer = await (await fetch(`${base}/api/${review.id}/page`)).json();
  assert.notEqual(newer.round, page.round); assert.equal(newer.status, 'waiting');
  // Notification must never broadcast a review into synchronized panes.
  tmux(['split-window', '-d', '-t', pane, `exec ${quote(process.execPath)} ${quote(fake)}`]);
  tmux(['set-window-option', '-t', pane, 'synchronize-panes', 'on']);
  const blocked = await (await post({ ...payload, round: newer.round, submission_id: 'sync-send-0003' })).json();
  assert.equal(blocked.status, 'saved'); assert.equal(blocked.woke, false);
  assert.match(blocked.reason, /synchronized/);
  await wait(200);
  assert.equal(readFileSync(seen, 'utf8').split('\n').filter(Boolean).length, 1, 'notification broadcast into synchronized panes');
  tmux(['set-window-option', '-t', pane, 'synchronize-panes', 'off']);
  writeFileSync(pathA, JSON.stringify({ ...spec, title: 'Worker restarted' }));
  const restarted = await (await fetch(`${base}/api/${review.id}/page`)).json();
  tmux(['respawn-pane', '-k', '-t', pane, `exec ${quote(process.execPath)} ${quote(fake)}`]);
  const retired = await (await post({ ...payload, round: restarted.round, submission_id: 'restart-send-0004' })).json();
  assert.equal(retired.woke, false); assert.match(retired.reason, /original reviewer/);
  assert.equal(readFileSync(seen, 'utf8').split('\n').filter(Boolean).length, 1);
  rmSync(pathA);
  assert.equal((await post({ ...payload, round: restarted.round })).status, 410);
});

test('finding IDs use one normalization and duplicates are refused before rendering', async t => {
  const root = mkdtempSync(join(tmpdir(), 'surface-finding-ids-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const prior = process.env.SURFACE_HOME;
  process.env.SURFACE_HOME = join(root, 'registry');
  const store = await import(`../lib/store.mjs?ids=${root}`);
  if (prior === undefined) delete process.env.SURFACE_HOME; else process.env.SURFACE_HOME = prior;
  const { validate } = await import('../server.mjs');
  const path = join(root, 'review.json');
  const spec = { findings: [{ id: ' f1 ', comment: 'Text' }, { id: '', comment: 'Other' }] };
  writeFileSync(path, JSON.stringify(spec));
  assert.ok(store.register(path));
  assert.deepEqual(validate(spec, { verdict: 'approve', mode: 'comment', findings: {
    f1: { decision: 'inline', comment: 'Text' }, f2: { decision: 'drop', comment: '' },
  } }), []);
  writeFileSync(path, JSON.stringify({ findings: [{ id: 'f1' }, { id: ' f1 ' }] }));
  assert.throws(() => store.register(path), /duplicate finding id/);
});
