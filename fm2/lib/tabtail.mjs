// Optional completion contract. Never infer finality from reports or output.
import { fstatSync, readFileSync, writeSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { home, loadTask } from './config.mjs';
import { shellQuote } from './shell.mjs';

const BRIDGE = join(dirname(dirname(fileURLToPath(import.meta.url))), 'tabtail.py');
export const tabtailEnabled = (agent = 'codex') => agent === 'codex' && process.env.FM2_TABTAIL === '1';
export const tabtailPython = () => join(process.env.FM2_TABTAIL_RELAY || join(homedir(), '.local/share/relay'), 'venv/bin/python');
export function tabtailStop(command, agent = 'codex') {
  return tabtailEnabled(agent) ? `${shellQuote(tabtailPython())} ${shellQuote(BRIDGE)} stop -- /bin/sh -c ${shellQuote(command)}` : command;
}
export function tabtailLaunch(command, agent = 'codex') {
  return tabtailEnabled(agent) ? `${shellQuote(tabtailPython())} ${shellQuote(BRIDGE)} launch -- ${command}` : command;
}
export function tabtailEnv(agent = 'codex') {
  return tabtailEnabled(agent) ? { FM2_TABTAIL: '1',
    ...(process.env.FM2_TABTAIL_RELAY ? { FM2_TABTAIL_RELAY: process.env.FM2_TABTAIL_RELAY } : {}),
  } : {};
}

// Only the released dispatcher provides the private *regular file* descriptor.
// Reject pipes/ttys/stdin/out/err: an optional synchronous write must never wait
// for a reader or corrupt terminal input. One write, no retry, no fd ownership.
export function stopOutcome(outcome) {
  if (!tabtailEnabled() || !['completed', 'handoff'].includes(outcome)) return;
  const raw = process.env.TABTAIL_STOP_OUTCOME_FD || '';
  if (!/^[0-9]+$/.test(raw)) return;
  const fd = Number(raw);
  if (!Number.isSafeInteger(fd) || fd < 3) return;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.size !== 0) return;
    writeSync(fd, JSON.stringify({ version: 1, outcome }));
  } catch { /* optional reporting never changes Stop control */ }
}

function handoffFile(task) { return join(home(), 'tabtail-handoffs', `${encodeURIComponent(task)}.json`); }

// A switch can be requested outside the tracked provider's environment. Its
// hook-recorded run, rather than the caller's opt-in flag, selects this guard.
export function beginTabtailHandoff(task, source) {
  if (!source?.tabtail_run) return () => {};
  const path = handoffFile(task), token = randomUUID();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ run: source.tabtail_run, token }), { mode: 0o600, flag: 'wx' });
  return () => { if (state(path).token === token) rmSync(path); };
}

function state(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unknown lifecycle state');
    return value;
  }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

export function completedStop(payload, { task, agent, panel, accepted = true } = {}) {
  try {
    if (!accepted || process.env.FM2_TABTAIL_FINAL !== '1' ||
        process.env.FM2_TABTAIL_BOOTSTRAPPED !== '1' || !task ||
        payload?.hook_event_name !== 'Stop' || typeof payload.session_id !== 'string' || !payload.session_id ||
        !['codex', 'claude'].includes(agent) || process.env.TABTAIL_AGENT_PROVIDER !== agent ||
        !process.env.TABTAIL_AGENT_PID || !process.env.TABTAIL_RUN) return;
    // Codex Stop identifies the current root turn. The released dispatcher
    // pairs this accepted candidate with native agent-turn-complete; goals and
    // unrelated background work are not part of that turn-end contract.
    if (agent === 'codex' && (process.env.TABTAIL_CODEX_EMBEDDED !== '1' ||
        typeof payload.turn_id !== 'string' || !payload.turn_id)) return;
    // Claude's released accepted-stop contract still requires real registries.
    if (agent === 'claude' && (!Array.isArray(payload.background_tasks) || payload.background_tasks.length ||
        !Array.isArray(payload.session_crons) || payload.session_crons.length)) return;
    if (['agent_id', 'agent_type', 'agent_transcript_path', 'error', 'error_details', 'interrupted',
      'cancelled', 'attention', 'permission_request'].some(key => Object.hasOwn(payload, key))) return;
    if (payload.decision === 'block' || payload.continue === false) return;
    const known = loadTask(task);
    if (!task.startsWith('controller:') && (!known || known.quiet || (known.agent || 'claude') !== agent)) return;
    const handoff = state(handoffFile(task));
    if (Object.keys(handoff).length && (typeof handoff.run !== 'string' || typeof handoff.token !== 'string')) return;
    if (handoff.run === process.env.TABTAIL_RUN) {
      stopOutcome('handoff'); return;
    }
    if (panel && existsSync(join(home(), 'panel-locks', panel.replace(/[^A-Za-z0-9._-]/g, '-')))) {
      stopOutcome('handoff'); return;
    }
    const effort = state(join(home(), 'efforts', `${encodeURIComponent(task)}.json`));
    if (Object.hasOwn(effort, 'pending') && effort.pending !== null) {
      if (!effort.pending || typeof effort.pending !== 'object' || Array.isArray(effort.pending)) return;
      stopOutcome('handoff'); return;
    }
    const update = state(join(home(), 'provider-updates', 'state.json')).current;
    if (update != null && (!update || typeof update !== 'object' ||
        !['codex', 'claude'].includes(update.provider) || typeof update.status !== 'string')) return;
    if (update && (update.provider === agent || update.requested_by === task)) {
      stopOutcome('handoff'); return;
    }
    stopOutcome('completed');
  } catch { /* unknown lifecycle state is ineligible, even when normal Stop allows it */ }
}
