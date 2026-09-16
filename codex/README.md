# Codex skill setup

The same installed skills support the Codex app and the `fm` terminal panel.
With no `FM2_TASK` or `FM2_PANEL` marker, the app holds tasks, messages, reviews,
and progress through its native tools. A marked terminal session uses `fm` for
its controller and workers and `surface` for review decisions. Neither mode
assumes the Python planning orchestrator is running.

## Before the first Codex session on a machine

Three things have to be true, and none of them announce themselves. Each one
fails as a pane that looks perfectly alive and never does anything.

**1. `codex` has to be on PATH.** It ships inside the desktop app rather than as
its own command, so nothing finds it by default: `fm caps` reports
`"codex": false`, and a panel switch refuses with `codex is not installed`.

Link its helpers too, in the same directory. `codex` resolves them **next to
itself**, so a lone symlink sends it looking in `/opt/homebrew/bin` and finding
nothing:

```sh
R="/Applications/ChatGPT.app/Contents/Resources"
for b in codex codex-code-mode-host codex_chronicle rg; do ln -sfn "$R/$b" "/opt/homebrew/bin/$b"; done
codex --version   # codex-cli 0.154.0-alpha.6.1
codex doctor      # search should read `found`, not `cannot find binary path`
```

`codex-code-mode-host` is the one that matters most, and its absence is the
least obvious failure in this whole document. Codex runs shell commands through
it; without it the session has **no shell at all** and says only `Code mode will
fail closed` in a startup banner nobody reads. The worker then tries to complete
its task through whatever tools remain — a real one asked permission to open
TextEdit, then Finder, to read a file it should have `cat`'d — and reported
itself blocked. It reported correctly, which is the only reason this was cheap
to find.

**2. The repository has to be trusted in Codex.** A Codex session in an untrusted
directory stops on `Do you trust the contents of this directory?` and waits.
Nothing here answers it — the harness clears Claude's dialogs and deliberately
leaves Codex's own trust and approval prompts to Codex.

That prompt is not cosmetic. Trusting is what allows **project-local config,
hooks, and exec policies to load**, and the hooks are the entire reporting
mechanism. An untrusted session that someone waves through by hand still comes
up with no `Stop` hook, so it never reports and `fm read` stays empty forever —
indistinguishable from a quiet fleet.

Trust is keyed on the **git repository root** and covers every worktree beside
it, so one answer covers a whole project. Either run `codex` once in the repo and
answer `1`, or write it directly:

```toml
# ~/.codex/config.toml
[projects."/absolute/path/to/repo"]
trust_level = "trusted"
```

Check what is already trusted with `grep -A1 '^\[projects' ~/.codex/config.toml`.

**3. The skills have to be installed for Codex**, not just for Claude:
`node codex/install.mjs`, then `--check`.

**4. The hooks have to be trusted, once.** The first session launched with a new
or changed hook set stops on `Hooks need review` and offers three answers. Take
`Trust all and continue`. `Continue without trusting (hooks won't run)` is the
quiet catastrophe: the session runs perfectly, does the work, stops — and never
reports, because reporting *is* the Stop hook. `fm read` says `nothing new`
forever and the fleet looks idle.

## What a Codex worker inherits, and why it matters

A launch names its model, reasoning effort, approval policy, sandbox, and native
status line outright, the same way the Claude path names `--model opus`: a
default is not a choice. They are passed as `-c` overrides rather than flags,
because `codex` and `codex resume` do not accept the same flags and `-c` works on
both. The footer mirrors the useful fields in the Claude status line: project,
branch, model and effort, fast mode, context use, and five-hour and weekly
limits. Codex leaves out any field that is unavailable for the current session.
Its native limit fields show percentages but not reset times, so fm also adds
the available account windows and their live reset countdowns to the existing
tmux status bar. The shared panel bar aggregates the account and model-family
windows reported by live Codex sessions, so every worker and reviewer can see
all currently available limits; an unavailable five-hour window is omitted
rather than shown as zero.

```
codex --no-alt-screen -c model="gpt-5.6-sol" -c model_reasoning_effort="ultra" \
      -c approval_policy="never" -c sandbox_mode="danger-full-access" \
      -c 'tui.status_line=["project-name","git-branch","model-with-reasoning",…]' \
      -c hooks.…
```

These used to be inherited from `~/.codex/config.toml`, on the reasonable premise
that the harness should not override the machine's own settings. Putting a real
worker on it showed why that is wrong here: the machine's settings are the
*desktop app's* settings, and an unattended pane is not a desktop app. With no
approval policy Codex sandboxes the session and stops to ask a human before its
first command outside the workspace, so a worker whose whole point is running
unattended waits forever — and `fm status` from inside that sandbox cannot reach
the tmux socket and reports every task DEAD, which is a confident wrong answer
rather than an error.

A session that is already running can be moved with `/permissions` → *Full
Access*, which is the per-session form of the same thing. Nothing needs it now
that launches carry it, but it is how an already-open pane is rescued.

The sandbox also breaks `fm` itself from inside a worker. `fm status` run in a
sandboxed session cannot reach the tmux socket at `/private/tmp/tmux-501/default`
and reports **every task DEAD** — a confident, completely wrong answer that looks
exactly like a dead fleet.

## Switching a panel that is already running

`fm panel-switch --agent codex` replaces every session in a panel. Two things
that bite on a panel which has been up for a while:

- **A session started before session recording needs its id passed in.** The
  switch refuses with `needs a recorded session or --session <exact-id>` rather
  than guess. Find it under `~/.claude/projects/<slugified-cwd>/` and pass a
  map: `--sessions @file`, keyed by pane id (`{"%4": "<uuid>"}`). Resist picking
  the newest file by hand when several sessions share a working directory — the
  controller's own transcript is often not the most recently written one.
- **Test with one session before moving a whole panel.** `fm switch <id> --agent
  codex` moves a single task and is the cheap way to find a machine-level
  problem. A panel switch stops every pane in the panel before it starts
  anything, so a problem found there is found nine times.

Install from this checkout with Node.js:

```sh
node codex/install.mjs
node codex/install.mjs --check
node --test codex/install.test.mjs
```

The installer links whole skill folders into `~/.agents/skills`. Each has a real
`SKILL.md`; shared rubrics remain linked to `skills/`. Empty imported folders are
repaired. A legacy directory containing only a link to this checkout's shared
`SKILL.md` source is migrated to the native folder. Conflicting custom content
stops the install before any changes. Other skills, Claude configuration,
credentials, permissions, and models are untouched.
Use `--skills-dir /path/to/skills` for an isolated installation. Codex launches
through `fm` use this same installer; they do not overwrite files through folder
links. Claude launches retain their existing shared-skill installation.

Keep this checkout at its installed path and rerun the installer after adding,
removing, or renaming a skill. `--check` fails for missing entries, broken rubric
links, or shared skills lacking a Codex entrypoint. Existing rubric edits appear
immediately through the links. After a setup change, start a new app task if its
skill list has not refreshed.

Automatic Claude import can replace native instructions and reintroduce the
tmux hooks. Once adopting this workflow, turn off automatic updates in the app's
Import settings. Manual imports remain available; review them before accepting
replacement instructions. The installer does not change the app setting.

Examples:

- “Implement WO-354 here.” Work continues in the current task, using subagents
  where useful.
- “Create a new PackPilot task to implement WO-354.” The app creates a task the
  user can open and continue directly.
- “Use full-review on this PR.” Independent judges review it, then the task
  presents findings in the app for decisions.
- “Tell the pricing task to use the revised rounding rule.” The follow-up goes
  to the existing task.
- “Keep watching that task and tell me when it needs me.” A native heartbeat
  continues monitoring after the coordinating turn ends.

In a terminal controller, “switch this whole session to Codex” routes to
`fm panel-switch --agent codex`; `--agent claude` switches back. The command
hands off saved conversations and existing task worktrees in the background.
It does not convert hidden model state or require manually importing chats.

`firstmate` and `full-review` have separate app and CLI procedures. The other
entrypoints retain the same implementation, evidence, and document rules while
[runtime.md](runtime.md) and [cli-runtime.md](cli-runtime.md) select the session's
tools and reporting mechanism. Merely opening a terminal does not change modes.
