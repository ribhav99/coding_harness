import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, symlinkSync, mkdirSync, statSync, utimesSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validate } from '../server.mjs';
import { renderPage } from '../lib/render.mjs';
import { embeddedHtml, assertPageSize } from '../lib/page.mjs';
import { validateDesign } from '../lib/design.mjs';

const example = resolve(import.meta.dirname, '../examples/design-review');
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'surface-media-'));
  cpSync(example, root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previous = process.env.SURFACE_HOME;
  process.env.SURFACE_HOME = join(root, 'registry');
  const store = await import(`../lib/store.mjs?home=${root}`);
  if (previous === undefined) delete process.env.SURFACE_HOME; else process.env.SURFACE_HOME = previous;
  const path = join(root, 'review.json');
  const spec = JSON.parse(readFileSync(path));
  return { root, path, spec, store, save: value => writeFileSync(path, JSON.stringify(value)) };
}

test('full-resolution multiple-image review is bundled privately within the released adapter limit', async t => {
  const { path, spec, store } = await fixture(t);
  const entry = store.register(path, { remote: true });
  const review = store.readReview(entry);
  assert.equal(review.images.length, 3);
  for (const image of review.images) {
    assert.equal(image.width, 1170); assert.equal(image.height, 2532);
    assert.match(image.src, /^data:image\/jpeg;base64,/);
  }
  const html = embeddedHtml(spec, { ...review, id: entry.id });
  assertPageSize({ html }, 4096);
  assert.match(html, /img-src data:/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<img[^>]+src="(?:https?:|file:|\/)/);
  assert.equal((html.match(/data:image\/jpeg;base64/g) || []).length, 3, 'enlargement duplicated the raster bundle');
  assert.match(html, /Design choices/); assert.doesNotMatch(html, /What may this review do to the branch/);
  assert.match(html, /value="needs-discussion" checked/);
  assert.match(renderPage({ title: 'Existing review', findings: [] }), /What may this review do to the branch/);
});

test('source replacement/deletion cannot change a reviewed round; explicit reattachment invalidates old decisions', async t => {
  const { root, path, spec, store } = await fixture(t);
  const entry = store.register(path);
  const first = store.readReview(entry);
  store.writeDecisions(entry, { round: first.round, verdict: 'needs-discussion', mode: 'comment' });
  cpSync(join(root, 'images/bold.jpg'), join(root, 'images/calm.jpg'));
  assert.equal(store.readReview(entry).round, first.round);
  assert.equal(store.readReview(entry).images[1].src, first.images[1].src);
  const reopened = store.register(path);
  const next = store.readReview(reopened);
  assert.equal(store.readReview(entry).round, next.round, 'cached entry kept an old generation alive');
  assert.notEqual(next.round, first.round);
  assert.equal(next.decided, null);
  assert.ok(store.archiveStaleDecisions(reopened));
  rmSync(join(root, 'images'), { recursive: true });
  assert.equal(store.readReview(reopened).round, next.round, 'review still depends on source screenshots');
  assert.equal(store.readReview(reopened).images.length, 3);
  const snapshot = join(root, '.surface-media', reopened.media.assets[1].file);
  writeFileSync(snapshot, 'altered');
  assert.throws(() => store.readReview(reopened), /Review media/);
  assert.equal(spec.design_questions[0].options[0].media[1], 'calm');
});

test('attachment descriptor changes require registration, even if spec timestamp is restored', async t => {
  const { path, spec, store, save } = await fixture(t);
  const entry = store.register(path), stamp = statSync(path);
  const firstRound = store.readReview(entry).round;
  save({ ...spec, media: spec.media.map(m => ({ ...m, caption: 'Changed caption' })) });
  utimesSync(path, stamp.atime, stamp.mtime);
  assert.throws(() => store.readReview(entry), /attachments changed/);
  assert.notEqual(store.readReview(store.register(path)).round, firstRound);
});

test('paths, symlinks, formats, counts, corrupt headers, dimensions and bytes fail loudly', async t => {
  const { root, path, spec, store, save } = await fixture(t);
  const attach = (media = spec.media) => save({ ...spec, media });
  const one = patch => [{ ...spec.media[0], ...patch }];
  // Avoid option-reference validation masking the path/format boundary.
  const openMedia = media => { save({ title: 'Illustration', media }); return store.register(path); };
  for (const bad of ['../secret.jpg', '/tmp/secret.jpg', 'https://example.com/a.jpg', 'images/../images/before.jpg', 'images\\before.jpg'])
    assert.throws(() => openMedia(one({ path: bad })), /relative path|ENOENT/);
  symlinkSync(join(root, 'images/before.jpg'), join(root, 'linked.jpg'));
  symlinkSync(join(root, 'images'), join(root, 'linked-dir'));
  for (const bad of ['linked.jpg', 'linked-dir/before.jpg']) assert.throws(() => openMedia(one({ path: bad })), /symlink/);
  writeFileSync(join(root, 'images/evil.svg'), '<svg onload="alert(1)"/>');
  assert.throws(() => openMedia(one({ path: 'images/evil.svg' })), /png.*jpg/);
  writeFileSync(join(root, 'images/evil.jpg'), '<html>not an image but long enough</html>');
  assert.throws(() => openMedia(one({ path: 'images/evil.jpg' })), /only static/);
  writeFileSync(join(root, 'images/huge.jpg'), Buffer.alloc(640 * 1024 + 1));
  assert.throws(() => openMedia(one({ path: 'images/huge.jpg' })), /640 KiB/);
  assert.throws(() => openMedia(Array.from({ length: 9 }, (_, i) => ({ ...spec.media[0], id: 'i' + i }))), /at most 8/);
  assert.throws(() => openMedia(Array.from({ length: 5 }, (_, i) => ({ ...spec.media[0], id: 'i' + i }))), /combined images/);
  assert.throws(() => openMedia([spec.media[0], spec.media[0]]), /unique/);
  assert.throws(() => openMedia(one({ alt: '' })), /needs alt/);
  mkdirSync(join(root, 'folder.jpg'));
  assert.throws(() => openMedia(one({ path: 'folder.jpg' })), /regular file/);
  const png = Buffer.alloc(45); Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.writeUInt32BE(13,8); png.write('IHDR',12); png.writeUInt32BE(8193,16); png.writeUInt32BE(1,20);
  Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]).copy(png,33);
  writeFileSync(join(root,'images/bounds.png'),png);
  assert.throws(() => openMedia(one({ path: 'images/bounds.png' })), /dimensions/);
  attach(); assert.ok(store.register(path));
});

test('design feedback preserves the existing phone contract without granting code/forge actions', async t => {
  const { spec } = await fixture(t);
  const payload = { mode: 'comment', verdict: 'approve-with-comments', findings: {
    home_direction: { decision: 'summary', comment: JSON.stringify({ choice: 'focused', comment: 'Keep A, but increase chart contrast 🐈' }) },
  }, nits: null, message: 'Make another mockup before implementing.' };
  assert.deepEqual(validate(spec, payload), []);
  assert.ok(validate(spec, { ...payload, mode: 'change' }).length);
  assert.ok(validate(spec, { ...payload, findings: {} }).length);
  for (const choice of ['not-an-option', null]) assert.ok(validate(spec, { ...payload, findings: {
    home_direction: { decision: 'summary', comment: JSON.stringify({ choice, comment: '' }) },
  } }).length);
  assert.deepEqual(validate(spec, { ...payload, verdict: 'needs-discussion', findings: {
    home_direction: { decision: 'summary', comment: JSON.stringify({ choice: null, comment: 'Please explore a third option' }) },
  } }), []);
  assert.throws(() => validateDesign({ ...spec, pr: 'https://github.com/o/r/pull/1' }), /cannot carry a PR/);
  assert.throws(() => validateDesign({ ...spec, own_pr: true }), /cannot carry a PR/);
  assert.throws(() => validateDesign({ ...spec, findings: [{ id: 'fake-defect' }] }), /code findings/);
  assert.throws(() => assertPageSize({ html: 'x'.repeat(1024 * 1024) }), /1 MiB/);
});


test('phone budget is checked before replacing a registration, and incomplete/animated PNG is refused', async t => {
  const { root, path, spec, store, save } = await fixture(t);
  const entry = store.register(path);
  const first = store.readReview(entry);
  save({ ...spec, summary: 'Long explanation '.repeat(20000) });
  assert.throws(() => store.register(path), /1 MiB/);
  assert.deepEqual(store.lookup(entry.id).media, entry.media, 'failed registration replaced snapshot binding');
  save(spec);
  const png = Buffer.alloc(57);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.writeUInt32BE(13,8); png.write('IHDR',12); png.writeUInt32BE(1,16); png.writeUInt32BE(1,20);
  png.writeUInt32BE(0,33); png.write('acTL',37);
  Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]).copy(png,45);
  writeFileSync(join(root,'images/animated.png'),png);
  save({media:[{...spec.media[0],path:'images/animated.png'}]});
  assert.throws(() => store.register(path), /animated PNG/);
  writeFileSync(join(root,'images/animated.png'),png.subarray(0,40));
  assert.throws(() => store.register(path), /truncated PNG/);
  assert.equal(first.images.length, 3);
});


test('a delayed submission cannot decide images reattached while its body is arriving', async t => {
  const { root, path, store } = await fixture(t);
  const entry = store.register(path), before = store.readReview(entry);
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  const server = spawn(process.execPath, [resolve(import.meta.dirname, '../server.mjs')], {
    env: { ...process.env, SURFACE_HOME: join(root,'registry'), SURFACE_PORT:String(port) }, stdio:'ignore',
  });
  t.after(() => server.kill());
  const wait = ms => new Promise(done => setTimeout(done, ms));
  for (let i=0;i<60;i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {}
    await wait(25);
  }
  const body = JSON.stringify({ round:before.round, submission_id:'delayed-design-0001', mode:'comment', verdict:'approve',
    findings:{home_direction:{decision:'summary',comment:JSON.stringify({choice:'focused',comment:'Old image'})}}, nits:null, message:'' });
  const req = request({host:'127.0.0.1',port,path:`/api/${entry.id}/decisions`,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}});
  t.after(() => req.destroy());
  const response = new Promise((done,reject) => {
    req.on('response',res => { let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>done({status:res.statusCode,body:JSON.parse(raw)})); });
    req.on('error',reject);
  });
  req.write(body.slice(0,40));
  await wait(100);
  cpSync(join(root,'images/bold.jpg'),join(root,'images/calm.jpg'));
  const replacement = store.register(path);
  assert.notEqual(store.readReview(replacement).round,before.round);
  req.end(body.slice(40));
  const result = await response;
  assert.equal(result.status,409);
  assert.match(result.body.error,/changed/);
  assert.equal(existsSync(join(root,'decisions.json')),false);
  assert.equal(existsSync(join(root,'submission-delayed-design-0001.json')),false);
});
