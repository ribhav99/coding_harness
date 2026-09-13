// The whole notification system.
//
// One trigger: a worker stopped. A worker running autonomously does not end a
// turn until it has nothing left to do, so its Stop hook firing already means
// the thing v1 spent a watcher, a wake queue, a status vocabulary, a staleness
// timer and a wedge-escalation ladder trying to infer.
//
// The worker writes nothing and remembers nothing. Its hook reads the last
// assistant message out of the transcript Claude Code hands it, and that message
// is the report - in the worker's own words, which is what the supervisor was
// paraphrasing from status lines anyway.

import { existsSync, readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { notifyDir, dir } from './config.mjs';

// Claude Code writes the transcript as JSONL, one event per line. The last
// assistant message is the worker's final word before it stopped.
export function lastAssistantMessage(transcriptPath, { maxChars = 4000 } = {}) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  let lines;
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n');
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== 'assistant') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (text) return text.length > maxChars ? `${text.slice(0, maxChars)}\n[...truncated]` : text;
  }
  return null;
}

// A notification is a file. Files survive a crashed supervisor, arrive in order,
// and need no process to be running to receive them.
export function record({ task, text, cwd = null }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(notifyDir(), `${stamp}-${task}.json`);
  writeFileSync(file, JSON.stringify({ task, text, cwd, at: new Date().toISOString() }, null, 2));
  return file;
}

export function pending() {
  return readdirSync(notifyDir())
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const p = join(notifyDir(), f);
      try {
        return { file: p, ...JSON.parse(readFileSync(p, 'utf8')) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Read is a move, not a delete: a supervisor that crashes mid-turn has already
// consumed the notification, and losing what a worker said is worse than seeing
// it twice. The archive is where it went.
export function drain() {
  const items = pending();
  const archive = dir('notify-read');
  for (const item of items) {
    try { renameSync(item.file, join(archive, item.file.split('/').pop())); } catch { /* already gone */ }
  }
  return items;
}

// Whether this task already has a report the supervisor has not taken.
//
// A worker can end several turns in a row without saying anything new - a
// background CI waiter finishing re-invokes it, it has nothing to add, and it
// stops again. WO-337 did this six times in five minutes, each stop carrying the
// same delivered-PR summary, and each one interrupted the supervisor.
//
// The report is still worth recording every time; what is not worth repeating is
// the knock. If the supervisor has not yet read the last thing this task said, it
// already knows the task is stopping - a second tap on the shoulder tells it
// nothing it does not have. Once it reads, the queue drains and the next stop
// knocks normally.
export function hasUnread(task) {
  return pending().some((item) => item.task === task);
}

export function count() {
  return readdirSync(notifyDir()).filter((f) => f.endsWith('.json')).length;
}

// Whether the supervisor has any report at all that it has not taken.
//
// This, not hasUnread, is what the knock asks - because reading is queue-wide
// and knocking should match it. `fm read` drains everything waiting, so the
// first knock already buys a look at every report behind it, whatever task it
// came from.
//
// Six sessions once stopped inside the same half-minute. Each hook found no
// unread report for its own task, so each knocked, and six lines went into the
// supervisor's pane. The first `fm read` handed over all six reports at once -
// correctly - and the remaining five lines stayed queued as prompts, each
// costing the supervisor a turn to discover there was nothing behind it. Five
// turns spent being told something it had already been told.
//
// Scoping to the queue keeps the guarantee that mattered - a stop is never
// silently dropped, because every report is still recorded - and gives up only
// the duplicate tap on the shoulder.
export function anyUnread() {
  return count() > 0;
}
