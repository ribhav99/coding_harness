#!/usr/bin/env node
// The supervisor's Stop hook: the only thing that can interrupt Ribhav.
//
// It blocks a turn when, and only when, a worker has reported something the
// supervisor has not read. Not on idleness, not on staleness, not on a
// heartbeat, not because a pane looked quiet. If no worker has spoken, this
// exits silently and the turn ends.
//
// Exit 2 with the reason on stderr is what forces a handling turn. That much v1
// got right; what it got wrong was everything it was willing to block for.
//
// This can only catch a turn that is ending, which is why it is not the whole
// story: a report landing while the supervisor sits between turns is delivered
// by the worker's own hook instead. See lib/knock.mjs.

import { pending } from '../lib/notify.mjs';
import { currentPanel, recordSupervisor } from '../lib/presence.mjs';
import { controllerId } from '../lib/sessions.mjs';
import { finishHook, readHookInput, rememberHookSession } from '../lib/hook-io.mjs';
import { schedulePendingEffort } from '../lib/effort.mjs';
import {
  providerUpdateOwnsStop,
  schedulePendingProviderUpdate,
} from '../lib/provider-update-state.mjs';

const raw = await readHookInput();

// Where the supervisor lives, so a stopping worker knows where to knock. Written
// on every stop rather than once, because a supervisor can be restarted into a
// new pane and a stale id knocks on somebody else's door.
let panel = null;
let task = null;
let agent = process.env.FM2_AGENT || 'claude';
try {
  const payload = JSON.parse(raw || '{}');
  panel = currentPanel();
  task = process.env.FM2_TASK || (panel ? controllerId(panel) : null);
  if (task && !task.startsWith('controller:')) finishHook();
  recordSupervisor(process.env.TMUX_PANE, { panel, task, agent, sessionId: payload.session_id, cwd: payload.cwd });
  rememberHookSession(payload, { task, agent, panel });
} catch { /* never hold up a turn for bookkeeping */ }

try {
  if (task && schedulePendingProviderUpdate(task, agent)) finishHook();
} catch { /* retain normal stop behavior if scheduling failed */ }

// The coordinator deliberately stops every session on the provider. Those
// lifecycle stops are neither completed work nor unread reports.
try {
  if (providerUpdateOwnsStop(agent, task)) finishHook();
} catch { /* retain normal stop behavior if state cannot be read */ }

try {
  if (task && schedulePendingEffort(task, agent)) finishHook();
} catch { /* retain normal stop behavior if scheduling failed */ }

let items = [];
try {
  items = pending(panel);
} catch {
  // If the notify directory cannot be read, let the turn end. A supervisor that
  // cannot stop is worse than one that misses a report it can still read later.
  finishHook();
}

if (items.length === 0) finishHook();

const lines = items.map((item) => {
  const first = String(item.text || '').split('\n').find((l) => l.trim()) || '(no text)';
  return `  ${item.task}: ${first.slice(0, 220)}`;
});

process.stderr.write(
  `${items.length} worker report${items.length === 1 ? '' : 's'} you have not read:\n` +
    `${lines.join('\n')}\n\n` +
    'Run `fm read` to take them, then handle them.\n',
);
process.exit(2);
