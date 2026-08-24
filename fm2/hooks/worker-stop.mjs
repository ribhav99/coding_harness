#!/usr/bin/env node
// A worker's Stop hook. Installed into every task's own settings by fm spawn.
//
// This is the entire reporting mechanism. The worker does not write a status
// file, does not learn a verb vocabulary, and cannot forget to report - stopping
// is the report, and its own last message is the content.
//
// Never blocks and never fails loudly. A worker's turn must not be held up by
// the supervisor's bookkeeping, and a broken hook must not strand a session.

import { record, lastAssistantMessage, hasUnread } from '../lib/notify.mjs';
import { knock } from '../lib/knock.mjs';
import { loadTask } from '../lib/config.mjs';

// Claude Code puts the worker's final message straight in the Stop payload as
// last_assistant_message. Verified against a real hook firing. Reading the
// transcript is kept only as a fallback for a payload that lacks it.

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

try {
  const payload = JSON.parse(raw || '{}');
  const task = process.env.FM2_TASK || 'unknown';
  // A task Ribhav is running himself. He is already in that pane reading the
  // replies as they land, so a report about it is not news - it is the same
  // words a second time, arriving as an interruption. Silence is the whole
  // feature: no notification is written and no knock is sent, so there is
  // nothing for the supervisor's own Stop hook to block on either.
  if (loadTask(task)?.quiet) process.exit(0);
  const direct = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message.trim() : '';
  const text = direct || lastAssistantMessage(payload.transcript_path);
  // Asked before recording, because recording is what would make it true.
  const alreadyWaiting = hasUnread(task);
  if (text) record({ task, text, cwd: payload.cwd ?? null });
  // Then say so, here, at the one moment it is known to have happened.
  //
  // The supervisor's own Stop hook can only block a turn that is ending, so it
  // never reaches a supervisor already sitting between turns - which is where a
  // report is most likely to land. Knocking is not conditional on the supervisor
  // looking busy or idle: whether a stop is worth acting on is the supervisor's
  // judgement, and this hook's job is only to make sure it gets to make it.
  if (!alreadyWaiting) await knock(task);
} catch {
  // Deliberately silent. There is nothing a worker can do about this, and
  // failing here would make a reporting bug look like a work bug.
}

process.exit(0);
