// Telling the supervisor a worker has stopped.
//
// The supervisor's Stop hook is a block, not a bell: it fires when the
// supervisor tries to end a turn, so it cannot reach one that is already sitting
// between turns. That is exactly where a report is most likely to land, and five
// of them once sat unread for the better part of an hour with every hook working
// perfectly.
//
// So the knock happens at the moment of the stop, from the worker's own hook.
// There is no watcher and nothing polls: a worker stopping was always the
// trigger, and this just carries it the last step.
//
// It is deliberately unconditional. An earlier version knocked only when the
// supervisor looked idle, which quietly decided on the supervisor's behalf that
// a mid-turn report was not worth mentioning. Whether a stop deserves any
// action is the supervisor's call; this only makes sure it is told.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './config.mjs';
import { currentPanel, supervisorPane } from './presence.mjs';

// The fact, and nothing after it. An earlier version added "its report is
// waiting, `fm read` takes it", which is both a standing instruction the
// supervisor already has and a nudge toward acting - on a message whose entire
// point is that acting is optional. What a stop is worth is decided by looking,
// not by what the knock says about it.
export const knockLine = (task) =>
  `${task} stopped. Look at the session to decide next steps, or ignore.`;

function sendKeys(args) {
  return new Promise((resolve) => {
    execFile('tmux', args, (err) => resolve(!err));
  });
}

// Never throws and never blocks for long. A worker's turn must not be held up by
// the supervisor's bookkeeping, so a missing pane, a dead session or no tmux at
// all are all just "not delivered" - the report is already on disk either way,
// and the supervisor's own Stop hook still catches it at the end of its next
// turn.
export async function knock(task, { panel = currentPanel(), pane = supervisorPane(panel), send = sendKeys } = {}) {
  if (panel && existsSync(join(dir('panel-locks'), panel.replace(/[^A-Za-z0-9._-]/g, '-')))) {
    return { knocked: false, reason: 'panel handoff in progress; report remains queued' };
  }
  if (!pane) return { knocked: false, reason: 'no supervisor pane recorded' };
  const line = knockLine(task);
  // -l sends the text literally, so a report id can never be read as a key name.
  if (!(await send(['send-keys', '-t', pane, '-l', line]))) {
    return { knocked: false, reason: 'the supervisor pane did not take the line' };
  }
  if (!(await send(['send-keys', '-t', pane, 'Enter']))) {
    return { knocked: false, reason: 'the line was typed but never submitted' };
  }
  return { knocked: true, pane, task };
}
