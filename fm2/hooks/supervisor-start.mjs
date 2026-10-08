#!/usr/bin/env node

import { currentPanel, recordSupervisor } from '../lib/presence.mjs';
import { configurePanelQuotaStatus } from '../lib/quota-status.mjs';
import { controllerId } from '../lib/sessions.mjs';
import { finishHook, readHookInput, rememberHookSession } from '../lib/hook-io.mjs';

const raw = await readHookInput();

try {
  const payload = JSON.parse(raw || '{}');
  const panel = currentPanel();
  const task = process.env.FM2_TASK || (panel ? controllerId(panel) : null);
  const agent = process.env.FM2_AGENT || 'claude';
  if (task && !task.startsWith('controller:')) process.exit(0);
  recordSupervisor(process.env.TMUX_PANE, { panel, task, agent, sessionId: payload.session_id, cwd: payload.cwd });
  rememberHookSession(payload, { task, agent, panel, source: payload.source });
  configurePanelQuotaStatus(panel, agent);
} catch {
  // Provider bookkeeping must not block a session or expose transcript contents.
}

finishHook();
