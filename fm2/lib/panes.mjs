// Putting a provider session in a pane: finding or making the window it
// belongs in, answering the dialogs that would hold it before its first turn,
// and refusing to call it started when it died on the way up.

import { loadTask, allTasks } from './config.mjs';
import { currentPanel } from './presence.mjs';
import { normalizeAgent } from './sessions.mjs';
import { sleepSync } from './wait.mjs';
import { tmux, paneAlive } from './tmux.mjs';
import { ensureCodexTrust, launchCommand } from './launch.mjs';

// tmux window targets are ambiguous without a session: a bare name is read as a
// pane first, which is why `-t reviews` fails with "can't find pane". Resolve the
// session explicitly and address windows as <session>:<window> throughout.
export function sessionName() {
  const panel = currentPanel();
  if (panel) return panel;
  try { return tmux(['list-sessions', '-F', '#{session_name}']).split('\n')[0]; } catch { /* none yet */ }
  return null;
}

// A window `fm` creates is routed to by NAME, so anything that renames it breaks
// the routing - a shell setting the title is enough. fmp used to pin this when it
// pre-created the windows; it no longer does, because a window created empty
// comes with a shell nobody wanted, so pinning belongs wherever the window is
// actually made.
function pinWindowName(target) {
  for (const opt of ['automatic-rename', 'allow-rename']) {
    try { tmux(['set-window-option', '-t', target, opt, 'off']); } catch { /* not worth failing a launch */ }
  }
}

// The panel builds workers and reviews up front, and an empty window cannot
// exist in tmux - it gets a shell. So a window holding one shell and nothing else
// is a placeholder waiting for its first task, and the task should REPLACE it
// rather than split beside it. Splitting beside it is what left one stray pane
// sitting in every window the panel ever built.
//
// Guarded twice, because respawning kills whatever is in the pane: it must be a
// bare shell, and it must not be a pane some task already owns.
function placeholderPane(target) {
  const panes = tmux(['list-panes', '-t', target, '-F', '#{pane_id}\t#{pane_current_command}'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  if (panes.length !== 1) return null;
  const [pane, command] = panes[0];
  if (!/^-?(zsh|bash|sh|fish|ksh|tcsh|csh)$/.test(command)) return null;
  if (allTasks().some((task) => task.pane === pane)) return null;
  return pane;
}
export function openPane(window, cwd, briefPath, id, settingsFile, resume = null, agent = 'claude', project = null) {
  if (normalizeAgent(agent) === 'codex') { try { ensureCodexTrust(cwd); } catch { /* best effort; Codex will ask */ } }
  const command = launchCommand({ agent, id, settingsFile, briefPath, resume, project: project || loadTask(id)?.project });
  let session = sessionName();
  if (!session) {
    session = 'fm';
    // Chained, not two calls: ~/.tmux.conf sets destroy-unattached on, and a
    // session built detached is destroyed the instant it has no client. tmux
    // drains a command queue before it looks for unattached sessions, so the
    // exemption has to ride along with the create - otherwise the worker's pane
    // dies before the next line can list it. Same reason as in bin-fmp.
    tmux(['new-session', '-d', '-s', session, '-n', window, '-c', cwd, command,
      ';', 'set-option', '-t', session, 'destroy-unattached', 'off']);
    pinWindowName(`${session}:${window}`);
    return tmux(['list-panes', '-t', `${session}:${window}`, '-F', '#{pane_id}']).split('\n')[0];
  }
  // Address the window by INDEX, not name. Names are not unique - a session can
  // hold three windows called "reviews" - and tmux refuses an ambiguous name
  // with "can't find window" even though listing shows it. Resolving to an index
  // once removes the ambiguity for every later call.
  const windows = tmux(['list-windows', '-t', session, '-F', '#{window_index}\t#{window_name}'])
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([, name]) => name === window);
  if (windows.length === 0) {
    // Created WITH the command, so the window's first pane is the task itself.
    // Making it empty and splitting into it is what left a stray shell in every
    // workers and reviews window the panel ever built.
    const created = tmux(['new-window', '-d', '-P', '-F', '#{window_index}', '-t', session, '-n', window, '-c', cwd, command]);
    pinWindowName(`${session}:${created}`);
    return tmux(['list-panes', '-t', `${session}:${created}`, '-F', '#{pane_id}']).split('\n').pop();
  }
  const target = `${session}:${windows[0][0]}`;
  const placeholder = placeholderPane(target);
  if (placeholder) {
    tmux(['respawn-pane', '-k', '-t', placeholder, '-c', cwd, command]);
    return placeholder;
  }
  const pane = tmux(['split-window', '-d', '-P', '-F', '#{pane_id}', '-t', target, '-c', cwd, command]);
  try { tmux(['select-layout', '-t', target, 'tiled']); } catch { /* single pane */ }
  return pane;
}

// A session that comes up behind a dialog has not started: it has not read its
// brief, it will never stop, and so it never reports - which looks precisely
// like a broken hook. Two dialogs do this, and both are answered here, where the
// pane is known, rather than leaving every launch to be rescued by hand.
//
// A fresh worktree is a folder Claude Code has not seen, so it asks whether the
// folder is trusted.
//
// And an old conversation asks how much of itself to bring back. `--resume` is
// how a task gets its pane back after a tmux server has gone, so this one is on
// the path of every restore - eight panes came up on it at once, all of them
// looking alive and none of them running. The offer to resume from a summary is
// declined on purpose: resuming exists so the pane holds what was already said,
// a summary is a lossy version of exactly that, and nothing here could tell the
// worker what had been dropped. It costs nothing until the session takes a turn,
// and an adopted pane comes up idle.
export function clearStartupPrompts(pane, { agent = 'claude', attempts = 20, waitMs = 1000 } = {}) {
  // Codex owns its trust and approval prompts; these dialogs are Claude-specific.
  if (normalizeAgent(agent) !== 'claude') {
    sleepSync(200);
    return false;
  }
  let answered = false;
  for (let i = 0; i < attempts; i += 1) {
    sleepSync(waitMs);
    let screen = '';
    try { screen = tmux(['capture-pane', '-p', '-t', pane]); } catch { return answered; }
    if (/I trust this folder/i.test(screen)) {
      tmux(['send-keys', '-t', pane, 'Enter']);
      answered = true;
      continue;
    }
    if (/Resume full session as-is/i.test(screen)) {
      tmux(['send-keys', '-t', pane, '-l', '2']);
      tmux(['send-keys', '-t', pane, 'Enter']);
      answered = true;
      continue;
    }
    // The brief is being worked, so no dialog is coming.
    if (/esc to interrupt|✻|⏺/i.test(screen)) return answered;
    // Or the session came up idle - a folder Claude Code already trusts, which
    // is the common case for an adopted worktree Ribhav has worked in.
    // Without this the loop burns its full budget waiting for a prompt that was
    // never going to appear, once per pane.
    if (/\? for shortcuts/i.test(screen)) return answered;
  }
  return answered;
}

// A launch that dies on the way up takes its pane with it, and tmux destroys the
// window if that pane was the only one in it. `fm attach` then printed a task id,
// a pane and a branch for a session that was never there - which is how a
// mistyped `--resume` reads as success. Asked after the dialogs, because the
// pane is legitimately busy until then.
export function assertStarted(pane, id) {
  if (paneAlive(pane)) return;
  throw new Error(
    `"${id}" did not start: its pane exited immediately. ` +
      'A --resume that names no real conversation does this.',
  );
}
