// Codex's native status line exposes the percentage left in account limits, but
// not their reset countdown. Every Codex transcript already records both values
// in token_count events, so fm adds the missing countdown to tmux's existing
// session status bar. Quotas are account-wide but may differ by model family,
// so fm aggregates the freshest recent snapshot for each reported limit.

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { home } from './config.mjs';
import { normalizeAgent } from './sessions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'quota-status.mjs');
const MAX_TRANSCRIPT_TAIL = 16 * 1024 * 1024;
const TRANSCRIPT_LOOKBACK_MS = 32 * 24 * 60 * 60 * 1000;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function sessionRecords(panel, fm2Home) {
  const root = join(fm2Home, 'sessions');
  if (!existsSync(root)) return [];
  const records = [];
  for (const task of readdirSync(root)) {
    const record = readJson(join(root, task, 'codex.json'));
    if (record?.panel !== panel || !record.transcript || !existsSync(record.transcript)) continue;
    if (record.task !== `controller:${panel}`) {
      const live = readJson(join(fm2Home, 'tasks', `${record.task}.json`));
      if (!live || live.panel !== panel || live.agent !== 'codex') continue;
      if (live.sessions?.codex?.id && live.sessions.codex.id !== record.id) continue;
    }
    records.push(record);
  }
  return records;
}

// Quota is account-wide, not panel-wide. A Codex task in the app (or a
// subagent) can spend it while every fm pane is idle, so panel sidecars alone
// can remain stale indefinitely. Look at the bounded set of rollout files that
// were active recently and merge their snapshots with the panel's. The panel
// records remain the durable fallback; this scan only supplies fresher facts.
function recentCodexTranscripts(codexHome, nowMs) {
  const cutoff = nowMs - TRANSCRIPT_LOOKBACK_MS;
  const found = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        if (statSync(path).mtimeMs >= cutoff) found.push(path);
      } catch { /* a rollout can move while an archive is completing */ }
    }
  };
  visit(join(codexHome, 'sessions'));
  visit(join(codexHome, 'archived_sessions'));
  return found;
}

function panelHasCodexSession(panel, fm2Home) {
  const supervisor = readJson(join(
    fm2Home,
    'panels',
    encodeURIComponent(panel),
    'supervisor-pane.json',
  ));
  if (supervisor?.panel === panel && supervisor.agent === 'codex') return true;

  const tasks = join(fm2Home, 'tasks');
  if (!existsSync(tasks)) return false;
  return readdirSync(tasks).some((file) => {
    if (!file.endsWith('.json')) return false;
    const task = readJson(join(tasks, file));
    return task?.panel === panel && task.agent === 'codex';
  });
}

function latestRateLimitSnapshot(transcript) {
  if (!transcript || !existsSync(transcript)) return null;
  let handle;
  try {
    handle = openSync(transcript, 'r');
    const stat = fstatSync(handle);
    const size = stat.size;
    let bytes = Math.min(size, 64 * 1024);
    while (bytes > 0) {
      const start = size - bytes;
      const buffer = Buffer.allocUnsafe(bytes);
      const read = readSync(handle, buffer, 0, bytes, start);
      const lines = buffer.subarray(0, read).toString('utf8').split('\n');
      if (start > 0) lines.shift(); // the first entry may begin before this slice
      for (let at = lines.length - 1; at >= 0; at -= 1) {
        const line = lines[at];
        if (!line.includes('"rate_limits"')) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'event_msg' && event.payload?.type === 'token_count'
            && event.payload.rate_limits) {
            return {
              at: Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : stat.mtimeMs,
              rateLimits: event.payload.rate_limits,
            };
          }
        } catch { /* a concurrently-written final line is safe to skip */ }
      }
      if (start === 0 || bytes >= MAX_TRANSCRIPT_TAIL) break;
      bytes = Math.min(size, bytes * 2, MAX_TRANSCRIPT_TAIL);
    }
  } catch { return null; } finally {
    if (handle !== undefined) closeSync(handle);
  }
  return null;
}

export function latestRateLimits(transcript) {
  return latestRateLimitSnapshot(transcript)?.rateLimits ?? null;
}

function windowName(minutes) {
  if (minutes === 60) return 'hourly';
  if (minutes === 300) return '5h';
  if (minutes === 1440) return 'daily';
  if (minutes === 10080) return 'weekly';
  if (minutes === 43200) return 'monthly';
  if (Number.isFinite(minutes) && minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h`;
  return Number.isFinite(minutes) && minutes > 0 ? `${minutes}m` : 'usage';
}

function countdown(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'now';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;
    return `${days}d ${hours}h ${rest}m`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours}h ${rest}m`;
  }
  return `${minutes}m`;
}

export function formatQuotaStatus(rateLimits, { now = Math.floor(Date.now() / 1000) } = {}) {
  const windows = [rateLimits?.primary, rateLimits?.secondary, rateLimits?.individual_limit]
    .filter((window, index, all) => window && Number.isFinite(window.used_percent)
      && Number.isFinite(window.window_minutes) && Number.isFinite(window.resets_at)
      && window.resets_at > now
      && all.findIndex((candidate) => candidate?.window_minutes === window.window_minutes) === index)
    .sort((left, right) => left.window_minutes - right.window_minutes);
  return windows.map((window) => {
    const used = Math.max(0, Math.min(100, Math.round(window.used_percent)));
    return `${windowName(window.window_minutes)} ${used}% used · resets in ${countdown(window.resets_at - now)}`;
  }).join(' | ');
}

function displayLimitName(rateLimits) {
  if (!rateLimits?.limit_name) return 'Codex';
  return rateLimits.limit_name
    .replace(/^GPT-/, 'GPT ')
    .replace(/-Codex-/, ' ')
    .replaceAll('-', ' ');
}

export function quotaStatusForPanel(panel, {
  fm2Home = home(),
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
  now,
} = {}) {
  if (typeof panel !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(panel)) return '';
  const newest = new Map();
  const panelTranscripts = sessionRecords(panel, fm2Home).map((record) => record.transcript);
  if (!panelTranscripts.length) return '';
  const transcripts = new Set([
    ...panelTranscripts,
    ...recentCodexTranscripts(codexHome, Number.isFinite(now) ? now * 1000 : Date.now()),
  ]);
  for (const transcript of transcripts) {
    const snapshot = latestRateLimitSnapshot(transcript);
    if (!snapshot) continue;
    const key = snapshot.rateLimits.limit_id || snapshot.rateLimits.limit_name || 'codex';
    const previous = newest.get(key);
    if (!previous || snapshot.at >= previous.at) newest.set(key, snapshot);
  }
  const groups = [...newest.values()]
    .map(({ rateLimits }) => ({ rateLimits, text: formatQuotaStatus(rateLimits, { now }) }))
    .filter(({ text }) => text)
    .sort((left, right) => {
      const leftDefault = left.rateLimits.limit_id === 'codex' || !left.rateLimits.limit_name ? 1 : 0;
      const rightDefault = right.rateLimits.limit_id === 'codex' || !right.rateLimits.limit_name ? 1 : 0;
      return rightDefault - leftDefault
        || displayLimitName(left.rateLimits).localeCompare(displayLimitName(right.rateLimits));
    });
  if (groups.length === 1) {
    const [{ rateLimits, text }] = groups;
    return rateLimits.limit_id === 'codex' || !rateLimits.limit_name
      ? text
      : `${displayLimitName(rateLimits)} ${text}`;
  }
  return groups.map(({ rateLimits, text }) => `${displayLimitName(rateLimits)} ${text}`).join(' || ');
}

export function codexStatusRight(panel, {
  base = '#[fg=colour245]%H:%M ',
  fm2Home = home(),
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
  node = process.execPath,
  script = SCRIPT,
} = {}) {
  const quota = `#(${shellQuote(node)} ${shellQuote(script)} ${shellQuote(panel)} ${shellQuote(fm2Home)} ${shellQuote(codexHome)})`;
  return `#[fg=colour216]${quota} #[default]${base}`;
}

export function configurePanelQuotaStatus(panel, agent, {
  fm2Home = home(),
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
  run = execFileSync,
} = {}) {
  if (typeof panel !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(panel)) return false;
  let provider;
  try { provider = normalizeAgent(agent); } catch { return false; }
  const read = (args) => String(run('tmux', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
  }) || '').replace(/\r?\n$/, '');
  const set = (args) => run('tmux', ['set-option', ...args], { stdio: 'ignore', timeout: 2000 });
  try {
    if (provider === 'codex') {
      let base = read(['show-option', '-qv', '-t', panel, '@fm-quota-status-base']);
      let baseLength = read(['show-option', '-qv', '-t', panel, '@fm-quota-status-base-length']);
      const active = read(['show-option', '-qv', '-t', panel, '@fm-quota-status-active']) === '1';
      // An early, unmarked implementation could be captured as the preserved
      // base by a later upgrade, producing quota | quota | clock. Repair that
      // metadata from the inherited values as well as handling a fresh install.
      const legacyBase = base.includes('quota-status.mjs');
      if (!active || legacyBase) {
        const localBaseSet = Boolean(read(['show-option', '-q', '-t', panel, 'status-right']));
        const localLengthSet = Boolean(read(['show-option', '-q', '-t', panel, 'status-right-length']));
        const localBase = read(['show-option', '-qv', '-t', panel, 'status-right']);
        const localLength = read(['show-option', '-qv', '-t', panel, 'status-right-length']);
        // Upgrade the unmarked first implementation without nesting its quota
        // command forever. That version only prepended fm to the inherited bar.
        const priorFmOverride = legacyBase || localBase.includes('quota-status.mjs');
        const preserveLocalBase = !priorFmOverride && localBaseSet;
        const preserveLocalLength = !priorFmOverride && localLengthSet;
        base = preserveLocalBase ? localBase : read(['show-option', '-gv', 'status-right']);
        baseLength = preserveLocalLength ? localLength : read(['show-option', '-gv', 'status-right-length']);
        set(['-t', panel, '@fm-quota-status-base', base]);
        set(['-t', panel, '@fm-quota-status-base-length', baseLength]);
        set(['-t', panel, '@fm-quota-status-base-local', preserveLocalBase ? '1' : '0']);
        set(['-t', panel, '@fm-quota-status-length-local', preserveLocalLength ? '1' : '0']);
        set(['-t', panel, '@fm-quota-status-active', '1']);
      }
      set(['-t', panel, 'status-right', codexStatusRight(panel, { base, fm2Home, codexHome })]);
      set(['-t', panel, 'status-right-length', String(Math.max(160, Number(baseLength) || 0))]);
    } else {
      const active = read(['show-option', '-qv', '-t', panel, '@fm-quota-status-active']) === '1';
      if (!active) return true;
      // A Claude controller can coexist with explicitly Codex workers. Its
      // prompt hook must not remove the shared bar from under those panes.
      if (panelHasCodexSession(panel, fm2Home)) return true;
      const base = read(['show-option', '-qv', '-t', panel, '@fm-quota-status-base']);
      const baseLength = read(['show-option', '-qv', '-t', panel, '@fm-quota-status-base-length']);
      const baseWasLocal = read(['show-option', '-qv', '-t', panel, '@fm-quota-status-base-local']) === '1';
      const lengthWasLocal = read(['show-option', '-qv', '-t', panel, '@fm-quota-status-length-local']) === '1';
      set(baseWasLocal ? ['-t', panel, 'status-right', base] : ['-u', '-t', panel, 'status-right']);
      set(lengthWasLocal
        ? ['-t', panel, 'status-right-length', baseLength]
        : ['-u', '-t', panel, 'status-right-length']);
      for (const option of [
        '@fm-quota-status-base',
        '@fm-quota-status-base-length',
        '@fm-quota-status-base-local',
        '@fm-quota-status-length-local',
        '@fm-quota-status-active',
      ]) set(['-u', '-t', panel, option]);
    }
    return true;
  } catch {
    // Cosmetic status must never block provider startup or report delivery.
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(quotaStatusForPanel(process.argv[2], {
    fm2Home: process.argv[3] || home(),
    codexHome: process.argv[4] || process.env.CODEX_HOME || join(homedir(), '.codex'),
  }));
}
