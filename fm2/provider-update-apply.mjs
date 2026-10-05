#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { prepareProviderUpdate, executeProviderUpdate } from './lib/provider-update.mjs';
import {
  claimProviderUpdate,
  finishProviderUpdate,
  setProviderUpdatePhase,
} from './lib/provider-update-state.mjs';
import { tmux } from './lib/tasks.mjs';
import { reportProviderUpdate } from './lib/provider-update-report.mjs';

const [provider, token, hookPidText] = process.argv.slice(2);
let request = null;

function wait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForHook(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    wait(50);
  }
  throw new Error(`stop hook ${pid} did not exit`);
}

function output(message, { error = false } = {}) {
  const line = `${new Date().toISOString()} ${message}\n`;
  (error ? process.stderr : process.stdout).write(line);
  if (request?.log) {
    try { appendFileSync(request.log, line, { mode: 0o600 }); } catch { /* the maintenance pane still shows it */ }
  }
}

function keepFailureVisible() {
  if (!process.env.TMUX_PANE) return;
  try { tmux(['set-window-option', '-t', process.env.TMUX_PANE, 'remain-on-exit', 'on']); } catch {}
}

function closeSuccessfulWindow() {
  if (!process.env.TMUX_PANE) return;
  try { tmux(['set-window-option', '-t', process.env.TMUX_PANE, 'remain-on-exit', 'off']); } catch {}
}

async function main() {
  keepFailureVisible();
  waitForHook(Number(hookPidText));
  // Let the provider consume the successful Stop-hook response and flush its
  // final transcript event before the coordinator takes the snapshots.
  wait(250);
  request = claimProviderUpdate(provider, token);
  if (!request) return;
  output(`preparing ${provider} update; no managed session has been stopped yet`);
  try {
    const manifest = prepareProviderUpdate(request);
    output(`stopping ${manifest.entries.length} managed ${provider} session(s)`);
    const result = executeProviderUpdate(manifest, {
      phase: (status, details = {}) => setProviderUpdatePhase(provider, token, status, details),
    });
    finishProviderUpdate(provider, token, {
      result: {
        before_version: result.before_version,
        after_version: result.after_version,
        session_count: result.entries.length,
        manifest: result.path,
      },
    });
    output(
      `${provider} update complete (${result.before_version} -> ${result.after_version}); ` +
      `${result.entries.length} exact conversation(s) reopened`,
    );
    try { await reportProviderUpdate(request, { result }); }
    catch (error) { output(`completion notification could not be delivered: ${error.message}`, { error: true }); }
    closeSuccessfulWindow();
  } catch (error) {
    let recovery = [];
    try {
      const latest = request.manifest ? JSON.parse(readFileSync(request.manifest, 'utf8')) : null;
      recovery = latest?.recovery ?? [];
    } catch { /* the original error is the useful one */ }
    finishProviderUpdate(provider, token, { error: error.message, recovery });
    output(`${provider} update failed: ${error.message}`, { error: true });
    output(`Full recovery record: ${request.manifest}`, { error: true });
    try { await reportProviderUpdate(request, { error }); }
    catch (failure) { output(`failure notification could not be delivered: ${failure.message}`, { error: true }); }
    process.exitCode = 1;
  }
}

await main();
