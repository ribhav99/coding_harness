#!/usr/bin/env node
// Record the provider's exact session id and transcript before the first turn.
// SessionStart can beat spawnTask's final task-record write, so rememberSession
// also writes a sidecar keyed by the stable fm task id.

import { rememberSession } from '../lib/sessions.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

try {
  const payload = JSON.parse(raw || '{}');
  rememberSession({
    task: process.env.FM2_TASK,
    agent: process.env.FM2_AGENT || 'claude',
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    cwd: payload.cwd,
  });
} catch {
  // Session identity improves recovery, but bookkeeping never blocks startup.
}

// Codex requires JSON from SessionStart command hooks; Claude accepts it too.
if (process.env.FM2_AGENT === 'codex') process.stdout.write('{}\n');
process.exit(0);
