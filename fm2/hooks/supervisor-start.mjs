#!/usr/bin/env node
// The supervisor's UserPromptSubmit hook: a turn is beginning.
//
// Its only job is to record where the supervisor is, so a worker that stops
// knows where to knock. Stop does the same, but a supervisor that has just been
// started has not stopped yet — and that first stretch is exactly when the
// panel is filling up with workers about to report.
//
// Never blocks and never fails loudly, for the same reason the worker's hook
// does not: the captain's turn must not be held up by bookkeeping, and a broken
// hook must not stop a session from starting.

import { recordSupervisor } from '../lib/presence.mjs';

try {
  recordSupervisor(process.env.TMUX_PANE);
} catch {
  // At worst a worker's knock goes undelivered and its report waits for the
  // next Stop, which is where it would have waited anyway.
}

process.exit(0);
