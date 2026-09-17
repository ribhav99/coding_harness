import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const FM2 = dirname(dirname(fileURLToPath(import.meta.url)));

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function waitForFile(file, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

test('fm attach from a transferred shell ignores stale panel/provider variables', { timeout: 30_000 }, async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'fm-preserved-shell-')));
  const socket = `fm-preserved-shell-${randomUUID()}`;
  const binary = execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8' }).trim();
  const bin = join(base, 'bin'); mkdirSync(bin);
  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`, TMUX: '', TMUX_PANE: '', ENV: '', BASH_ENV: '',
    FM2_HOME: join(base, 'state'), FM2_PANEL: 'old-panel', FM2_AGENT: 'claude', FM2_TASK: '',
    CODEX_SKILLS_DIR: join(base, 'codex-skills'), CLAUDE_SKILLS_DIR: join(base, 'claude-skills'),
  };
  const tmux = (args) => execFileSync(binary, ['-L', socket, '-f', '/dev/null', ...args], {
    encoding: 'utf8', timeout: 5_000, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  t.after(() => {
    try { tmux(['kill-server']); } catch { /* creation may have failed */ }
    rmSync(base, { recursive: true, force: true });
  });
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh\nexec ${quote(binary)} -L ${quote(socket)} -f /dev/null "$@"\n`, { mode: 0o700 });
  symlinkSync(join(FM2, 'bin-fm'), join(bin, 'fm'));
  symlinkSync(process.execPath, join(bin, 'node'));
  const launchedEnv = join(base, 'codex.env');
  const launchedArgs = join(base, 'codex.args');
  const launchedReady = join(base, 'codex.ready');
  writeFileSync(join(bin, 'codex'), [
    '#!/bin/sh',
    `printf '%s\\n' "$FM2_AGENT" "$FM2_PANEL" "$FM2_TASK" "$FM2_HOME" "$TMUX_PANE" > ${quote(launchedEnv)}`,
    `printf '%s\\n' "$@" > ${quote(launchedArgs)}`,
    `printf ready > ${quote(launchedReady)}`,
    'exec /bin/sleep 10000',
  ].join('\n'), { mode: 0o700 });
  const wrongProvider = join(base, 'claude-was-started');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf wrong-provider > ${quote(wrongProvider)}\nexit 73\n`, { mode: 0o700 });
  const project = join(base, 'project'); mkdirSync(project);
  const git = (args) => execFileSync('git', ['-C', project, ...args], { env: environment, stdio: 'ignore' });
  git(['init', '-q', '-b', 'develop']);
  git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'fixture']);
  const worktree = join(base, 'project-wo-354');
  git(['worktree', 'add', '-qb', 'wo-354', worktree]);
  writeFileSync(join(worktree, 'keep.txt'), 'existing uncommitted work');
  const sourcePane = tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'old-panel', '-n', 'control', '-c', project, '/bin/sh', '-i',
    ';', 'set-option', '-t', 'old-panel', 'destroy-unattached', 'off',
    ';', 'set-option', '-t', 'old-panel', '@fm-agent', 'claude',
    ';', 'set-option', '-g', 'default-shell', '/bin/sh']);
  const targetPane = tmux(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'codex-panel', '-n', 'control', '-c', project, '/bin/sh', '-i',
    ';', 'set-option', '-t', 'codex-panel', 'destroy-unattached', 'off',
    ';', 'set-option', '-t', 'codex-panel', '@fm-agent', 'codex']);
  const shellPid = tmux(['display-message', '-p', '-t', sourcePane, '#{pane_pid}']);
  tmux(['swap-pane', '-d', '-s', sourcePane, '-t', targetPane]);
  assert.equal(tmux(['display-message', '-p', '-t', sourcePane, '#{session_name}']), 'codex-panel');
  const staleEnv = join(base, 'preserved.env');
  const output = join(base, 'attach.stdout');
  const errorOutput = join(base, 'attach.stderr');
  const status = join(base, 'attach.status');
  const command = `printf '%s\\n' "$FM2_PANEL" "$FM2_AGENT" > ${quote(staleEnv)}; `
    + `fm attach ${quote(worktree)} > ${quote(output)} 2> ${quote(errorOutput)}; printf '%s' "$?" > ${quote(status)}`;
  tmux(['send-keys', '-t', sourcePane, '-l', command]);
  tmux(['send-keys', '-t', sourcePane, 'Enter']);
  await waitForFile(status, 'fm attach did not finish in the preserved shell');
  assert.deepEqual(readFileSync(staleEnv, 'utf8').trimEnd().split('\n'), ['old-panel', 'claude']);
  assert.equal(readFileSync(status, 'utf8'), '0', readFileSync(errorOutput, 'utf8'));
  assert.equal(existsSync(wrongProvider), false, 'stale provider environment launched Claude');
  const task = JSON.parse(readFileSync(join(environment.FM2_HOME, 'tasks', 'wo-354.json'), 'utf8'));
  assert.equal(task.agent, 'codex'); assert.equal(task.panel, 'codex-panel');
  assert.equal(task.worktree, worktree); assert.equal(task.adopted, true);
  assert.equal(tmux(['display-message', '-p', '-t', task.pane, '#{session_name}']), 'codex-panel');
  assert.equal(tmux(['display-message', '-p', '-t', task.pane, '#{window_name}']), 'workers');
  // `fm attach` returns after asking tmux to start the provider; tmux schedules
  // that process independently. Waiting only for attach.status made the test
  // race the mock provider under full-suite load. Its ready marker is written
  // after both files asserted below are complete.
  await waitForFile(launchedReady, 'the attached Codex process did not start');
  assert.deepEqual(readFileSync(launchedEnv, 'utf8').trimEnd().split('\n'), ['codex', 'codex-panel', 'wo-354', environment.FM2_HOME, task.pane]);
  assert.match(readFileSync(launchedArgs, 'utf8'), /hooks\.SessionStart=/);
  assert.match(readFileSync(launchedArgs, 'utf8'), /hooks\.Stop=/);
  assert.equal(tmux(['display-message', '-p', '-t', sourcePane, '#{pane_pid}']), shellPid, 'preserved shell restarted');
  assert.equal(tmux(['list-windows', '-t', 'old-panel', '-F', '#{window_name}']), 'control', 'worker opened in the stale panel');
  assert.equal(readFileSync(join(worktree, 'keep.txt'), 'utf8'), 'existing uncommitted work');
});
