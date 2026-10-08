#!/usr/bin/env node
// fm - the whole harness.
//
//   fm review <pr> [--project <dir>]   open a cold review on a PR  [--window <name>]
//                        [--spec <text|@file>]  on Ribhav's brief instead of the review skill
//   fm ship <id> --spec <text|@file>   put a worker on a task  [--window <name>]
//                        [--investigate]  an open question to think through, not ship
//   fm attach <worktree> [--spec ...]  a session on a worktree that already exists
//                        [--resume]    carrying on the exact recorded conversation
//                                      also how a task whose pane died is reopened
//   fm switch <id> --agent <name>      move the same task between claude and codex
//   fm effort <level>                  restart this session at a new reasoning effort
//   fm update <claude|codex>           update a provider and resume all managed sessions
//   fm reload --agent <name> [--fresh] replace every session in this panel, in place
//                     [--controller-only]  ... or just the one running this
//   fm handoff <id>                    close a finished ship task, open its cold review
//   fm read                            take the worker reports you have not read
//   fm status                          what is alive, and what the forge says
//   fm tell <id> <message>             pass Ribhav's words to a session
//   fm quiet <id> [--off]              stop a task reporting; Ribhav has that pane
//   fm close <id> [--force]            take a task down, refusing to strand work
//   fm announce <id>                   post the outcome where the review was asked for
//   fm focus <id|%pane>                 full-screen one pane without changing its layout
//                        [--list|--choose]
//   fm caps                            what this machine can reach
//
// There is no poll, no watcher, no daemon, and no status file. A worker stopping
// is the only trigger; it knocks on the supervisor's pane as it goes, and
// `fm read` is how its words reach you.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { allTasks, loadTask, saveTask, capabilities, projectConfig, dir } from './lib/config.mjs';
import { spawnTask, adoptTask, closeTask } from './lib/tasks.mjs';
import { tmux, paneAlive } from './lib/tmux.mjs';
import { sendToPane } from './lib/pane-input.mjs';
import { currentBranch, mainCheckoutOf, pushedBranchOf } from './lib/git.mjs';
import { launchCommand, writeWorkerSettings, ensureCodexTrust } from './lib/launch.mjs';
import { clearStartupPrompts } from './lib/panes.mjs';
import { preserveSession } from './lib/handoff.mjs';
import { switchTask } from './lib/switch.mjs';
import { drain, count } from './lib/notify.mjs';
import { pr, reviewState, outcomeWord, repoOf, fetchPrHead, prForBranch, landedPrForBranch } from './lib/forge.mjs';
import { ATTACH_BRIEF, INVESTIGATE_BRIEF, PLAIN_REVIEW_BRIEF, REVIEW_BRIEF, SHIP_BRIEF } from './lib/briefs.mjs';
import { supervisorCommand } from './supervisor.mjs';
import { agentOf, normalizeAgent, resolveSession, controllerId } from './lib/sessions.mjs';
import { queuePanelSwitch } from './lib/panel-switch.mjs';
import { currentPanel, supervisorPane } from './lib/presence.mjs';
import { discoverSessions } from './lib/sessions.mjs';
import { focusCommand } from './focus-pane.mjs';
import { requestEffort } from './lib/effort.mjs';
import { requestProviderUpdate } from './lib/provider-update-state.mjs';
import { projectForSurface, setRemoteReviews } from './lib/remote.mjs';

function die(msg, code = 1) {
  process.stderr.write(`fm: ${msg}\n`);
  process.exit(code);
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// A spec given inline, or as @file.
function specArg() {
  const spec = arg('--spec');
  return spec && spec.startsWith('@') ? readFileSync(spec.slice(1), 'utf8') : spec;
}

function selectedAgent(value) {
  try { return normalizeAgent(value); } catch (error) { return die(error.message); }
}

function defaultAgent() {
  const panel = currentPanel();
  if (panel) {
    try {
      const value = execFileSync('tmux', ['show-option', '-qv', '-t', panel, '@fm-agent'], { encoding: 'utf8', timeout: 5000 }).trim();
      if (value) return selectedAgent(value);
    } catch { /* legacy panels use the launch environment */ }
  }
  return process.env.FM2_AGENT || 'claude';
}

const [, , command] = process.argv;

function remote() {
  const value = process.argv[3] ?? die('usage: fm remote yes|no [--project <dir>]');
  try {
    const project = resolve(arg('--project', projectForSurface()));
    const enabled = setRemoteReviews(project, value);
    process.stdout.write(`${project}: reviews ${enabled ? 'available in TabTail; Mac browser stays closed' : 'open in the Mac browser'}\n`);
  } catch (error) { die(error.message); }
  process.exit(0);
}

// --- effort ------------------------------------------------------------------
// The provider requests only the target level. Its Stop hook performs the
// replacement after the current turn has ended, so the command that queues the
// transition is never responsible for killing its own process tree.
function effort() {
  const level = process.argv[3] ?? die('usage: fm effort <level>');
  if (process.argv.length !== 4) die('usage: fm effort <level>');
  const id = process.env.FM2_TASK ?? die('fm effort is only available inside an fm-managed session');
  const task = id.startsWith('controller:') ? null : loadTask(id);
  if (!id.startsWith('controller:') && !task) die(`no task "${id}"`);
  const agent = normalizeAgent(process.env.FM2_AGENT || task?.agent || 'claude');
  try {
    const result = requestEffort(id, agent, level, { current: process.env.FM2_EFFORT || null });
    process.stdout.write(result.changed
      ? `${id}: effort ${result.from} -> ${result.effort} queued; end this turn now\n`
      : `${id}: already at effort ${result.effort}\n`);
  } catch (error) { die(error.message); }
  process.exit(0);
}

// --- provider update --------------------------------------------------------
// Queue from a controller and execute only after its current turn has ended.
// The Stop hook opens an independent maintenance pane, so the coordinator can
// safely stop and later resume the conversation that requested the update.
function update() {
  const provider = process.argv[3] ?? die(`usage: fm ${command} <claude|codex>`);
  if (process.argv.length !== 4) die(`usage: fm ${command} <claude|codex>`);
  const id = process.env.FM2_TASK ?? die('fm update is only available inside an fm control session');
  if (!id.startsWith('controller:')) die('fm update must be requested from an fm control session');
  const panel = currentPanel() ?? process.env.FM2_PANEL
    ?? die('fm update cannot identify the requesting panel');
  const requesterAgent = normalizeAgent(process.env.FM2_AGENT || 'claude');
  try {
    const result = requestProviderUpdate(provider, { requestedBy: id, requesterAgent, panel });
    process.stdout.write(
      `${result.provider} update queued for every managed ${result.provider} session; end this turn now\n` +
      `maintenance log: ${result.log}\n`,
    );
  } catch (error) { die(error.message); }
  process.exit(0);
}

// --- focus -------------------------------------------------------------------

async function focus() {
  try { await focusCommand(process.argv.slice(3)); } catch (error) { die(error.message); }
  process.exit(0);
}

// --- review ------------------------------------------------------------------

// A cold review session on a PR: a worktree detached at the PR's head, named
// for its branch, with a brief that says where the report goes. `review` opens
// one by hand; `handoff` opens one on the PR a finished ship task left behind.
function startReview({ project, repo, number, spec = null, window, agent }) {
  const meta = pr(repo, number);
  const slug = String(meta.headRefName || '').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40);
  const id = `pr-${number}${slug ? `-${slug}` : ''}`;

  const ref = `refs/fm2/${id}`;
  fetchPrHead(project, number, ref);

  const reportPath = join(dir('briefs', id), 'report.md');
  const specPath = join(dir('briefs', id), 'review.json');
  const task = spawnTask({
    id,
    project,
    brief: spec ? PLAIN_REVIEW_BRIEF(spec, meta.url, reportPath) : REVIEW_BRIEF(meta.url, reportPath, specPath),
    baseRef: ref,
    window,
    agent,
    env: { pr: number, repo, pr_url: meta.url, pr_author: meta.author?.login ?? null },
  });
  return { task, meta };
}

function review() {
  const number = process.argv[3] ?? die('usage: fm review <pr-number> [--project <dir>] [--window <name>] [--spec <text|@file>] [--agent claude|codex]');
  const project = resolve(arg('--project', process.cwd()));
  const agent = selectedAgent(arg('--agent', defaultAgent()));
  // Ribhav's own brief for the review, when the full skill is more than he wants.
  const spec = specArg();
  // A batch of reviews Ribhav wants kept apart from the day's work gets its
  // own window, the same way `ship` batches do. Naming one that does not exist
  // yet is how you get it.
  const window = arg('--window', 'reviews');
  const repo = repoOf(project) ?? die(`no github remote on ${project}`);
  const caps = capabilities();
  if (!caps.gh) die('gh is not authenticated, so the PR cannot be read');

  const { task } = startReview({ project, repo, number, spec, window, agent });
  process.stdout.write(`${task.id}\t${task.pane}\t${task.worktree}\n`);
  process.exit(0);
}

// --- ship --------------------------------------------------------------------

function ship() {
  const id = process.argv[3] ?? die('usage: fm ship <id> --spec <text|@file> [--window <name>] [--investigate] [--agent claude|codex]');
  const project = resolve(arg('--project', process.cwd()));
  const agent = selectedAgent(arg('--agent', defaultAgent()));
  const spec = specArg() ?? die('a ship task needs --spec');
  // A window per batch, when Ribhav wants one. `fm` creates it on demand, so
  // naming one that does not exist yet is how you get it.
  const window = arg('--window', 'workers');
  // An open question gets a worker told to answer it, not one told to open a PR.
  const investigate = process.argv.includes('--investigate');
  const brief = investigate ? INVESTIGATE_BRIEF(spec) : SHIP_BRIEF(spec);
  const task = spawnTask({ id, project, brief, window, agent });
  process.stdout.write(`${id}\t${task.pane}\t${task.worktree}\n`);
  process.exit(0);
}

// --- attach ------------------------------------------------------------------
// A session on a branch Ribhav already has open. `ship` is for work that
// does not exist yet and makes the worktree to hold it; `attach` is for work
// that does. Without --spec the session comes up idle, which is what a branch
// you want to sit down with looks like.
//
// And a branch that already exists usually has a conversation behind it. `--resume`
// opens the pane on that conversation instead of a blank one, which is nearly
// always what sitting back down with a branch means: an idle session that has to
// be told the history again is the same session started twice.

function attach() {
  const target = process.argv[3] ?? die('usage: fm attach <worktree> [--project <dir>] [--id <id>] [--spec <text|@file>] [--window <name>] [--resume [<session>]] [--agent claude|codex]');
  const worktree = resolve(target);
  // A worktree knows which checkout it belongs to, so asking it beats defaulting
  // to whatever directory the supervisor happens to be standing in. Attaching to
  // a bnl-packpilot worktree from the harness checkout used to fail with "is not
  // a worktree of coding_harness" - true, unhelpful, and about a directory nobody
  // named. --project still wins when it is given.
  const project = resolve(arg('--project') ?? mainCheckoutOf(worktree) ?? process.cwd());
  // Named for the worktree, minus the project prefix the convention already puts
  // there: bnl-packpilot-wo-213 is simply wo-213.
  const base = worktree.split('/').pop();
  const prefix = `${project.split('/').pop()}-`;
  const id = arg('--id', base.startsWith(prefix) ? base.slice(prefix.length) : base);
  const existing = loadTask(id);
  const agent = selectedAgent(arg('--agent', existing ? agentOf(existing) : defaultAgent()));
  if (existing && agent !== agentOf(existing)) {
    die(`"${id}" belongs to ${agentOf(existing)}; use fm switch ${id} --agent ${agent} to preserve its history`);
  }
  const spec = specArg();
  // Left null on purpose: adoptTask picks the window, because only it knows
  // whether this is a fresh adoption or a review being reopened.
  const window = arg('--window');
  // Bare `--resume` means the conversation recorded for this task, or the one
  // transcript whose cwd and opening brief identify it; a value names one
  // exactly. Refusing when there is nothing to resume is deliberate: the
  // alternative is a pane that comes up cold looking exactly like one that
  // resumed, and Ribhav finds out by asking it something it cannot answer.
  let resume = null;
  if (process.argv.includes('--resume')) {
    const named = arg('--resume');
    const explicit = named && !named.startsWith('--') ? named : null;
    try {
      resume = resolveSession(
        existing ?? { id, worktree, brief: null, sessions: {} },
        agent,
        { explicit },
      ).id;
    } catch (error) {
      die(error.message);
    }
  }
  let task;
  try {
    task = adoptTask({
      id,
      project,
      worktree,
      window,
      brief: spec ? ATTACH_BRIEF(spec) : null,
      resume,
      agent,
    });
  } catch (err) {
    die(err.message);
  }
  process.stdout.write(`${task.id}\t${task.pane}\t${task.branch ?? 'detached'}\t${task.worktree}${resume ? `\t${resume}` : ''}\n`);
  process.exit(0);
}

// --- panel-switch ------------------------------------------------------------

async function panelSwitch() {
  const agent = arg('--agent') ?? die('usage: fm panel-switch --agent claude|codex [--panel <session>] [--sessions @file]');
  try {
    const sessionsFile = arg('--sessions');
    const sessions = sessionsFile ? JSON.parse(readFileSync(sessionsFile.replace(/^@/, ''), 'utf8')) : {};
    const result = await queuePanelSwitch({ agent, panel: arg('--panel') ?? currentPanel(), sessions });
    process.stdout.write(`Switch queued: ${result.from} -> ${result.to}\nFull panel handoff: ${result.path}\nProgress: ${result.log}\n`);
  } catch (error) { die(error.message); }
  process.exit(0);
}

// The conversation a task is holding right now, named exactly.
//
// Prefers what the hooks recorded; falls back to the transcripts that claim this
// task's own working directory, newest first. Returns null when there is nothing
// to name, which leaves the ordinary resolution to say so.
function liveSession(task) {
  const provider = task.agent ?? 'claude';
  const recorded = task.sessions?.[provider]?.id;
  if (recorded) return recorded;
  const found = discoverSessions(provider, task.worktree);
  if (!found.length) return null;
  return found
    .map((entry) => ({ id: entry.id, at: statSync(entry.transcript).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0].id;
}

// --- reload --------------------------------------------------------------
// Every session in THIS panel, replaced where it already sits.
//
// `panel-switch` builds a new panel and leaves the old one for recovery, which
// is right when a switch might fail and wrong when the panel is the one Ribhav
// is looking at: it opened a second set of windows across the desktop and the
// tab he was working in was not the one that came back. This never creates a
// window, a split, or a panel. Each task's pane is respawned in place, carrying
// its own conversation, in the order it appears.

function reload() {
  // Named, never inferred. The panel's recorded agent is what it was STARTED
  // with, so defaulting to it turns "reload onto Codex" into "put everything
  // back on Claude" without saying so - which is exactly what it did once.
  const agent = selectedAgent(arg('--agent') ?? die('usage: fm reload --agent claude|codex [--panel <session>]'));
  const panel = arg('--panel') ?? currentPanel();
  // The control pane is not a task, so it is never in the list and never
  // replaced by accident - a reload of the workers must not take out the session
  // running it. `--controller-only` is how it is asked for, and it is the last
  // thing anyone should run in a panel: it replaces the conversation issuing it.
  if (process.argv.includes('--controller-only')) {
    const target = panel ?? die('a controller reload needs --panel <session> or a panel of its own');
    const pane = supervisorPane(target) ?? process.env.TMUX_PANE
      ?? die(`no control pane recorded for ${target}`);
    const cwd = process.cwd();
    const id = controllerId(target);
    const task = { id, worktree: cwd, project: cwd, brief: null, agent: agentOf({ agent: process.env.FM2_AGENT }) };
    const source = resolveSession(task, task.agent, { explicit: arg('--session') });
    const preserved = preserveSession(task, source, agent);
    const command = supervisorCommand({ agent, id, panel: target, briefPath: preserved.promptPath, cwd });
    process.stdout.write(`${id}\t${task.agent} -> ${agent}\t${pane}\tcarried ${source.id}\n`);
    tmux(['respawn-pane', '-k', '-t', pane, '-c', cwd, command]);
    process.exit(0);
  }
  const tasks = allTasks().filter((task) => paneAlive(task.pane)
    && (!panel || (task.panel ?? panel) === panel));
  if (!tasks.length) die(`no live task in ${panel ?? 'this panel'} to reload`);
  // Stop what is there and start from the conversation already preserved on
  // disk, instead of handing the running session over.
  //
  // Handing over is better when it works, because it captures whatever the
  // session said since its last handoff. It cannot work when the running session
  // is not the one any record names - a switch that was interrupted, or a panel
  // that was closed out from under its sessions - and then the handover step
  // chases a session that no longer exists and the pane can never be reloaded at
  // all. The conversation is not lost either way: it is in the handoff.
  const fresh = process.argv.includes('--fresh');
  let failed = 0;
  if (fresh) {
    for (const task of tasks) {
      try {
        const handoff = (task.handoffs ?? []).at(-1);
        const promptPath = handoff ? join(dirname(handoff), 'continue.md') : null;
        const settingsFile = writeWorkerSettings(task.id, agent, panel ?? '');
        const command = launchCommand({
          agent,
          id: task.id,
          settingsFile,
          panel: panel ?? '',
          briefPath: promptPath && existsSync(promptPath) ? promptPath : null,
        });
        if (agent === 'codex') ensureCodexTrust(task.worktree);
        tmux(['respawn-pane', '-k', '-t', task.pane, '-c', task.worktree, command]);
        // A replacement that comes up behind a dialog has not started: it never
        // reads its handoff, never stops, and so never reports - which is
        // indistinguishable from a broken hook. `switchTask` clears these on its
        // own path; this one respawns the pane directly and has to do the same.
        clearStartupPrompts(task.pane, { agent });
        saveTask({ ...task, agent, panel: panel ?? task.panel ?? null, resumed: null });
        process.stdout.write(`${task.id}\t${agentOf(task)} -> ${agent}\t${task.pane}${promptPath ? '\tcarried its handoff' : '\tno handoff to carry'}\n`);
      } catch (error) {
        failed += 1;
        process.stdout.write(`${task.id}\tFAILED\t${error.message.split('\n')[0]}\n`);
      }
    }
    process.stdout.write(`\n${tasks.length - failed} of ${tasks.length} replaced on ${agent}; no panel was created\n`);
    process.exit(failed ? 1 : 0);
  }
  for (const task of tasks) {
    // The running session is being replaced, so its identity is named here
    // rather than proved from the pane. Without this a session whose exact id
    // hooks never recorded - anything older than session recording, or anything
    // an interrupted switch left half-written - can never be reloaded at all.
    let session = null;
    try { session = liveSession(task); } catch { /* let switchTask resolve it */ }
    try {
      const result = switchTask(task.id, { agent, session });
      process.stdout.write(`${task.id}\t${result.from} -> ${result.to}\t${task.pane}\n`);
    } catch (error) {
      failed += 1;
      process.stdout.write(`${task.id}\tFAILED\t${error.message.split('\n')[0]}\n`);
    }
  }
  process.stdout.write(`\n${tasks.length - failed} of ${tasks.length} reloaded on ${agent}; no panel was created\n`);
  process.exit(failed ? 1 : 0);
}

// --- switch ------------------------------------------------------------------
// Keep the task, branch, worktree and reporting route; replace only the CLI.
// The source transcript is resolved before the old process is stopped, copied
// outside the worktree, and handed to the target session in full.

function switchProvider() {
  const id = process.argv[3] ?? die('usage: fm switch <id> --agent claude|codex [--session <source-id>]');
  const agent = arg('--agent') ?? die('a switch needs --agent claude|codex');
  const session = arg('--session');
  try {
    const result = switchTask(id, { agent, session });
    process.stdout.write(
      `${id}: ${result.from} -> ${result.to}; same task and worktree\n` +
        `full handoff: ${result.manifest}${result.resumed ? `; resumed ${result.to} session ${result.resumed}` : ''}\n`,
    );
  } catch (error) {
    die(error.message);
  }
  process.exit(0);
}

// --- handoff -----------------------------------------------------------------
// The automatic chain: a ship task that opened a PR reviews its own work once,
// then is closed and replaced by a session that never saw it written.

function handoff() {
  const id = process.argv[3] ?? die('usage: fm handoff <id>');
  const task = loadTask(id) ?? die(`no task "${id}"`);
  const stage = arg('--stage', task.handoff_stage ?? 'self-review');
  const reviewAgent = selectedAgent(arg('--agent', defaultAgent()));

  if (stage === 'self-review') {
    if (!paneAlive(task.pane)) die(`"${id}" has no live session to self-review`);
    sendToPane(
      task.pane,
      'Before this hands off: review your own work on this PR as if you did not write it. ' +
        'Push any fixes you are confident in, then stop and say what you found.',
    );
    saveTask({ ...task, handoff_stage: 'awaiting-self-review' });
    process.stdout.write(`${id}: asked to self-review; it will report when it stops\n`);
    process.exit(0);
  }

  // Stage two and three are one operation, so the swap cannot half-happen and
  // leave the work with no session at all.
  // A review task carries its PR number; a ship task never does, because the
  // worker is the one that opened it. So ask the forge what the branch has open
  // before giving up - the whole point of the chain is that a finished ship task
  // becomes a cold review without Ribhav doing it by hand.
  // The worktree is asked first, because the branch a task ENDS on is not the
  // one it was created with: a worker that names its own branch leaves the task
  // record pointing at nothing, and the chain then dies on a PR that is sitting
  // right there. Same reason the PR number is asked of the forge rather than
  // recorded - what the worker actually did beats what we wrote down.
  let number = task.pr ?? null;
  if (number == null) {
    try {
      number = prForBranch(task.repo ?? repoOf(task.project), pushedBranchOf(task.worktree) ?? task.branch ?? id);
    } catch (err) {
      // Distinct from the refusal below on purpose: "the forge would not say" and
      // "there is no PR" lead Ribhav to opposite next moves, and only one of
      // them is worth acting on.
      die(`could not ask the forge what "${id}" has open: ${String(err.stderr || err.message).trim().split('\n')[0]}\nNothing changed; run this again.`);
    }
  }
  if (number == null) die(`"${id}" has no PR recorded, and its branch has none open; nothing to review`);
  let closed;
  try {
    closed = closeTask(id);
  } catch (err) {
    die(`${err.message}\nThe handoff changed nothing.`);
  }
  const project = closed.project;
  const repo = closed.repo ?? repoOf(project);
  const { task: review, meta } = startReview({ project, repo, number, window: 'reviews', agent: reviewAgent });
  process.stdout.write(`${id} closed; ${review.id} now reviewing ${meta.url}\n`);
  process.exit(0);
}

// --- read --------------------------------------------------------------------

function read() {
  const items = drain(currentPanel() ?? undefined);
  if (!items.length) {
    process.stdout.write('nothing new\n');
    process.exit(0);
  }
  for (const item of items) {
    process.stdout.write(`\n=== ${item.task} — ${item.at} ===\n${item.text}\n`);
  }
  process.exit(0);
}

// --- status ------------------------------------------------------------------

function status() {
  const tasks = allTasks();
  if (!tasks.length) {
    process.stdout.write('no tasks\n');
    process.exit(0);
  }
  const caps = capabilities();
  let dead = 0;
  let merged = 0;
  let unhanded = 0;
  for (const task of tasks) {
    const alive = paneAlive(task.pane) ? 'alive' : 'DEAD';
    let forge = '';
    // A session whose PR has landed has nothing left to do, and it does not
    // announce that - it just sits in the list looking like work in progress.
    // Ribhav had to notice three of them himself. Say it here, where the forge
    // is already being asked, and say it as an instruction rather than a state.
    let landed = false;
    let pending = '';
    if (task.pr && caps.gh) {
      try {
        const s = reviewState(task.repo, task.pr);
        forge = ` | PR ${task.pr} ${s.prState}/${s.decision ?? '-'}`;
        landed = s.prState === 'MERGED';
      } catch { forge = ` | PR ${task.pr} unreadable`; }
    } else if (caps.gh) {
      // A ship task never carries a PR number: the worker opens the PR, so `fm`
      // only ever knows the branch. That made the mark above fire for reviews and
      // stay silent for exactly the tasks Ribhav had to spot himself twice in one
      // day - a revert and a promotion, both landed, both still sitting in the
      // list looking like work. A detached review worktree has no branch, so it
      // costs those nothing.
      const repo = task.repo ?? repoOf(task.project);
      const branch = pushedBranchOf(task.worktree, task.branch ?? currentBranch(task.worktree));
      const landedIn = landedPrForBranch(repo, branch);
      if (landedIn) {
        forge = ` | PR ${landedIn} MERGED`;
        landed = true;
      } else if (task.kind === 'ship' && !task.handoff_stage) {
        // A ship task that opened a PR owes a handoff: it reviews its own work
        // once, then a fresh session reads the PR cold. CLAUDE.md calls that
        // automatic, and nothing made it so - the PR just sits there looking
        // finished, which is indistinguishable from a task still working. Ribhav
        // had to ask for it three times before asking why. The open PR on the
        // branch is the evidence the work is done; `handoff_stage` is the
        // evidence it was passed on.
        const openIn = prForBranch(repo, branch);
        if (openIn) {
          forge = ` | PR ${openIn} open`;
          unhanded += 1;
          pending = '  <- opened a PR, not handed off';
        }
      }
    }
    // An adopted task has no PR of its own to read state from, so the branch it
    // sits on is the only thing that says which one it is.
    const where = task.adopted && task.branch ? ` | ${task.branch}` : '';
    // A muted task is otherwise invisible: it stops reporting and looks exactly
    // like one with nothing to say. Say so here, or the mute outlives the reason
    // for it and a session goes unwatched by both of us.
    const provider = agentOf(task) === 'claude' ? '' : ` | ${agentOf(task)}`;
    const muted = task.quiet ? ' | quiet' : '';
    const done = landed ? '  <- MERGED, close it' : '';
    process.stdout.write(`${task.id}\t${task.pane}\t${alive}${where}${forge}${provider}${muted}${done}${pending}\n`);
    if (alive === 'DEAD') dead += 1;
    if (landed) merged += 1;
  }
  // A dead pane is not a dead task - the worktree and the conversation are both
  // still there. Saying so here is the difference between a panel that looks
  // lost after a tmux restart and one that is a command away from being back.
  if (merged) {
    process.stdout.write(
      `\n${merged} session(s) whose PR has merged — fm close <id> takes them down\n`,
    );
  }
  if (unhanded) {
    process.stdout.write(
      `\n${unhanded} task(s) whose PR is open and unreviewed — fm handoff <id> starts the chain\n`,
    );
  }
  if (dead) {
    process.stdout.write(
      `\n${dead} task(s) with no session — fm attach <worktree> --resume reopens one with its recorded agent\n`,
    );
  }
  const n = count();
  if (n) process.stdout.write(`\n${n} unread report(s) — fm read\n`);
  process.exit(0);
}

// --- tell --------------------------------------------------------------------
//
// The supervisor does not chat with workers. Three things it may say, and this
// carries all three: an answer Ribhav gave to a question the worker asked, a
// message Ribhav asked to be passed on verbatim, and the handoff.
//
// It exists because doing it by hand meant driving tmux directly - two
// `send-keys` calls, the pane id copied from `status`, and no check that anyone
// was there to hear it. A message typed into a dead pane goes nowhere and says
// it succeeded, which is the failure this refuses.
//
// What it deliberately does NOT do is invent a reason to speak. Whether a
// session should be told something is a judgement made before running this.

function tell() {
  const id = process.argv[3] ?? die('usage: fm tell <id> <message>');
  const message = process.argv.slice(4).join(' ').trim();
  if (!message) die('usage: fm tell <id> <message>');
  const task = loadTask(id) ?? die(`no task "${id}"`);
  // A pane that has gone takes the message with it and reports nothing. Say so
  // instead, and name the way back.
  if (!paneAlive(task.pane)) {
    die(`"${id}" has no session (pane ${task.pane} is gone); nothing was sent.\n` +
        `fm attach ${task.worktree} --resume reopens it.`);
  }
  sendToPane(task.pane, message);
  process.stdout.write(`told ${id}\n`);
  process.exit(0);
}

// --- quiet -------------------------------------------------------------------
//
// Some sessions Ribhav works himself. He is in that pane, reading every reply as
// it lands, and the report afterwards is the same words again - arriving as an
// interruption to whatever else he had the supervisor doing. This mutes one task
// at the source: its Stop hook writes no notification and knocks on no pane.
//
// Deliberately per-task and deliberately explicit. There is no rule that could
// infer this - "he replied to it recently" is true of every session that is
// going well - so it is something he says, once, about the one he has taken.

function quiet() {
  const id = process.argv[3] ?? die('usage: fm quiet <id> [--off]');
  const task = loadTask(id) ?? die(`no task "${id}"`);
  const off = process.argv.includes('--off');
  saveTask({ ...task, quiet: !off });
  process.stdout.write(off ? `${id} reports again\n` : `${id} is quiet\n`);
  process.exit(0);
}

// --- close -------------------------------------------------------------------

function close() {
  const id = process.argv[3] ?? die('usage: fm close <id> [--force]');
  const force = process.argv.includes('--force');
  try {
    closeTask(id, { force });
    process.stdout.write(`closed ${id}\n`);
  } catch (err) {
    die(err.message);
  }
  process.exit(0);
}

// --- announce ----------------------------------------------------------------

function announce() {
  const id = process.argv[3] ?? die('usage: fm announce <id>');
  const task = loadTask(id) ?? die(`no task "${id}"`);
  if (!task.pr) die(`"${id}" has no PR`);
  const caps = capabilities();
  if (!caps.gh) die('gh is not authenticated, so the outcome cannot be confirmed');

  // Confirm on the forge. Never relay what a worker said it did.
  const word = outcomeWord(task.repo, task.pr);
  const cfg = projectConfig(task.project);

  if (!caps.slack || !cfg.review_channel) {
    process.stdout.write(
      `PR ${task.pr} — ${word}\n` +
        `(no Slack on this machine${cfg.review_channel ? '' : ' and no review channel configured'}; ` +
        'nothing was posted)\n',
    );
    process.exit(0);
  }
  // The supervisor posts it; this prints exactly what to say and where.
  process.stdout.write(JSON.stringify({ channel: cfg.review_channel, author: task.pr_author, text: `PR ${task.pr} — ${word}` }) + '\n');
  process.exit(0);
}

function caps() {
  process.stdout.write(`${JSON.stringify(capabilities({ refresh: true }), null, 2)}\n`);
  process.exit(0);
}

const COMMANDS = {
  remote,
  effort,
  update,
  upgrade: update,
  focus,
  review,
  ship,
  attach,
  'panel-switch': panelSwitch,
  reload,
  switch: switchProvider,
  handoff,
  read,
  status,
  tell,
  quiet,
  close,
  announce,
  caps,
};

if (!Object.hasOwn(COMMANDS, command)) {
  die('usage: fm review|ship|attach|switch|effort|update|reload|panel-switch|handoff|read|status|tell|quiet|close|announce|focus|caps');
}
await COMMANDS[command]();
