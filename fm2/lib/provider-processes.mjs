import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function processTable() {
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 5000 })
    .split('\n').map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean).map((match) => ({ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }));
}

export function processProvider(command) {
  if (/(^|\/)codex(?:$|[- ])/.test(command ?? '')) return 'codex';
  if (/(^|\/)claude(?:$|\/|[- ])/.test(command ?? '')) return 'claude';
  return null;
}

export function descendants(pid, table = processTable()) {
  const out = [], visited = new Set([Number(pid)]);
  const visit = (parent) => {
    for (const child of table.filter((entry) => entry.parent === Number(parent))) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid); out.push(child); visit(child.pid);
    }
  };
  visit(pid);
  return out;
}

export function providerProcess(agent, { pid = process.ppid, table = processTable() } = {}) {
  const visited = new Set();
  while (pid && !visited.has(Number(pid))) {
    visited.add(Number(pid));
    const entry = table.find((entry) => entry.pid === Number(pid));
    if (!entry) return null;
    if (processProvider(entry.command) === agent) return entry.pid;
    pid = entry.parent;
  }
  return null;
}

export function providerAt(pane, table = processTable()) {
  const commands = [table.find((entry) => entry.pid === Number(pane.pid))?.command,
    ...descendants(pane.pid, table).map((entry) => entry.command)];
  return commands.map(processProvider).find(Boolean) ?? null;
}

export function sessionOwnership(pane, source, { explicit = false, table = processTable() } = {}) {
  source ??= {};
  const owned = [Number(pane.pid), ...descendants(pane.pid, table).map((entry) => entry.pid)];
  const provider = table.find((entry) => entry.pid === source.provider_pid);
  const recorded = source.pane === pane.id && Number.isSafeInteger(source.provider_pid)
    && owned.includes(source.provider_pid) && provider && processProvider(provider.command) === source.agent;
  if (!pane.dead && !recorded && (!explicit || source.provider_pid != null)) {
    throw new Error(`pane ${pane.id} has no current hook-recorded session identity; name its exact source with --sessions (panel) or --session (task)`);
  }
  // A command-line prompt can contain "-c". Backend selection comes only from
  // the launch marker recorded by a hook inside this pane's provider process.
  const exited = pane.dead && source.pane === pane.id && Number.isSafeInteger(source.provider_pid) && !provider;
  return source.backend === 'embedded' && (recorded || exited) ? 'embedded' : 'daemon';
}

export function stopProvider(pane, { tmux, agent, source, explicit = false, allowUnrecordedEmbedded = false, allowMissingProvider = false } = {}) {
  let table = processTable();
  const rootBeforeStop = table.find((entry) => entry.pid === Number(pane.pid));
  if (allowMissingProvider && descendants(pane.pid, table).length === 0
      && (!rootBeforeStop || /(^|\/)-?(?:sh|bash|zsh|fish)$/.test(rootBeforeStop.command))
      && !table.some((entry) => entry.pid === source?.provider_pid && processProvider(entry.command))) {
    tmux(['respawn-pane', '-k', '-t', pane.id, '-c', pane.cwd]);
    return null;
  }
  const backend = allowUnrecordedEmbedded ? 'embedded' : sessionOwnership(pane, source, { explicit, table });
  let codexState = null;
  const interrupt = () => {
    const module = new URL('./codex-control.mjs', import.meta.url);
    return JSON.parse(execFileSync(process.execPath, [fileURLToPath(module), source?.id ?? '', pane.cwd],
      { encoding: 'utf8', timeout: 35_000, stdio: ['ignore', 'pipe', 'pipe'] }));
  };
  if (agent === 'codex' && backend !== 'embedded') codexState = interrupt();
  table = processTable();
  if (!allowUnrecordedEmbedded) sessionOwnership(pane, source, { explicit, table });
  let children = descendants(pane.pid, table);
  const root = table.find((entry) => entry.pid === Number(pane.pid));
  if (root && processProvider(root.command) === agent) children.unshift(root);
  if (!children.some((entry) => processProvider(entry.command) === agent)) {
    throw new Error(`pane ${pane.id} has no identifiable ${agent} process`);
  }
  tmux(['set-window-option', '-t', pane.id, 'remain-on-exit', 'on']);
  const frozen = new Set();
  try {
    // Freeze parents before enumerating again so tools cannot fork around stop.
    for (let pass = 0; pass < 10; pass += 1) {
      for (const child of children) {
        if (frozen.has(child.pid)) continue;
        try { process.kill(child.pid, 'SIGSTOP'); frozen.add(child.pid); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      table = processTable();
      const refreshed = descendants(pane.pid, table);
      if (root && table.some((entry) => entry.pid === root.pid)) refreshed.unshift(root);
      children = refreshed;
      if (children.every((entry) => frozen.has(entry.pid))) break;
      if (pass === 9) throw new Error(`tools in pane ${pane.id} kept spawning during shutdown`);
    }
    for (const child of [...children].reverse()) {
      try { process.kill(child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      try { process.kill(child.pid, 'SIGCONT'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    // Four seconds was not enough for a real Claude session to finish exiting,
    // and giving up was worse than waiting: the processes are SIGSTOPped at this
    // point, and a provider that has been backgrounded on its pane's tty cannot
    // be revived by the SIGCONT in the `finally`. It reads the terminal, takes
    // SIGTTIN, and stops again immediately - so the pane was left holding a
    // frozen session that no signal would restore and nothing would clean up.
    // That is what happened on the first real panel switch: `ps` showed state
    // `T` with `tpgid` pointing at the shell, and it had to be found and killed
    // by hand.
    //
    // So: a generous grace for a clean exit, and then SIGKILL rather than a
    // refusal. This is not a worker's work being discarded - the transcript was
    // copied before anything was signalled, and killing a provider that is
    // already being deliberately replaced strands nothing. A frozen pane does.
    const gone = (waitMs) => {
      for (let attempt = 0; attempt * 100 < waitMs; attempt += 1) {
        const alive = new Set(processTable().map((entry) => entry.pid));
        if (children.every((entry) => !alive.has(entry.pid))) return true;
        execFileSync('sleep', ['0.1']);
      }
      return false;
    };
    if (!gone(15_000)) {
      for (const child of [...children].reverse()) {
        try { process.kill(child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      if (!gone(5_000)) {
        throw new Error(
          `provider tools in pane ${pane.id} survived SIGKILL; no replacement was started. ` +
            `Still running: ${children.map((entry) => entry.pid).join(', ')}`,
        );
      }
    }
    tmux(['respawn-pane', '-k', '-t', pane.id, '-c', pane.cwd]);
    if (codexState) return { ...interrupt(), goal: codexState.goal, children_before_stop: codexState.children };
    return null;
  } finally {
    for (const pid of frozen) { try { process.kill(pid, 'SIGCONT'); } catch {} }
  }
}
