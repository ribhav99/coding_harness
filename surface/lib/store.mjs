// Where a review's files live, and how a review is registered.
//
// A review is a directory. The spec is a file in it, the decisions land beside
// the spec, and the id is derived from the spec path. There is no database, no
// session table, and - deliberately - no negotiated token.
//
// The token is worth naming, because removing it is the point. The tool this
// replaces handed each page load a token the server had to still recognise; a
// tab reloaded after a restart presented one the server had forgotten and got a
// refusal, which rendered as a blank page. Twice in two days. Here a page is
// addressed by id alone and served from disk on every request, so reloading a
// tab, opening it twice, or coming back to it tomorrow all behave identically.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { findingId } from './render.mjs';
import { snapshotMedia, bundledMedia, validateMedia } from './media.mjs';
import { embeddedHtml, assertPageSize } from './page.mjs';
import { validateDesign } from './design.mjs';

export const REGISTRY = process.env.SURFACE_HOME || join(homedir(), '.surface');

function registryPath() {
  return join(registryDir(), 'reviews.json');
}

export function loadRegistry() {
  const p = registryPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    // A corrupt registry must not take the server down with it. Reviews are
    // recoverable by re-registering; a crash loop is not.
    return {};
  }
}

function saveRegistry(reg) {
  atomicJson(registryPath(), reg);
}

export function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

// Concurrent reviewers register from separate CLI processes. Keep their
// read/modify/write transactions from losing one another's pages.
export function withRegistryLock(fn) {
  const lock = join(dirname(registryPath()), 'registry.lock');
  const until = Date.now() + 5000;
  let fd;
  while (fd === undefined) {
    try {
      fd = openSync(lock, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const pid = Number(readFileSync(lock, 'utf8'));
        if (pid > 0) {
          try { process.kill(pid, 0); } catch (probe) {
            if (probe.code === 'ESRCH') { unlinkSync(lock); continue; }
          }
        } else if (Date.now() - statSync(lock).mtimeMs > 30000) {
          unlinkSync(lock); continue;
        }
      } catch { /* the other process may just have released the lock */ }
      if (Date.now() >= until) throw new Error('the review registry is busy; retry surface open');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); } finally { closeSync(fd); unlinkSync(lock); }
}

export function paneSocket(pane) {
  if (!pane) return null;
  try {
    return execFileSync('tmux', ['display-message', '-p', '-t', pane, '#{socket_path}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim() || null;
  } catch { return null; }
}

export function paneIdentity(pane, socket = null) {
  if (!pane) return null;
  try {
    const pid = execFileSync('tmux', [...(socket ? ['-S', socket] : []), 'display-message', '-p', '-t', pane, '#{pane_pid}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    const born = execFileSync('ps', ['-o', 'lstart=', '-p', pid],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    return pid && born ? `${pid}:${born}` : null;
  } catch { return null; }
}

function supervisorPaneFile() {
  return join(registryDir(), 'supervisor-pane');
}

// The pane the supervisor runs in, recorded once by `surface claim-supervisor`.
// Absent means unknown, and the guard below simply does not fire - it protects
// against a real mistake without inventing a dependency when it is not set.
export function supervisorPane() {
  const p = supervisorPaneFile();
  if (!existsSync(p)) return null;
  const value = readFileSync(p, 'utf8').trim();
  return value || null;
}

// tmux hands out pane ids from a pool and reuses them. A claim recorded in
// August can therefore name the pane a review opened today: `pr-146` closed on
// the 10th and its pane died with it, and eight days later that id came back
// around. The claim below refused to let the live review bind to its own pane,
// so Ribhav's decisions had nowhere to land and the reviewer went off to
// improvise a workaround - which is the shape of every bug this guard exists to
// prevent, arriving through the guard itself.
//
// The pane id is not the identity; the shell running in it is. Ask when that
// shell started, and a claim registered before it is talking about a pane that
// no longer exists.
function paneBornAt(pane, socket = null) {
  try {
    const pid = execFileSync('tmux', [...(socket ? ['-S', socket] : []), 'display-message', '-p', '-t', pane, '#{pane_pid}'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!pid) return null;
    const started = execFileSync('ps', ['-o', 'lstart=', '-p', pid], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const at = started ? new Date(started) : null;
    return at && !Number.isNaN(at.getTime()) ? at : null;
  } catch {
    return null;
  }
}

// Unprovable is not stale. With no tmux, no such pane, or no timestamp to
// compare, the claim stands - a guard that fails open on a missing answer is
// not a guard.
function claimIsStale(entry, pane) {
  if (!entry || !entry.registered_at) return false;
  const born = paneBornAt(pane, entry.pane_socket);
  if (!born) return false;
  const claimed = new Date(entry.registered_at);
  return !Number.isNaN(claimed.getTime()) && claimed < born;
}

export function claimSupervisorPane(pane) {
  return withRegistryLock(() => claimSupervisor(pane));
}

function claimSupervisor(pane) {
  if (!pane) throw new Error('no pane to claim: run this inside a tmux pane, or set SURFACE_PANE');
  const reg = loadRegistry();
  const socket = paneSocket(pane);
  const claimedBy = Object.values(reg).find((e) => e.pane === pane && sameSocket(e.pane_socket, socket) && !claimIsStale(e, pane));
  if (claimedBy) {
    throw new Error(`pane ${pane} is already bound to review "${claimedBy.id}"; it is not the supervisor's`);
  }
  writeFileSync(supervisorPaneFile(), `${pane}\n`);
  atomicJson(join(registryDir(), 'supervisor-binding.json'), { pane, socket });
  return pane;
}

// An id has to be stable across reopens - Ribhav's tab from yesterday must
// still resolve - and safe in a URL. The spec's own id wins; otherwise the
// containing directory names it, which is already the task id in practice.
export function idFor(specPath, spec) {
  const declared = spec && spec.id ? String(spec.id) : basename(dirname(resolve(specPath)));
  const safe = declared.replace(/[^A-Za-z0-9._-]/g, '-');
  return (safe || 'review').slice(0, 160);
}

// Every key the page actually reads. A spec is written by a reviewer, not by a
// schema, so an invented key is a plausible mistake - and the failure mode is the
// worst kind: the page renders, looks complete, and the findings in that key are
// never seen by anyone. It happened on a real review, where three items sat in
// `extra_summary_points` and only surfaced because the reviewer mentioned them.
const RENDERED = new Set([
  'id', 'title', 'pr', 'own_pr', 'summary', 'product_changes', 'recommendation',
  'findings', 'nits', 'tests', 'judges', 'scope', 'media', 'review_type', 'design_questions',
]);

function sameSocket(a, b) { return !a || !b || a === b; }

function supervisorSocket(pane) {
  try {
    const binding = JSON.parse(readFileSync(join(registryDir(), 'supervisor-binding.json'), 'utf8'));
    return binding.pane === pane ? binding.socket : null;
  } catch { return null; }
}

// Empty is not content: a key carrying `[]` or `""` loses nothing by being
// dropped, and refusing over it would be noise.
function carriesContent(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

export function register(specPath, options = {}) {
  return withRegistryLock(() => registerLocked(specPath, options));
}

function registerLocked(specPath, { pane = null, project = null, remote = false } = {}) {
  const abs = resolve(specPath);
  if (!existsSync(abs)) throw new Error(`no spec at ${abs}`);
  if (statSync(abs).size > 1024 * 1024) throw new Error('review spec exceeds 1 MiB');
  const spec = JSON.parse(readFileSync(abs, 'utf8'));
  if (spec.findings != null && !Array.isArray(spec.findings)) throw new Error('spec findings must be an array');
  const findingIds = new Set();
  for (const [index, finding] of (spec.findings || []).entries()) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) throw new Error(`finding ${index + 1} must be an object`);
    const id = findingId(finding, index);
    if (findingIds.has(id)) throw new Error(`duplicate finding id "${id}" after normalization`);
    findingIds.add(id);
  }

  // Loud at registration, because that is the last moment anyone is looking. The
  // reviewer folds the content into findings or nits and re-opens; Ribhav
  // never gets a page that quietly omits something.
  const unread = Object.keys(spec).filter((k) => !RENDERED.has(k) && carriesContent(spec[k]));
  if (unread.length) {
    throw new Error(
      `spec has ${unread.length} key(s) the page does not render: ${unread.join(', ')}. ` +
        'Their content would never reach Ribhav. Move it into `findings` or `nits`, ' +
        'or drop the key, then open again.',
    );
  }

  validateMedia(spec);
  validateDesign(spec);
  const reg = loadRegistry();
  // Keep existing bookmarked URLs; new paths get a namespace even when two
  // repositories both declare their review as pr-1.
  const baseId = idFor(abs, spec);
  const suffix = createHash('sha256').update(abs).digest('hex').slice(0, 10);
  const id = Object.values(reg).find(e => e.spec === abs)?.id ||
    (reg[baseId] && reg[baseId].spec !== abs ? `${baseId}-${suffix}` : baseId);
  const previous = reg[id] ?? null;
  const socket = pane ? paneSocket(pane) : previous?.pane_socket ?? null;

  // The pane binding decides where Ribhav's decisions get typed, so getting
  // it wrong types into someone else's session. Registering from the wrong
  // session is easy to do by accident - it happened during this component's own
  // testing, and the wake landed in the supervisor's chat - so a pane already
  // claimed by a different review is refused rather than quietly stolen.
  if (pane) {
    // The supervisor's pane is Ribhav's chat. A review bound to it types
    // decisions there instead of at a reviewer - which happened twice while
    // building this, because running `surface open` from the supervisor's own
    // session is the natural way to try it out.
    if (pane === supervisorPane() && sameSocket(supervisorSocket(pane), socket)) {
      throw new Error(
        `pane ${pane} is the supervisor's own session; a review bound to it would ` +
          "type Ribhav's decisions into their chat. Run `surface open` from the " +
          'review\'s session, or set SURFACE_PANE to it.',
      );
    }
    const claimedBy = Object.values(reg).find((e) => e.pane === pane && sameSocket(e.pane_socket, socket) && e.id !== id && !claimIsStale(e, pane));
    if (claimedBy) {
      throw new Error(
        `pane ${pane} already belongs to review "${claimedBy.id}"; ` +
          `register "${id}" from its own session, or pass SURFACE_PANE explicitly`,
      );
    }
  }

  const media = snapshotMedia(abs, spec);
  if (media) {
    // Unchanged reopens retain their round, but A→B→A is a new publication:
    // earlier A decisions may already be archived while its receipt survives.
    const unchanged = previous?.media?.descriptors === media.descriptors &&
      JSON.stringify(previous.media.assets) === JSON.stringify(media.assets);
    if (unchanged) {
      if (previous.media.generation) media.generation = previous.media.generation;
    } else media.generation = randomUUID();
  }
  const entry = {
    id,
    spec: abs,
    ...(media ? { media } : {}),
    // Captured at registration from the session that owns the review, so the
    // server never has to guess which session a page belongs to.
    pane: pane ?? previous?.pane ?? null,
    pane_identity: pane ? paneIdentity(pane, socket) : previous?.pane_identity ?? null,
    pane_socket: socket,
    project: project || previous?.project || null,
    remote,
    registered_at: new Date().toISOString(),
  };
  if (media) {
    const { images } = bundledMedia(entry, spec);
    assertPageSize({ html: embeddedHtml(spec, { id, images, round: '0'.repeat(64) }) }, 4096);
  }
  reg[id] = entry;
  saveRegistry(reg);

  // A rebind is legitimate when a review is respawned into a new pane, but it is
  // never something to do silently: the caller reports it so a mistake is seen.
  entry.rebound_from = previous && previous.pane && previous.pane !== entry.pane ? previous.pane : null;
  return entry;
}

export function lookup(id) {
  const reg = loadRegistry();
  return reg[id] ?? null;
}

// Read on every request rather than caching: a review that rewrites its spec
// after a round of decisions should be visible on reload with no restart.
export function readReview(entry) {
  // Media-only reopen changes the registry even when spec bytes/mtime stay put.
  // Never let a cached caller entry keep an old attachment generation alive.
  const registered = entry.id ? lookup(entry.id) : null;
  if (registered && registered.spec === entry.spec) entry = registered;
  const before = statSync(entry.spec);
  if (before.size > 1024 * 1024) throw new Error('review spec exceeds 1 MiB');
  const raw = readFileSync(entry.spec, 'utf8');
  const after = statSync(entry.spec);
  if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.size !== after.size)
    throw new Error('review changed while being read; reload it');
  const spec = JSON.parse(raw);
  validateDesign(spec);
  const { images, identity } = bundledMedia(entry, spec);
  const round = createHash('sha256').update(raw).update(String(after.mtimeMs)).update(identity).digest('hex');
  let decided = readDecisions(entry);
  if (decided && ((decided.round && decided.round !== round) ||
      statSync(decisionsPath(entry)).mtimeMs < after.mtimeMs)) decided = null;
  return { spec, images, round, decided };
}

// The id a page generates for one send, so a retried send is recognised.
export function isSubmissionId(value) {
  return /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

export function receiptPath(entry, submission) {
  if (!isSubmissionId(submission)) throw new Error('invalid submission id');
  return join(dirname(entry.spec), `submission-${submission}.json`);
}

export function readReceipt(entry, submission) {
  const path = receiptPath(entry, submission);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

export function decisionsPath(entry) {
  return join(dirname(entry.spec), 'decisions.json');
}

export function readDecisions(entry) {
  const p = decisionsPath(entry);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeDecisions(entry, payload) {
  const p = decisionsPath(entry);
  atomicJson(p, payload);
  return p;
}

// A review that opens its page for another round has rewritten its spec first,
// so decisions older than the spec answer the round before. Left in place,
// `surface read` handed them back as Ribhav's answer to the new round and the
// page opened as already sent. They move aside rather than being deleted: they
// are the record of what was decided last time.
export function archiveStaleDecisions(entry) {
  return withRegistryLock(() => archiveDecisionsLocked(entry));
}

function archiveDecisionsLocked(entry) {
  const p = decisionsPath(entry);
  if (!existsSync(p) || !existsSync(entry.spec)) return null;
  const decidedAt = statSync(p).mtimeMs;
  if (decidedAt >= statSync(entry.spec).mtimeMs && readReview(entry).decided) return null;
  const stamp = new Date(decidedAt).toISOString().replace(/[:.]/g, '-');
  const dest = join(dirname(entry.spec), `decisions-${stamp}.json`);
  renameSync(p, dest);
  return dest;
}

export function listReviews() {
  const reg = loadRegistry();
  return Object.values(reg).filter((e) => existsSync(e.spec));
}

export function registryDir() {
  mkdirSync(REGISTRY, { recursive: true, mode: 0o700 });
  return REGISTRY;
}
