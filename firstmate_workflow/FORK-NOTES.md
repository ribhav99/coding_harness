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

### 9. Automatic post-PR review flow

`bin/fm-review-flow.sh` (new), plus a refusal and a state-file cleanup in `bin/fm-teardown.sh`, two lines in `AGENTS.md` section 7, and `tests/fm-review-flow.test.sh`.

**Why.**
Upstream's lifecycle ends a PR-based ship task at "record the PR, tell the captain".
Whether the PR then got reviewed depended on a session remembering to review it.
This makes the review a step of the lifecycle, enforced by a script rather than by prose a future session could skip - the same reasoning `config/crew-effort` (delta 8) applies to effort.

**Four stages, one per call.**
`fm-pr-check.sh` still owns stage 1 unchanged.
`fm-review-flow.sh <id>` owns the rest and advances **at most one stage per call**, which is what keeps them from overlapping:

| stage | what happens | gate |
| --- | --- | --- |
| 1 | `pr=` recorded in meta | `fm-pr-check.sh`, untouched |
| 2 | the *implementing* agent is sent one self-review line, in its own live session and worktree | endpoint exists |
| 3 | a review session starts in the routed review window, cwd = the task's own recorded worktree, prompt = the single line `/full-review this pr` | implementer provably not mid-turn |
| 4 | the implementing agent's endpoint is killed | the review endpoint exists first |

**A separate step, not a tail of `fm-pr-check.sh`.**
Two reasons, either sufficient.
`bin/fm-pr-merge.sh` *calls* `fm-pr-check.sh` again at merge time, so a launch wired into it would re-fire the whole flow on every merge.
And `fm-pr-check.sh` is the load-bearing step - it publishes the watcher's merge poll through a carefully bounded atomic sequence - so a best-effort session launch has no business inside that transaction.
Keeping it separate is what makes a failed launch inert.

**A plain session, not a tracked task.**
It has no brief, produces no deliverable, and must run *inside* the finished task's worktree - which `fm-spawn.sh` would refuse to reuse, since it allocates a fresh worktree per task and asserts isolation from the primary checkout.
A second task record would also put a non-deliverable into the backlog and into supervision's fleet inventory.
What the flow genuinely needs durably - which stage it reached, and where the review lives - is one private `state/<id>.review-flow` sidecar keyed by the implementing task's own id.

**Stage 3's gate is the interesting one.**
`bin/fm-busy-lib.sh` is the owner of "is this agent mid-turn", and it reports `unknown` - never `idle` - for missing, stale, or untrusted busy data.
Only `idle` (turn ended) or `dead` (endpoint already gone) advance; `busy` waits and returns 0, `unknown` refuses and returns non-zero.
A flow that stalls visibly is strictly better than one that kills an agent mid-commit.

**Routing** reuses `config/pane-routes` rather than hardcoding: `$FM_REVIEW_WINDOW`, then `review:`, then the existing `scout:`, then built-in `reviews`.
`default:` is deliberately *not* consulted - it maps to `workers`, which is exactly where a review must not land.

**Teardown safety.**
A review session runs in the task's worktree, so `validate_worktree_teardown_safety` gained `validate_no_live_review_session`, checked before the kind carve-out because a live review is a property of the *directory* being removed.
The **endpoint's own state** decides, never the record alone: `dead`/`missing` clear the way, everything else refuses, so a finished review can never block cleanup forever and a live one can never be silently destroyed.
`--force` stays the single explicit discard path, exactly as for unlanded work.
Teardown also removes `state/<id>.review-flow` with the rest of the volatile state.

**Backends.**
Wired for `tmux` and `tmux-panes` only - the adapters whose create/send/kill primitives take a plain cwd and a window name, and `tmux-panes` is the hand-verified path.
`herdr`, `zellij`, `orca`, and `cmux` each bind a session to a workspace or an owned worktree, so they refuse cleanly rather than guess (AGENTS.md section 4: never dispatch on an unverified adapter).
`kimi` is refused as a review harness because it rejects a positional prompt and needs `fm-spawn.sh`'s readiness gate.

**Deliberate non-sharing with `fm-spawn.sh`'s `launch_template`.**
That template's payload is a brief file routed through the operational-input carrier, plus per-task turn-end wiring and extensions.
A review session has none of those - it is a plain session taking one literal prompt - so only each adapter's verified binary, permission flag, and the effort mapping are mirrored.
Sharing the template would have meant refactoring the spawn hot path, which cannot be end-to-end tested here (see below).

**Verified:** `tests/fm-review-flow.test.sh`, 13 cases, all passing - stage ordering, single-send idempotence, no-second-review, the `unknown`-busy refusal, routing, the kill-only-after-launch rule, the record-before-send rule, and the three teardown interactions.
The test fakes tmux entirely and carries three independent isolation guards (`TMUX_TMPDIR` redirect, a PATH assertion, and high-range fixture pane ids).
**Not verified:** a live end-to-end run, because this repo is self-hosting - the changes only take effect after merge and pull, so the running first mate cannot exercise them.
The launch command this produces is byte-identical in shape to the hand-verified `claude --dangerously-skip-permissions --effort max '/full-review this pr'`.

---

## Known pre-existing failure (not ours)

`tests/fm-turnend-guard.test.sh` →
`not ok - Pi guard must inject once for no-tool and multi-tool logical runs`

Reproduced on pristine upstream `1e24757` with our changes stashed. The Pi harness
is not installed on this machine. Not caused by this fork.

`tests/fm-teardown.test.sh` →
`not ok - herdr-orphan-refusal: the successful retry never returned the isolated copy`

`bin/fm-lint.sh` → exit 1, from `SC1087` at `bin/fm-spawn.sh:1061` and `SC2317` at
`bin/fm-worktree.sh:51`.

Both reproduced on this branch's merge base with our changes stashed, in files
delta 9 does not touch. Recorded here so a future session does not mistake either
for a regression.

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
