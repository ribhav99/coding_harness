import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const PLACEHOLDER = 'exec /bin/sleep 2147483647';

function runTmux(args) {
  return execFileSync('tmux', args, {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\n$/, '');
}

function sessionTarget(name) {
  if (typeof name !== 'string' || !name || /[:.\x00-\x1f]/.test(name)) {
    throw new Error('a panel needs a nonempty tmux session name without dots, colons, or control characters');
  }
  return `=${name}`;
}

function display(tmux, target, format) {
  return tmux(['display-message', '-p', '-t', target.startsWith('=') ? `${target}:` : target, format]);
}

function lines(value) {
  return value.split('\n').filter(Boolean);
}

function layoutFor(layout, paneMap) {
  const body = layout.replace(/^[0-9a-f]{4},/i, '').replace(
    /(\d+x\d+,\d+,\d+,)(\d+)(?=[,}\]]|$)/g,
    (_, geometry, source) => {
      const target = paneMap[`%${source}`];
      if (!/^%\d+$/.test(target ?? '')) throw new Error(`no target pane for %${source}`);
      return `${geometry}${target.slice(1)}`;
    },
  );
  let checksum = 0;
  for (const char of body) {
    checksum = (((checksum >> 1) | ((checksum & 1) << 15)) + char.charCodeAt(0)) & 0xffff;
  }
  return `${checksum.toString(16).padStart(4, '0')},${body}`;
}

function checkSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !snapshot.windows?.length) throw new Error('invalid or empty panel snapshot');
  const ids = new Set();
  const indices = new Set();
  for (const window of snapshot.windows) {
    if (!Number.isInteger(window.index) || window.index < 0 || indices.has(window.index)) {
      throw new Error('panel windows must have unique nonnegative indices');
    }
    indices.add(window.index);
    if (!window.panes?.length || !window.layout
      || !Number.isInteger(window.width) || window.width < 1
      || !Number.isInteger(window.height) || window.height < 1) {
      throw new Error(`incomplete panel window ${window.id}`);
    }
    for (const pane of window.panes) {
      if (!/^%\d+$/.test(pane.id) || ids.has(pane.id)) throw new Error(`invalid or repeated pane ${pane.id}`);
      ids.add(pane.id);
    }
    if (!window.panes.some((pane) => pane.id === window.activePane)) {
      throw new Error(`active pane is missing from ${window.id}`);
    }
    const leaves = [...window.layout.matchAll(/\d+x\d+,\d+,\d+,(\d+)(?=[,}\]]|$)/g)]
      .map((match) => `%${match[1]}`);
    if (leaves.length !== window.panes.length || window.panes.some((pane) => !leaves.includes(pane.id))) {
      throw new Error(`layout no longer matches the panes in ${window.id}`);
    }
  }
  if (!snapshot.windows.some((window) => window.id === snapshot.activeWindow)) {
    throw new Error('active window is missing from the panel');
  }
}

export function capturePanel(session, { tmux = runTmux, scrollbackDir } = {}) {
  const target = sessionTarget(session);
  const snapshot = {
    version: 1,
    sessionId: display(tmux, target, '#{session_id}'),
    sessionName: display(tmux, target, '#{session_name}'),
    socketPath: display(tmux, target, '#{socket_path}'),
    activeWindow: display(tmux, target, '#{window_id}'),
    windows: [],
  };
  const windowFormat = '#{window_id}\t#{window_index}\t#{window_width}\t#{window_height}\t#{window_zoomed_flag}\t#{window_layout}\t#{window_visible_layout}';
  const paneFormat = '#{pane_id}\t#{pane_index}\t#{pane_active}\t#{pane_pid}\t#{pane_dead}\t#{pane_width}\t#{pane_height}\t#{pane_left}\t#{pane_top}\t#{history_size}';
  if (scrollbackDir) mkdirSync(resolve(scrollbackDir), { recursive: true, mode: 0o700 });
  for (const line of lines(tmux(['list-windows', '-t', target, '-F', windowFormat]))) {
    const [id, index, width, height, zoomed, layout, visibleLayout] = line.split('\t');
    const window = {
      id, index: Number(index), name: display(tmux, id, '#{window_name}'),
      width: Number(width), height: Number(height), zoomed: zoomed === '1',
      layout, visibleLayout, activePane: null, panes: [],
    };
    for (const paneLine of lines(tmux(['list-panes', '-t', id, '-F', paneFormat]))) {
      const [paneId, paneIndex, active, pid, dead, paneWidth, paneHeight, left, top, historySize] = paneLine.split('\t');
      const pane = {
        id: paneId, index: Number(paneIndex), active: active === '1', pid: Number(pid), dead: dead === '1',
        width: Number(paneWidth), height: Number(paneHeight), left: Number(left), top: Number(top),
        historySize: Number(historySize), cwd: display(tmux, paneId, '#{pane_current_path}'),
        currentCommand: display(tmux, paneId, '#{pane_current_command}'),
      };
      if (scrollbackDir) {
        pane.scrollbackPath = join(resolve(scrollbackDir), `pane-${paneId.slice(1)}-${randomUUID()}.txt`);
        writeFileSync(pane.scrollbackPath, tmux(['capture-pane', '-p', '-S', '-', '-t', paneId]), {
          encoding: 'utf8', mode: 0o600, flag: 'wx',
        });
      }
      if (pane.active) window.activePane = pane.id;
      window.panes.push(pane);
    }
    window.panes.sort((a, b) => a.index - b.index);
    snapshot.windows.push(window);
  }
  snapshot.windows.sort((a, b) => a.index - b.index);
  checkSnapshot(snapshot);
  return snapshot;
}

export function createPanel(snapshot, targetSession, { tmux = runTmux } = {}) {
  checkSnapshot(snapshot);
  const target = sessionTarget(targetSession);
  let exists = false;
  try { tmux(['has-session', '-t', target]); exists = true; } catch { /* a new session is expected */ }
  if (exists) throw new Error(`tmux session already exists: ${targetSession}`);
  const paneMap = {};
  let createdSession = null;
  try {
    for (const [position, window] of snapshot.windows.entries()) {
      const first = window.panes[0];
      const temporaryWidth = Math.max(window.width, window.panes.length * 4);
      let initial;
      if (position === 0) {
        // This must share a command queue with creation when the user's global option is on.
        initial = tmux([
          'new-session', '-d', '-P', '-F', '#{pane_id}', '-s', targetSession,
          '-n', window.name, '-x', String(temporaryWidth), '-y', String(window.height), '-c', first.cwd, PLACEHOLDER,
          ';', 'set-option', '-t', `${target}:`, 'destroy-unattached', 'off',
          ';', 'set-option', '-t', `${target}:`, 'renumber-windows', 'off',
        ]);
        createdSession = display(tmux, initial, '#{session_id}');
        const initialIndex = Number(display(tmux, initial, '#{window_index}'));
        if (initialIndex !== window.index) {
          tmux(['move-window', '-s', display(tmux, initial, '#{window_id}'), '-t', `${targetSession}:${window.index}`]);
        }
      } else {
        initial = tmux([
          'new-window', '-d', '-P', '-F', '#{pane_id}', '-t', `${targetSession}:${window.index}`,
          '-n', window.name, '-c', first.cwd, PLACEHOLDER,
        ]);
      }
      const targetWindow = display(tmux, initial, '#{window_id}');
      tmux(['set-option', '-w', '-t', targetWindow, 'automatic-rename', 'off']);
      tmux(['set-option', '-w', '-t', targetWindow, 'allow-rename', 'off']);
      tmux(['set-option', '-w', '-t', targetWindow, 'pane-base-index', String(first.index)]);
      tmux(['set-option', '-w', '-t', targetWindow, 'window-size', 'manual']);
      tmux(['resize-window', '-t', targetWindow, '-x', String(temporaryWidth), '-y', String(window.height)]);
      paneMap[first.id] = initial;
      let tail = initial;
      for (const pane of window.panes.slice(1)) {
        tail = tmux([
          'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-t', tail, '-c', pane.cwd, PLACEHOLDER,
        ]);
        paneMap[pane.id] = tail;
        tmux(['select-layout', '-t', targetWindow, 'even-horizontal']);
      }
    }
    applyPanelLayout(snapshot, paneMap, targetSession, { tmux });
    return paneMap;
  } catch (error) {
    if (createdSession) {
      try { tmux(['kill-session', '-t', createdSession]); } catch { /* leave the original failure visible */ }
    }
    throw error;
  }
}

export function applyPanelLayout(snapshot, paneMap, targetSession, { tmux = runTmux } = {}) {
  checkSnapshot(snapshot);
  const sessionId = display(tmux, sessionTarget(targetSession), '#{session_id}');
  const targets = snapshot.windows.map((window) => {
    const layout = layoutFor(window.layout, paneMap);
    const panes = window.panes.map((pane) => paneMap[pane.id]);
    const windowId = display(tmux, panes[0], '#{window_id}');
    for (const pane of panes) {
      if (display(tmux, pane, '#{session_id}') !== sessionId || display(tmux, pane, '#{window_id}') !== windowId) {
        throw new Error(`mapped pane ${pane} is outside its target panel window`);
      }
    }
    const actual = lines(tmux(['list-panes', '-t', windowId, '-F', '#{pane_id}']));
    if (actual.length !== panes.length || new Set(panes).size !== panes.length) {
      throw new Error(`target window ${windowId} has an unexpected pane set`);
    }
    return { window, windowId, layout, panes, actual };
  });
  if (new Set(targets.map(({ windowId }) => windowId)).size !== targets.length) {
    throw new Error('multiple source windows map to the same target window');
  }
  for (const { window, windowId, layout, panes, actual } of targets) {
    if (display(tmux, windowId, '#{window_zoomed_flag}') === '1') tmux(['resize-pane', '-Z', '-t', windowId]);
    // tmux applies layout leaves by pane order, ignoring their embedded IDs.
    for (const [index, pane] of panes.entries()) {
      const currentIndex = actual.indexOf(pane);
      if (currentIndex === index) continue;
      tmux(['swap-pane', '-d', '-s', pane, '-t', actual[index]]);
      [actual[index], actual[currentIndex]] = [actual[currentIndex], actual[index]];
    }
    tmux(['select-layout', '-t', windowId, layout]);
    tmux(['resize-window', '-t', windowId, '-x', String(window.width), '-y', String(window.height)]);
    tmux(['select-layout', '-t', windowId, layout]);
    tmux(['select-pane', '-t', paneMap[window.activePane]]);
    if (window.zoomed) tmux(['resize-pane', '-Z', '-t', paneMap[window.activePane]]);
  }
  const active = targets.find(({ window }) => window.id === snapshot.activeWindow);
  tmux(['select-window', '-t', active.windowId]);
  return paneMap;
}

const ITERM_SCRIPT = `on run argv
  set launchCommand to item 1 of argv
  set placement to item 2 of argv
  tell application "iTerm2"
    activate
    if placement is "tab" and (count of windows) > 0 then
      tell current window
        create tab with default profile command launchCommand
      end tell
    else
      create window with default profile command launchCommand
    end if
  end tell
end run`;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runAppleScript(script, args) {
  return execFileSync('/usr/bin/osascript', ['-', ...args], {
    input: script, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function openITermPanel(targetSession, {
  placement = 'tab', tmuxPath, socketPath,
  runAppleScript: execute = runAppleScript, platform = process.platform,
} = {}) {
  if (platform !== 'darwin') throw new Error('native iTerm panels require macOS');
  if (!['tab', 'window'].includes(placement)) throw new Error('iTerm placement must be tab or window');
  const executable = tmuxPath ?? execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8', timeout: 5_000 }).trim();
  const args = [executable, ...(socketPath ? ['-S', socketPath] : []), '-CC', 'attach-session', '-t', sessionTarget(targetSession)];
  const command = `/bin/sh -c ${shellQuote(`exec ${args.map(shellQuote).join(' ')}`)}`;
  execute(ITERM_SCRIPT, [command, placement]);
  return { session: targetSession, placement, command };
}
