// Opt-in visual/transport proof. See ../DESIGN_REVIEWS.md for the isolated run.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const ROOT = resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.SURFACE_EVIDENCE || mkdtempSync(join(tmpdir(), 'surface-visual-evidence-'));
mkdirSync(OUTPUT, { recursive: true, mode: 0o700 });
assert.ok(process.env.SURFACE_PLAYWRIGHT_MODULE, 'set SURFACE_PLAYWRIGHT_MODULE to an installed playwright/index.mjs');
assert.ok(process.env.SURFACE_MOBILE_REPO, 'set SURFACE_MOBILE_REPO to a read-only mobile_build repository containing the released commit');
const { webkit } = await import(pathToFileURL(process.env.SURFACE_PLAYWRIGHT_MODULE));
const home = mkdtempSync(join(tmpdir(), 'surface-webkit-'));
const artifacts = join(home, 'review');
cpSync(join(ROOT, 'surface/examples/design-review'), artifacts, { recursive: true });
const specPath = join(artifacts, 'review.json');
const socket = join(home, 'tmux.sock'), seen = join(home, 'seen'), fake = join(home, 'worker.mjs');
writeFileSync(fake, `import { appendFileSync } from 'node:fs';import { createInterface } from 'node:readline';for await (const line of createInterface({input:process.stdin})) appendFileSync(${JSON.stringify(seen)},line+'\\n');`);
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
const tmux = args => execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8' }).trim();
const pane = tmux(['-f', '/dev/null', 'new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'design-fixture', `exec ${quote(process.execPath)} ${quote(fake)}`]);
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(done => listener.close(done));
const env = { ...process.env, SURFACE_HOME: join(home, 'registry'), SURFACE_PORT: String(port),
  SURFACE_PANE: pane, TMUX: `${socket},1,0`, TMUX_PANE: pane, FM2_TASK: '', FM_PROJECT: '', FM_REMOTE: 'yes' };
const server = spawn(process.execPath, [join(ROOT, 'surface/server.mjs')], { env, stdio: 'ignore' });
const pause = ms => new Promise(done => setTimeout(done, ms));
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {}
    await pause(50);
  }
  const open = () => execFileSync(process.execPath, [join(ROOT, 'surface/cli.mjs'), 'open', specPath], { env, encoding: 'utf8' });
  assert.match(open(), /Available in TabTail/);
  const adapterRoot = join(home, 'released-adapter');
  mkdirSync(join(adapterRoot, 'relay_adapter'), { recursive: true });
  writeFileSync(join(adapterRoot, 'relay_adapter/__init__.py'), '');
  const releasedCommit = 'c3f41d3b4b3e282031386e227f8f31d69ffbfb20';
  for (const module of ['common.py', 'reviews.py']) writeFileSync(join(adapterRoot, 'relay_adapter', module),
    execFileSync('git', ['-C', process.env.SURFACE_MOBILE_REPO, 'show', `${releasedCommit}:adapter/relay_adapter/${module}`]));
  const adapter = (op, message = {}) => {
    const result = execFileSync(process.env.SURFACE_PYTHON || '/opt/homebrew/bin/python3',
      [join(ROOT, 'surface/test/adapter_fixture.py'), adapterRoot, String(port), op, JSON.stringify(message)], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(result);
  };
  function refused(op, message, code) {
    try { adapter(op, message); } catch (error) {
      assert.equal(JSON.parse(error.stdout).code, code); return;
    }
    assert.fail(`${op} did not refuse with ${code}`);
  }
  const inbox = adapter('reviews.list');
  const review = adapter('reviews.open', { review: inbox.reviews[0].id });
  const responseBytes = Buffer.byteLength(JSON.stringify(review));
  assert.ok(responseBytes < 1024 * 1024);
  writeFileSync(join(OUTPUT, 'embedded-page.json'), JSON.stringify(review));
  browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const requests = [];
  await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  async function nativePage(html) {
    const page = await context.newPage();
    // Mirrors the existing WebView bridge; no native filesystem or network API.
    await page.evaluate(() => { window.messages = []; window.ReactNativeWebView = { postMessage: s => window.messages.push(JSON.parse(s)) }; });
    await page.setContent(html);
    await page.waitForFunction(() => window.messages.some(m => m.type === 'ready'));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.review-image')).every(i => i.complete));
    return page;
  }
  let page = await nativePage(review.html);
  const dimensions = await page.locator('.review-image').evaluateAll(images => images.map(i => [i.naturalWidth, i.naturalHeight]));
  assert.deepEqual(dimensions, [[1170,2532],[1170,2532],[1170,2532]]);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(OUTPUT, 'phone-gallery.png'), fullPage: true });
  await page.locator('[data-image="calm"]').click();
  await page.screenshot({ path: join(OUTPUT, 'phone-enlarged-fit.png') });
  await page.locator('#image-plus').click();
  await page.locator('#image-plus').click();
  assert.ok(await page.locator('.image-scroll').evaluate(el => el.scrollWidth > el.clientWidth && el.scrollHeight > el.clientHeight));
  await page.locator('.image-scroll').evaluate(el => el.scrollTo(180, 240));
  await page.screenshot({ path: join(OUTPUT, 'phone-enlarged-4x.png') });
  await page.locator('#image-close').click();
  await page.check('input[name="home_direction-choice"][value="focused"]');
  await page.fill('[name="home_direction-feedback"]', 'A is clearer. Increase chart contrast 🐈');
  await page.check('input[name="verdict"][value="approve-with-comments"]');
  const draft = await page.evaluate(() => window.messages.filter(m => m.type === 'draft').at(-1).payload);
  assert.equal(draft.mode, 'comment');
  assert.deepEqual(JSON.parse(draft.findings.home_direction.comment), { choice: 'focused', comment: 'A is clearer. Increase chart contrast 🐈' });
  assert.equal(await page.locator('#send').isDisabled(), true, 'embedded form can send while disconnected');
  await page.close();
  page = await nativePage(review.html);
  await page.evaluate(payload => { window.surfaceNativeReceive({type:'restore',payload}); window.surfaceNativeReceive({type:'connection',connected:true}); }, draft);
  assert.equal(await page.inputValue('[name="home_direction-feedback"]'), 'A is clearer. Increase chart contrast 🐈');
  assert.equal(await page.isChecked('input[name="home_direction-choice"][value="focused"]'), true);
  await page.locator('#decisions').screenshot({ path: join(OUTPUT, 'phone-design-feedback.png') });
  await page.click('#send');
  const payload = await page.evaluate(() => window.messages.find(m => m.type === 'submit').payload);
  const message = { review: review.id, round: review.round, submission_id: 'design-visual-0001', decisions: payload };
  const receipt = adapter('reviews.submit', message);
  assert.equal(receipt.woke, true);
  assert.deepEqual(adapter('reviews.submit', message), receipt, 'retry changed receipt');
  await pause(100);
  assert.equal(readFileSync(seen, 'utf8').trim().split('\n').length, 1);
  const saved = JSON.parse(readFileSync(join(artifacts, 'decisions.json')));
  writeFileSync(join(OUTPUT,'saved-decisions.json'),JSON.stringify(saved,null,2));
  writeFileSync(join(OUTPUT,'receipt.json'),JSON.stringify(receipt,null,2));
  assert.equal(saved.review_type, 'design'); assert.equal(saved.mode, 'comment');
  assert.deepEqual(saved.findings, payload.findings);
  const savedReview = adapter('reviews.open', { review: review.id });
  const savedPage = await nativePage(savedReview.html);
  assert.equal(await savedPage.inputValue('[name="home_direction-feedback"]'), 'A is clearer. Increase chart contrast 🐈');
  assert.equal(await savedPage.locator('#send').isDisabled(), true);
  await savedPage.close();
  // CSP refuses requests even if an untrusted URL is injected into the DOM.
  const blocked = await page.evaluate(async () => {
    const image = document.createElement('img'); image.src='https://external.invalid/secret.jpg';document.body.appendChild(image);
    try { await fetch('https://external.invalid/leak'); return false; } catch { return true; }
  });
  assert.equal(blocked, true);
  assert.deepEqual(requests, [], 'embedded page attempted network requests');
  // Decode a PNG export of the same full-resolution product screenshot too.
  const pngData = await page.locator('.review-image').first().evaluate(img => {
    const canvas = document.createElement('canvas'); canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(join(artifacts,'images/baseline.png'),Buffer.from(pngData,'base64'));
  const pngDir = join(home, 'png-review'); mkdirSync(pngDir);
  cpSync(join(artifacts, 'images/baseline.png'), join(pngDir, 'baseline.png'));
  const pngSpecPath = join(pngDir,'review.json');
  writeFileSync(pngSpecPath, JSON.stringify({ id:'png-proof', title:'PNG product illustration', media:[{id:'png',path:'baseline.png',title:'Baseline PNG',alt:'Workout home PNG screenshot'}] }));
  // Separate no-pane fixture registration avoids stealing the design owner.
  execFileSync(process.execPath,[join(ROOT,'surface/cli.mjs'),'open',pngSpecPath],{env:{...env,SURFACE_PANE:'',TMUX_PANE:''},encoding:'utf8'});
  const pngReview = adapter('reviews.open',{review:'png-proof'});
  const pngPage = await nativePage(pngReview.html);
  assert.deepEqual(await pngPage.locator('.review-image').evaluate(img=>[img.naturalWidth,img.naturalHeight]),[1170,2532]);
  await pngPage.close();
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(`http://127.0.0.1:${port}/r/png-proof`);
  await desktop.waitForFunction(() => document.querySelector('.review-image')?.naturalWidth === 1170);
  assert.equal(await desktop.isChecked('input[name="mode"][value="comment"]'), true);
  await desktop.check('input[name="mode"][value="change"]');
  assert.match(await desktop.locator('#send').textContent(), /will change the branch/);
  await desktop.screenshot({ path: join(OUTPUT, 'desktop-code-image.png'), fullPage: true });
  await desktop.close();
  // A replaced source leaves the old round untouched until explicitly reopened.
  cpSync(join(artifacts, 'images/bold.jpg'), join(artifacts, 'images/calm.jpg'));
  assert.equal(adapter('reviews.open', { review: review.id }).round, review.round);
  open();
  const next = adapter('reviews.open', { review: review.id });
  assert.notEqual(next.round, review.round); assert.equal(next.status, 'waiting');
  refused('reviews.submit', message, 'review_stale');
  // A structurally plausible but undecodable JPEG gets an explicit in-page error.
  const corrupt = Buffer.alloc(32); corrupt.set([255,216,255,192,0,8,8,0,10,0,10,1]); corrupt.set([255,217],30);
  writeFileSync(join(artifacts,'images/corrupt.jpg'),corrupt);
  const spec = JSON.parse(readFileSync(specPath)); spec.media[0].path='images/corrupt.jpg'; writeFileSync(specPath,JSON.stringify(spec)); open();
  const bad = await nativePage(adapter('reviews.open', {review:review.id}).html);
  await bad.evaluate(() => window.surfaceNativeReceive({type:'connection',connected:true}));
  assert.equal(await bad.locator('.image-error:not([hidden])').count(),1);
  assert.equal(await bad.locator('#send').isDisabled(),true);
  await bad.screenshot({path:join(OUTPUT,'phone-corrupt-error.png'),fullPage:true});
  rmSync(specPath);
  refused('reviews.open',{review:review.id}, 'review_closed');
  writeFileSync(join(OUTPUT,'visual-results.json'),JSON.stringify({ releasedCommit, responseBytes, dimensions, pngDimensions: [1170,2532], desktop: 'PNG decoded with original code-review mode controls', networkRequests:requests, zoom:'4× fit with horizontal and vertical scrolling', draft:'restored exact choice/comment', retry:'one original-worker wake', stale:'refused through released adapter', closed:'refused through released adapter', corrupt:'explicit error and send blocked', proof:'Playwright WebKit 26.0 at 390×844 CSS pixels, DPR 3; not a physically observed phone' },null,2));
  console.log(`PASS: released adapter + iPhone-sized WebKit; ${responseBytes} response bytes. Evidence: ${OUTPUT}`);
} finally {
  await browser?.close();
  server.kill();
  try { tmux(['kill-server']); } catch {}
  rmSync(home, {recursive:true,force:true});
}
