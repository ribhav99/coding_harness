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

### 4. `gh-axi` → `gh` — `bin/fm-pr-merge.sh`, `bin/fm-teardown.sh`

**Two** call sites, not one.

`fm-pr-merge.sh:84` — `gh pr merge` takes identical arguments. Clean drop-in.

`fm-teardown.sh:377` (`pr_number_from_branch`) — **not** a clean drop-in, and the
failure would have been silent. Upstream parsed the leading field of a
comma-delimited TOON row:

```sh
sed -n 's/^[[:space:]]*\([0-9][0-9]*\),.*/\1/p'
```

Plain `gh pr list` emits a TAB-delimited table, so that sed matches nothing. The
function is fail-safe by design — any failure means "no PR found" — so swapping
the binary alone would have made teardown silently decide landed work had no PR,
and then refuse to tear it down. Switched to
`--json number --jq '.[0].number'`, which gh resolves with its own embedded jq
(no external jq dependency) and which prints the bare number.

**Lesson for future AXI removals:** an AXI tool's *output format* is part of its
contract, not just its name. Grep for the parse, not only the invocation.

Verified: zero `gh-axi` invocations remain in `bin/`; the `--json` path returns
empty on no match, preserving fail-safe behavior.

#### Capabilities lost with the AXI suite

Not everything degrades gracefully. Known gaps:

| script | without the tool |
| --- | --- |
| `bin/fm-session-start.sh` | degrades cleanly — falls back to title-line backlog rendering |
| `bin/fm-decision-hold.sh` | **hard-requires** `tasks-axi`; durable captain-held decisions are unavailable |
| `bin/fm-backlog-handoff.sh` | **hard-requires** `tasks-axi`; secondmate backlog handoff unavailable (unused) |
| `bin/fm-public-followup.sh` | **hard-requires** `tasks-axi`; X mode only (off) |
| `bin/fm-home-seed.sh` | **hard-requires** `no-mistakes` to seed a secondmate home (unused) |

**Update:** `tasks-axi` 0.2.4 IS now installed. `bin/fm-decision-hold.sh`
backs durable captain decision holds, and scout teardown verifies them, so it
is load-bearing for review work. The backlog itself still uses
`config/backlog-backend=manual`.

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

### 6. Treehouse removed — `bin/fm-worktree.sh` (new), `fm-spawn.sh`, `fm-teardown.sh`, `fm-backend.sh`, `fm-bootstrap.sh`

Task worktrees are now plain `git worktree` siblings of the project checkout,
created per task and deleted on teardown. No pool, no leases, no warm state.
`bin/fm-worktree.sh` is the provider; its header owns the full contract.

**Spawn.** Upstream created the pane in the *project* directory, sent the literal
text `treehouse get` into it, then polled `pane_current_path` for up to 60
seconds waiting for treehouse's subshell to `cd` — needing two consecutive
agreeing reads, because a brand-new pane can transiently report an unrelated
stale path that would otherwise be recorded as the worktree in
`state/<id>.meta`. That entire race exists only because treehouse hands out a
worktree by opening a subshell inside it.

Now the worktree is created *before* the endpoint and the pane opens directly
inside it. No send, no poll, no race, and up to 60s of worst-case spawn latency
gone. `validate_spawn_worktree` still runs — it is the isolation assertion.

**Teardown.** `teardown_treehouse_return` keeps its name and all of its
stale-`index.lock` retry machinery, which is still correct: the matcher greps
*git's* own `Unable to create '...index.lock': File exists`, which treehouse
merely surfaced, and `git worktree remove` fails identically. Only the command
changed.

**Two bugs found while testing this, both mine:**

1. **Trap name collision.** `fm-spawn.sh:354` already had
   `trap spawn_abort_cleanup EXIT` — a flag-gated handler for herdr/orca abort
   cleanup. Defining a second function with that name later in the file silently
   overrode it, so an *unguarded* cleanup ran on every exit including success:
   the worktree was created, the pane opened in it, and then it was deleted a
   moment later. It also destroyed herdr/orca abort cleanup. Fixed by following
   the file's existing pattern instead — a `WORKTREE_ABORT_CLEANUP` flag armed
   after creation, disarmed after the meta write, handled inside the original
   trap alongside the orca and herdr blocks.
2. **`BASH_SOURCE` resolution.** The provider resolved its own directory in a
   way that broke when sourced from zsh, silently losing `fm_default_branch`.
   Now guarded, with a `$0` fallback and a loud error.

`fm_worktree_path` resolves the project's PHYSICAL path before deriving the
sibling name. That matters for a project symlinked under `projects/` at a
checkout living elsewhere: without it the worktree would be derived from the
symlink's own parent and land inside the firstmate home. With it, worktrees sit
beside the real checkout. Verified live against the captain's own
`fitness_agent`: a task worktree appeared as `fitness_agent-fm-<id>` at detached
HEAD from `origin/master`, the captain's `release/2.2.0` branch and clean tree
were untouched, their four pre-existing worktrees were untouched, and teardown
restored the worktree list exactly.

**Verified end to end** against a scratch repo:

| | |
| --- | --- |
| spawn | worktree created as a sibling, git registers it, detached HEAD, pane cwd IS the worktree |
| teardown | directory removed, registration pruned, endpoint killed |
| abort | endpoint step forced to fail after creation → no orphan directory, no stale registration |

**Still treehouse-dependent:** `bin/fm-home-seed.sh` (`treehouse get --lease`)
for secondmate homes, which this fork does not use. `fm-bootstrap.sh`'s
`treehouse_supports_lease` gate is inert but left in place.

### 7. `tmux-panes` backend — `bin/backends/tmux-panes.sh` (new) + registrations

A sixth runtime backend that places each task as a tiled **pane inside a routed
window**, instead of one window per task. Selected via `config/backend`.

**Not a copy of `backends/tmux.sh`.** It sources the stock adapter and delegates
all eight unchanged functions to it, so upstream fixes to capture, submit,
composer handling and current-path keep flowing through. Only three functions
are reimplemented, because only three are window-shaped:

| function | stock tmux | tmux-panes |
| --- | --- | --- |
| `create_task` | `new-window` | `split-window` into the routed window, then `select-layout tiled` |
| `kill` | `kill-window` | `kill-pane`, then re-tile the survivors |
| `agent_state` | window-**name** membership | pane-**id** membership |

**Identity is stronger, not weaker.** The stock adapter identifies a task by
window name and carries a workaround for it — names can be renamed out from
under you, so it pins `automatic-rename`/`allow-rename` off. Pane ids are
server-unique and immutable for the pane's lifetime. Meta records
`window=%<pane-id>`, and `fm_backend_validate_task_endpoint` gained a
`tmux-panes` branch binding identity through `endpoint_task_id=`, exactly as the
herdr/zellij/cmux branches do.

**Routing** (`spawn_resolve_pane_window` in `fm-spawn.sh`): `--window <name>`,
then `$FM_PANE_WINDOW`, then `config/pane-routes` (`<kind>: <window>` lines, or
`default:`), then built-in `scout → reviews`, everything else `→ workers`.
Deliberately mechanical — routing *intent* is a judgment call belonging to
firstmate at intake, the same split `config/crew-dispatch.json` uses.

**Registrations:** `FM_BACKEND_KNOWN`, `FM_BACKEND_SPAWN`,
`fm_backend_required_tools`, `fm_backend_source`, six dispatch arms and
`fm_backend_target_exists` in `fm-backend.sh`; four dispatch arms, the
`--window` flag, the routing resolver and a `tmux-panes)` create branch in
`fm-spawn.sh`.

**A bug found by testing, not by reading.** The placeholder-replacement step —
which lets the first task replace the idle shell a fresh window starts with —
originally classified a pane as a placeholder if the window held exactly one
pane running a shell. A task pane whose agent has not finished launching *also*
reports a shell, so the second task into a window killed the first task's live
pane. Fixed by requiring the pane's title to not start with `fm-`: every pane
this adapter creates is titled `fm-<id>`, so a task pane is unmatchable
regardless of what it is running at that instant.

**Verified end to end:** 3 ship + 2 scout tasks route to `workers`/`reviews`
respectively, tile evenly, and carry `fm-<id>` pane titles; tearing down a middle
pane reflows the survivors and leaves neighbouring worktrees intact; the last
teardown in a window closes it; no orphan worktrees or stale registrations.

**Upstream bug found while smoke-testing a real agent.** Claude Code renames its
own process to its VERSION STRING, so `pane_current_command` reports e.g.
`2.1.220`, not `claude`. Upstream's harness classifier matches `*claude*`, so a
live Claude agent classified as `ambiguous` rather than `alive`. This affects
upstream's stock `backends/tmux.sh` identically — same pattern list — so it is
not introduced here. It is fail-safe (only `dead`/`missing` authorize recovery,
so no duplicate agents), but session start cannot confirm agents are alive.
`backends/tmux-panes.sh` adds a bare-semver arm; the stock adapter is left
untouched so the difference stays visible. Worth reporting upstream.

Fail-closed gates all survive the fork. A scout still refuses teardown without
`data/<id>/report.md`, and then again until
`bin/fm-decision-hold.sh complete <id> --none` attests its decision inventory.

### 8. Per-project homes + standing crew effort

**One control panel per project.** Each project gets its own tmux session
`fm-<project>` (tabs: control / workers / reviews) and its own `FM_HOME` under
`homes/<project>/`. The code — `bin/`, `AGENTS.md`, skills — is shared from
`FM_ROOT`; only private state (`data/`, `state/`, `config/`, `projects/`) is
per-project. Sessions are created with `tmux new-session -e FM_HOME=…` plus
`set-environment`, so crew panes inherit it.

cwd deliberately stays `FM_ROOT` in every session while `FM_HOME` varies: the
hooks in `.claude/settings.json` resolve through `$CLAUDE_PROJECT_DIR`, which
must remain the code checkout. Verified: a second home resolves its own registry,
bootstraps clean off the shared `bin/`, keeps the guards active, and takes its own
session lock.

**`homes/` added to `.gitignore`.** A per-project home is machine-local
operational state by definition, so no part of it is ever committed. Every child
directory a home actually contains (`data/`, `state/`, `config/`, `projects/`)
was already covered, because those patterns are unanchored and so match at any
depth — but only by coincidence of naming. Without `homes/` itself ignored, any
future file placed *directly* under `homes/<project>/`, or in a subdirectory not
named after one of those four, would become trackable, and a `git pull` on
another machine could then clobber the local registry it belongs to. Ignoring the
whole tree makes that structural instead of incidental.

**`fmp` is deliberately NOT in this repo.** The launcher that builds the session
described above hardcodes an absolute `FM_ROOT`, so it is per-machine and lives
at `~/.local/bin/fmp` rather than in `bin/`. It creates the session with
`-e FM_HOME=…` plus `set-environment`, pins `automatic-rename`/`allow-rename` off
on all three windows (window names are how `fm-spawn.sh` routes: `scout` →
`reviews`, everything else → `workers`), splits `control` with the first mate on
the left at `FM_ROOT` and a project shell on the right at the checkout's
*physical* path, and re-attaches instead of rebuilding when the session already
exists — a rebuild would strand live task panes and their worktrees.

**The standing `--dangerously-skip-permissions --effort max` preference now covers
the primary too, not just the crew.** `bin/fm-spawn.sh:484` already hardcodes
skip-permissions for a claude crewmate and fills `__EFFORTFLAG__` from
`config/crew-effort`, so crew panes were already compliant. The gap was the first
mate itself, which `fmp` originally launched as bare `claude`; it now launches
`claude --dangerously-skip-permissions --effort max`, overridable per-invocation
with `FMP_CLAUDE_CMD`. Recorded in each home's `data/captain.md`, because it is
exactly the explicit captain preference that AGENTS.md section 4's "never max
without explicit captain preference" rule defers to.

**Window numbering starts at 1.** `~/.tmux.conf` sets `base-index 1`,
`pane-base-index 1`, and `renumber-windows on`, so a project session reads
control=1 / workers=2 / reviews=3. `fmp` re-applies the base-index before creating
the session if the effective value is still 0, so a machine with no tmux config
gets the same layout. Safe for this fork specifically: delta 7 targets windows by
NAME and panes by immutable pane id, never by index, and `fm-spawn.sh` appends
with a trailing colon precisely so a non-default base-index cannot collide.

The root home is no longer a working home. Its `data/projects.md` says so.

**`config/crew-effort` (new).** Upstream has no crew equivalent of the secondmate
effort token, because crew effort is a per-task judgment call — and AGENTS.md
section 4 explicitly says "never max without explicit captain preference". The
captain has now given that preference, as a standing "always", so it is read from
a config file on every spawn rather than left to a prompt a future session could
reason its way out of. An explicit `--effort` still wins. Ship and scout only;
secondmates keep their own contract.

Both homes also pin `config/crew-harness=claude`.
`--dangerously-skip-permissions` was already in upstream's claude launch template.

Verified: meta records `effort=max`, and the pane's command is
`claude --dangerously-skip-permissions --effort 'max'`.

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
