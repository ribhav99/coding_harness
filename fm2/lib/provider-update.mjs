import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { allTasks, loadTask, saveTask } from './config.mjs';
import {
  allRecordedSessions,
  agentOf,
  controllerId,
  normalizeAgent,
  recordedSession,
  resolveSession,
  sessionFromTranscript,
} from './sessions.mjs';
import { supervisorRecord } from './presence.mjs';
import {
  clearStartupPrompts,
  launchCommand,
  preserveSession,
  refreshPreservedTranscript,
  tmux,
  worktreeState,
  writeWorkerSettings,
} from './tasks.mjs';
import { supervisorCommand } from '../supervisor.mjs';
import {
  descendants,
  processTable,
  providerAt,
  processProvider,
  sessionOwnership,
  stopProvider,
} from './provider-processes.mjs';
import { providerExecutable } from './provider-command.mjs';
import { CLAUDE_MODEL, latestCodexModel } from './provider-model.mjs';

function wait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function lines(value) { return String(value || '').split('\n').filter(Boolean); }
function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

function supportsSelfUpdate(executable) {
  try {
    const help = execFileSync(executable, ['--help'], {
      encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return /(?:^|\n)\s*update(?:\|upgrade)?(?:\s|$)/u.test(help);
  } catch { return false; }
}

function installedWithNpm(executable) {
  let actual = executable;
  try { actual = realpathSync(executable); } catch { /* keep the launch path */ }
  return actual.includes('/node_modules/@openai/codex/');
}

function installedWithBrew(executable) {
  let actual = executable;
  try { actual = realpathSync(executable); } catch { /* keep the launch path */ }
  return actual.includes('/Caskroom/codex/');
}

export function providerUpdatePlan(provider) {
  const agent = normalizeAgent(provider);
  const executable = providerExecutable(agent, { required: true });
  // The app-bundled CLI advertises `update` but cannot detect an installation
  // method. Replace only its external bin symlink with the official standalone
  // npm distribution (which also contains the code-mode host). Future updates
  // then have a real package-manager installation to upgrade.
  let actual = executable;
  try { actual = realpathSync(executable); } catch { /* ordinary lookup handles absence */ }
  if (agent === 'codex' && actual.includes('/ChatGPT.app/Contents/')
      && actual !== executable && dirname(executable).endsWith('/bin')
      && !executable.includes('.app/Contents/')) {
    const prefix = dirname(dirname(executable));
    return {
      provider: agent, method: 'app-bundle-to-npm', executable,
      steps: [{ command: 'npm', args: ['install', '-g', '--prefix', prefix, '--force', '@openai/codex@latest'] }],
    };
  }
  // Claude Code's supported updater is `claude update`; its very large help
  // output is truncated when captured through a Node pipe on some native
  // builds, so probing that listing can falsely claim the command is absent.
  if (agent === 'claude' || supportsSelfUpdate(executable)) {
    return { provider: agent, method: 'self-update', executable, steps: [{ command: executable, args: ['update'] }] };
  }
  if (agent === 'codex' && installedWithNpm(executable)) {
    return {
      provider: agent,
      method: 'npm',
      executable,
      steps: [{ command: 'npm', args: ['install', '-g', '@openai/codex@latest'] }],
    };
  }
  if (agent === 'codex' && installedWithBrew(executable)) {
    return {
      provider: agent,
      method: 'homebrew',
      executable,
      steps: [
        { command: 'brew', args: ['update'] },
        { command: 'brew', args: ['upgrade', '--cask', 'codex'] },
      ],
    };
  }
  throw new Error(
    `${agent} at ${executable} has no supported noninteractive update command; ` +
    (agent === 'codex'
      ? 'install the standalone Codex CLI with npm or the Homebrew cask, then retry'
      : 'update Claude Code once with its installer, then retry'),
  );
}

export function providerVersion(provider) {
  const executable = providerExecutable(provider, { required: true });
  return execFileSync(executable, ['--version'], {
    encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function runProviderUpdate(plan) {
  for (const step of plan.steps) {
    execFileSync(step.command, step.args, { stdio: 'inherit', timeout: 30 * 60_000 });
  }
}

function systemPanes(provider) {
  const table = processTable();
  const format = '#{pane_id}\t#{pane_pid}\t#{pane_dead}\t#{pane_current_path}\t#{session_name}\t#{window_name}\t#{pane_index}';
  return lines(tmux(['list-panes', '-a', '-F', format]))
    .map((line) => {
      const [id, pid, dead, cwd, panel, window, index] = line.split('\t');
      return { id, pid: Number(pid), dead: dead === '1', cwd, panel, window, index: Number(index) };
    })
    .filter((pane) => !pane.dead && providerAt(pane, table) === provider);
}

function openFiles(pid) {
  return lines(execFileSync('lsof', ['-Fn', '-p', String(pid)], {
    encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  })).filter((line) => line.startsWith('n')).map((line) => line.slice(1));
}

function providerTranscript(provider, path) {
  if (!path.endsWith('.jsonl')) return false;
  return provider === 'codex'
    ? path.includes('/.codex/sessions/')
    : path.includes('/.claude/projects/');
}

// Hooks are the normal source of pane/session ownership. A user can also split
// a control window and run `codex` or `claude` directly, though. During an
// update, lsof gives us a stronger exact identity for that case: the provider
// PID and the one native transcript it currently has open. Refuse zero or
// multiple matches; never fall back to cwd recency.
export function activeProviderSession(pane, provider, {
  table = processTable(),
  filesForPid = openFiles,
} = {}) {
  const candidates = [table.find((entry) => entry.pid === Number(pane.pid)), ...descendants(pane.pid, table)]
    .filter((entry) => entry && processProvider(entry.command) === provider);
  const matches = [];
  for (const process of candidates) {
    let files;
    try { files = filesForPid(process.pid); } catch { continue; }
    for (const path of files.filter((file) => providerTranscript(provider, file))) {
      const source = sessionFromTranscript(provider, path);
      if (!source) continue;
      matches.push({
        ...source,
        pane: pane.id,
        panel: pane.panel,
        provider_pid: process.pid,
        backend: 'embedded',
        source: 'active-provider-transcript',
      });
    }
  }
  const unique = [...new Map(matches.map((source) => [`${source.provider_pid}:${source.id}:${source.transcript}`, source])).values()];
  if (unique.length > 1) {
    throw new Error(
      `pane ${pane.id} has more than one open ${provider} transcript; no session was stopped`,
    );
  }
  return unique[0] ?? null;
}

function systemStart(entry, command, provider) {
  tmux(['respawn-pane', '-k', '-t', entry.pane.id, '-c', entry.task.worktree, command]);
  clearStartupPrompts(entry.pane.id, { agent: provider });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pid = Number(tmux(['display-message', '-p', '-t', entry.pane.id, '#{pane_pid}']));
      if (providerAt({ pid }) === provider) {
        if (entry.unmanaged) return;
        const current = recordedSession(entry.task, provider);
        // Wait for the exact resumed conversation's startup hook, not just a
        // process that exists but cannot yet accept the completion report.
        if (current?.id === entry.source.id) {
          sessionOwnership({ id: entry.pane.id, pid, dead: false }, current);
          return;
        }
      }
    } catch { /* the next iteration gives the provider time to start */ }
    wait(100);
  }
  throw new Error(`${provider} did not restart in pane ${entry.pane.id}`);
}

export const PROVIDER_UPDATE_RUNTIME = {
  panes: systemPanes,
  activeSession: activeProviderSession,
  ownership: (pane, source) => sessionOwnership(pane, source),
  stop: (entry) => stopProvider(entry.pane, {
    tmux,
    agent: entry.provider,
    source: entry.source,
  }),
  start: systemStart,
  plan: providerUpdatePlan,
  version: providerVersion,
  update: runProviderUpdate,
};

function taskForPane(pane, provider, tasks, records) {
  let task = tasks.find((item) => item.pane === pane.id) ?? null;
  const controller = supervisorRecord(pane.panel);
  const matching = records.filter((record) => record.pane === pane.id
    && (!record.panel || record.panel === pane.panel));
  let record = matching.find((item) => item.task === task?.id) ?? null;

  if (!task && controller?.pane === pane.id) {
    const id = controller.task || controllerId(pane.panel);
    record = matching.find((item) => item.task === id) ?? record;
    task = {
      id,
      worktree: resolve(record?.cwd || controller.cwd || pane.cwd),
      project: resolve(record?.cwd || controller.cwd || pane.cwd),
      pane: pane.id,
      panel: pane.panel,
      brief: null,
      kind: 'controller',
      agent: provider,
    };
  }
  if (!task && matching.length === 1) {
    record = matching[0];
    const stored = loadTask(record.task);
    task = stored ?? {
      id: record.task,
      worktree: resolve(record.cwd || pane.cwd),
      project: resolve(record.cwd || pane.cwd),
      pane: pane.id,
      panel: pane.panel,
      brief: null,
      kind: record.task.startsWith('controller:') ? 'controller' : 'session',
      agent: provider,
    };
  }
  if (!task) return { task: null, record: null };
  if (agentOf(task) !== provider) {
    throw new Error(`task ${task.id} says ${agentOf(task)} but pane ${pane.id} is running ${provider}`);
  }
  record ??= matching.find((item) => item.task === task.id) ?? null;
  return { task: { ...task, pane: pane.id, panel: pane.panel }, record };
}

function commandFor(entry, provider) {
  // Resolve the binary on every construction. A successful app or CLI update
  // may replace its launch path, and resuming through a pre-update path would
  // make the entire lifecycle appear to have lost its sessions.
  providerExecutable(provider, { required: true });
  if (entry.unmanaged) {
    const executable = shellQuote(providerExecutable(provider, { required: true }));
    return provider === 'claude'
      ? `${executable} --model ${CLAUDE_MODEL} --resume ${shellQuote(entry.source.id)}`
      : `${executable} resume -c model=${JSON.stringify(latestCodexModel())} ${shellQuote(entry.source.id)}`;
  }
  if (entry.controller) {
    return supervisorCommand({
      agent: provider,
      id: entry.task.id,
      panel: entry.pane.panel,
      cwd: entry.task.worktree,
      resume: entry.source.id,
    });
  }
  return launchCommand({
    agent: provider,
    id: entry.task.id,
    panel: entry.pane.panel,
    settingsFile: writeWorkerSettings(entry.task.id, provider, entry.pane.panel),
    resume: entry.source.id,
  });
}

function saveHandoff(entry, manifestPath) {
  if (!entry.registered) return;
  const current = loadTask(entry.task.id) ?? entry.task;
  const handoffs = [...new Set([...(current.handoffs ?? []), entry.preserved.manifestPath])];
  saveTask({
    ...current,
    handoffs,
    last_provider_update: manifestPath,
  });
}

function saveRestart(entry, manifestPath) {
  if (!entry.registered) return;
  const current = loadTask(entry.task.id) ?? entry.task;
  saveTask({
    ...current,
    pane: entry.pane.id,
    panel: entry.pane.panel,
    agent: entry.provider,
    resumed: entry.source.id,
    last_provider_update: manifestPath,
  });
}

export function prepareProviderUpdate(request, { runtime = PROVIDER_UPDATE_RUNTIME } = {}) {
  const provider = normalizeAgent(request.provider);
  const plan = runtime.plan(provider);
  const beforeVersion = runtime.version(provider);
  const panes = runtime.panes(provider);
  const tasks = allTasks();
  const records = allRecordedSessions(provider);
  const entries = [];
  for (const pane of panes) {
    let { task, record } = taskForPane(pane, provider, tasks, records);
    let unmanaged = false;
    let source;
    if (!task) {
      source = runtime.activeSession?.(pane, provider) ?? null;
      if (!source) {
        throw new Error(
          `pane ${pane.id} in ${pane.panel} is running ${provider} but has no fm session identity ` +
          'or single open native transcript; no session was stopped',
        );
      }
      const safeId = String(source.id).replace(/[^A-Za-z0-9._-]/g, '-');
      task = {
        id: `unmanaged-${provider}-${safeId}`,
        worktree: resolve(source.cwd || pane.cwd),
        project: resolve(source.cwd || pane.cwd),
        pane: pane.id,
        panel: pane.panel,
        brief: null,
        kind: 'unmanaged',
        agent: provider,
      };
      record = null;
      unmanaged = true;
    } else {
      source = resolveSession(task, provider, { explicit: record?.id ?? null });
    }
    const backend = runtime.ownership(pane, source);
    const preserved = preserveSession(task, source, provider);
    const entry = {
      provider,
      task,
      pane,
      source,
      backend,
      controller: task.id.startsWith('controller:'),
      unmanaged,
      registered: Boolean(loadTask(task.id)),
      preserved,
      before: worktreeState(task.worktree),
    };
    entry.oldCommand = commandFor(entry, provider);
    entries.push(entry);
  }
  entries.sort((a, b) => Number(a.controller) - Number(b.controller));
  const manifest = {
    version: 1,
    token: request.token,
    provider,
    phase: 'prepared',
    requested_by: request.requested_by,
    created_at: request.requested_at,
    prepared_at: new Date().toISOString(),
    before_version: beforeVersion,
    update: plan,
    entries,
    path: request.manifest,
    log: request.log,
  };
  writeJson(manifest.path, manifest);
  return manifest;
}

function restartEntries(manifest, entries, runtime, failures) {
  for (const entry of [...entries.filter((item) => !item.controller), ...entries.filter((item) => item.controller)]) {
    try {
      // Save the durable recovery point before starting the provider. Its
      // SessionStart hook can race the process check below; loading a task that
      // already carries the handoff keeps either write order lossless.
      saveHandoff(entry, manifest.path);
      let command;
      try { command = commandFor(entry, manifest.provider); }
      catch { command = entry.oldCommand; }
      runtime.start(entry, command, manifest.provider);
      saveRestart(entry, manifest.path);
    } catch (error) {
      failures.push(`${entry.task.id} (${entry.pane.id}): ${error.message}`);
    }
  }
}

export function executeProviderUpdate(manifest, {
  runtime = PROVIDER_UPDATE_RUNTIME,
  phase = () => {},
} = {}) {
  const stopped = [];
  let operationError = null;
  let uncertainStop = null;
  try {
    manifest.phase = 'stopping';
    phase('stopping', { session_count: manifest.entries.length });
    writeJson(manifest.path, manifest);
    for (const entry of manifest.entries) {
      phase('stopping', { stopping_task: entry.task.id });
      uncertainStop = entry;
      entry.codexState = runtime.stop(entry);
      stopped.push(entry);
      uncertainStop = null;
      phase('stopping', { stopping_task: null });
      refreshPreservedTranscript(entry.preserved, entry.source);
      const handoff = JSON.parse(readFileSync(entry.preserved.manifestPath, 'utf8'));
      handoff.worktree = { path: resolve(entry.task.worktree), ...worktreeState(entry.task.worktree) };
      if (entry.codexState) handoff.source.codex_state = entry.codexState;
      writeJson(entry.preserved.manifestPath, handoff);
    }

    manifest.phase = 'updating';
    phase('updating');
    writeJson(manifest.path, manifest);
    runtime.update(manifest.update);
    manifest.after_version = runtime.version(manifest.provider);
  } catch (error) {
    operationError = error;
  }

  manifest.phase = 'restarting';
  phase('restarting', { stopped_count: stopped.length });
  writeJson(manifest.path, manifest);
  const recovery = uncertainStop
    ? [`${uncertainStop.task.id} (${uncertainStop.pane.id}): shutdown could not be verified; inspect before relaunching`]
    : [];
  restartEntries(manifest, stopped, runtime, recovery);

  if (operationError || recovery.length) {
    manifest.phase = recovery.length ? 'recovery-required' : 'failed';
    manifest.error = operationError?.message ?? 'one or more sessions did not restart';
    manifest.recovery = recovery;
    manifest.completed_at = new Date().toISOString();
    writeJson(manifest.path, manifest);
    const detail = recovery.length ? ` Recovery required: ${recovery.join('; ')}` : '';
    throw new Error(`${manifest.error}.${detail}`);
  }

  manifest.phase = 'complete';
  manifest.completed_at = new Date().toISOString();
  manifest.resumed = stopped.map((entry) => ({ task: entry.task.id, pane: entry.pane.id, session: entry.source.id }));
  writeJson(manifest.path, manifest);
  return manifest;
}
