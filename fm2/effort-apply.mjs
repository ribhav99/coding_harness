#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimEffort, finishEffort, setEffort } from './lib/effort.mjs';
import { loadTask } from './lib/config.mjs';
import { tmux, panePid } from './lib/tmux.mjs';
import { assertProviderStarted, clearStartupPrompts } from './lib/panes.mjs';
import { preserveSession, refreshPreservedTranscript } from './lib/handoff.mjs';
import { switchTask } from './lib/switch.mjs';
import { supervisorRecord } from './lib/presence.mjs';
import { stopProvider } from './lib/provider-processes.mjs';
import { resolveSession } from './lib/sessions.mjs';
import { supervisorCommand } from './supervisor.mjs';
import { providerExecutable } from './lib/provider-command.mjs';
import { sleepSync, waitForExit } from './lib/wait.mjs';
import { tabtailEnabled } from './lib/tabtail.mjs';

const [id, token, hookPidText] = process.argv.slice(2);

export function reloadController(identity, request) {
  const panel = identity.slice('controller:'.length);
  const record = supervisorRecord(panel);
  if (!record?.pane) throw new Error(`no control pane recorded for ${panel}`);
  if (record.agent && record.agent !== request.agent) throw new Error(`controller ${panel} is running ${record.agent}, not ${request.agent}`);
  const cwd = resolve(record.cwd || process.cwd());
  const task = { id: identity, worktree: cwd, project: cwd, brief: null, agent: request.agent };
  const source = resolveSession(task, request.agent, { explicit: record.session_id || null });
  providerExecutable(request.agent, { required: true });
  const preserved = preserveSession(task, source, request.agent);
  const targetCommand = supervisorCommand({
    agent: request.agent, id: identity, panel, cwd, resume: source.id,
    briefPath: preserved.promptPath, effort: request.effort,
  });
  const oldCommand = supervisorCommand({
    agent: request.agent, id: identity, panel, cwd, resume: source.id,
    briefPath: preserved.promptPath, effort: request.from,
  });
  let stopped = false, targetAttempted = false, launchPid = null;
  const optedIn = tabtailEnabled(request.agent, identity);
  try {
    stopProvider({ id: record.pane, pid: panePid(record.pane), cwd }, {
      tmux, agent: request.agent, source, explicit: true,
    });
    stopped = true;
    refreshPreservedTranscript(preserved, source);
    targetAttempted = true;
    tmux(['respawn-pane', '-k', '-t', record.pane, '-c', cwd, targetCommand]);
    if (optedIn) launchPid = panePid(record.pane);
    clearStartupPrompts(record.pane, { agent: request.agent });
    assertProviderStarted(record.pane, identity, request.agent,
      { verb: 'restart', waitMs: optedIn ? 6000 : 0, launchPid });
    return preserved.manifestPath;
  } catch (error) {
    let targetStopped = !targetAttempted || !optedIn;
    if (stopped && targetAttempted && optedIn) {
      try {
        if (tmux(['display-message', '-p', '-t', record.pane, '#{pane_dead}']) === '0') {
          stopProvider({ id: record.pane, pid: panePid(record.pane), cwd }, { tmux,
            agent: request.agent, source, explicit: true, allowUnrecordedEmbedded: true,
            allowMissingProvider: true, launchPid });
        }
        targetStopped = true;
      } catch { /* never restore a second writer before target termination */ }
    }
    if (stopped && targetStopped) {
      try {
        tmux(['respawn-pane', '-k', '-t', record.pane, '-c', cwd, oldCommand]);
        const sourcePid = optedIn ? panePid(record.pane) : null;
        clearStartupPrompts(record.pane, { agent: request.agent });
        if (optedIn) assertProviderStarted(record.pane, identity, request.agent,
          { verb: 'restart', waitMs: 6000, launchPid: sourcePid });
      } catch { /* the preserved transcript and manifest remain the recovery point */ }
    }
    throw error;
  }
}

async function main() {
  waitForExit(Number(hookPidText));
  // The provider receives the hook result after the hook process exits. Give it
  // one brief flush window before snapshotting and stopping the exact session.
  sleepSync(200);
  const request = claimEffort(id, token);
  if (!request) return;
  try {
    let manifest;
    if (id.startsWith('controller:')) manifest = reloadController(id, request);
    else {
      const task = loadTask(id);
      if (!task) throw new Error(`no task "${id}"`);
      const result = switchTask(id, { agent: request.agent, effort: request.effort });
      manifest = result.manifest;
    }
    setEffort(id, request.agent, request.effort);
    finishEffort(id, token);
    process.stdout.write(`${new Date().toISOString()} ${id}: ${request.from} -> ${request.effort}; ${manifest}\n`);
  } catch (error) {
    finishEffort(id, token, { error: error.message });
    process.stderr.write(`${new Date().toISOString()} ${id}: effort change failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();
