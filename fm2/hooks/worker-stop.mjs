#!/usr/bin/env node
// A worker's Stop hook. Installed into every task's own settings by fm spawn.
//
// This is the entire reporting mechanism. The worker does not write a status
// file, does not learn a verb vocabulary, and cannot forget to report - stopping
// is the report, and its own last message is the content.
//
// Never blocks and never fails loudly. A worker's turn must not be held up by
// the supervisor's bookkeeping, and a broken hook must not strand a session.

import { record, lastAssistantMessage } from '../lib/notify.mjs';

// Claude Code puts the worker's final message straight in the Stop payload as
// last_assistant_message. Verified against a real hook firing. Reading the
// transcript is kept only as a fallback for a payload that lacks it.

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

try {
  const payload = JSON.parse(raw || '{}');
  const task = process.env.FM2_TASK || 'unknown';
  const direct = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message.trim() : '';
  const text = direct || lastAssistantMessage(payload.transcript_path);
  if (text) record({ task, text, cwd: payload.cwd ?? null });
} catch {
  // Deliberately silent. There is nothing a worker can do about this, and
  // failing here would make a reporting bug look like a work bug.
}

process.exit(0);
