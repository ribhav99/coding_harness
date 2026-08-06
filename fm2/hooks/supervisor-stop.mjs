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

if (items.length === 0) process.exit(0);

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
