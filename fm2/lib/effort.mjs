import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dir, home } from './config.mjs';
import { normalizeAgent } from './sessions.mjs';

export const DEFAULT_EFFORT = 'high';
export const EFFORT_LEVELS = Object.freeze({
  claude: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  codex: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
});

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = join(dirname(HERE), 'effort-apply.mjs');

function safeId(id) {
  if (typeof id !== 'string' || !/^(?:controller:)?[A-Za-z0-9_.-]+$/.test(id) || ['.', '..'].includes(id)) {
    throw new Error('invalid effort-session identity');
  }
  return encodeURIComponent(id);
}

function stateFile(id) { return join(dir('efforts'), `${safeId(id)}.json`); }

function readState(id) {
  try { return JSON.parse(readFileSync(stateFile(id), 'utf8')); } catch { return { version: 1, current: {} }; }
}

function writeState(id, state) {
  const path = stateFile(id);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
  return state;
}

export function normalizeEffort(agent, effort) {
  const provider = normalizeAgent(agent);
  const value = String(effort ?? '').toLowerCase();
  if (!EFFORT_LEVELS[provider].includes(value)) {
    throw new Error(`invalid ${provider} effort "${effort}" (use ${EFFORT_LEVELS[provider].join(', ')})`);
  }
  return value;
}

export function effortFor(id, agent) {
  const provider = normalizeAgent(agent);
  const stored = readState(id).current?.[provider];
  return stored ? normalizeEffort(provider, stored) : DEFAULT_EFFORT;
}

export function setEffort(id, agent, effort) {
  const provider = normalizeAgent(agent);
  const value = normalizeEffort(provider, effort);
  const state = readState(id);
  return writeState(id, { ...state, current: { ...(state.current ?? {}), [provider]: value } });
}

export function requestEffort(id, agent, effort, { current = null } = {}) {
  const provider = normalizeAgent(agent);
  const value = normalizeEffort(provider, effort);
  const state = readState(id);
  const active = current ? normalizeEffort(provider, current) : (state.current?.[provider] ?? DEFAULT_EFFORT);
  if (value === active) {
    if (state.pending) throw new Error(`an effort change to ${state.pending.effort} is already pending`);
    return { changed: false, effort: value };
  }
  if (state.pending) throw new Error(`an effort change to ${state.pending.effort} is already pending`);
  const pending = {
    token: randomUUID(), agent: provider, from: active, effort: value,
    status: 'requested', requested_at: new Date().toISOString(),
  };
  writeState(id, {
    ...state,
    current: { ...(state.current ?? {}), [provider]: active },
    pending,
  });
  return { changed: true, ...pending };
}

export function pendingEffort(id, agent = null) {
  const pending = readState(id).pending ?? null;
  if (!pending || (agent && pending.agent !== normalizeAgent(agent))) return null;
  return pending;
}

function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

export function schedulePendingEffort(id, agent, { hookPid = process.pid, run = execFileSync } = {}) {
  const provider = normalizeAgent(agent);
  const state = readState(id);
  const pending = state.pending;
  if (!pending || pending.agent !== provider || pending.status !== 'requested') return null;
  const scheduled = { ...pending, status: 'scheduled', scheduled_at: new Date().toISOString() };
  writeState(id, { ...state, pending: scheduled });
  const log = join(dir('logs'), 'effort.log');
  const command =
    `FM2_HOME=${shellQuote(home())} ${shellQuote(process.execPath)} ${shellQuote(APPLY)} ` +
    `${shellQuote(id)} ${shellQuote(pending.token)} ${shellQuote(hookPid)} >> ${shellQuote(log)} 2>&1`;
  try {
    run('tmux', ['run-shell', '-b', command], { stdio: 'ignore', timeout: 10_000 });
  } catch (error) {
    writeState(id, { ...state, pending });
    throw error;
  }
  return scheduled;
}

export function claimEffort(id, token) {
  const state = readState(id);
  if (!state.pending || state.pending.token !== token || state.pending.status !== 'scheduled') return null;
  const pending = { ...state.pending, status: 'applying', applying_at: new Date().toISOString() };
  writeState(id, { ...state, pending });
  return pending;
}

export function finishEffort(id, token, { error = null } = {}) {
  const state = readState(id);
  if (!state.pending || state.pending.token !== token) return false;
  const request = state.pending;
  const next = { ...state, pending: null };
  if (error) next.last_failure = { ...request, error: String(error), at: new Date().toISOString() };
  else {
    next.current = { ...(state.current ?? {}), [request.agent]: request.effort };
    next.last_change = { ...request, completed_at: new Date().toISOString() };
    delete next.last_failure;
  }
  writeState(id, next);
  return true;
}

export function effortStatePath(id) {
  const path = stateFile(id);
  return existsSync(path) ? path : null;
}
