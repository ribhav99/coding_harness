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
```

to `node git gh`.

| tool | why dropped |
| --- | --- |
| `chrome-devtools-axi` | **zero shell call sites.** Agent-facing only; a Playwright harness already exists in this repo |
| `lavish-axi` | **zero shell call sites.** Kept as an optional dependency of `skills/coding/full-review.md`, unrelated to firstmate |
| `no-mistakes` | replaced by this repo's own judge fleet under `skills/coding/`. Projects run in `direct-PR` mode |
| `gh-axi` | see delta 4 |

The per-tool version gates further down the file are each guarded by
`command -v`, so they are correct no-ops while a tool is absent and start
enforcing again the moment one is installed. Left untouched deliberately.

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

**Routing** (`spawn_resolve_pane_window` in `fm-spawn.sh`): `--window <name>`,
then `$FM_PANE_WINDOW`, then `config/pane-routes` (`<kind>: <window>` lines, or
`default:`), then built-in `scout → reviews`, everything else `→ workers`.
Deliberately mechanical — routing *intent* is a judgment call belonging to

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

The root home is no longer a working home. Its `data/projects.md` says so.

effort token, because crew effort is a per-task judgment call — and AGENTS.md
section 4 explicitly says "never max without explicit captain preference". The
captain has now given that preference, as a standing "always", so it is read from
a config file on every spawn rather than left to a prompt a future session could
reason its way out of. An explicit `--effort` still wins. Ship and scout only;

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
  `git worktree add` / `remove`, creating worktrees as siblings of the project
  checkout (`<project>-fm-<id>`, matching the existing hand-rolled convention).
  Deliberately dumb: no pool, no leases, no warm state, no setup hooks. Worktrees
  start cold and that is accepted. Upstream's fail-closed teardown rule — a
  worktree holding uncommitted or unlanded work refuses to be removed — must be
