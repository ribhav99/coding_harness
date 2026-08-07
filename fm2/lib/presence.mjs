// Where the supervisor is, so a worker that stops can reach it.
//
// This is a location, not a state. An earlier version recorded whether the
// supervisor was idle and only knocked when it was — which meant deciding, on
// the supervisor's behalf, that a report arriving mid-turn was not worth
// mentioning. That is the supervisor's call to make, not this file's. A worker
// stopping is the trigger; every one of them gets through.
//
// Written by the supervisor's own hooks because nothing else knows: a tmux pane
// inherits the server's environment rather than the shell that asked for it, so
// the pane id has to be captured where it is actually visible.

import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './config.mjs';

function markerFile() {
  return join(dir(), 'supervisor-pane.json');
}

export function recordSupervisor(pane) {
  if (!pane) return null;
  const record = { pane, at: new Date().toISOString() };
  writeFileSync(markerFile(), JSON.stringify(record, null, 2));
  return record;
}

export function supervisorPane() {
  const f = markerFile();
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')).pane ?? null;
  } catch {
    return null;
  }
}

export { markerFile };
