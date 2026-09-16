import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('the remote chooser opens tmux session discovery without a saved project target', (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'fm2-fmp-choose-')));
  const bin = join(base, 'bin');
  const log = join(base, 'tmux.log');
  mkdirSync(bin);
  t.after(() => rmSync(base, { recursive: true, force: true }));

  writeFileSync(join(bin, 'tmux'), `#!/bin/sh
printf 'CALL' >> "$FMP_TMUX_LOG"
printf '\\t%s' "$@" >> "$FMP_TMUX_LOG"
printf '\\n' >> "$FMP_TMUX_LOG"
`, { mode: 0o755 });

  execFileSync('/bin/bash', [join(ROOT, 'bin-fmp'), '--choose'], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMUX: '',
      FM_REPO: dirname(ROOT),
      FMP_TMUX_LOG: log,
    },
  });

  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    'CALL\tlist-sessions',
    'CALL\tattach-session\t-f\tignore-size\t;\tchoose-tree\t-s',
  ]);
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
    } catch { /* the tmux server or session may not exist yet */ }
    await delay(50);
  }
  assert.fail(message);
}

test('the owning fmp pane controls panel lifetime while secondary clients may disconnect', {
  skip: process.platform !== 'darwin' || !existsSync('/usr/bin/script'),
}, async (t) => {
  let realTmux;
  try {
    realTmux = execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8' }).trim();
  } catch {
    t.skip('tmux is not installed');
    return;
  }

  const base = realpathSync(mkdtempSync(join(tmpdir(), 'fm2-fmp-owner-')));
  const projects = join(base, 'projects');
  const project = join(projects, 'fixture');
  const bin = join(base, 'bin');
  const socket = `fm2-fmp-owner-${randomUUID()}`;
  mkdirSync(join(project, '.git'), { recursive: true });
  mkdirSync(bin);

  const tmuxPath = join(bin, 'tmux');
  writeFileSync(tmuxPath,
    `#!/bin/sh\nexec ${JSON.stringify(realTmux)} -L ${JSON.stringify(socket)} -f /dev/null "$@"\n`,
    { mode: 0o755 });

  const tmux = (args) => execFileSync(tmuxPath, args, {
    encoding: 'utf8', timeout: 5_000, env: { ...process.env, TMUX: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const session = 'fm-fixture';
  const hasSession = () => {
    try { tmux(['has-session', '-t', `=${session}`]); return true; }
    catch { return false; }
  };
  const clients = () => tmux(['list-clients', '-t', `=${session}`, '-F', '#{client_name}'])
    .split('\n').filter(Boolean);
  const children = [];
  const launch = (args, env = process.env) => {
    const child = spawn('/usr/bin/script', ['-q', '/dev/null', ...args], {
      detached: true, env, stdio: 'ignore',
    });
    child.unref();
    children.push(child);
    return child;
  };

  t.after(() => {
    try { tmux(['kill-server']); } catch { /* the owner should already have ended it */ }
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
    }
    rmSync(base, { recursive: true, force: true });
  });

  const ownerEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TMUX: '',
    FM_REPO: dirname(ROOT),
    FM_PROJECTS: projects,
    FMP_CLAUDE_CMD: 'sleep 300',
  };
  launch(['/bin/bash', join(ROOT, 'bin-fmp'), 'fixture'], ownerEnv);
  await waitFor(() => hasSession() && clients().length === 1, 'the owning fmp client did not attach');
  const ownerClient = clients()[0];

  launch([tmuxPath, 'attach-session', '-f', 'ignore-size', '-t', `=${session}`]);
  await waitFor(() => clients().length === 2, 'the secondary client did not attach');
  const firstSecondary = clients().find((client) => client !== ownerClient);
  assert.ok(firstSecondary);

  tmux(['detach-client', '-t', firstSecondary]);
  await waitFor(() => hasSession() && clients().length === 1,
    'disconnecting the secondary client disturbed the owner');
  assert.deepEqual(clients(), [ownerClient]);

  launch([tmuxPath, 'attach-session', '-f', 'ignore-size', '-t', `=${session}`]);
  await waitFor(() => clients().length === 2, 'the replacement secondary client did not attach');
  tmux(['detach-client', '-t', ownerClient]);
  await waitFor(() => !hasSession(), 'a secondary client kept the panel alive after its owner detached');

  tmux(['new-session', '-d', '-s', session, '-n', 'control', '-c', project]);
  launch([tmuxPath, 'attach-session', '-f', 'ignore-size', '-t', `=${session}`]);
  await waitFor(() => clients().length === 1, 'the legacy client did not attach');
  const legacyClient = clients()[0];

  launch(['/bin/bash', join(ROOT, 'bin-fmp'), 'fixture', '--owner'], ownerEnv);
  await waitFor(() => clients().length === 2, 'the explicit owner did not attach');
  const adoptedOwner = clients().find((client) => client !== legacyClient);
  assert.ok(adoptedOwner);
  tmux(['detach-client', '-t', adoptedOwner]);
  await waitFor(() => !hasSession(), 'an explicitly adopted panel outlived its new owner');
});
