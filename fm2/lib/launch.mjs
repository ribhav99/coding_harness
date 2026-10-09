// What a provider session is started as: its hook settings, its model and
// effort, its approvals, and the trust Codex needs before its hooks will load.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadTask, dir, home as homeDir } from './config.mjs';
import { currentPanel } from './presence.mjs';
import { effortFor, normalizeEffort } from './effort.mjs';
import { providerExecutable } from './provider-command.mjs';
import { CLAUDE_MODEL, latestCodexModel } from './provider-model.mjs';
import { remoteReviews } from './remote.mjs';
import { normalizeAgent } from './sessions.mjs';
import { shellQuote, tomlValue } from './shell.mjs';
import { worktreePaths } from './git.mjs';
import { tabtailEnabled, tabtailStop, tabtailLaunch, tabtailEnv, tabtailCleanPrefix } from './tabtail.mjs';

const FM2 = dirname(dirname(fileURLToPath(import.meta.url)));

// Each task gets its own Stop hook, so stopping reports.
//
// Passed at launch with --settings rather than written into the worktree's
// .claude/. Writing it there depends on Claude Code discovering project-local
// settings, which it did not do for a fresh worktree - the session ran, stopped,
// and reported nothing. Handing the file to the launch command removes the
// discovery step entirely, and leaves the worktree clean of harness files.
function hookCommand(id, agent, hook, panel = currentPanel() ?? '') {
  // Home and task are baked into the command, not inherited. An environment that
  // does not reach the hook is indistinguishable from a hook that never fired,
  // and that cost an hour to tell apart once.
  return (
    `FM2_HOME=${shellQuote(homeDir())} FM2_TASK=${shellQuote(id)} ` +
    `FM2_AGENT=${shellQuote(agent)} FM2_PANEL=${shellQuote(panel)} node ${shellQuote(hook)}`
  );
}

export function workerHookConfig(id, agent = 'claude', panel = currentPanel() ?? '') {
  const provider = normalizeAgent(agent);
  const command = (script) => provider === 'codex'
    ? `node ${shellQuote(join(FM2, 'hooks', script))}`
    : hookCommand(id, provider, join(FM2, 'hooks', script), panel);
  const start = command('worker-session.mjs');
  const stop = tabtailStop(command('worker-stop.mjs'), provider, id);
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: start }] }],
      Stop: [{ hooks: [{ type: 'command', command: stop }] }],
    },
  };
}

export function writeWorkerSettings(id, agent = 'claude', panel = currentPanel() ?? '') {
  const provider = normalizeAgent(agent);
  const file = join(dir('hooks'), `${id}-${provider}.json`);
  writeFileSync(
    file,
    JSON.stringify(workerHookConfig(id, provider, panel), null, 2),
  );
  return file;
}

// Keep the native Codex footer aligned with the information in the user's
// Claude status line. Codex omits a field when that datum is unavailable.
export const CODEX_STATUS_LINE = [
  'project-name',
  'git-branch',
  'model-with-reasoning',
  'fast-mode',
  'context-used',
  'five-hour-limit',
  'weekly-limit',
];

// What every Codex session fm starts - worker or controller - is launched on,
// said outright rather than inherited.
//
// This is the same rule the Claude path already follows with `--model opus`: a
// default is not a choice. These used to come from ~/.codex/config.toml on the
// premise that the harness should not override the machine's own settings, and
// that reads well until you put a real worker on it. The machine's settings are
// the desktop app's settings, and they are wrong for an unattended pane in two
// ways that both look like the worker being broken:
//
//   - with no approval policy, Codex sandboxes the session and stops to ask a
//     human before its first command outside the workspace. A worker whose whole
//     point is running unattended waits forever. Worse, `fm status` from inside
//     that sandbox cannot reach the tmux socket and reports every task DEAD.
//   - the model follows whatever the app is pointed at today. The harness
//     instead resolves the newest stable Sol from Codex's own model catalog.
//
// Passed as `-c` rather than as flags because `codex` and `codex resume` do not
// take the same flags, and `-c` is accepted by both.
export function codexSessionArgs(effort, hooks = {}, id = process.env.FM2_TASK) {
  return [
    '-c', `model=${JSON.stringify(latestCodexModel())}`,
    '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
    '-c', 'approval_policy="never"',
    '-c', 'sandbox_mode="danger-full-access"',
    '-c', `tui.status_line=${tomlValue(CODEX_STATUS_LINE)}`,
    // The hook prompt is the harness's own hooks being offered back to it.
    //
    // Codex asks once per changed hook set, and the wrong answer is available
    // and quiet: `continue without trusting` yields a session that works,
    // stops, and never reports, because reporting IS the Stop hook. Eight panes
    // asked at once after a reload. These hooks are written from this checkout
    // moments before the launch, so the source is already vetted - which is
    // the stated condition for this flag.
    ...(tabtailEnabled('codex', id) ? [] : ['--dangerously-bypass-hook-trust']),
    ...Object.entries(hooks).flatMap(([event, groups]) => ['-c', `hooks.${event}=${tomlValue(groups)}`]),
  ];
}

// One word of a worker's launch command. Scalar overrides keep the readable
// `key="value"` form these commands have always had - the shell drops the
// double quotes and Codex reads the bare value as the same string. Arrays and
// tables are single-quoted whole.
function launchWord(arg) {
  return /^[\w./:=-]*$/.test(arg) || /^[\w.]+="[\w./:-]*"$/.test(arg) ? arg : shellQuote(arg);
}

// Codex will not run in a directory it has not been trusted with, and the prompt
// it stops on is not the real cost: trusting is also what allows project-local
// config and HOOKS to load. An untrusted session that someone waves through by
// hand still comes up with no Stop hook, so it works, it stops, and it never
// reports - `fm read` stays empty and the fleet looks idle.
//
// Nothing in the harness answers that prompt, by design: Codex owns its own
// dialogs. So the trust is recorded before the session is launched instead.
// This is the same grant answering the prompt would write, made at the moment
// the harness is being asked to run an agent there, and it is keyed on the git
// repository ROOT because that is what Codex keys it on - one entry covers every
// worktree beside it.
export function ensureCodexTrust(worktree, { configPath = join(homedir(), '.codex', 'config.toml') } = {}) {
  let root;
  try { root = worktreePaths(worktree)[0] ?? resolve(worktree); } catch { root = resolve(worktree); }
  let config = '';
  try { config = readFileSync(configPath, 'utf8'); } catch { /* first Codex run on this machine */ }
  const header = `[projects."${root}"]`;
  if (config.includes(header)) return { root, added: false };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    `${config}${config.endsWith('\n') || !config ? '' : '\n'}\n${header}\ntrust_level = "trusted"\n`,
  );
  return { root, added: true };
}

// What a worker is actually started as.
//
// Its own function because every flag in it is a decision that is invisible
// once the pane is up. A worker on the wrong model, at the wrong effort, or
// without its settings file looks exactly like one that is right - same pane,
// same reports, same `fm status` line - so the only place the choice can be
// held is here, where a test can read it.
export function launchCommand({ agent = 'claude', id, settingsFile, briefPath = null, resume = null, panel = currentPanel() ?? '', effort = null, project = loadTask(id)?.project || process.env.FM_PROJECT }) {
  const provider = normalizeAgent(agent);
  const executable = shellQuote(providerExecutable(provider));
  const reasoning = effort === null ? effortFor(id, provider) : normalizeEffort(provider, effort);
  // FM2_TASK and FM2_HOME travel with the launch command, because a tmux pane
  // inherits the tmux SERVER's environment, not the environment of whatever
  // shell asked for the pane. Without them the hook fires and writes its report
  // into the wrong home, which looks exactly like the hook not firing at all.
  const env =
    `FM2_TASK=${shellQuote(id)} FM2_HOME=${shellQuote(homeDir())} FM2_AGENT=${shellQuote(provider)} FM2_PANEL=${shellQuote(panel)} FM2_EFFORT=${shellQuote(reasoning)}` +
    (provider === 'codex' ? " FM2_CODEX_BACKEND='embedded'" : '') +
    Object.entries(tabtailEnv(id)).map(([key, value]) => ` ${key}=${shellQuote(value)}`).join('') +
    (project ? ` FM_PROJECT=${shellQuote(resolve(project))} FM_REMOTE=${shellQuote(remoteReviews(project) ? 'yes' : 'no')}` : '');
  // The family is explicit and the version follows its latest release:
  // Claude's opus alias and Codex's latest stable Sol catalog entry. Effort
  // remains an independent per-task choice, including when resuming history.
  //
  // No brief means no opening prompt: the session comes up idle, waiting for
  // whoever opens the pane. An adopted worktree has no task to be handed, and
  // passing an empty string instead would start a turn on nothing.
  //
  // Resuming picks the conversation back up where it stopped, so the pane comes
  // up holding everything that was already said in this worktree rather than
  // cold. It is a launch flag, not a message: nothing is sent to the worker.
  const prompt = briefPath ? ` "$(cat ${shellQuote(briefPath)})"` : '';
  if (provider === 'claude') {
    return (
      `${tabtailCleanPrefix()} ${env} ${tabtailLaunch(executable, provider, id)} --dangerously-skip-permissions --effort ${reasoning} --model ${CLAUDE_MODEL} ` +
      `--settings ${shellQuote(settingsFile)}` +
      (resume ? ` --resume ${shellQuote(resume)}` : '') +
      prompt
    );
  }

  const { hooks } = JSON.parse(readFileSync(settingsFile, 'utf8'));
  const flags = [...(tabtailEnabled('codex', id) ? ['--no-daemon'] : []), '--no-alt-screen', ...codexSessionArgs(reasoning, hooks ?? {}, id)].map(launchWord).join(' ');
  if (resume) return `${tabtailCleanPrefix()} ${env} ${tabtailLaunch(executable, provider, id)} resume ${flags} ${shellQuote(resume)}${prompt}`;
  return `${tabtailCleanPrefix()} ${env} ${tabtailLaunch(executable, provider, id)} ${flags}${prompt}`;
}
