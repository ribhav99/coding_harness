// Whether the supervisor is between turns, and which pane it is sitting in.
//
// This exists because reading the screen cannot answer it. A pane running Claude
// Code looks much the same working as idle until you start matching spinner
// glyphs and elapsed-time footers, and those change with the client. A wrong
// guess is not a missed nudge — it types a line into a turn that was still
// running.
//
// The hooks already know precisely. Stop fires the instant a turn ends and
// UserPromptSubmit the instant one begins, so between them the answer is
// recorded rather than inferred. The marker's presence IS the idle state.

import { existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { home, dir } from './config.mjs';

function markerFile() {
  return join(dir(), 'supervisor-idle.json');
}

// Called when a turn ends with nothing left unread. The pane travels with it
// because nothing else knows where the supervisor lives: the watcher is a
// separate process, and a tmux pane inherits the server's environment rather
// than the shell that asked for it.
export function markIdle(pane) {
  if (!pane) return null;
  const record = { pane, at: new Date().toISOString() };
  writeFileSync(markerFile(), JSON.stringify(record, null, 2));
  return record;
}

// Called when a turn begins, and by the watcher the moment it nudges. That
// second caller is what stops a queue that stays unread from being nudged over
// and over: one wake per idle period, and the next Stop arms it again.
export function markBusy() {
  const f = markerFile();
  if (existsSync(f)) {
    try { rmSync(f); } catch { /* already gone */ }
    return true;
  }
  return false;
}

export function idlePane() {
  const f = markerFile();
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')).pane ?? null;
  } catch {
    return null;
  }
}

export { markerFile };
