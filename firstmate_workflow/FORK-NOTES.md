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

### 2. Worktree-tangle guard scope — `bin/fm-tangle-lib.sh`

**Why.** Same root cause as delta 1, different guard. `fm_primary_tangle_branch`
exists to catch a crewmate that branched and committed in firstmate's *own*
primary checkout instead of its disposable worktree. Its header says it outright:
"the repo root firstmate operates from".

Nested, the branch it reads belongs to `coding_harness`, not to firstmate. So
every ordinary feature branch tripped it:

```
TANGLE: primary checkout on feature branch 'firstmate-workflow' (expected 'master')
  … restore the primary with: git -C …/firstmate_workflow checkout master
```

That repair command would have checked out `master` in a repo firstmate does not
own — actively destructive advice, on a false positive that fires constantly.

**Fix.** Return inert unless `$root` *is* the git top level.

**Verified.** A standalone top-level repo on `fm/feature` still reports the
tangle (upstream behavior preserved); a nested subdirectory of the same repo is
inert. Linked worktrees still reach the detached-HEAD exemption unchanged.

**Upstreamable?** Partially — upstream may legitimately want to require a
top-level home. Worth raising as an issue rather than a PR.

### 3. Required toolchain trimmed — `bin/fm-bootstrap.sh`

`COMMON_TOOLS` went from

```sh
node git gh no-mistakes gh-axi chrome-devtools-axi lavish-axi tasks-axi quota-axi
```

to `node git gh`.

| tool | why dropped |
| --- | --- |
| `chrome-devtools-axi` | **zero shell call sites.** Agent-facing only; a Playwright harness already exists in this repo |
| `lavish-axi` | **zero shell call sites.** Kept as an optional dependency of `skills/coding/full-review.md`, unrelated to firstmate |
| `quota-axi` | only used by dispatch profiles, which are not configured. Deferred |
| `no-mistakes` | replaced by this repo's own judge fleet under `skills/coding/`. Projects run in `direct-PR` mode |
| `gh-axi` | see delta 4 |
| `tasks-axi` | deferred via `config/backlog-backend=manual`; firstmate hand-edits `data/backlog.md` in the identical format. The only hard break is `fm-backlog-handoff.sh` (secondmate handoff), which is unused |

The per-tool version gates further down the file are each guarded by
`command -v`, so they are correct no-ops while a tool is absent and start
enforcing again the moment one is installed. Left untouched deliberately.

Remaining bootstrap requirements: `tmux` and `treehouse`. Treehouse goes away
with the planned worktree-provider delta.

### 4. `gh-axi` → `gh` — `bin/fm-pr-merge.sh`

Upstream's only hard `gh-axi` call site in the entire repo. Plain `gh pr merge`
takes identical arguments, so this is a one-line drop-in. Revert this line if
`gh-axi` is ever installed.

### 5. Delivery-mode fallback → `direct-PR` — `bin/fm-project-mode.sh`

Upstream defaults every fallback to `no-mistakes off`: an unregistered project,
a legacy bracket-less registry line, and an unknown mode. The stated intent is
that "a typo never silently drops the gate" — fail toward *more* rigor.

That intent is right; its target is wrong here. `no-mistakes` is not installed
in this home, so the fallback routed work into a pipeline that does not exist.
In this fork the gate is `direct-PR` plus the reviewer fleet in
`../skills/coding/`, which makes `direct-PR` the correct fail-safe. All three
fallback sites changed; the warning on stderr is preserved.

**Verified.**

| registry line | resolves to |
| --- | --- |
| `- demo-a [direct-PR] - …` | `direct-PR off` |
| `- demo-b [local-only +yolo] - …` | `local-only on` |
| `- demo-c - …` (legacy, no bracket) | `direct-PR off` |
| *(not in registry at all)* | `direct-PR off` |

**Upstreamable?** No — this is specific to running without no-mistakes.

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
  checkout (`<project>-fm-<id>`, matching the existing hand-rolled convention).
  Deliberately dumb: no pool, no leases, no warm state, no setup hooks. Worktrees
  start cold and that is accepted. Upstream's fail-closed teardown rule — a
  worktree holding uncommitted or unlanded work refuses to be removed — must be
  preserved; it is the one part of treehouse's contract worth keeping.
