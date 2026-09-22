#!/usr/bin/env node
// A worker's Stop hook. Installed into every task's own settings by fm spawn.
//
// This is the entire reporting mechanism. The worker does not write a status
// file, does not learn a verb vocabulary, and cannot forget to report - stopping
// is the report, and its own last message is the content.
//
// Never blocks and never fails loudly. A worker's turn must not be held up by
// the supervisor's bookkeeping, and a broken hook must not strand a session.

import { record, lastAssistantMessage, anyUnread } from '../lib/notify.mjs';
import { knock } from '../lib/knock.mjs';
import { loadTask, saveTask } from '../lib/config.mjs';
import { rememberSession } from '../lib/sessions.mjs';
import { currentPanel } from '../lib/presence.mjs';
import { providerProcess } from '../lib/provider-processes.mjs';
import { schedulePendingEffort } from '../lib/effort.mjs';

// Claude Code puts the worker's final message straight in the Stop payload as
// last_assistant_message. Verified against a real hook firing. Reading the
// transcript is kept only as a fallback for a payload that lacks it.

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

function done() {
  // Codex Stop hooks require JSON on a successful exit. Claude accepts the
  // same hook with no output, so keep its existing behavior unchanged.
  if (process.env.FM2_AGENT === 'codex') process.stdout.write('{}\n');
  process.exit(0);
}

try {
  const payload = JSON.parse(raw || '{}');
  const task = process.env.FM2_TASK || 'unknown';
  const agent = process.env.FM2_AGENT || 'claude';
  const panel = currentPanel();
  try {
    rememberSession({
      task,
      agent,
      sessionId: payload.session_id,
      transcriptPath: payload.transcript_path,
      cwd: payload.cwd,
      panel,
      pane: process.env.TMUX_PANE,
      backend: process.env.FM2_CODEX_BACKEND || null,
      providerPid: providerProcess(agent),
    });
  } catch { /* session bookkeeping must not suppress the report */ }
  // Where this task is now, not where it was spawned. A session that is
  // restarted by hand - to pick up a Claude Code update, say - comes back in a
  // different pane, and the task record still names the old one. Reporting
  // survives that, because this hook finds its task through FM2_TASK rather
  // than the pane; everything addressed *to* the session does not. `fm status`
  // calls it DEAD and `fm tell` refuses to send. The supervisor's own Stop hook
  // already re-records its pane for exactly this reason - a worker is no
  // different, and here is the one moment its live pane is known.
  const here = process.env.TMUX_PANE;
  const known = loadTask(task);
  if (here && known && known.pane !== here && (known.agent || 'claude') === (process.env.FM2_AGENT || 'claude')) {
    try { saveTask({ ...known, pane: here }); } catch { /* bookkeeping never blocks a turn */ }
  }
  // An effort change is a lifecycle transition, not a completed task. Queue the
  // replacement outside this provider's process tree, let this hook return, and
  // suppress the ordinary report/notification for this intermediate stop.
  try {
    if (schedulePendingEffort(task, agent)) done();
  } catch { /* report normally if the replacement could not be scheduled */ }
  // A task Ribhav is running himself. He is already in that pane reading the
  // replies as they land, so a report about it is not news - it is the same
  // words a second time, arriving as an interruption. Silence is the whole
  // feature: no notification is written and no knock is sent, so there is
  // nothing for the supervisor's own Stop hook to block on either.
  if (loadTask(task)?.quiet) done();
  const direct = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message.trim() : '';
  const text = direct || lastAssistantMessage(payload.transcript_path);
  // Asked before recording, because recording is what would make it true. The
  // question is queue-wide, not about this task: `fm read` takes everything
  // waiting, so a supervisor with any report unread has already been told to
  // look, and this stop will be in its hands when it does.
  const alreadyWaiting = anyUnread(panel);
  if (text) record({ task, text, cwd: payload.cwd ?? null, panel });
  // Then say so, here, at the one moment it is known to have happened.
  //
  // The supervisor's own Stop hook can only block a turn that is ending, so it
  // never reaches a supervisor already sitting between turns - which is where a
  // report is most likely to land. Knocking is not conditional on the supervisor
  // looking busy or idle: whether a stop is worth acting on is the supervisor's
  // judgement, and this hook's job is only to make sure it gets to make it.
  //
  // It is conditional on there being something to say. A stop with no last
  // message recorded nothing, so the knock would send the supervisor to `fm
  // read` for "nothing new" - a tap on the shoulder that spends a turn and
  // teaches it to distrust the next one. Stopping is the report and the last
  // message is the content; with no content there is no report, and `fm status`
  // is where a quiet session is found.
  if (text && !alreadyWaiting) await knock(task, { panel });
} catch {
  // Deliberately silent. There is nothing a worker can do about this, and
  // failing here would make a reporting bug look like a work bug.
}

done();
