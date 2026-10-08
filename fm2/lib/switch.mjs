// Moving a task between providers, or reloading it on the same one, in the
// pane it already has. The source conversation is preserved before anything
// is stopped, and a failed target launch puts the source back.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveTask, loadTask } from './config.mjs';
import { syncSkills } from './skills.mjs';
import { sessionOwnership, stopProvider } from './provider-processes.mjs';
import { currentPanel } from './presence.mjs';
import { configurePanelQuotaStatus } from './quota-status.mjs';
import { effortFor, normalizeEffort, setEffort } from './effort.mjs';
import { providerAvailable } from './provider-command.mjs';
import {
  agentOf,
  normalizeAgent,
  recordedSession,
  rememberSession,
  resolveSession,
  resumableSession,
} from './sessions.mjs';
import { tmux, panePid } from './tmux.mjs';
import { ensureCodexTrust, launchCommand, writeWorkerSettings } from './launch.mjs';
import { assertProviderStarted, clearStartupPrompts, openPane } from './panes.mjs';
import { preserveSession, refreshPreservedTranscript, worktreeState } from './handoff.mjs';

const FM2 = dirname(dirname(fileURLToPath(import.meta.url)));

function replacePane(pane, cwd, command) {
  tmux(['respawn-pane', '-k', '-t', pane, '-c', cwd, command]);
  return pane;
}

const SWITCH_RUNTIME = {
  available(agent) {
    return providerAvailable(normalizeAgent(agent));
  },
  alive(pane) {
    try { return tmux(['display-message', '-p', '-t', pane, '#{pane_dead}']) === '0'; }
    catch { return false; }
  },
  interrupt(pane, { from, source, task, explicit = false, targetLaunch = false } = {}) {
    return stopProvider({ id: pane, pid: panePid(pane), cwd: task.worktree }, { tmux, agent: from, source,
      explicit, allowUnrecordedEmbedded: targetLaunch && from === 'codex', allowMissingProvider: targetLaunch });
  },
  replace: replacePane,
  open: openPane,
  clear: clearStartupPrompts,
  assert: assertProviderStarted,
};

export function switchTask(id, {
  agent,
  session = null,
  effort = null,
  claudeRoot,
  codexRoot,
  runtime = SWITCH_RUNTIME,
} = {}) {
  const task = loadTask(id);
  if (!task) throw new Error(`no task "${id}"`);
  const from = agentOf(task);
  const to = normalizeAgent(agent);
  const sourceEffort = effortFor(id, from);
  const targetEffort = effort === null ? effortFor(id, to) : normalizeEffort(to, effort);
  // Same agent in and out is a RELOAD, not a mistake: the session is replaced in
  // its own pane so it picks up launch settings that have changed since it
  // started - a different model, or approvals that are no longer asked for.
  // Refusing it meant the only way to re-launch a session was to bounce it
  // through the other provider and back, or to move the whole panel, which
  // builds a new one. Everything else is identical, conversation included.
  if (!runtime.available(to)) throw new Error(`cannot switch "${id}": ${to} is not installed`);

  const source = resolveSession(task, from, { explicit: session, claudeRoot, codexRoot });
  const wasAlive = runtime.alive(task.pane);
  if (runtime === SWITCH_RUNTIME && wasAlive) {
    sessionOwnership({ id: task.pane, pid: panePid(task.pane) }, source, { explicit: Boolean(session) });
  }
  rememberSession({
    task: id,
    agent: from,
    sessionId: source.id,
    transcriptPath: source.transcript,
    cwd: task.worktree,
  });
  const target = resumableSession(task, to);
  const preserved = preserveSession(task, source, to);
  const before = worktreeState(task.worktree);
  const settingsFile = writeWorkerSettings(id, to);
  syncSkills({ agent: to });
  const targetCommand = launchCommand({
    agent: to,
    id,
    settingsFile,
    briefPath: preserved.promptPath,
    resume: target?.id ?? null,
    panel: task.panel ?? currentPanel() ?? '',
    effort: targetEffort,
  });

  if (to === 'codex') { try { ensureCodexTrust(task.worktree); } catch { /* best effort; Codex will ask */ } }

  let pane = task.pane;
  let sourceStopped = false, targetAttempted = false;
  try {
    if (wasAlive) {
      const codexState = runtime.interrupt(task.pane, { from, source, task, explicit: Boolean(session) });
      sourceStopped = true;
      refreshPreservedTranscript(preserved, source);
      if (codexState) {
        const manifest = JSON.parse(readFileSync(preserved.manifestPath, 'utf8'));
        manifest.source.codex_state = codexState;
        writeFileSync(preserved.manifestPath, JSON.stringify(manifest, null, 2));
      }
      targetAttempted = true;
      pane = runtime.replace(task.pane, task.worktree, targetCommand);
    } else {
      if (from === 'codex' && runtime === SWITCH_RUNTIME && source.backend !== 'embedded') {
        execFileSync(process.execPath, [join(FM2, 'lib/codex-control.mjs'), source.id, task.worktree],
          { encoding: 'utf8', timeout: 35_000, stdio: ['ignore', 'pipe', 'pipe'] });
      }
      const window = task.kind === 'review' ? 'reviews' : 'workers';
      pane = runtime.open(
        window,
        task.worktree,
        preserved.promptPath,
        id,
        settingsFile,
        target?.id ?? null,
        to,
      );
    }
    runtime.clear(pane, { agent: to });
    runtime.assert(pane, id, to);
  } catch (error) {
    // If replacing a live provider failed, resume the exact source session in
    // the same pane. A failed target launch must not turn a provider switch into
    // a dead task.
    let targetStopped = !targetAttempted;
    if (sourceStopped && targetAttempted && runtime === SWITCH_RUNTIME) {
      try {
        if (runtime.alive(pane)) runtime.interrupt(pane, { from: to, source: recordedSession(task, to), task, targetLaunch: true, explicit: true });
        targetStopped = true;
      } catch { /* keep the source stopped until target termination is verified */ }
    } else if (runtime !== SWITCH_RUNTIME) targetStopped = true;
    if (sourceStopped && targetStopped) {
      try {
        const oldSettings = writeWorkerSettings(id, from);
        const oldCommand = launchCommand({
          agent: from,
          id,
          settingsFile: oldSettings,
          resume: source.id,
          panel: task.panel ?? currentPanel() ?? '',
          briefPath: effort !== null ? preserved.promptPath : null,
          effort: sourceEffort,
        });
        runtime.replace(task.pane, task.worktree, oldCommand);
        runtime.clear(task.pane, { agent: from });
        runtime.assert(task.pane, id, from);
      } catch { /* the preserved handoff is the recovery point */ }
    }
    // A Codex target can run SessionStart and install the shared bar before a
    // later launch assertion fails. Once that target is verified stopped,
    // reconcile to the still-recorded source provider without hiding the
    // original switch failure.
    if (targetStopped) configurePanelQuotaStatus(task.panel, from);
    throw new Error(
      `could not switch "${id}" to ${to}: ${error.message}. ` +
        `The source transcript is preserved at ${preserved.snapshot}`,
    );
  }

  const after = worktreeState(task.worktree);
  const latest = loadTask(id) ?? task;
  const updated = saveTask({
    ...latest,
    pane,
    agent: to,
    resumed: target?.id ?? null,
    handoffs: [...(latest.handoffs ?? []), preserved.manifestPath],
    sessions: {
      ...(latest.sessions ?? {}),
      [from]: {
        id: source.id,
        transcript: source.transcript,
        cwd: resolve(task.worktree),
        recorded_at: new Date().toISOString(),
      },
    },
  });
  // SessionStart runs before a provider switch commits the task's new agent.
  // Reconcile after that commit so switching the final Codex worker to Claude
  // restores the panel's original tmux status immediately.
  configurePanelQuotaStatus(updated.panel, to);
  setEffort(id, to, targetEffort);
  return {
    task: updated,
    from,
    to,
    source,
    resumed: target?.id ?? null,
    effort: targetEffort,
    manifest: preserved.manifestPath,
    worktreePreserved: JSON.stringify(before) === JSON.stringify(after),
  };
}
