#!/usr/bin/env node

import { resolve } from 'node:path';
import { claimEffort, finishEffort, setEffort } from './lib/effort.mjs';
import { loadTask } from './lib/config.mjs';
import { tmux } from './lib/tmux.mjs';
import { clearStartupPrompts } from './lib/panes.mjs';
import { preserveSession, refreshPreservedTranscript } from './lib/handoff.mjs';
import { switchTask } from './lib/switch.mjs';
import { supervisorRecord } from './lib/presence.mjs';
import { providerAt, stopProvider } from './lib/provider-processes.mjs';
import { resolveSession } from './lib/sessions.mjs';
import { supervisorCommand } from './supervisor.mjs';
import { providerExecutable } from './lib/provider-command.mjs';
import { sleepSync, waitForExit } from './lib/wait.mjs';

const [id, token, hookPidText] = process.argv.slice(2);

function panePid(pane) {
  return Number(tmux(['display-message', '-p', '-t', pane, '#{pane_pid}']));
}

function assertProvider(pane, agent, idValue) {
  const pid = panePid(pane);
  if (tmux(['display-message', '-p', '-t', pane, '#{pane_dead}']) === '0' && providerAt({ pid }) === agent) return;
  throw new Error(`"${idValue}" did not restart its ${agent} provider`);
}

function reloadController(identity, request) {
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
  let stopped = false;
  try {
    stopProvider({ id: record.pane, pid: panePid(record.pane), cwd }, {
      tmux, agent: request.agent, source, explicit: true,
    });
    stopped = true;
    refreshPreservedTranscript(preserved, source);
    tmux(['respawn-pane', '-k', '-t', record.pane, '-c', cwd, targetCommand]);
    clearStartupPrompts(record.pane, { agent: request.agent });
    assertProvider(record.pane, request.agent, identity);
    return preserved.manifestPath;
  } catch (error) {
    if (stopped) {
      try {
        tmux(['respawn-pane', '-k', '-t', record.pane, '-c', cwd, oldCommand]);
        clearStartupPrompts(record.pane, { agent: request.agent });
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

await main();
