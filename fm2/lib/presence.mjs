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
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { dir } from './config.mjs';

function panePanel(pane) {
  if (!pane) return null;
  try {
    return execFileSync('tmux', ['display-message', '-p', '-t', pane, '#{session_name}'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim() || null;
  } catch { return null; }
}

export function currentPanel({ panel, pane = process.env.TMUX_PANE } = {}) {
  const selected = panel !== undefined ? panel : panePanel(pane) ?? (process.env.FM2_PANEL || null);
  if (selected !== null && (typeof selected !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(selected))) {
    throw new Error('invalid panel name');
  }
  return selected;
}

function markerFile(panel = currentPanel()) {
  return panel
    ? join(dir('panels', encodeURIComponent(panel)), 'supervisor-pane.json')
    : join(dir(), 'supervisor-pane.json');
}

export function recordSupervisor(pane, { panel = currentPanel(), task = null, agent = null, sessionId = null, cwd = null } = {}) {
  if (!pane) return null;
  const previous = supervisorRecord(panel);
  const same = previous?.pane === pane && (!agent || previous.agent === agent) && (!task || previous.task === task);
  const record = {
    pane, panel,
    task: task ?? previous?.task ?? null,
    agent: agent ?? previous?.agent ?? null,
    session_id: sessionId ?? (same ? previous?.session_id : null) ?? null,
    cwd: cwd ?? previous?.cwd ?? null,
    at: new Date().toISOString(),
  };
  writeFileSync(markerFile(panel), JSON.stringify(record, null, 2));
  return record;
}

export function supervisorRecord(panel = currentPanel()) {
  const f = markerFile(panel);
  if (!existsSync(f)) return null;
  try {
    const record = JSON.parse(readFileSync(f, 'utf8'));
    if ((record.panel ?? null) !== (panel ?? null)) return null;
    return record;
  } catch {
    return null;
  }
}

export function supervisorPane(panel = currentPanel()) {
  const record = supervisorRecord(panel);
  if (!record?.pane) return null;
  if (panel && panePanel(record.pane) !== panel) return null;
  return record.pane;
}

export { markerFile };
