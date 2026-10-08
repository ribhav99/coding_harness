import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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
// Explicit paste also bypasses Codex's unbracketed-paste burst detector. A
// sender-side sleep cannot do that: a busy receiver can read the entire stream,
// including Enter, after the sleep. Codex clears its burst state on an explicit
// paste, so one Enter can follow immediately, even if both arrive together.
function runTmux(args, options = {}) {
  return execFileSync('tmux', args, { timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'], ...options });
}

export function sendToPane(pane, line, { run = runTmux } = {}) {
  const buffer = `fm-send-${process.pid}-${randomUUID()}`;
  let pasted = false;
  let phase = 'paste';
  try {
    run(['load-buffer', '-b', buffer, '-'], { input: line });
    // Delete on successful paste; on failure, clean only our own named buffer.
    run(['paste-buffer', '-p', '-d', '-b', buffer, '-t', pane]);
    pasted = true;
    phase = 'submit';
    run(['send-keys', '-t', pane, 'Enter']);
  } catch (cause) {
    const error = new Error(phase === 'submit'
      ? `${cause.message}\nthe message was typed into ${pane} but not submitted - clear that prompt before sending again`
      : cause.message, { cause });
    error.phase = phase;
    throw error;
  } finally {
    if (!pasted) {
      try { run(['delete-buffer', '-b', buffer]); } catch { /* original failure wins */ }
    }
  }
}
