#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { claimEffort, finishEffort, setEffort } from './lib/effort.mjs';
import { loadTask } from './lib/config.mjs';
import {
  clearStartupPrompts,
  preserveSession,
  refreshPreservedTranscript,
  switchTask,
  tmux,
} from './lib/tasks.mjs';
import { supervisorRecord } from './lib/presence.mjs';
import { providerAt, stopProvider } from './lib/provider-processes.mjs';
import { resolveSession } from './lib/sessions.mjs';
import { supervisorCommand } from './supervisor.mjs';

const [id, token, hookPidText] = process.argv.slice(2);

function wait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForHook(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try { process.kill(pid, 0); } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    wait(50);
  }
  throw new Error(`stop hook ${pid} did not exit`);
}

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
  try {
    execFileSync('command', ['-v', request.agent], { stdio: 'ignore', shell: '/bin/bash' });
  } catch {
    throw new Error(`${request.agent} is not installed`);
  }
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
  waitForHook(Number(hookPidText));
  // The provider receives the hook result after the hook process exits. Give it
  // one brief flush window before snapshotting and stopping the exact session.
  wait(200);
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
