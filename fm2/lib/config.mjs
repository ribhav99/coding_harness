// Where v2 keeps its state, and what this machine can actually reach.
//
// Capabilities resolve once, here, into available-or-not. No step probes for its
// own dependency at the moment it needs it, and no step fails halfway because
// something it assumed was present is missing. The captain runs this on a work
// machine with Slack and a home machine without it, against projects that track
// work three different ways.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

// Read per call, never snapshotted at import. A constant here would freeze the
// home to whatever the environment held when the module first loaded, which
// makes the home un-overridable for anything that imports this indirectly.
export function home() {
  return process.env.FM2_HOME || join(homedir(), '.fm2');
}

export function dir(...parts) {
  const p = join(home(), ...parts);
  mkdirSync(p, { recursive: true });
  return p;
}

export function tasksDir() { return dir('tasks'); }
export function notifyDir() { return dir('notify'); }

// --- per-task record ---------------------------------------------------------
// A task is a pane, a worktree and a brief. This is the only bookkeeping v2
// keeps, and it holds identity, not state: where the task lives, not how it is
// doing. How it is doing is read from the forge, the report, or the pane.

export function taskFile(id) { return join(tasksDir(), `${id}.json`); }

export function saveTask(task) {
  writeFileSync(taskFile(task.id), JSON.stringify(task, null, 2));
  return task;
}

export function loadTask(id) {
  const f = taskFile(id);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

export function allTasks() {
  return readdirSync(tasksDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => loadTask(f.replace(/\.json$/, '')))
    .filter(Boolean);
}

export function removeTask(id) {
  const f = taskFile(id);
  if (existsSync(f)) {
    writeFileSync(join(dir('closed'), `${id}.json`), readFileSync(f));
    execFileSync('rm', ['-f', f]);
    return true;
  }
  return false;
}

// --- per-project config ------------------------------------------------------

const DEFAULT_PROJECT = {
  tracker: 'none',           // none | github-issues | work-orders
  review_channel: null,      // slack channel id, or null
  default_branch: null,      // declared only when the remote's answer is wrong
  worktree_parent: null,     // defaults to the project's parent directory
};

export function projectConfig(projectPath) {
  const f = join(projectPath, '.fm2.json');
  if (!existsSync(f)) return { ...DEFAULT_PROJECT };
  try {
    return { ...DEFAULT_PROJECT, ...JSON.parse(readFileSync(f, 'utf8')) };
  } catch {
    return { ...DEFAULT_PROJECT };
  }
}

// --- capabilities ------------------------------------------------------------

function have(cmd) {
  try {
    execFileSync('command', ['-v', cmd], { stdio: 'ignore', shell: '/bin/bash' });
    return true;
  } catch {
    return false;
  }
}

let cached = null;
let cachedFor = null;

export function capabilities({ refresh = false } = {}) {
  // Keyed on the home, so a changed home re-resolves rather than serving a
  // verdict computed for somewhere else.
  if (cached && !refresh && cachedFor === home()) return cached;
  cachedFor = home();
  const caps = {
    git: have('git'),
    tmux: have('tmux'),
    gh: false,
    slack: false,
  };
  if (have('gh')) {
    try {
      execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
      caps.gh = true;
    } catch { caps.gh = false; }
  }
  // Slack is whatever the captain has wired up on this machine. A marker file is
  // the honest test: the supervisor writes it when it has a working connection,
  // and its absence simply means announcements are skipped and reported instead.
  caps.slack = existsSync(join(home(), 'slack-available'));
  cached = caps;
  return caps;
}

export function setSlackAvailable(available) {
  const f = join(dir(), 'slack-available');
  if (available) writeFileSync(f, 'yes\n');
  else if (existsSync(f)) execFileSync('rm', ['-f', f]);
  cached = null;
  return available;
}
