import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { decodeControlOutput, listFocusedPanes, parseControlOutput } from '../focus-pane.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('tmux control output decoding preserves terminal bytes', () => {
  assert.deepEqual(
    decodeControlOutput(String.raw`hello\134world\015\012\011`).toString('binary'),
    'hello\\world\r\n\t',
  );
  const ordinary = parseControlOutput(String.raw`%output %12 A\033[31mred\033[0m\015\012`);
  assert.equal(ordinary.pane, '%12');
  assert.equal(ordinary.data.toString('binary'), 'A\x1b[31mred\x1b[0m\r\n');
  const extended = parseControlOutput(String.raw`%extended-output %3 128 ignored : later\015\012`);
  assert.equal(extended.pane, '%3');
  assert.equal(extended.data.toString('binary'), 'later\r\n');
  assert.equal(parseControlOutput('%layout-change @1 deadbeef'), null);
});

test('the focused picker names live controllers and tasks without listing shell panes', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'fm2-focus-list-'));
  const previous = process.env.FM2_HOME;
  process.env.FM2_HOME = base;
  t.after(() => {
    if (previous === undefined) delete process.env.FM2_HOME;
    else process.env.FM2_HOME = previous;
    rmSync(base, { recursive: true, force: true });
  });
  mkdirSync(join(base, 'tasks'), { recursive: true });
  mkdirSync(join(base, 'panels', 'fm-project'), { recursive: true });
  writeFileSync(join(base, 'tasks', 'worker.json'), JSON.stringify({ id: 'worker-one', pane: '%2' }));
  writeFileSync(join(base, 'panels', 'fm-project', 'supervisor-pane.json'), JSON.stringify({
    pane: '%1', panel: 'fm-project', task: 'controller:fm-project',
  }));
  const tmux = () => [
    '%1\tfm-project\tcontrol\t1\t0\t',
    '%2\tfm-project\tworkers\t1\t0\t',
    '%3\tfm-project\tworkers\t2\t0\t',
    '%4\tother\twork\t1\t0\tcodex',
    '%5',
  ].join('\n');
  assert.deepEqual(listFocusedPanes({ tmux }).map(({ id, pane }) => ({ id, pane })), [
    { id: 'controller:fm-project', pane: '%1' },
    { id: 'worker-one', pane: '%2' },
  ]);
});

test('interactive SSH shells open the installed focused picker', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'fm2-remote-picker-'));
  const bin = join(base, 'bin');
  const config = join(base, '.config', 'fm');
  const log = join(base, 'calls.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, 'focus-pane.mjs'), '// installed helper\n');
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'node'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PICKER_LOG"\n', { mode: 0o755 });
  t.after(() => rmSync(base, { recursive: true, force: true }));

  execFileSync('/bin/zsh', ['-dfi', '-c', `source ${JSON.stringify(join(ROOT, 'remote-picker.zsh'))}`], {
    env: {
      ...process.env,
      HOME: base,
      PATH: `${bin}:/usr/bin:/bin`,
      SSH_CONNECTION: 'phone 1 mac 22',
      TMUX: '',
      PICKER_LOG: log,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  assert.equal(readFileSync(log, 'utf8').trim(), `${join(config, 'focus-pane.mjs')} --choose`);
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  assert.fail(message);
}

test('a focused view mirrors one pane and leaves the shared layout untouched', {
  skip: !existsSync('/usr/bin/script'),
}, async (t) => {
  let realTmux;
  try {
    realTmux = execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8' }).trim();
  } catch {
    t.skip('tmux is not installed');
    return;
  }

  const base = mkdtempSync(join(tmpdir(), 'fm2-focus-pane-'));
  const bin = join(base, 'bin');
  const home = join(base, 'home');
  const socket = `fm2-focus-${randomUUID()}`;
  mkdirSync(bin);
  mkdirSync(home);
  const tmuxPath = join(bin, 'tmux');
  writeFileSync(tmuxPath,
    `#!/bin/sh\nexec ${JSON.stringify(realTmux)} -L ${JSON.stringify(socket)} -f /dev/null "$@"\n`,
    { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMUX: '', FM2_HOME: home };
  const tmux = (args) => execFileSync(tmuxPath, args, {
    encoding: 'utf8', timeout: 5_000, env, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  t.after(() => {
    try { tmux(['kill-server']); } catch { /* already stopped */ }
    rmSync(base, { recursive: true, force: true });
  });

  const target = tmux([
    'new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fm-fixture', '-n', 'workers',
    'cat',
  ]);
  tmux(['set-option', '-t', 'fm-fixture', '@fm-agent', 'codex']);
  const sibling = tmux([
    'split-window', '-d', '-P', '-F', '#{pane_id}', '-t', target,
    'sleep 30',
  ]);
  tmux(['send-keys', '-t', target, '-l', 'TARGET_READY']);
  tmux(['send-keys', '-t', target, 'Enter']);
  tmux(['send-keys', '-t', sibling, '-l', 'SIBLING_ONLY']);
  const before = `${tmux(['display-message', '-p', '-t', target, '#{window_layout}\t#{window_zoomed_flag}'])}\n`
    + tmux(['list-panes', '-t', 'fm-fixture:workers', '-F', '#{pane_id}:#{pane_active}']);

  const moduleUrl = pathToFileURL(join(ROOT, 'focus-pane.mjs')).href;
  const runner = `import { focusPane } from ${JSON.stringify(moduleUrl)}; await focusPane(${JSON.stringify(target)}, { requireTty: false });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', runner], {
    env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('binary'); });
  child.stderr.on('data', (chunk) => { errors += chunk.toString('utf8'); });

  await waitFor(() => output.includes('TARGET_READY'), `focused view did not render its target: ${errors}`);
  await delay(600);
  assert.doesNotMatch(output, /SIBLING_ONLY/);

  child.stdin.write('hello from phone\n');
  await waitFor(() => output.includes('hello from phone'), `focused input did not reach its target: ${errors}`);
  child.stdin.write(Buffer.from([0x1d]));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('focused view did not detach')), 5_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code) reject(new Error(`focused view exited ${code}: ${errors}`)); else resolve();
    });
  });

  const after = `${tmux(['display-message', '-p', '-t', target, '#{window_layout}\t#{window_zoomed_flag}'])}\n`
    + tmux(['list-panes', '-t', 'fm-fixture:workers', '-F', '#{pane_id}:#{pane_active}']);
  assert.equal(after, before);
  assert.match(output, /\x1b\[\?1049h/);
  assert.match(output, /\x1b\[\?1049l/);
});
