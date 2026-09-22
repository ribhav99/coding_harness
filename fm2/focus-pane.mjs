#!/usr/bin/env node
// A full-screen secondary view of one pane in an existing Firstmate panel.
//
// tmux zoom and pane layouts belong to the shared window, so attaching from a
// phone and zooming a pane also zooms it on the laptop. Control mode gives us a
// safer primitive: mirror only the selected pane's terminal stream and forward
// input to it. The source pane, its dimensions, and the owner's layout never
// change.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CLEAR = '\x1b[2J\x1b[H';
const DETACH_BYTE = 0x1d; // Ctrl-]

function runTmux(args, options = {}) {
  return execFileSync('tmux', args, {
    encoding: options.encoding ?? 'utf8',
    timeout: 5_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fmHome() {
  return process.env.FM2_HOME || join(homedir(), '.fm2');
}

function jsonFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(directory, entry.name));
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function knownPaneNames() {
  const names = new Map();
  for (const path of jsonFiles(join(fmHome(), 'tasks'))) {
    const task = readJson(path);
    if (task?.pane && task?.id) names.set(task.pane, task.id);
  }
  const panels = join(fmHome(), 'panels');
  if (existsSync(panels)) {
    for (const entry of readdirSync(panels, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const record = readJson(join(panels, entry.name, 'supervisor-pane.json'));
      if (record?.pane) names.set(record.pane, record.task || `controller:${record.panel || decodeURIComponent(entry.name)}`);
    }
  }
  return names;
}

function taskFromStartCommand(command) {
  if (!command) return null;
  const match = command.match(/FM2_TASK=(?:'([^']*)'|"([^"]*)"|([^\s]+))/);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function isAgentProcess(command) {
  return command === 'codex' || command === 'claude' || /^\d+\.\d+\.\d+$/.test(command ?? '');
}

export function listFocusedPanes({ tmux = runTmux } = {}) {
  let lines;
  try {
    lines = tmux([
      'list-panes', '-a', '-F',
      '#{pane_id}\t#{session_name}\t#{window_name}\t#{pane_index}\t#{pane_dead}\t#{pane_current_command}\t#{pane_start_command}\t#{pane_title}\t#{@fm-agent}',
    ]).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const names = knownPaneNames();
  return lines.map((line) => {
    const [pane, panel, window, index, dead, command, startCommand, title, panelAgent] = line.split('\t');
    if (!pane || !panel || !window || index === undefined || dead === undefined) return null;
    const id = names.get(pane) ?? taskFromStartCommand(startCommand)
      ?? (isAgentProcess(command) ? `pane-${pane.slice(1)}` : null);
    return {
      pane, panel, window, index: Number(index), dead: dead === '1', panelAgent, command,
      id, label: id?.startsWith('pane-') && title ? title : id,
    };
  }).filter((entry) => entry && (entry.panelAgent || /^fm-/.test(entry.panel)) && !entry.dead && entry.id)
    .sort((a, b) => a.panel.localeCompare(b.panel)
      || a.window.localeCompare(b.window)
      || a.index - b.index);
}

export function decodeControlOutput(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\' && /^[0-7]{3}/.test(value.slice(index + 1, index + 4))) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 4), 8));
      index += 3;
    } else {
      bytes.push(value.charCodeAt(index));
    }
  }
  return Buffer.from(bytes);
}

export function parseControlOutput(line) {
  const ordinary = line.match(/^%output\s+(%\d+)\s(.*)$/);
  if (ordinary) return { pane: ordinary[1], data: decodeControlOutput(ordinary[2]) };
  const extended = line.match(/^%extended-output\s+(%\d+)\s+.*?\s:\s(.*)$/);
  if (extended) return { pane: extended[1], data: decodeControlOutput(extended[2]) };
  return null;
}

function paneDetails(pane, { tmux = runTmux } = {}) {
  const value = tmux([
    'display-message', '-p', '-t', pane,
    '#{pane_id}\t#{session_name}\t#{pane_cursor_x}\t#{pane_cursor_y}\t#{pane_dead}',
  ]).trim();
  const [id, panel, x, y, dead] = value.split('\t');
  if (id !== pane || dead === '1') throw new Error(`pane ${pane} is no longer running`);
  return { pane: id, panel, x: Number(x), y: Number(y) };
}

function resolvePane(target, options = {}) {
  if (/^%\d+$/.test(target)) return paneDetails(target, options);
  const match = listFocusedPanes(options).find((entry) => entry.id === target);
  if (!match) throw new Error(`no live Firstmate session named "${target}"`);
  return paneDetails(match.pane, options);
}

function seedScreen(details, output, { tmux = runTmux } = {}) {
  const screen = tmux(['capture-pane', '-p', '-e', '-N', '-t', details.pane], { encoding: 'buffer' });
  output.write(CLEAR);
  output.write(Buffer.from(screen.toString('binary').replaceAll('\n', '\r\n'), 'binary'));
  output.write(`\x1b[${details.y + 1};${details.x + 1}H`);
}

function bytesCommand(pane, bytes) {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return hex ? `send-keys -t ${pane} -H ${hex}\n` : '';
}

export async function focusPane(target, {
  input = process.stdin,
  output = process.stdout,
  tmux = runTmux,
  requireTty = true,
} = {}) {
  if (requireTty && (!input.isTTY || !output.isTTY)) {
    throw new Error('focused view needs an interactive terminal');
  }
  const details = resolvePane(target, { tmux });
  const control = spawn('tmux', [
    '-C', 'attach-session', '-f', 'ignore-size,active-pane', '-t', `=${details.panel}`,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let finished = false;
  let priorRaw = false;
  const finish = (error = null) => {
    if (finished) return;
    finished = true;
    input.off('data', onInput);
    process.off('SIGWINCH', redraw);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
    if (typeof input.setRawMode === 'function') input.setRawMode(priorRaw);
    input.pause();
    if (typeof input.unref === 'function') input.unref();
    if (control.stdin.writable) control.stdin.end();
    if (!control.killed) control.kill('SIGTERM');
    output.write(ALT_SCREEN_OFF);
    if (error) rejectDone(error); else resolveDone();
  };
  const redraw = () => {
    try { seedScreen(paneDetails(details.pane, { tmux }), output, { tmux }); } catch (error) { finish(error); }
  };
  const onSignal = () => finish();
  const onInput = (chunk) => {
    const bytes = Buffer.from(chunk);
    const detachAt = bytes.indexOf(DETACH_BYTE);
    const forwarded = detachAt === -1 ? bytes : bytes.subarray(0, detachAt);
    const command = bytesCommand(details.pane, forwarded);
    if (command && control.stdin.writable) control.stdin.write(command);
    if (detachAt !== -1) finish();
  };
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });

  output.write(ALT_SCREEN_ON);
  seedScreen(details, output, { tmux });
  priorRaw = Boolean(input.isRaw);
  if (typeof input.setRawMode === 'function') input.setRawMode(true);
  input.resume();
  input.on('data', onInput);
  process.on('SIGWINCH', redraw);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);

  let pending = '';
  control.stdout.on('data', (chunk) => {
    pending += chunk.toString('utf8');
    const records = pending.split('\n');
    pending = records.pop();
    for (const record of records) {
      const parsed = parseControlOutput(record.replace(/\r$/, ''));
      if (parsed?.pane === details.pane) output.write(parsed.data);
      if (record.slice(0, `%pane-exited ${details.pane}`.length) === `%pane-exited ${details.pane}`) finish();
    }
  });
  control.stderr.on('data', (chunk) => {
    const message = chunk.toString('utf8').trim();
    if (message) finish(new Error(message));
  });
  control.stdin.on('error', finish);
  control.once('error', finish);
  control.once('exit', (code, signal) => {
    if (!finished && (code || signal)) finish(new Error(`tmux focused view ended (${signal || code})`));
    else finish();
  });
  control.stdin.write(`switch-client -t ${details.pane}\n`);
  await done;
}

function printList(entries, output = process.stdout) {
  if (!entries.length) {
    output.write('No live Firstmate sessions. Start a panel locally with: fmp <project>\n');
    return;
  }
  for (const entry of entries) {
    output.write(`${entry.id}\t${entry.pane}\t${entry.label}\t${entry.panel}:${entry.window}.${entry.index}\n`);
  }
}

async function readChoice(output) {
  const prompt = createInterface({ input: process.stdin, output });
  try {
    return (await prompt.question('Choose a session: ')).trim().toLowerCase();
  } finally {
    prompt.close();
  }
}

function openFullPanel() {
  if (process.env.TMUX) runTmux(['choose-tree', '-s']);
  else execFileSync('tmux', ['attach-session', '-f', 'ignore-size,active-pane', ';', 'choose-tree', '-s'], { stdio: 'inherit' });
}

export async function chooseFocusedPane(output = process.stdout, {
  list = listFocusedPanes,
  focus = focusPane,
  choose = readChoice,
  fullPanel = openFullPanel,
} = {}) {
  // Stay inside one SSH connection. A phone should behave like a conversation
  // list: select one live agent, see only that pane, then detach the focused
  // view and land back here to choose another. Requiring one Termius tab per
  // pane made the feature technically usable but missed that navigation model.
  while (true) {
    const entries = list();
    output.write(CLEAR);
    if (!entries.length) {
      printList(entries, output);
      return;
    }
    output.write('Firstmate sessions\n\n');
    entries.forEach((entry, index) => {
      output.write(`  ${index + 1}. ${entry.label}  [${entry.panel} / ${entry.window}]\n`);
    });
    output.write('\n  p. Full panel tree (shared laptop layout)\n');
    output.write('  q. Disconnect\n\n');
    output.write('Inside a session, press Ctrl-] to return to this list.\n');
    const answer = await choose(output);
    if (answer === 'q' || answer === 'quit' || answer === '0') return;
    if (answer === 'p') {
      await fullPanel();
      continue;
    }
    const selected = Number(answer);
    if (!Number.isInteger(selected) || selected < 1 || selected > entries.length) continue;
    await focus(entries[selected - 1].pane);
  }
}

export async function focusCommand(args) {
  if (args.length === 1 && args[0] === '--list') {
    printList(listFocusedPanes());
    return;
  }
  if (args.length === 1 && args[0] === '--choose') {
    await chooseFocusedPane();
    return;
  }
  if (args.length !== 1) throw new Error('usage: fm focus <task-id|%pane> | fm focus --list | fm focus --choose');
  await focusPane(args[0]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await focusCommand(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`fm focus: ${error.message}\n`);
    process.exitCode = 1;
  }
}
