# Architecture

How firstmate works, in depth.

The [README](../README.md) carries the high-level diagram and a short synopsis.
This document expands every part of it.
firstmate's always-loaded operating contract and routing index for conditional procedures is [`AGENTS.md`](../AGENTS.md); this is the human-facing companion.

## Event-driven supervision

A zero-token bash watcher (`bin/fm-watch.sh`) sleeps on the fleet, classifies detected wakes in bash, and wakes the first mate only when something is actionable.
Repeated provably-working stale escalations on the same unchanged pane add an escalation count to the wake reason and, at `FM_WEDGE_DEMAND_INSPECT_COUNT`, a `demand-deep-inspection` marker.
A busy pane is otherwise exempt from staleness, but only until its latest `state/<id>.turn-ended` marker reaches `FM_BUSY_TURN_MAX_SECS`, or its `state/<id>.meta` spawn record reaches that age before any turn completes; past that bound it is routed through the same wedge escalation, with the identical reason, escalation count, and `demand-deep-inspection` marker, for inspection only - never an automatic interrupt, signal, or restart.
Those actionable wakes are written to a durable local queue (`state/.wake-queue`) before detector state advances, so a missed process exit can be recovered by draining the queue.
When a canonical validated PR poll returns exactly `merged`, the watcher appends that durable notification before publishing a private receipt bound to the poll's registration, bytes, file identities, metadata, provider, URL, and task ID.
The receipt makes retirement safely retryable across restarts: fixed-path recovery revalidates the same evidence, removes the runnable check first, removes its registration and data sidecars, removes the receipt last, and preserves task metadata including `pr=` and `pr_head=`.
`bin/fm-pr-lib.sh` owns the receipt format and strict identity mechanics, while `bin/fm-watch.sh` owns queue-before-retirement ordering.
No-verb wakes, such as `working:` notes and bare turn-ended signals, are benign only when `bin/fm-crew-state.sh` reports positive evidence that the crew is still working: an actively running no-mistakes step attributed to that crew's current code, or an exact busy verdict from the semantic busy-state contract.
A crew that declares `paused:` for a known external wait is separately absorbed while idle and re-surfaced only on the longer pause cadence, rather than being treated as a possible wedge.
For an ordinary crew that has stopped, the normal-mode watcher first surfaces one stale wake, then applies that same cadence to an unchanged `paused:` or durable `captain-held` endpoint only when the backend confidently reports its agent dead.
Its initial normal-mode status signal still surfaces through the no-verb path, while away mode self-handles that routine signal and owns the later recheck.
Fresh stale panes use the same current-state read before trusting the status log, so an active run or a proven busy worker outranks an old captain-relevant status-log line left behind before validation.
No-change heartbeats are also benign.
Absorbed wakes advance their suppression markers, log to `state/.watch-triage.log`, and keep the watcher blocking without a queue record or LLM turn.
After each drain, `fm-wake-drain.sh` runs the same liveness guard as the supervision scripts, so a lapsed watcher chain surfaces even on a turn that only drains and handles queued wakes.
Routine watcher polling, supervision no-ops, elapsed waiting time, and absorbed benign wakes stay silent.
A declared external wait trades that silence for one bounded recheck per pause window, so a forgotten pause cannot remain invisible indefinitely.
Crew status files are append-only wake-event logs, not current-state fields.
`bin/fm-crew-state.sh <id>` is the cheap current-state read for an actionable heartbeat review: it attributes a no-mistakes run, active or terminal, only when it matches the crew's branch and current code identity, then keeps that run-step authoritative even if the pane has closed.
The script header owns the exact run-head ancestry rules.
During no-mistakes' `ci` monitor phase, it also reads the ci step log tail because `axi status` reports both "still waiting on checks" and "checks green, waiting on merge" as `ci,running`.
The most recent recognized ci log marker wins, so checks-green monitoring reports done while a later re-arm, failed-check, or issue marker returns the crew to working.
Only when no matching run exists does it consult semantic busy state; exact busy reports working, exact idle permits fallback to a status-log event whose verb maps to a recognized run-state, and unknown or a dead pane stays unknown instead of trusting a stale log.
Decision-only events such as `resolved` never become current state or leak their prose into the current-state detail.
In that status-log fallback, a declared external wait reports the distinct `paused` state with its reason.
The semantic branch reports working only on an exact busy verdict and names the source that produced it; an unknown verdict never becomes working, never permits the status-log fallback, and never becomes a silent idle.
`bin/fm-fleet-view.sh` renders that snapshot as Markdown for humans, while `bin/fm-bearings-snapshot.sh` provides the bounded bearings projection, so both views consume one structured contract instead of reparsing raw fleet files.
The script header owns the exact JSON schema.

## Busy state is semantic, per adapter

`bin/fm-busy-lib.sh` is the single owner of what "this worker is busy" means, and `bin/fm-busy-event.sh` is the only writer of the per-task records it reads.
Every classification returns a verdict of busy, idle, unknown, or dead together with the source that produced it, so a consumer or a diagnostic can never confuse semantic state with a fallback.

Missing, malformed, stale, untrusted, or unverified semantic state is unknown, never idle, and unknown is never promoted to busy either.
Ordinary task-state consumers act only on an exact busy verdict, so an unreadable worker surfaces for a closer look instead of being absorbed as still-working or written off as finished.
Endpoint death is the only process-level override and yields dead; child processes, CPU, process sleep state, and marker modification times are not state signals.
`state/<id>.turn-ended` files remain wake notifications, not current state.

Each record is bound to an incarnation token minted when the task's wiring is armed, so an event from a superseded incarnation is rejected rather than applied, and a record left behind by one classifies unknown.
All are harness-scoped rather than a global pattern union, and none is a recorded worker state source.

## Runtime session backends

The runtime backend is the session-provider layer below firstmate's scripts.
It owns task endpoint creation, bounded capture, text/key sends, current-path reads for spawn-time worktree discovery when the backend does not create the worktree itself, live-window fallback lookup, agent-process liveness probes where verified, and endpoint teardown.
[`configuration.md`](configuration.md#runtime-backend-configbackend--fm_backend) owns new-spawn backend selection precedence and authorization.
Unknown backend names fail loudly.
For compatibility, default tmux tasks do not write `backend=tmux`; every reader treats a missing `backend=` field as `tmux`.
`fm-watch.sh` decides each window's busy state through the semantic contract above rather than by polling the backend for rendered text.
That poll loop is still the default event source for backends with no native push events, so this stays an extraction of the abstraction rather than a watcher rewrite.

## Worktrees, not branches in your checkout

For ship and scout work, `fm-spawn.sh` refuses to launch unless the resolved task path is a real git worktree root that is distinct from the project primary checkout.

The firstmate repo has one extra exposure because it can dispatch crewmates to work on itself.
Its operating checkout (`FM_ROOT`) and the disposable crewmate worktrees are all linked git worktrees of the same repository, so the valid discriminator is branch state, not whether the checkout is linked.
Only a named non-default branch checked out in `FM_ROOT` is a worktree tangle.

`fm-tangle-lib.sh` resolves the default branch from `origin/HEAD`, then local `main` or `master`, and classifies that named non-default primary branch as the tangle.
`fm-guard.sh` prints the repair command on the next mutable fleet action, while `bin/fm-session-start.sh` reports the same condition through bootstrap as a `TANGLE:` line at session start.
If another live session holds the fleet lock, both surfaces keep the alarm but switch to read-only wording with no repair command.
Ship briefs also tell the crewmate to verify `pwd -P` and `git rev-parse --show-toplevel` before creating `fm/<id>`, then stop with a blocked status if it landed in the primary checkout.

## No-mistakes gate authority boundary

Firstmate's own no-mistakes gate runs agents inside a checkout that also contains the fleet-captain identity in `AGENTS.md`, so gate execution needs an authority boundary separate from ordinary crewmate worktree isolation.
The tracked `.no-mistakes.yaml` sets `disable_project_settings: true`; no-mistakes honors that setting only from the trusted default-branch copy, so a pushed branch cannot enable its own project instructions during validation.
Independently, `fm-spawn.sh`, `fm-send.sh`, and `fm-teardown.sh` source `bin/fm-gate-refuse-lib.sh` and exit with status 3 before fleet mutation when the gate environment marker is present or the current checkout matches the default no-mistakes gate-repository topology.
A normal primary checkout or crewmate worktree has neither signal and remains unaffected.
The helper's header owns the exact signal detection, relocated-home limitation, test-harness bypass, and relationship to no-mistakes' HEAD-continuity guard.

## Two task shapes

Ship tasks change projects and ship by project mode (`no-mistakes`, `direct-PR`, or `local-only`); scout tasks leave standalone investigation reports at `data/<id>/report.md` and never push.
The intake and authority contract in `AGENTS.md` owns when separate scout research is warranted.

## Dispatch profiles

The shell scripts validate the JSON shape and verified harness/effort combinations, but they do not parse task intent, match natural-language rules, or own array selection.
The session-start bootstrap step keeps valid dispatch configuration silent unless verbose facts are enabled and surfaces a concise invalid-config line when validation fails.
When the file exists, `fm-spawn.sh` refuses crewmate and scout launches without an explicit harness, so `config/crew-harness` is only automatic when no dispatch profile file is active.
Unsupported effort values are still recorded in task meta when passed to `fm-spawn.sh`, but the launch template omits any effort flag that the selected harness does not accept.

## Project modes are explicit

`data/projects.md` records each project's delivery mode and optional `+yolo` autonomy flag.
`no-mistakes` projects run the full validation pipeline, `direct-PR` projects open PRs without that pipeline, and `local-only` projects stay local until firstmate performs an approved fast-forward merge.
When a selected delivery path calls for a diff, `bin/fm-review-diff.sh` refreshes the authoritative base and, when task meta records `pr=`, always fetches and compares against `refs/pull/<n>/head` by default (recorded `pr_head=` is only an offline fallback) before falling back to the local branch with a warning.
For target project repos shipped through their own no-mistakes pipeline, commits under `.no-mistakes/evidence/` are the pipeline's PR-viewable validation evidence and are expected to stay in the crew branch until the evidence-hosting design changes.
The firstmate repo itself is the exception: its `.no-mistakes/` directory is local state, stays gitignored, and is rejected by CI if tracked.
PR-based task merges go through `bin/fm-pr-merge.sh`, which records `pr=` and any available `pr_head=` through `bin/fm-pr-check.sh` before calling `gh-axi pr merge`.
The helper requires a full `https://github.com/<owner>/<repo>/pull/<n>` URL, invokes `gh-axi pr merge <n> --repo <owner>/<repo>`, defaults to `--squash`, preserves explicit merge-method flags, and rejects malformed URLs or repo override flags before recording merge state; a well-formed GitLab merge request URL (see [docs/gitlab-merge-watch.md](gitlab-merge-watch.md)) is refused too, explicitly, rather than sent to the wrong forge.
Teardown is fail-closed for ship worktrees: dirty worktrees refuse, and committed work must be landed before the worktree is returned.
[`bin/fm-teardown.sh`](../bin/fm-teardown.sh)'s header owns the landed-work proofs, PR-discovery fallback, and stale-lock recovery procedure.

## Project memory belongs to projects

Durable project-intrinsic agent knowledge lives in each project's committed `AGENTS.md`, with `CLAUDE.md` as a symlink.
Ship briefs prompt crewmates to create or update those files through the normal delivery path; `data/projects.md` stays a thin private registry.
Each project `AGENTS.md` carries a short `## Maintaining this file` self-governance section; `bin/fm-ensure-agents-md.sh` owns the canonical wording and injects it idempotently when creating the skeleton, promoting an existing `CLAUDE.md`, or reconciling an existing `AGENTS.md` that still lacks it.
It refuses a case-variant real memory file such as a lowercase `agents.md`, whose `CLAUDE.md` symlink would carry an uppercase literal target that dangles on a case-sensitive filesystem, and surfaces the mismatch for manual reconciliation.
The full ownership rule - what is project-intrinsic versus fleet-private, and how firstmate keeps the two apart without writing into project clones - is owned by [`AGENTS.md`](../AGENTS.md) (project and knowledge management).

## Operational memory routing

`/stow` sweeps the current session for durable knowledge that only exists in conversation and routes each finding to the most specific disk home.
Home-domain captain preferences go to `data/captain.md`, cross-domain shared captain preferences go to the primary home's `data/captain-shared.md`, fleet-local operational facts and gotchas go to home-local `data/learnings.md`, project-intrinsic knowledge goes through normal crewmate delivery into that project's committed `AGENTS.md`, and task-scoped notes or undone next steps go to the backlog.
Memory writes use inspect-then-update: read the current destination first, then rewrite or prune matching bullets or notes in place instead of appending by default.
Task-scoped notes use `tasks-axi show <id> --full` followed by `tasks-axi update <id> --body-file <path>`, adding `--archive-body` when the prior body should remain recoverable.
Generalizable firstmate knowledge goes to shared tracked docs through the normal PR pipeline; the firstmate-internal `/stow` deliberately never stores findings in either skill directory.

## Local clones stay fresh

The locked session-start bootstrap step, PR-based teardown, and merged-PR wake handling refresh remote-backed project clones when the clone is safe to move.
Clean default-branch clones fast-forward to `origin/<default>`, and a clean detached HEAD that holds no unique commits is re-attached to the default branch before the same fast-forward path runs.
Dirty clones, non-default branches, detached HEADs with unique commits, diverged defaults, and default branches checked out in another worktree are reported as `STUCK:` with their behind count and left untouched.
Fetches blocked by an orphaned `.git/packed-refs.lock` use bounded retries and remove the lock only when the shared staleness proof can prove it abandoned; [configuration.md](configuration.md#toolchain) owns the recovery details and tuning knobs.
Local-only projects, clones without an origin remote, and fetch failures remain benign skips.
The refresh also prunes local branches whose remote is gone and that no worktree still needs.

## Self-updates stay safe

The update is fast-forward only: dirty, diverged, offline, and off-default targets are reported and left untouched.
The mechanics are owned by the `/updatefirstmate` skill and firstmate's operating manual in [`AGENTS.md`](../AGENTS.md) (self-update).

## Restart-proof

Use `/stow` before an intentional reset when the conversation may hold durable knowledge that has not yet been written to disk; after that, the next firstmate session can reconcile and carry on.

## Development notes

The current watcher reliability work combines always-on bash triage with a durable queue for actionable wakes, a race-proof singleton lock, duplicate self-eviction, drain-time liveness assertion, and a self-verifying tracked-child arm wrapper.
The presence-gated sub-supervisor (`bin/fm-supervise-daemon.sh`) provides walk-away supervision via the `/afk` skill while reusing the same shared wake classifier as the always-on watcher.
