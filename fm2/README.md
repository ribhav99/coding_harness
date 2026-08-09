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
fm handoff <id>                    ask a finished ship task to self-review
fm handoff <id> --stage swap       close it and open its cold review — one operation
fm read                            take the reports you have not read
fm status                          what is alive, and what the forge says
fm close <id> [--force]            take a task down, refusing to strand work
fm announce <id>                   the outcome, confirmed on the forge
fm caps                            what this machine can reach
```

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
a branch the captain has had open for a week. It creates nothing, so closing
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
