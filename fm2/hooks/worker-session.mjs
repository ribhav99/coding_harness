#!/usr/bin/env node
// Record the provider's exact session id and transcript before the first turn.
// SessionStart can beat spawnTask's final task-record write, so rememberSession
// also writes a sidecar keyed by the stable fm task id.

import { rememberSession } from '../lib/sessions.mjs';
import { currentPanel } from '../lib/presence.mjs';
import { providerProcess } from '../lib/provider-processes.mjs';
import { configurePanelQuotaStatus } from '../lib/quota-status.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

try {
  const payload = JSON.parse(raw || '{}');
  const panel = currentPanel();
  const agent = process.env.FM2_AGENT || 'claude';
  rememberSession({
    task: process.env.FM2_TASK,
    agent,
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    cwd: payload.cwd,
    panel,
    pane: process.env.TMUX_PANE,
    backend: process.env.FM2_CODEX_BACKEND || null,
    providerPid: providerProcess(process.env.FM2_AGENT || 'claude'),
    source: payload.source,
  });
  // A worker may be the first Codex process resumed in a legacy panel. It can
  // safely install the shared quota display, but a lone Claude worker must not
  // remove it while a whole-panel switch is still in flight.
  if (agent === 'codex') configurePanelQuotaStatus(panel, agent);
} catch {
  // Session identity improves recovery, but bookkeeping never blocks startup.
}

if (process.env.FM2_AGENT === 'codex') process.stdout.write('{}\n');
process.exit(0);
