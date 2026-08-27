#!/usr/bin/env node
// surface - open a review page, and read back what Ribhav decided.
//
// Usage:
//   surface open <spec.json>     register the review, ensure the server, open the
//                                page, print the URL, and RETURN. The calling
//                                session is expected to stop immediately after.
//   surface read <spec.json>     print decisions.json if Ribhav has sent,
//                                exit 1 if not. This is what a woken reviewer runs.
//   surface url <spec.json>      print the page URL without opening a browser
//   surface list                 the reviews this server knows about
//   surface claim-supervisor     record this pane as the supervisor's, so no review
//                                can ever bind to it and type into Ribhav's chat
//   surface stop                 shut the server down
//
// There is no `poll`, and that absence is the design. A reviewer does not wait
// for Ribhav; it stops, and the server wakes it by typing into its pane.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  register, lookup, idFor, readDecisions, decisionsPath, listReviews, claimSupervisorPane,
} from './lib/store.mjs';
import { buildStamp } from './lib/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SURFACE_PORT || 4390);
const BASE = `http://127.0.0.1:${PORT}`;

function die(message, code = 1) {
  process.stderr.write(`surface: ${message}\n`);
  process.exit(code);
}

async function serverHealth() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function serverAlive() {
  return (await serverHealth()) !== null;
}

function spawnServer() {
  const child = spawn(process.execPath, [join(HERE, 'server.mjs')], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

// Start detached and wait for it to answer. Detached because the server outlives
// the session that happened to need it first; a review opened at noon must still
// serve a tab opened at five.
//
// Outliving the session is the point; outliving the code is the bug. Because
// nothing ever restarted it, a server started in August served August's code
// for weeks - which is how a word renamed out of the harness kept appearing in
// files written long after the rename. So compare what the running process was
// built from against the source on disk, and replace it when they differ. This
// CLI is a fresh process each time, so its own stamp is always current.
// Stop whatever is serving this port, by the pid it reports rather than by
// matching a command line. Returns false if something is still answering.
async function stopServer(pid) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (pid) {
      try {
        process.kill(pid, signal);
      } catch {
        /* already gone, or not ours to signal; the port check below decides */
      }
    }
    for (let i = 0; i < 30; i += 1) {
      if (!(await serverAlive())) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return !(await serverAlive());
}

async function ensureServer() {
  const health = await serverHealth();
  if (health) {
    if (health.build === buildStamp()) return false;
    process.stderr.write('surface: the running server is out of date; restarting it\n');
    if (!(await stopServer(health.pid))) die(`the out-of-date server on ${BASE} would not stop`);
  }
  spawnServer();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 150));
    if (await serverAlive()) return true;
  }
  die(`the server did not come up on ${BASE}`);
}

function entryFor(specPath) {
  const abs = resolve(specPath);
  if (!existsSync(abs)) die(`no spec at ${abs}`);
  const id = idFor(abs, JSON.parse(readFileSync(abs, 'utf8')));
  const entry = lookup(id);
  return entry ?? { id, spec: abs, pane: null };
}

const [, , command, ...rest] = process.argv;

if (command === 'open') {
  const specPath = rest[0] ?? die('usage: surface open <spec.json>');
  // TMUX_PANE is set inside a tmux pane, so a review registers the pane it is
  // running in without being told. That pane is where its decisions arrive.
  const pane = process.env.SURFACE_PANE || process.env.TMUX_PANE || null;
  let entry;
  try {
    entry = register(specPath, { pane });
  } catch (err) {
    die(err.message);
  }
  if (entry.rebound_from) {
    process.stderr.write(
      `surface: "${entry.id}" moved from pane ${entry.rebound_from} to ${entry.pane}. ` +
        'If that is not this review\'s own session, its decisions will arrive in the wrong pane.\n',
    );
  }
  await ensureServer();
  const url = `${BASE}/r/${encodeURIComponent(entry.id)}`;
  if (!rest.includes('--no-open')) {
    try {
      execFileSync('open', [url], { stdio: 'ignore' });
    } catch {
      // A browser that will not open is not a failure worth stopping for; the
      // URL is printed and the review is registered either way.
    }
  }
  process.stdout.write(`${url}\n`);
  if (!pane) {
    process.stderr.write(
      'surface: no tmux pane detected, so Ribhav\'s decisions cannot wake this session.\n' +
        `surface: they will still be written to ${decisionsPath(entry)} - read it when you next run.\n`,
    );
  }
  process.exit(0);
}

if (command === 'read') {
  const entry = entryFor(rest[0] ?? die('usage: surface read <spec.json>'));
  const decisions = readDecisions(entry);
  if (!decisions) die('Ribhav has not sent decisions for this review yet', 1);
  process.stdout.write(`${JSON.stringify(decisions, null, 2)}\n`);
  process.exit(0);
}

if (command === 'url') {
  const entry = entryFor(rest[0] ?? die('usage: surface url <spec.json>'));
  process.stdout.write(`${BASE}/r/${encodeURIComponent(entry.id)}\n`);
  process.exit(0);
}

if (command === 'list') {
  for (const e of listReviews()) {
    process.stdout.write(`${e.id}\t${e.pane ?? '(no pane)'}\t${e.spec}\n`);
  }
  process.exit(0);
}

if (command === 'claim-supervisor') {
  const pane = process.env.SURFACE_PANE || process.env.TMUX_PANE || null;
  try {
    process.stdout.write(`surface: ${claimSupervisorPane(pane)} recorded as the supervisor's pane; no review can bind to it\n`);
  } catch (err) {
    die(err.message);
  }
  process.exit(0);
}

if (command === 'stop') {
  const health = await serverHealth();
  if (!health) {
    process.stdout.write('surface: nothing was running\n');
    process.exit(0);
  }
  if (!(await stopServer(health.pid))) die(`the server on ${BASE} would not stop`);
  process.stdout.write('surface: stopped\n');
  process.exit(0);
}

die('usage: surface open|read|url|list|claim-supervisor|stop');
