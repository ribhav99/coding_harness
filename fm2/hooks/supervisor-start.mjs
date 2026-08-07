#!/usr/bin/env node
// The supervisor's UserPromptSubmit hook: a turn is beginning.
//
// The other half of the idle marker. Without this the supervisor would look
// idle for the whole of the turn its own wake started, and a second report
// landing mid-turn would type a line into it.
//
// Never blocks and never fails loudly, for the same reason the worker's hook
// does not: the captain's turn must not be held up by bookkeeping, and a broken
// hook must not stop a session from starting.

import { markBusy } from '../lib/presence.mjs';

try {
  markBusy();
} catch {
  // A marker that cannot be cleared costs at most one redundant wake, which is
  // strictly better than refusing to start the turn.
}

process.exit(0);
