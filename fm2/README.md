# fm2

The harness. One CLI, no watcher, no daemon, no polling, no status files.

`node fm2/cli.mjs` is the whole install. No dependencies.

On a new machine, `./install` from the repo root points that machine at this
checkout — the commands, the 30 skills, and a check of what git/tmux/node/gh can
reach. `./install --check` says what is wrong without changing anything. Re-run
it whenever the checkout moves.

## The one idea

**A worker stopping is the only trigger.** A worker running autonomously does not
end a turn until it has nothing left to do, so its Stop hook firing already means
the thing v1 spent a watcher, a wake queue, a status vocabulary, a staleness timer
and a wedge-escalation ladder trying to infer.

The worker writes nothing and remembers nothing. Claude Code hands its Stop hook
the last message it produced, and that message *is* the report — in the worker's
own words.

```
  worker stops -> its own last message is recorded, and it knocks
  supervisor tries to end a turn -> blocked, but only if something is unread
  fm read -> takes the reports; the turn proceeds
```

Nothing else can interrupt. Not idleness, not staleness, not a heartbeat.

## Use

```sh
fm review <pr> [--project <dir>]   open a cold review on a PR
fm ship <id> --spec <text|@file>   put a worker on a task
fm attach <worktree> [--spec ...]  a session on a worktree that already exists
fm switch <id> --agent codex       move the same task to Codex (or claude)
fm handoff <id>                    ask a finished ship task to self-review
fm handoff <id> --stage swap       close it and open its cold review — one operation
fm read                            take the reports you have not read
fm status                          what is alive, and what the forge says
fm close <id> [--force]            take a task down, refusing to strand work
fm announce <id>                   the outcome, confirmed on the forge
fm caps                            what this machine can reach
```

Claude Code remains the default outside a panel. A panel's workers and reviewers
inherit its provider; `--agent claude|codex` overrides it for a specific launch.

## Switching Claude Code and Codex

`fm switch <id> --agent codex` and `fm switch <id> --agent claude` replace the
CLI process in that task's existing pane. The task id, worktree, branch, current
files, brief/report path, PR metadata, mute, and unread notifications stay on
the same record. Dirty files and commits that have not been pushed are neither
cleaned nor moved.

Every harness-launched session has `SessionStart` and `Stop` hooks. SessionStart
records the provider's exact session id, transcript path, and cwd. Stop feeds
the provider's `last_assistant_message` into the existing fm report queue. A
switch first copies the full source transcript and a manifest to
`~/.fm2/handoffs/<id>/`, then stops the old CLI and its tools and starts the
target in the same worktree. If the task used the target provider before, fm
resumes that exact session and gives it the transcript containing everything
that happened since.

Older Claude tasks predate the identity hook. For those, fm requires one local
transcript matching the exact worktree and opening brief. Multiple matches are
an error rather than a recency guess; after Ribhav identifies it, pass
`--session <source-id>`. Switching does not call the source provider, so it also
works when that provider is timing out. The transcript only contains events the
old CLI had already written; hidden model state and an unwritten partial answer
cannot transfer.

Tell firstmate to “switch this panel to Codex” or “switch this panel to Claude
Code.” It runs the same public command:

```sh
fm panel-switch --agent codex
fm panel-switch --agent claude
```

The switch runs in a detached helper so replacing the control conversation does
not kill the handoff. It opens an iTerm2 control-mode tab, recreates every tmux
window and split, and moves shell panes with their running processes. Each
replacement conversation reads its complete saved source transcript and prior
handoffs, and resumes its exact earlier conversation in the target provider
when available. These are history files supplied as context; they do not become
converted native message bubbles or transfer hidden model state.

The old agents stop before replacements begin. Harness-launched Codex uses an
embedded backend so the lifecycle hooks retain their exact task and pane identity;
the helper verifies that its provider process and tools exit. When adopting a
shared daemon session, it verifies exact thread identity and cwd, cancels its turn,
pauses an active goal, and stops its background tools and descendant conversations.
Independent shell/server panes remain running as they move.
Goal metadata stays in the handoff; interrupted commands continue from their
actual files and output. A failed launch attempts to restore the original
provider conversations and leaves complete recovery records under
`~/.fm2/panel-handoffs/`. The source panel remains for recovery; `fmp <project>`
follows its successful switch to the active panel.

A new panel starts with `fmp <project> --agent codex`; plain `fmp` starts Claude.
For legacy conversations without an exact SessionStart record, identify their
source session explicitly using `--sessions @file.json` (keys are task IDs or
pane IDs; values are exact provider session IDs). Ambiguous history refuses
before stopping a source.

## Termius and other secondary terminals

An `fmp` project panel is one tmux session, so use one Termius tab per project.
The controller, workers, and reviews remain tmux windows and panes inside that
terminal; Termius does not turn each inner pane into a separate app tab.

After connecting to the Mac with ordinary SSH, attach only to the existing
panel and keep the phone or tablet out of tmux's size calculation:

```sh
tmux attach-session -f ignore-size -t '=fm-fitness_agent'
```

Replace the target with the panel shown by `tmux list-sessions`. Do not use
`-d`, which would detach the owning iTerm client, or `new-session -A`, which can
silently recreate a panel that its owner intentionally closed. Closing Termius
only disconnects that secondary view. Closing the owning iTerm pane explicitly
destroys the panel and disconnects every secondary client with it.

There is no harness-specific mobile UI or daemon. On each Mac, install this
checkout normally, enable macOS Remote Login, make the Mac reachable through
the private network (for example Tailscale), and authorize the Termius SSH key.
Once those machine prerequisites exist, the same attach command works for every
project and every device.

Panels opened before this owner lifecycle was installed do not need to restart.
Open a second iTerm tab and run `fmp <project> --owner`; after it attaches to the
existing panel, close the original iTerm tab. The new tab is now the owner and
all tmux windows, panes, processes, and scrollback stayed in the same session.
Use `--owner` only for this deliberate transfer: closing any owning tab destroys
the panel, even when another client is attached.

iTerm2's **Settings → General → tmux → When attaching, restore windows as…**
controls whether tmux windows become native tabs or separate windows. Choose
tabs in a new window for a complete panel grouped together. The harness uses
the supported `tmux -CC` integration and preserves that preference.

Codex keeps its configured model, reasoning, sandbox, and approval settings.
On first use, inspect and trust the harness command hooks with `/hooks` in the
control pane and a worker pane. Hook definitions stay stable across task IDs
and panels. Skipped hooks cannot report or record exact session IDs. The
shared-daemon handoff requires a Codex CLI exposing the current app-server
control protocol; if it cannot verify cancellation, it refuses to start another
provider.

The hook fields and output shapes follow the current official
[Codex hooks contract](https://learn.chatgpt.com/docs/hooks).

## The knock

The supervisor's Stop hook is a block, not a bell. It fires when the supervisor
*tries to end a turn*, so it cannot reach one already sitting between turns —
which is exactly where a report is most likely to land. Five reports once sat
unread for the better part of an hour that way, with every hook working
perfectly the whole time.

So the worker knocks on its way out. Its Stop hook already runs at the one moment
the stop is known to have happened; it records the report and then says so, to
the pane the supervisor's own hooks wrote down.

It is unconditional on purpose. A version of this knocked only when the
supervisor looked idle, which quietly decided on the supervisor's behalf that a
mid-turn report was not worth mentioning. Whether a stop deserves any action is
the supervisor's judgement — the hook's job is only to make sure it gets to make
it. Every stop is its own knock, because every stop is its own report.

Nothing polls and nothing watches. A worker stopping was always the only trigger;
this just carries it the last step.

## Ship makes the worktree; attach borrows one

`ship` is for work that does not exist yet, so it cuts the branch and the
worktree to hold it, and closing destroys both. `attach` is for work that does —
a branch Ribhav has had open for a week. It creates nothing, so closing
takes down the session and leaves the worktree exactly as it was found. The
record carries `adopted` and teardown reads it; getting that backwards deletes
real work and calls it cleanup.

Without `--spec` an attached session comes up idle, which is what a branch you
want to sit down with looks like.

## What refuses

- **Unlanded work.** Uncommitted changes, or commits on no remote. `fm close`
  refuses and says which. An adopted worktree is exempt: closing removes
  nothing, so nothing can be stranded.
- **A review with no report.** Its findings would go with the worktree.
- **The primary checkout.** A task never runs in it; asserted before an agent exists.

## Things learned the hard way

Each of these cost real time during the build and is now handled:

- A tmux window name is not unique. Three windows called `reviews` make
  `-t session:reviews` fail with "can't find pane". Windows are addressed by index.
- A tmux pane inherits the tmux *server's* environment, not the shell that asked
  for the pane. The home and task id are baked into the hook command rather than
  inherited — an environment that does not reach the hook looks exactly like a
  hook that never fired.
- A fresh worktree triggers Claude Code's folder-trust prompt. Until it is
  answered the session has not started and will never stop, which also looks like
  a broken hook. `spawnTask` answers it.
- A half-made task is worse than none, so a failed launch rolls the worktree back.

## Tests

```sh
node --test fm2/test/fm2.test.mjs
```
