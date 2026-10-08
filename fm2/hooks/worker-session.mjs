#!/usr/bin/env node
// Record the provider's exact session id and transcript before the first turn.
// SessionStart can beat spawnTask's final task-record write, so rememberSession
// also writes a sidecar keyed by the stable fm task id.

import { currentPanel } from '../lib/presence.mjs';
import { finishHook, readHookInput, rememberHookSession } from '../lib/hook-io.mjs';
import { configurePanelQuotaStatus } from '../lib/quota-status.mjs';

const raw = await readHookInput();

try {
  const payload = JSON.parse(raw || '{}');
  const panel = currentPanel();
  const agent = process.env.FM2_AGENT || 'claude';
  rememberHookSession(payload, { task: process.env.FM2_TASK, agent, panel, source: payload.source });
  // A worker may be the first Codex process resumed in a legacy panel. It can
  // safely install the shared quota display, but a lone Claude worker must not
  // remove it while a whole-panel switch is still in flight.
  if (agent === 'codex') configurePanelQuotaStatus(panel, agent);
} catch {
  // Session identity improves recovery, but bookkeeping never blocks startup.
}

finishHook();
