# Fork notes

This directory is a **squashed `git subtree`** of [`kunchenguid/firstmate`](https://github.com/kunchenguid/firstmate),
vendored into the `coding_harness` repo rather than run as its own checkout.

Every local deviation from upstream is listed here. Keep this file current — it is
the thing that makes `git subtree pull` survivable.

## Syncing with upstream

```sh
# from the coding_harness repo root
git subtree pull --prefix=firstmate_workflow firstmate-upstream main --squash
```

Conflicts are expected only in the files listed under "Local deltas" below.

Vendored at upstream commit `1e24757` (branch `main`).

---

## Local deltas

### 1. Nested-checkout guard scope — `bin/fm-primary-scope-lib.sh`, `bin/fm-cd-pretool-check.sh`

**Why.** Upstream assumes the firstmate home *is* a git repo top level. It decides
"am I a plain primary checkout, or a linked task worktree?" by comparing:

```sh
git rev-parse --git-dir
git rev-parse --git-common-dir
```

Run from a repo **top level**, both print `.git` and the compare works. Run from a
**subdirectory** — which is what this home is — git prints an absolute path for
`--git-dir` and a relative one for `--git-common-dir`:

```
dir=/…/coding_harness/.git   common=../.git
```

The strings differ, so the predicate returned "not primary". Because every caller
treats a scope miss as `exit 0` / inert *with no output*, this silently disabled
the cd-guard, the turn-end guard ("no turn ends blind"), and the subagent guard.
Nothing would have warned about it.

**Fix.** Pin `--path-format=absolute` on both calls. This preserves the check's
real intent exactly — a linked worktree still reports
`.git/worktrees/<name>` vs `.git` and is still correctly rejected:

| checkout | `--git-dir` | `--git-common-dir` | verdict |
| --- | --- | --- | --- |
| `coding_harness` (top level) | `…/coding_harness/.git` | `…/coding_harness/.git` | primary |
| `firstmate_workflow` (nested) | `…/coding_harness/.git` | `…/coding_harness/.git` | primary ✅ fixed |
| `fitness_agent-marketing` (linked worktree) | `…/.git/worktrees/fitness_agent-marketing` | `…/fitness_agent/.git` | inert ✅ preserved |

`bin/fm-ff-lib.sh:199` already used this flag upstream, so it is idiomatic here
rather than a workaround. Requires git ≥ 2.31; an older git errors and falls
through to the same inert result as before, so it is not a new failure mode.

**Verified.** `tests/fm-cd-pretool-check.test.sh` passes in full, including
`cd-guard: inert in a crewmate/scout task worktree (linked git worktree)`.
`tests/fm-claude-stop-autoarm.test.sh` and `tests/fm-gate-refuse.test.sh` pass.

**Upstreamable?** Yes — this is arguably a plain upstream bug. Good first PR.

---

## Known pre-existing failure (not ours)

`tests/fm-turnend-guard.test.sh` →
`not ok - Pi guard must inject once for no-tool and multi-tool logical runs`

Reproduced on pristine upstream `1e24757` with our changes stashed. The Pi harness
is not installed on this machine. Not caused by this fork.

---

## Planned deltas (not yet implemented)

- **`tmux-panes` backend** — one *pane* per task inside a routed window, replacing
  upstream's one *window* per task. Rewrites `create_task`, `kill`, and
  `agent_state` in a new `bin/backends/tmux-panes.sh`, plus registration and a
  teardown-identity branch in `bin/fm-backend.sh`.
- **Treehouse removal** — replace the pooled-worktree provider with plain
  `git worktree add` / `remove`, creating worktrees as siblings of the project
  checkout. Needs a per-project post-create setup hook to replace the warm-pool
  behaviour we give up (e.g. venv creation).
