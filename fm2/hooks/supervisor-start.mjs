#!/usr/bin/env node

import { currentPanel, recordSupervisor } from '../lib/presence.mjs';
import { controllerId, rememberSession } from '../lib/sessions.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

try {
  const payload = JSON.parse(raw || '{}');
  const panel = currentPanel();
  const task = process.env.FM2_TASK || (panel ? controllerId(panel) : null);
  const agent = process.env.FM2_AGENT || 'claude';
  if (task && !task.startsWith('controller:')) process.exit(0);
  recordSupervisor(process.env.TMUX_PANE, { panel, task, agent, sessionId: payload.session_id, cwd: payload.cwd });
  rememberSession({
    task, agent, sessionId: payload.session_id, transcriptPath: payload.transcript_path,
    cwd: payload.cwd, panel, pane: process.env.TMUX_PANE, source: payload.source,
  });
} catch {
  // Provider bookkeeping must not block a session or expose transcript contents.
}

if (process.env.FM2_AGENT === 'codex') process.stdout.write('{}\n');
process.exit(0);
