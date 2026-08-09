// A task is a tmux pane, a git worktree, and a brief. Spawning one, and taking
// one down without destroying work.
//
// The rails here are not general safety theatre. Each one caught a real mistake
// in the two days before this was written, and each refusal is loud.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { saveTask, loadTask, removeTask, allTasks, projectConfig, dir, home as homeDir } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FM2 = dirname(HERE);

function git(cwd, args, { quiet = true } = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  }).trim();
}

function tmux(args) {
  return execFileSync('tmux', args, { encoding: 'utf8' }).trim();
}

export function defaultBranch(project) {
  try {
    const head = git(project, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    return head.split('/').pop();
  } catch {
    return projectConfig(project).default_branch;
  }
}

// The worktree sits beside the project, named for the task, following the
// convention the project already uses by hand.
export function worktreePath(project, id) {
  const cfg = projectConfig(project);
  const parent = cfg.worktree_parent || dirname(resolve(project));
  return join(parent, `${basename(resolve(project))}-${id}`);
}

// A task never runs in the primary checkout. Asserted before an agent exists,
// because by the time one does it has already started editing.
function assertIsolated(project, worktree) {
  const primary = resolve(project);
  const wt = resolve(worktree);
  if (wt === primary) throw new Error(`refusing to run task in the primary checkout: ${primary}`);
  if (!wt.startsWith(dirname(primary))) throw new Error(`worktree ${wt} is not beside the project`);
}

// Each task gets its own Stop hook, so stopping reports.
//
// Passed at launch with --settings rather than written into the worktree's
// .claude/. Writing it there depends on Claude Code discovering project-local
// settings, which it did not do for a fresh worktree - the session ran, stopped,
// and reported nothing. Handing the file to the launch command removes the
// discovery step entirely, and leaves the worktree clean of harness files.
function writeWorkerSettings(id) {
  const hook = join(FM2, 'hooks/worker-stop.mjs');
  const file = join(dir('hooks'), `${id}.json`);
  // Home and task are baked into the command, not inherited. An environment that
  // does not reach the hook is indistinguishable from a hook that never fired,
  // and that cost an hour to tell apart once.
  const command =
    `FM2_HOME=${JSON.stringify(homeDir())} FM2_TASK=${JSON.stringify(id)} node ${JSON.stringify(hook)}`;
  writeFileSync(
    file,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }, null, 2),
  );
  return file;
}

// tmux window targets are ambiguous without a session: a bare name is read as a
// pane first, which is why `-t reviews` fails with "can't find pane". Resolve the
// session explicitly and address windows as <session>:<window> throughout.
function sessionName() {
  if (process.env.TMUX_PANE) {
    try { return tmux(['display-message', '-p', '-t', process.env.TMUX_PANE, '#{session_name}']); } catch { /* fall through */ }
  }
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

function openPane(window, cwd, briefPath, id, settingsFile, resume = null) {
  // FM2_TASK and FM2_HOME travel with the launch command, because a tmux pane
  // inherits the tmux SERVER's environment, not the environment of whatever
  // shell asked for the pane. Without them the hook fires and writes its report
  // into the wrong home, which looks exactly like the hook not firing at all.
  const env = `FM2_TASK=${JSON.stringify(id)} FM2_HOME=${JSON.stringify(homeDir())}`;
  // No brief means no opening prompt: the session comes up idle, waiting for
  // whoever opens the pane. An adopted worktree has no task to be handed, and
  // passing an empty string instead would start a turn on nothing.
  // Resuming picks the conversation back up where it stopped, so the pane comes
  // up holding everything that was already said in this worktree rather than
  // cold. It is a launch flag, not a message: nothing is sent to the worker.
  const command =
    `${env} claude --dangerously-skip-permissions --effort max ` +
    `--settings ${JSON.stringify(settingsFile)}` +
    (resume ? ` --resume ${JSON.stringify(resume)}` : '') +
    (briefPath ? ` "$(cat ${JSON.stringify(briefPath)})"` : '');
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

// A fresh worktree is a folder Claude Code has not seen, so it asks whether the
// folder is trusted and waits. Until that is answered the session has not
// started, has not read its brief, and will never stop - so it never reports,
// which looks precisely like a broken hook. Answer it here, where the pane is
// known, rather than leaving every spawn to be rescued by hand.
function acceptTrustPrompt(pane, { attempts = 12, waitMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    execFileSync('sleep', [String(waitMs / 1000)]);
    let screen = '';
    try { screen = tmux(['capture-pane', '-p', '-t', pane]); } catch { return false; }
    if (/I trust this folder/i.test(screen)) {
      tmux(['send-keys', '-t', pane, 'Enter']);
      return true;
    }
    // The brief is being worked, so no dialog is coming.
    if (/esc to interrupt|✻|⏺/i.test(screen)) return false;
    // Or the session came up idle - a folder Claude Code already trusts, which
    // is the common case for an adopted worktree the captain has worked in.
    // Without this the loop burns its full budget waiting for a prompt that was
    // never going to appear, once per pane.
    if (/\? for shortcuts/i.test(screen)) return false;
  }
  return false;
}

export function spawnTask({ id, project, brief, baseRef = null, window = 'workers', env = {} }) {
  if (loadTask(id)) throw new Error(`task "${id}" already exists`);
  const wt = worktreePath(project, id);
  assertIsolated(project, wt);
  if (existsSync(wt)) throw new Error(`worktree already exists: ${wt}`);

  if (baseRef) {
    git(project, ['worktree', 'add', '--detach', wt, baseRef]);
  } else {
    git(project, ['worktree', 'add', '-b', id, wt, defaultBranch(project)]);
  }

  const briefDir = dir('briefs', id);
  const briefPath = join(briefDir, 'brief.md');
  writeFileSync(briefPath, brief);
  const settingsFile = writeWorkerSettings(id);

  // One pane per task in a named window, so the captain can watch a row of them.
  // Everything from here can fail, and a half-made task is worse than none: it
  // leaves a worktree nobody owns and a branch nobody will finish. So the rest
  // rolls back.
  let pane;
  try {
    pane = openPane(window, wt, briefPath, id, settingsFile);
    acceptTrustPrompt(pane);
  } catch (err) {
    try { git(project, ['worktree', 'remove', '--force', wt]); } catch { /* never made it */ }
    throw new Error(`could not start "${id}": ${err.message.split('\n')[0]}`);
  }

  return saveTask({
    id,
    project: resolve(project),
    worktree: wt,
    pane,
    brief: briefPath,
    kind: baseRef ? 'review' : 'ship',
    created_at: new Date().toISOString(),
    ...env,
  });
}

// --- adoption ----------------------------------------------------------------

// The last conversation held in a directory, or null.
//
// Claude Code files a session's transcript under ~/.claude/projects, in a folder
// named for the cwd with every non-alphanumeric character turned into a dash,
// and the transcript's filename IS the session id `--resume` wants.
//
// Newest wins, and the reason matters: a session that comes up and never takes a
// turn writes nothing here at all. So opening an idle pane on a worktree does
// not bury the chat that came before it - the newest file is still the last real
// conversation. The one case where newest is not what you want is a pane that IS
// mid-conversation right now, which resuming would fork rather than join.
export function lastSessionFor(cwd, root = join(homedir(), '.claude', 'projects')) {
  const folder = join(root, resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
  if (!existsSync(folder)) return null;
  const newest = readdirSync(folder)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, at: statSync(join(folder, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0];
  return newest ? basename(newest.f, '.jsonl') : null;
}

// A session on a worktree the captain already has.
//
// Every rail in spawnTask assumes the worktree is the harness's own: it creates
// it, and closing destroys it. A branch the captain has had open for a week is
// the opposite kind of thing. It exists, it may hold uncommitted work, and it
// must still be there afterwards - so adoption is its own path rather than a
// flag on spawn, and the record carries `adopted` so teardown can tell them
// apart. Getting that backwards would delete real work on `fm close`.
export function adoptTask({ id, project, worktree, window = 'workers', brief = null, resume = null, env = {} }) {
  if (loadTask(id)) throw new Error(`task "${id}" already exists`);
  const wt = resolve(worktree);
  if (!existsSync(wt)) throw new Error(`no worktree at ${wt}`);
  assertIsolated(project, wt);

  // It must be a worktree of THIS project. Attaching to a checkout of something
  // else would put the pane in a panel it has nothing to do with, and `fm status`
  // would then read it against the wrong repository.
  const known = git(project, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => resolve(line.slice('worktree '.length)));
  if (!known.includes(wt)) throw new Error(`${wt} is not a worktree of ${resolve(project)}`);

  let briefPath = null;
  if (brief) {
    briefPath = join(dir('briefs', id), 'brief.md');
    writeFileSync(briefPath, brief);
  }
  const settingsFile = writeWorkerSettings(id);

  // Nothing to roll back. The worktree was not ours to make, so a launch that
  // fails leaves it exactly as it was found - which is the whole point.
  const pane = openPane(window, wt, briefPath, id, settingsFile, resume);
  acceptTrustPrompt(pane);

  let branch = null;
  try { branch = git(wt, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch { /* detached, or worse */ }

  return saveTask({
    id,
    project: resolve(project),
    worktree: wt,
    pane,
    brief: briefPath,
    kind: 'adopted',
    adopted: true,
    branch,
    resumed: resume,
    created_at: new Date().toISOString(),
    ...env,
  });
}

// --- teardown ----------------------------------------------------------------

// Unlanded work is work that exists nowhere but this worktree. Uncommitted
// changes, or commits no remote has. Refusing is the point: a worktree removed
// with either is gone.
export function unlandedWork(task) {
  const wt = task.worktree;
  if (!existsSync(wt)) return [];
  // An adopted worktree outlives its session, so closing strands nothing: the
  // changes are exactly where the captain left them. Refusing here would be
  // refusing to put a pane away over work that is in no danger.
  if (task.adopted) return [];
  const problems = [];
  const dirty = git(wt, ['status', '--porcelain']).split('\n').filter((l) => l.trim() && !l.startsWith('??'));
  if (dirty.length) problems.push(`${dirty.length} uncommitted change(s)`);
  try {
    // HEAD, not --branches. A review worktree sits on a detached PR head with no
    // branch of its own, and --branches would count every unpushed commit in the
    // whole repository against it - refusing every close for work that is not
    // this task's and is not even in this worktree.
    const unpushed = git(wt, ['log', '--oneline', 'HEAD', '--not', '--remotes']).split('\n').filter(Boolean);
    if (unpushed.length) problems.push(`${unpushed.length} commit(s) on no remote`);
  } catch { /* no commits reachable, or no remotes: nothing to strand */ }
  return problems;
}

// A review whose findings live only in a session is a review that dies with it.
export function missingReport(task) {
  if (task.kind !== 'review') return null;
  const report = join(dirname(task.brief), 'report.md');
  return existsSync(report) ? null : report;
}

export function closeTask(id, { force = false } = {}) {
  const task = loadTask(id);
  if (!task) throw new Error(`no task "${id}"`);

  if (!force) {
    const unlanded = unlandedWork(task);
    if (unlanded.length) {
      throw new Error(
        `refusing to close "${id}": ${unlanded.join(', ')}. ` +
          'That work exists nowhere else. Land it, or say so explicitly.',
      );
    }
    const report = missingReport(task);
    if (report) {
      throw new Error(
        `refusing to close review "${id}": no report at ${report}. ` +
          'Its findings would go with the worktree.',
      );
    }
  }

  try { tmux(['kill-pane', '-t', task.pane]); } catch { /* pane already gone */ }
  // Closing an adopted task takes the session down and nothing else. The
  // worktree and its branch were the captain's before this and remain theirs
  // after; `--force` here would remove a week of work and call it teardown.
  if (!task.adopted) {
    try { git(task.project, ['worktree', 'remove', '--force', task.worktree]); } catch { /* already removed */ }
  }
  removeTask(id);
  return task;
}

export function sendToPane(pane, line) {
  tmux(['send-keys', '-t', pane, '-l', line]);
  tmux(['send-keys', '-t', pane, 'Enter']);
}

export function paneAlive(pane) {
  try {
    tmux(['display-message', '-p', '-t', pane, 'ok']);
    return true;
  } catch {
    return false;
  }
}

export { git, tmux };
