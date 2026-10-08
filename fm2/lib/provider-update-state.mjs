import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dir, home } from './config.mjs';
import { normalizeAgent } from './sessions.mjs';
import { shellQuote } from './shell.mjs';
import { writeJson, writeJsonAtomic } from './json-file.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = join(dirname(HERE), 'provider-update-apply.mjs');
const ACTIVE = new Set(['scheduled', 'preparing', 'stopping', 'updating', 'restarting']);

function stateFile() { return join(dir('provider-updates'), 'state.json'); }
function lockDir() { return join(dir('provider-updates'), 'active.lock'); }

function readState() {
  // Include directory creation in the guard, without treating parsed null as
  // an absent record. Both distinctions are part of the existing stop contract.
  try { return JSON.parse(readFileSync(stateFile(), 'utf8')); }
  catch { return { version: 1, current: null, last: null }; }
}

function writeState(state) {
  return writeJsonAtomic(stateFile(), state);
}

function validController(id) {
  return typeof id === 'string' && /^controller:[A-Za-z0-9_.-]+$/.test(id);
}

export function requestProviderUpdate(provider, {
  requestedBy,
  requesterAgent,
  panel,
} = {}) {
  const agent = normalizeAgent(provider);
  const requester = normalizeAgent(requesterAgent);
  if (!validController(requestedBy)) throw new Error('provider updates can only be requested from an fm control session');
  if (typeof panel !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(panel)) {
    throw new Error('a provider update needs the requesting controller panel');
  }
  const state = readState();
  if (state.current) {
    throw new Error(
      `${state.current.provider} update ${state.current.status} since ${state.current.requested_at}; ` +
      `see ${state.current.log}`,
    );
  }
  const lock = lockDir();
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`another provider update owns ${lock}`);
    throw error;
  }
  try {
    const token = randomUUID();
    const operationDir = dir('provider-updates', `${agent}-${Date.now()}-${token.slice(0, 8)}`);
    const current = {
      token,
      provider: agent,
      requested_by: requestedBy,
      requester_agent: requester,
      panel,
      status: 'requested',
      requested_at: new Date().toISOString(),
      manifest: join(operationDir, 'manifest.json'),
      log: join(operationDir, 'update.log'),
      lock,
      maintenance_pane: null,
    };
    writeJson(current.manifest, { version: 1, ...current });
    writeState({ ...state, current });
    return current;
  } catch (error) {
    rmSync(lock, { recursive: true, force: true });
    throw error;
  }
}

export function providerUpdateInProgress(provider) {
  const current = readState().current;
  return Boolean(current && current.provider === normalizeAgent(provider) && ACTIVE.has(current.status));
}

export function providerUpdateOwnsStop(provider, task) {
  const current = readState().current;
  return Boolean(current
    && current.provider === normalizeAgent(provider)
    && current.status === 'stopping'
    && current.stopping_task === task);
}

export function schedulePendingProviderUpdate(requestedBy, requesterAgent, {
  hookPid = process.pid,
  run = execFileSync,
} = {}) {
  const state = readState();
  const current = state.current;
  if (!current || current.status !== 'requested' || current.requested_by !== requestedBy
      || current.requester_agent !== normalizeAgent(requesterAgent)) return null;
  const command =
    `FM2_HOME=${shellQuote(home())} ${shellQuote(process.execPath)} ${shellQuote(APPLY)} ` +
    `${shellQuote(current.provider)} ${shellQuote(current.token)} ${shellQuote(hookPid)}`;
  const scheduled = { ...current, status: 'scheduled', scheduled_at: new Date().toISOString() };
  writeState({ ...state, current: scheduled });
  try {
    const output = run('tmux', [
      'new-window', '-d', '-P', '-F', '#{pane_id}', '-t', `${current.panel}:`,
      '-n', `update-${current.provider}`, '-c', dirname(HERE), command,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
    const maintenancePane = String(output ?? '').trim() || null;
    const latest = readState();
    const withPane = { ...latest.current, maintenance_pane: maintenancePane };
    writeState({ ...latest, current: withPane });
    return withPane;
  } catch (error) {
    writeState({ ...state, current });
    throw error;
  }
}

export function claimProviderUpdate(provider, token) {
  const state = readState();
  const current = state.current;
  if (!current || current.provider !== normalizeAgent(provider) || current.token !== token
      || current.status !== 'scheduled') return null;
  const claimed = { ...current, status: 'preparing', preparing_at: new Date().toISOString() };
  writeState({ ...state, current: claimed });
  return claimed;
}

export function setProviderUpdatePhase(provider, token, status, details = {}) {
  if (!ACTIVE.has(status)) throw new Error(`invalid provider-update phase ${status}`);
  const state = readState();
  const current = state.current;
  if (!current || current.provider !== normalizeAgent(provider) || current.token !== token) return null;
  const updated = { ...current, ...details, status, [`${status}_at`]: new Date().toISOString() };
  writeState({ ...state, current: updated });
  return updated;
}

export function finishProviderUpdate(provider, token, { error = null, recovery = [], result = null } = {}) {
  const state = readState();
  const current = state.current;
  if (!current || current.provider !== normalizeAgent(provider) || current.token !== token) return false;
  const last = {
    ...current,
    status: error ? (recovery.length ? 'recovery-required' : 'failed') : 'complete',
    completed_at: new Date().toISOString(),
    ...(error ? { error: String(error), recovery } : { result }),
  };
  writeState({ ...state, current: null, last });
  if (current.lock) rmSync(current.lock, { recursive: true, force: true });
  return last;
}
