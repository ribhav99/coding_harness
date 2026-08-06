# fm2

The harness. One CLI, no watcher, no daemon, no polling, no status files.

`node fm2/cli.mjs` is the whole install. No dependencies.

## The one idea

**A worker stopping is the only trigger.** A worker running autonomously does not
end a turn until it has nothing left to do, so its Stop hook firing already means
the thing v1 spent a watcher, a wake queue, a status vocabulary, a staleness timer
and a wedge-escalation ladder trying to infer.

The worker writes nothing and remembers nothing. Claude Code hands its Stop hook
the last message it produced, and that message *is* the report — in the worker's
own words.

```
  worker stops -> its own last message is recorded
  supervisor tries to end a turn -> blocked, but only if something is unread
  fm read -> takes the reports; the turn proceeds
```

Nothing else can interrupt. Not idleness, not staleness, not a heartbeat.

## Use

```sh
fm review <pr> [--project <dir>]   open a cold review on a PR
fm ship <id> --spec <text|@file>   put a worker on a task
fm handoff <id>                    ask a finished ship task to self-review
fm handoff <id> --stage swap       close it and open its cold review — one operation
fm read                            take the reports you have not read
fm status                          what is alive, and what the forge says
fm close <id> [--force]            take a task down, refusing to strand work
fm announce <id>                   the outcome, confirmed on the forge
fm caps                            what this machine can reach
```

## State is read, not recorded

There is no status vocabulary. Where something stands comes from the forge (is the
PR approved, did the comment land), from `report.md`, or from the pane. v1's own
rule was to confirm the forge rather than trust a worker's claim — which was an
admission the bookkeeping was never the truth.

## What refuses

- **Unlanded work.** Uncommitted changes, or commits on no remote. `fm close`
  refuses and says which.
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
