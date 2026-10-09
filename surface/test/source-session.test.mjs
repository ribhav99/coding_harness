import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { sourceSession } from '../lib/source-session.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const recorded = { pane: '%1', pane_socket: '/isolated/fixture.sock',
  pane_identity: '123:Fri Oct  9 10:00:00 2026', registered_at: '2026-10-10T12:00:00Z' };

test('identity requires complete recorded ownership and distinguishes socket/pane/process lifetime', () => {
  const identity = sourceSession(recorded);
  assert.match(identity, /^surface-pane-v1:[a-f0-9]{64}$/);
  assert.equal(identity, sourceSession({ ...recorded, id: 'different', project: 'different' }));
  for (const change of [{ pane: '%2' }, { pane_socket: '/other/fixture.sock' },
    { pane_identity: '124:Fri Oct  9 10:00:00 2026' }, { pane_identity: '123:Fri Oct  9 11:00:00 2026' }])
    assert.notEqual(identity, sourceSession({ ...recorded, ...change }));
  for (const key of ['pane', 'pane_socket', 'pane_identity', 'registered_at'])
    assert.equal(sourceSession({ ...recorded, [key]: null }), undefined);
  for (const change of [{ pane: 'worker' }, { pane: '%1\n' }, { pane_socket: 'relative.sock' },
    { pane_identity: recorded.pane_identity + '\n' },
    { pane_identity: '123:invalid' }, { pane_identity: '123:Fri Feb 30 10:00:00 2026' },
    { pane_identity: '123:Thu Oct  9 10:00:00 2026' }, { pane_identity: '0:Fri Oct  9 10:00:00 2026' },
    { registered_at: 'invalid' }, { registered_at: '2020-01-01T00:00:00Z' }])
    assert.equal(sourceSession({ ...recorded, ...change }), undefined);
});

test('isolated HTTP summaries retain historical ownership across pane reuse without mutating artifacts', async t => {
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'surface-session-'));
  const home = join(root, 'registry'), socket = join(root, 'tmux.sock');
  mkdirSync(home);
  const env = { ...process.env, SURFACE_HOME: home, TMUX: `${socket},1,0`,
    FM2_TASK: '', FM_PROJECT: '', SURFACE_PANE: '', TMUX_PANE: '' };
  const tmux = args => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' }).trim();
  let server;
  t.after(() => {
    server?.kill();
    try { tmux(['kill-server']); } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  const paneA = tmux(['-f', '/dev/null', 'new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'session-a', 'sleep 300']);
  const paneB = tmux(['new-window', '-d', '-P', '-F', '#{pane_id}', '-t', 'session-a', 'sleep 300']);
  const register = (id, pane) => {
    const dir = join(root, id); mkdirSync(dir);
    const path = join(dir, 'review.json');
    writeFileSync(path, JSON.stringify({ id, title: 'Same title', findings: [] }));
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { register } from './surface/lib/store.mjs'; console.log(JSON.stringify(register(process.argv[1], {pane: process.argv[2], project: '/fixture/same-project'})));`, path, pane],
    { cwd: ROOT, env, encoding: 'utf8' }));
  };
  const a = register('session-a', paneA), b = register('session-b', paneB);
  assert.notEqual(sourceSession(a), sourceSession(b));
  assert.ok(sourceSession(a));
  // Model existing historical registrations without weakening register's claim
  // guard. This fixture alone copies recorded ownership into a second record.
  const historical = { ...a, id: 'historical', spec: join(root, 'historical.json') };
  writeFileSync(historical.spec, JSON.stringify({ title: 'Same title', findings: [] }));
  const legacy = { ...historical, id: 'legacy', pane_identity: null };
  writeFileSync(join(home, 'reviews.json'), JSON.stringify({ [a.id]: a, [b.id]: b, historical, legacy }));
  const registry = readFileSync(join(home, 'reviews.json'));
  const artifacts = new Map([a, b, historical].map(entry => [entry.spec, readFileSync(entry.spec)]));
  // A pane id now runs a different process. Reading old registrations must not
  // resolve that current process or relabel any historical review.
  tmux(['respawn-pane', '-k', '-t', paneA, 'sleep 300']);
  const listener = createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(done => listener.close(done));
  server = spawn(process.execPath, ['surface/server.mjs'], { cwd: ROOT,
    env: { ...env, SURFACE_PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise(done => setTimeout(done, 20));
  }
  const list = await (await fetch(`${base}/api/reviews`)).json();
  assert.equal(list.reviews.length, 4, 'server must not deduplicate');
  const byId = Object.fromEntries(list.reviews.map(review => [review.id, review]));
  assert.equal(byId[a.id].source_session, sourceSession(a));
  assert.equal(byId.historical.source_session, sourceSession(a));
  assert.notEqual(byId[b.id].source_session, sourceSession(a));
  assert.equal('source_session' in byId.legacy, false);
  for (const review of list.reviews) {
    const page = await (await fetch(`${base}/api/${review.id}/page`)).json();
    assert.equal(page.source_session, review.source_session);
    assert.equal('pane_socket' in page, false);
    assert.equal('pane_identity' in page, false);
    assert.equal('pane' in page, false);
    assert.equal('spec' in page, false);
  }
  assert.deepEqual(readFileSync(join(home, 'reviews.json')), registry);
  for (const [path, bytes] of artifacts) assert.deepEqual(readFileSync(path), bytes);
  const currentIdentity = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { paneIdentity } from './surface/lib/store.mjs'; console.log(paneIdentity(process.argv[1], process.argv[2]));`, paneA, socket],
  { cwd: ROOT, env, encoding: 'utf8' }).trim();
  assert.notEqual(sourceSession({ ...a, pane_identity: currentIdentity }), sourceSession(a));
});
