#!/usr/bin/env node
// The supervisor's Stop hook: the only thing that can interrupt the captain.
//
// It blocks a turn when, and only when, a worker has reported something the
// supervisor has not read. Not on idleness, not on staleness, not on a
// heartbeat, not because a pane looked quiet. If no worker has spoken, this
// exits silently and the turn ends.
//
// Exit 2 with the reason on stderr is what forces a handling turn. That much v1
// got right; what it got wrong was everything it was willing to block for.

import { pending } from '../lib/notify.mjs';
import { markIdle, markBusy } from '../lib/presence.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let items = [];
try {
  items = pending();
} catch {
  // If the notify directory cannot be read, let the turn end. A supervisor that
  // cannot stop is worse than one that misses a report it can still read later.
  process.exit(0);
}

// Nothing unread, so the turn ends and the supervisor is now unreachable until
// something makes it run again. Record that, and where, so a report arriving in
// the gap has somewhere to knock. This is the only moment that can be known for
// certain, which is why it is written here rather than guessed at from outside.
if (items.length === 0) {
  try { markIdle(process.env.TMUX_PANE); } catch { /* never hold up a turn for bookkeeping */ }
  process.exit(0);
}

// Reports are waiting, so the turn is about to be forced to continue and the
// supervisor is not idle. Clearing here is load-bearing: the marker left by the
// LAST clean stop is still on disk, and blocking does not go through
// UserPromptSubmit, so nothing else would take it down. Left in place it says
// "idle" for the whole handling turn, and the watcher types into it.
try { markBusy(); } catch { /* bookkeeping never holds up a turn */ }

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
