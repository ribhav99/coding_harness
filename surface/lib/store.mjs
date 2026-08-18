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

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const REGISTRY = process.env.SURFACE_HOME || join(homedir(), '.surface');

function registryPath() {
  mkdirSync(REGISTRY, { recursive: true });
  return join(REGISTRY, 'reviews.json');
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
  writeFileSync(registryPath(), JSON.stringify(reg, null, 2));
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
// so the captain's decisions had nowhere to land and the reviewer went off to
// improvise a workaround - which is the shape of every bug this guard exists to
// prevent, arriving through the guard itself.
//
// The pane id is not the identity; the shell running in it is. Ask when that
// shell started, and a claim registered before it is talking about a pane that
// no longer exists.
function paneBornAt(pane) {
  try {
    const pid = execFileSync('tmux', ['display-message', '-p', '-t', pane, '#{pane_pid}'], {
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
  const born = paneBornAt(pane);
  if (!born) return false;
  const claimed = new Date(entry.registered_at);
  return !Number.isNaN(claimed.getTime()) && claimed < born;
}

export function claimSupervisorPane(pane) {
  if (!pane) throw new Error('no pane to claim: run this inside a tmux pane, or set SURFACE_PANE');
  const reg = loadRegistry();
  const claimedBy = Object.values(reg).find((e) => e.pane === pane && !claimIsStale(e, pane));
  if (claimedBy) {
    throw new Error(`pane ${pane} is already bound to review "${claimedBy.id}"; it is not the supervisor's`);
  }
  writeFileSync(supervisorPaneFile(), `${pane}\n`);
  return pane;
}

// An id has to be stable across reopens - a captain's tab from yesterday must
// still resolve - and safe in a URL. The spec's own id wins; otherwise the
// containing directory names it, which is already the task id in practice.
export function idFor(specPath, spec) {
  const declared = spec && spec.id ? String(spec.id) : basename(dirname(resolve(specPath)));
  const safe = declared.replace(/[^A-Za-z0-9._-]/g, '-');
  return safe || 'review';
}

// Every key the page actually reads. A spec is written by a reviewer, not by a
// schema, so an invented key is a plausible mistake - and the failure mode is the
// worst kind: the page renders, looks complete, and the findings in that key are
// never seen by anyone. It happened on a real review, where three items sat in
// `extra_summary_points` and only surfaced because the reviewer mentioned them.
const RENDERED = new Set([
  'id', 'title', 'pr', 'own_pr', 'summary', 'recommendation',
  'findings', 'nits', 'tests', 'judges', 'scope',
]);

// Empty is not content: a key carrying `[]` or `""` loses nothing by being
// dropped, and refusing over it would be noise.
function carriesContent(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

export function register(specPath, { pane = null } = {}) {
  const abs = resolve(specPath);
  if (!existsSync(abs)) throw new Error(`no spec at ${abs}`);
  const spec = JSON.parse(readFileSync(abs, 'utf8'));

  // Loud at registration, because that is the last moment anyone is looking. The
  // reviewer folds the content into findings or nits and re-opens; the captain
  // never gets a page that quietly omits something.
  const unread = Object.keys(spec).filter((k) => !RENDERED.has(k) && carriesContent(spec[k]));
  if (unread.length) {
    throw new Error(
      `spec has ${unread.length} key(s) the page does not render: ${unread.join(', ')}. ` +
        'Their content would never reach the captain. Move it into `findings` or `nits`, ' +
        'or drop the key, then open again.',
    );
  }

  const id = idFor(abs, spec);
  const reg = loadRegistry();
  const previous = reg[id] ?? null;

  // The pane binding decides where a captain's decisions get typed, so getting
  // it wrong types into someone else's session. Registering from the wrong
  // session is easy to do by accident - it happened during this component's own
  // testing, and the wake landed in the supervisor's chat - so a pane already
  // claimed by a different review is refused rather than quietly stolen.
  if (pane) {
    // The supervisor's pane is the captain's chat. A review bound to it types
    // decisions there instead of at a reviewer - which happened twice while
    // building this, because running `surface open` from the supervisor's own
    // session is the natural way to try it out.
    if (pane === supervisorPane()) {
      throw new Error(
        `pane ${pane} is the supervisor's own session; a review bound to it would ` +
          "type the captain's decisions into their chat. Run `surface open` from the " +
          'review\'s session, or set SURFACE_PANE to it.',
      );
    }
    const claimedBy = Object.values(reg).find((e) => e.pane === pane && e.id !== id && !claimIsStale(e, pane));
    if (claimedBy) {
      throw new Error(
        `pane ${pane} already belongs to review "${claimedBy.id}"; ` +
          `register "${id}" from its own session, or pass SURFACE_PANE explicitly`,
      );
    }
  }

  const entry = {
    id,
    spec: abs,
    // Captured at registration from the session that owns the review, so the
    // server never has to guess which session a page belongs to.
    pane: pane ?? previous?.pane ?? null,
    registered_at: new Date().toISOString(),
  };
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

export function readSpec(entry) {
  // Read on every request rather than caching: a review that rewrites its spec
  // after a round of decisions should be visible on reload with no restart.
  return JSON.parse(readFileSync(entry.spec, 'utf8'));
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
  writeFileSync(p, JSON.stringify(payload, null, 2));
  return p;
}

export function listReviews() {
  const reg = loadRegistry();
  return Object.values(reg).filter((e) => existsSync(e.spec));
}

export function pruneMissing() {
  const reg = loadRegistry();
  let removed = 0;
  for (const [id, entry] of Object.entries(reg)) {
    if (!existsSync(entry.spec)) {
      delete reg[id];
      removed += 1;
    }
  }
  if (removed) saveRegistry(reg);
  return removed;
}

export function registryDir() {
  mkdirSync(REGISTRY, { recursive: true });
  return REGISTRY;
}

export { readdirSync };
