import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

// Route imported helpers and subprocesses through the same disposable server.
// A temporary session name alone still shares the user's server and config.
export function privateTmux(t) {
  const binary = execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8' }).trim();
  const root = mkdtempSync(join(tmpdir(), 'fm2-private-tmux-'));
  const bin = join(root, 'bin');
  const blocked = join(root, 'blocked-launches');
  const socket = `fm2-private-${randomUUID()}`;
  mkdirSync(bin);
  writeFileSync(blocked, '');
  writeFileSync(join(bin, 'tmux'),
    `#!/bin/sh\nexec ${quote(binary)} -L ${quote(socket)} -f /dev/null "$@"\n`, { mode: 0o700 });
  for (const name of ['fm', 'fmp', 'open', 'osascript', 'claude', 'codex']) {
    writeFileSync(join(bin, name),
      `#!/bin/sh\nprintf '%s\\n' ${quote(name)} >> ${quote(blocked)}\nexit 99\n`, { mode: 0o700 });
  }
  const replacement = { PATH: `${bin}:${process.env.PATH}`, TMUX: '', TMUX_PANE: '',
    FM2_PANEL: '', FM2_TASK: '', FM2_AGENT: '', FM2_CODEX_BACKEND: '', ENV: '', BASH_ENV: '' };
  const previous = Object.fromEntries(Object.keys(replacement).map(key => [key, process.env[key]]));
  Object.assign(process.env, replacement);
  const tmux = (args, options = {}) => execFileSync(join(bin, 'tmux'), args, {
    encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], ...options,
  }).trim();
  t.after(() => {
    try { tmux(['kill-server']); } catch { /* startup may have failed */ }
    const launches = readFileSync(blocked, 'utf8');
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
    assert.equal(launches, '', 'a terminal fixture attempted to launch a real app or provider');
  });
  const pane = tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fixture',
    '/bin/sleep', '10000', ';', 'set-option', '-g', 'default-shell', '/bin/sh',
    ';', 'set-option', '-g', 'default-command', 'exec /bin/sh']);
  process.env.TMUX = `${tmux(['display-message', '-p', '-t', pane, '#{socket_path}'])},0,0`;
  process.env.TMUX_PANE = pane;
  return { tmux, pane, tmuxPath: join(bin, 'tmux'),
    window: tmux(['display-message', '-p', '-t', pane, '#{window_id}']) };
}
