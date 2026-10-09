// What every fm hook does at its edges: read the provider's payload, record
// which exact session fired it, and exit the way that provider expects.

import { rememberSession } from './sessions.mjs';
import { providerProcess } from './provider-processes.mjs';

// The raw payload, unparsed: each hook parses it inside its own guard, because
// a payload it cannot read must never stop a turn.
export async function readHookInput() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

// The provider's exact session id and transcript, keyed by the fm task.
export function rememberHookSession(payload, { task, agent, panel, source = null }) {
  return rememberSession({
    task,
    agent,
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    cwd: payload.cwd,
    panel,
    pane: process.env.TMUX_PANE,
    source,
    backend: process.env.FM2_CODEX_BACKEND || null,
    providerPid: providerProcess(agent),
    tabtailRun: process.env.FM2_TABTAIL === '1' && process.env.TABTAIL_AGENT_PROVIDER === agent
      ? process.env.TABTAIL_RUN || null : null,
  });
}

// Codex hooks require JSON on a successful exit. Claude accepts the same hook
// with no output, so it is given none.
export function finishHook() {
  if (process.env.FM2_AGENT === 'codex') process.stdout.write('{}\n');
  process.exit(0);
}
