// Provider session identity. A task may move between Claude Code and Codex,
// but it must never move by guessing that the newest transcript is the right
// one. Hooks record exact ids for new sessions; transcript discovery exists
// only to adopt older sessions, and refuses whenever metadata is ambiguous.

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { dir, loadTask, saveTask } from './config.mjs';

const AGENTS = new Set(['claude', 'codex']);

export function normalizeAgent(agent) {
  const value = String(agent || 'claude').toLowerCase();
  if (!AGENTS.has(value)) throw new Error(`unknown agent "${agent}" (use claude or codex)`);
  return value;
}

export function agentOf(task) {
  return normalizeAgent(task?.agent ?? 'claude');
}

export function controllerId(panel) {
  if (typeof panel !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(panel)) {
    throw new Error('a controller needs an explicit panel name');
  }
  return `controller:${panel}`;
}

function sessionRecordPath(task, agent) {
  if (typeof task !== 'string' || !/^(?:controller:)?[A-Za-z0-9_.-]+$/.test(task) || ['.', '..'].includes(task)) {
    throw new Error('invalid provider-session task identity');
  }
  return join(dir('sessions', task), `${normalizeAgent(agent)}.json`);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function recordedSession(task, agent) {
  const known = task?.sessions?.[normalizeAgent(agent)] ?? null;
  const sidecar = task?.id ? readJson(sessionRecordPath(task.id, agent)) : null;
  // The sidecar is written by SessionStart, which can fire just before the task
  // record itself is saved. Prefer it when it is newer, without losing a record
  // that already made it into the task.
  if (!known) return sidecar;
  if (!sidecar) return known;
  return String(sidecar.recorded_at || '') > String(known.recorded_at || '') ? sidecar : known;
}

export function rememberSession({ task, agent, sessionId, transcriptPath = null, cwd = null, panel = null, pane = null, source = null }) {
  if (!task || typeof sessionId !== 'string' || !sessionId.trim()) return null;
  const provider = normalizeAgent(agent);
  const recordPath = sessionRecordPath(task, provider);
  const previous = readJson(recordPath);
  const same = previous?.id === sessionId ? previous : null;
  const entry = {
    id: sessionId,
    task,
    agent: provider,
    transcript: transcriptPath ? resolve(transcriptPath) : same?.transcript ?? null,
    cwd: cwd ? resolve(cwd) : same?.cwd ?? null,
    panel: panel ?? same?.panel ?? null,
    pane: pane ?? same?.pane ?? null,
    source: source ?? same?.source ?? null,
    recorded_at: new Date().toISOString(),
  };
  const temporary = `${recordPath}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(entry, null, 2));
  renameSync(temporary, recordPath);

  if (task.startsWith('controller:')) return entry;
  const known = loadTask(task);
  if (known) {
    saveTask({
      ...known,
      ...(pane && agentOf(known) === provider ? { pane } : {}),
      sessions: { ...(known.sessions ?? {}), [provider]: entry },
    });
  }
  return entry;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && ['text', 'input_text'].includes(part.type) && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function parseClaudeTranscript(path) {
  const events = readJsonLines(path);
  if (events.length === 0) return null;
  const sessionIds = new Set();
  const cwds = new Set();
  const userTexts = [];
  for (const event of events) {
    if (event.sessionId) sessionIds.add(String(event.sessionId));
    if (event.cwd) cwds.add(resolve(event.cwd));
    if (event.type === 'user') {
      const text = textFromContent(event.message?.content);
      if (text) userTexts.push(text);
    }
  }
  const filenameId = basename(path, '.jsonl');
  if (sessionIds.size > 1) return null;
  return {
    id: [...sessionIds][0] ?? filenameId,
    transcript: resolve(path),
    cwd: cwds.size === 1 ? [...cwds][0] : null,
    metadata_conflict: cwds.size > 1,
    userTexts,
  };
}

function parseCodexTranscript(path) {
  const events = readJsonLines(path);
  if (events.length === 0) return null;
  const sessionIds = new Set();
  const cwds = new Set();
  const userTexts = [];
  for (const event of events) {
    if (event.type === 'session_meta') {
      if (event.payload?.id) sessionIds.add(String(event.payload.id));
      if (event.payload?.cwd) cwds.add(resolve(event.payload.cwd));
    }
    if (event.type === 'response_item' && event.payload?.role === 'user') {
      const text = textFromContent(event.payload.content);
      if (text) userTexts.push(text);
    }
  }
  if (sessionIds.size > 1) return null;
  const filenameId = basename(path, '.jsonl').match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i)?.[1] ?? null;
  return {
    id: [...sessionIds][0] ?? filenameId,
    transcript: resolve(path),
    cwd: cwds.size === 1 ? [...cwds][0] : null,
    metadata_conflict: cwds.size > 1,
    userTexts,
  };
}

function readJsonLines(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function walkJsonl(root, out = []) {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkJsonl(path, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(path);
  }
  return out;
}

export function discoverSessions(agent, cwd, {
  claudeRoot = join(homedir(), '.claude', 'projects'),
  codexRoot = join(homedir(), '.codex', 'sessions'),
} = {}) {
  const provider = normalizeAgent(agent);
  const wanted = resolve(cwd);
  let files;
  if (provider === 'claude') {
    const folder = join(claudeRoot, wanted.replace(/[^A-Za-z0-9]/g, '-'));
    files = existsSync(folder)
      ? readdirSync(folder).filter((name) => name.endsWith('.jsonl')).map((name) => join(folder, name))
      : [];
  } else {
    files = walkJsonl(codexRoot);
  }

  const parse = provider === 'claude' ? parseClaudeTranscript : parseCodexTranscript;
  return files
    .map(parse)
    .filter((entry) => entry && entry.id && !entry.metadata_conflict && entry.cwd === wanted);
}

function checkedRecorded(task, agent) {
  const entry = recordedSession(task, agent);
  if (!entry) return null;
  checkRecordedIdentity(task, normalizeAgent(agent), entry);
  if (entry.cwd && resolve(entry.cwd) !== resolve(task.worktree)) {
    throw new Error(
      `recorded ${agent} session ${entry.id} belongs to ${entry.cwd}, not ${task.worktree}`,
    );
  }
  if (!entry.transcript || !existsSync(entry.transcript)) {
    throw new Error(`recorded ${agent} session ${entry.id} has no readable full transcript`);
  }
  const parse = normalizeAgent(agent) === 'claude' ? parseClaudeTranscript : parseCodexTranscript;
  const fromFile = parse(entry.transcript);
  if (!fromFile || fromFile.metadata_conflict || !fromFile.id) {
    throw new Error(`recorded ${agent} session ${entry.id} has invalid or conflicting transcript metadata`);
  }
  if (fromFile?.cwd && fromFile.cwd !== resolve(task.worktree)) {
    throw new Error(
      `recorded ${agent} transcript belongs to ${fromFile.cwd}, not ${task.worktree}`,
    );
  }
  if (fromFile?.id && fromFile.id !== entry.id) {
    throw new Error(`recorded ${agent} session id ${entry.id} does not match its transcript (${fromFile.id})`);
  }
  return { ...entry, transcript: resolve(entry.transcript), cwd: resolve(task.worktree) };
}

function checkRecordedIdentity(task, provider, entry) {
  if (entry && (!entry.id || (entry.task && entry.task !== task.id) || (entry.agent && entry.agent !== provider))) {
    throw new Error(`recorded ${provider} session has conflicting task or provider identity`);
  }
}

// Find the source conversation without relying on recency. Hook-recorded
// identity wins. Older tasks can be recovered when one transcript has the exact
// worktree metadata and opening brief; anything less precise is refused.
export function resolveSession(task, agent = agentOf(task), {
  explicit = null,
  claudeRoot,
  codexRoot,
} = {}) {
  const provider = normalizeAgent(agent);
  const rawKnown = recordedSession(task, provider);
  checkRecordedIdentity(task, provider, rawKnown);
  let known = null;
  let knownError = null;
  if (!explicit || rawKnown?.id === explicit) {
    try { known = checkedRecorded(task, provider); } catch (error) { knownError = error; }
  }
  if (known && (!explicit || known.id === explicit)) return known;

  const found = discoverSessions(provider, task.worktree, { claudeRoot, codexRoot });
  if (rawKnown && (!explicit || rawKnown.id === explicit)) {
    const same = found.filter((entry) => entry.id === rawKnown.id);
    if (same.length === 1) return same[0];
    if (same.length > 1) throw new Error(`more than one ${provider} transcript claims session ${rawKnown.id}`);
    if (knownError) throw knownError;
  }
  if (explicit) {
    const exact = found.filter((entry) => entry.id === explicit);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(`more than one ${provider} transcript claims session ${explicit}`);
    throw new Error(`no ${provider} session ${explicit} belongs to ${task.worktree}`);
  }

  let candidates = found;
  let hasBrief = false;
  if (task.brief && existsSync(task.brief)) {
    const brief = readFileSync(task.brief, 'utf8').trim();
    if (brief) {
      hasBrief = true;
      candidates = found.filter((entry) => entry.userTexts.some((text) => text.includes(brief)));
    }
  }
  if (task.id?.startsWith('controller:') && !hasBrief) {
    throw new Error(`controller "${task.id}" needs a recorded session or --session <exact-id>`);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(`no ${provider} transcript can be tied exactly to task "${task.id}" in ${task.worktree}`);
  }
  throw new Error(
    `ambiguous ${provider} history for task "${task.id}": ${candidates.map((entry) => entry.id).join(', ')}; ` +
      'name the source with --session <id>',
  );
}

// A prior target session is resumed only when hooks recorded its exact id and
// cwd. Returning null starts a new session; it never means "resume the newest
// one". A supplied transcript must still agree with that identity before launch.
export function resumableSession(task, agent) {
  const provider = normalizeAgent(agent);
  const entry = recordedSession(task, provider);
  if (!entry) return null;
  checkRecordedIdentity(task, provider, entry);
  if (entry.cwd && resolve(entry.cwd) !== resolve(task.worktree)) {
    throw new Error(
      `recorded ${provider} session ${entry.id} belongs to ${entry.cwd}, not ${task.worktree}`,
    );
  }
  if (entry.transcript) return checkedRecorded(task, provider);
  if (!entry.cwd) {
    throw new Error(`recorded ${provider} session has no verified task and working-directory identity`);
  }
  return entry;
}
