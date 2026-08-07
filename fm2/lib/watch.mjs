// The one thing v2 said it would never have, and the reason it needs it.
//
// The supervisor's Stop hook is a block, not a bell. It fires when the
// supervisor tries to end a turn, so a report that lands while it is already
// idle reaches nobody — it sits in the queue until something unrelated makes the
// supervisor run. That is how five reports went unread for the better part of an
// hour while the captain assumed the hooks were broken.
//
// So this watches, but it is not the watcher v1 had. v1 polled to *infer* state:
// is that worker stuck, is that pane stale, has this gone quiet. This infers
// nothing. A report either exists on disk or it does not, and the supervisor is
// either between turns or it is not — both are recorded facts. It wakes on the
// edge where those two are true at once, and is otherwise silent.

import { watch as fsWatch } from 'node:fs';
import { execFile } from 'node:child_process';
import { pending } from './notify.mjs';
import { idlePane, markBusy } from './presence.mjs';
import { notifyDir } from './config.mjs';

export const WAKE_LINE =
  'A worker has reported while you were between turns. Run `fm read` to take it, then handle it.';

function sendLine(pane, line) {
  return new Promise((resolve) => {
    execFile('tmux', ['send-keys', '-t', pane, '-l', line], (err) => {
      if (err) return resolve({ woke: false, reason: err.message });
      execFile('tmux', ['send-keys', '-t', pane, 'Enter'], (err2) => {
        resolve(err2 ? { woke: false, reason: err2.message } : { woke: true });
      });
    });
  });
}

// One decision, exported so it can be tested without timers or a tmux server.
//
// Both conditions are required and neither is a heuristic. No reports means
// there is nothing to say, and saying nothing is the whole contract. No idle
// marker means the supervisor is mid-turn, and its own Stop hook will surface
// the queue when that turn ends — nudging then would be a second copy of a
// message it is already about to get.
export async function tick({ send = sendLine } = {}) {
  let items = [];
  try { items = pending(); } catch { return { woke: false, reason: 'queue unreadable' }; }
  if (items.length === 0) return { woke: false, reason: 'nothing pending' };

  const pane = idlePane();
  if (!pane) return { woke: false, reason: 'supervisor is mid-turn; its own hook will catch these' };

  // Cleared before the send, not after. The wake starts a turn, and that turn's
  // UserPromptSubmit would clear it anyway - but if the send fails, or the pane
  // is gone, a marker left in place would re-fire on every subsequent report.
  markBusy();
  const result = await send(pane, WAKE_LINE);
  return { ...result, pane, count: items.length };
}

// fs.watch is the trigger; the interval is a backstop, not the mechanism. On
// macOS the directory event is reliable enough to be the normal path, but it can
// be missed on an editor-shaped write or a filesystem that does not report, and
// a missed report is exactly the failure this was built to remove. A silent
// check costs a readdir.
export function watchLoop({ intervalMs = 60_000, log = () => {} } = {}) {
  let running = false;
  const run = async (why) => {
    if (running) return;
    running = true;
    try {
      const result = await tick();
      if (result.woke) log(`woke the supervisor for ${result.count} report(s) [${why}]`);
    } catch {
      // A watcher that dies on one bad tick is worse than one that misses it.
    } finally {
      running = false;
    }
  };

  let watcher = null;
  try {
    watcher = fsWatch(notifyDir(), () => run('event'));
  } catch {
    log('the notify directory could not be watched; running on the interval alone');
  }
  const timer = setInterval(() => run('interval'), intervalMs);
  // Do not hold the process open on the timer alone; the watcher is the reason
  // this runs, and an interval that outlives it is a poll with nothing to poll.
  run('start');

  return () => {
    clearInterval(timer);
    if (watcher) watcher.close();
  };
}
