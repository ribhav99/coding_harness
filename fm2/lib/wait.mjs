// Blocking waits. Everything that calls these is synchronous - hooks, launch
// paths, tmux polling - so a promise would only move the wait somewhere else.

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Until the process is gone. A Stop hook schedules work that must not begin
// until the hook itself has returned to its provider, so the scheduled side
// waits on the hook's pid first.
export function waitForExit(pid, { attempts = 400, intervalMs = 50 } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { process.kill(pid, 0); } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    sleepSync(intervalMs);
  }
  throw new Error(`stop hook ${pid} did not exit`);
}
