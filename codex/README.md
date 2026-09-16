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

A launch carries only `--no-alt-screen` and its hook configuration; the model,
reasoning effort, approval policy and sandbox all come from `~/.codex/config.toml`.
That is deliberate and the tests pin it — the harness does not override the
settings the machine already has. So that file *is* the worker configuration:
`model` and `model_reasoning_effort` there are what every worker runs on.

Two of those settings decide whether an autonomous worker is autonomous at all.
With no `approval_policy` and no `sandbox_mode` in that file, Codex defaults to a
workspace sandbox and asks before stepping outside it, and a worker put on a task
then stops and waits for a human on its first real command. The standing
preference for this harness is the opposite — every agent launch is
permissionless — and for Codex that means:

```toml
# ~/.codex/config.toml
approval_policy = "never"
sandbox_mode = "danger-full-access"
```

Set it deliberately or not at all, but know which you have chosen. It is a
machine-wide setting: it reaches the desktop app and every Codex session on the
machine, not only the ones `fm` starts.

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
