// tmux, asked from Node: the bounded call everything else goes through, and
// the two questions every caller has about a pane - is it there, and can a
// message reach it.

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
// Pasted, not typed.
//
// `send-keys -l` hands the text to the pane as a stream of keystrokes, and a
// message long enough to matter does not survive the trip. Ribhav's words to a
// worker arrived with the first two thirds missing and every newline eaten -
// "the Backoffice names in CC" came out as "the Backofficenames in CC" - so the
// worker acted on a fragment that began mid-sentence and never saw the
// instruction at all. `fm tell` printed "told". That is the worst shape a bug
// can take here: the supervisor believes Ribhav has been carried to the worker,
// the worker believes it has heard everything, and the two of them disagree
// about what was asked with nothing on either side to show it.
//
// A buffer fixes both halves. The text goes over stdin, so no argv limit and no
// quoting; `-p` wraps it in bracketed paste, so the application reads it as one
// paste rather than racing a keystroke stream, and the newlines inside arrive as
// text instead of as Enter presses that would submit the message piece by piece.
//
// The paste and the Enter stay two calls, and the gap between them is a real
// state: if the second fails the message is sitting in the worker's prompt,
// typed and unsent, and the caller has to be told that rather than left to
// discover it when the next message concatenates onto the stranded one.
export function sendToPane(pane, line) {
  const buffer = `fm-send-${process.pid}`;
  execFileSync('tmux', ['load-buffer', '-b', buffer, '-'], { input: line, timeout: 10_000 });
  // `-d` deletes the buffer on the way out, so a message is never left lying in
  // tmux's paste stack where the next window-paste would replay it.
  tmux(['paste-buffer', '-p', '-d', '-b', buffer, '-t', pane]);
  try {
    tmux(['send-keys', '-t', pane, 'Enter']);
  } catch (error) {
    throw new Error(
      `${error.message}\nthe message was typed into ${pane} but not submitted - clear that prompt before sending again`,
    );
  }
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
