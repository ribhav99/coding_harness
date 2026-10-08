// tmux, asked from Node: the bounded call everything else goes through, and
// the two questions every caller has about a pane - is it there, and what
// process runs in it.

import { execFileSync } from 'node:child_process';

// Bounded, because a tmux call that never returns is worse than one that fails.
//
// `send-keys` can block indefinitely when the caller's environment cannot reach
// the tmux socket - a sandboxed shell is the case that bit us. There is no
// output and no error, so `fm tell` simply never came back and the message was
// never delivered; worse, the literal had already landed, leaving the typed
// text stranded unsent in the worker's prompt where the next send would
// concatenate onto it. Ten seconds is far longer than any tmux command here
// legitimately takes, so a timeout means something is wrong, not slow.
export function tmux(args) {
  try {
    return execFileSync('tmux', args, { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch (error) {
    if (error?.signal === 'SIGTERM' && error?.killed) {
      throw new Error(`tmux ${args[0]} did not return within 10s (target ${args[2] ?? '?'})`);
    }
    throw error;
  }
}
// The pid of what a pane runs: its shell, or the provider launched in it.
export function panePid(pane) {
  return Number(tmux(['display-message', '-p', '-t', pane, '#{pane_pid}']));
}

// Asked by membership, not by addressing the pane.
//
// `display-message -t %77` on a pane that no longer exists does NOT fail - tmux
// falls back to the current pane and cheerfully answers, so this returned true
// for every dead session ever passed to it. `fm status` then reported a review
// as alive after its window had been closed, which is the one thing status must
// never get wrong.
export function paneAlive(pane) {
  try {
    return tmux(['list-panes', '-a', '-F', '#{pane_id}']).split('\n').includes(pane);
  } catch {
    return false;
  }
}
