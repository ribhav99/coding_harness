// What code the server is actually running.
//
// The server is detached and long-lived on purpose - a review opened at noon
// must still serve a tab opened at five - and `ensureServer` starts one only
// when none answers. Nothing ever restarted it, so a process that came up in
// August was still serving August's code weeks later. That is not an abstract
// staleness: the harness renamed what it calls Ribhav on 18 Aug, and every
// decisions.json written after that still carried the old word, because the
// process writing them predated the rename. Reviewers then read that file and
// repeated the word back into their reports.
//
// So the server stamps itself with a digest of the source it loaded, and the
// CLI - which is a fresh process every time, and therefore always reads the
// current source - compares. A mismatch is a restart, not a warning: the
// server holds no state that a restart could lose, since reviews and decisions
// both live on disk.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// The files the server holds in memory once it has booted. Anything read
// per-request - the static assets - is already current and does not belong
// here; listing it would force restarts that change nothing.
const SOURCES = ['server.mjs', 'lib/render.mjs', 'lib/store.mjs', 'lib/build.mjs'];

export function buildStamp() {
  const hash = createHash('sha256');
  for (const name of SOURCES) {
    hash.update(name);
    hash.update('\0');
    hash.update(readFileSync(join(ROOT, name)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}
