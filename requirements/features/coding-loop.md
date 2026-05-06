# Coding Loop

## Overview

The Coding Loop is the third and final autonomous stage. It reads approved blueprints, produces an ordered sequence of work orders that together cover every blueprint's delivery surface, and then drains that sequence in dependency order — one work order at a time, each on its own `task/<task_id>` branch, each with its own PR opened on first pass and its own reviewer stack run to pass before the PR is ready for operator merge. No phase groupings; one continuous task sequence encoded by `blocked_by[]` and `sort_order` on each work order.

The operator needs this loop because per-work-order execution is where the harness actually produces shipped code. It is also where verification costs compound: every work order is independently generated and independently reviewed, so slippage in reviewer quality or in scoping discipline directly produces merged bugs. The loop solves this with two distinct reviewer stacks — three reviewers for sequence generation and six for per-work-order execution — plus an operator-driven merge gate that keeps the harness from auto-shipping anything.

## Terminology

- **Sequence generation** — the step at the start of a `coding-loop` invocation (when there are no ready work orders or when blueprints have changed since the last generation) that produces the ordered list of work orders under `work-orders/wo-NNN/`.
- **Sequence execution** — the drain phase, where the orchestrator runs one work order at a time in dependency order through its own generator-and-reviewer subprocess cycle.
- **Work order** — one `work-orders/wo-NNN/` directory with a `description.md` (scoped-task body) and a `.work-order.meta.yaml` carrying `id`, `status`, `priority`, `type`, `parent_id`, `sort_order`, `blocked_by[]`, and `blueprint_ids[]`.
- **Scoped-task body** — the canonical markdown shape of `description.md`, with `Goal`, `In scope`, `Out of scope`, `Depends on`, `Produces`, `Acceptance criteria`, and optional `Implementation notes (non-binding)` sections.
- **`.sequence.meta.yaml`** — a file at the `work-orders/` directory level recording the hash of the blueprint tree at the time the sequence was generated, used to detect when regeneration is needed.
- **Gap** — an out-of-scope missing piece of work (missing prerequisite, latent bug, useful refactor) the execution generator discovers mid-run and files as a backlog work order under `work-orders/_inbox/wo-NNN/` with a back-reference to the originator.

## Requirements

### REQ-CL-001 — Loop orchestrator subcommand and drain modes
**User Story.** As an operator, I want one CLI command that runs the coding loop, so that I can generate work orders and drive execution without operating intermediate steps.
- **AC-CL-001.1** — When the operator runs `python -m orchestrator coding-loop`, the orchestrator shall run sequence generation if needed, then drain all ready work orders in dependency order until the queue is empty or exhausted.
- **AC-CL-001.2** — The `--one` flag shall cause the orchestrator to execute one work order and exit.
- **AC-CL-001.3** — The `--gen-only` flag shall cause the orchestrator to run only sequence generation and exit without executing any implementation.

### REQ-CL-002 — Sequence-generation trigger
**User Story.** As an operator, I want the sequence to be regenerated when blueprints change, so that stale work orders do not silently execute against updated blueprints.
- **AC-CL-002.1** — At the start of a `coding-loop` invocation, the orchestrator shall compare the current blueprint-tree hash against the hash recorded in `work-orders/.sequence.meta.yaml`.
- **AC-CL-002.2** — If there are no existing work orders OR the blueprint hash differs from the recorded hash, the orchestrator shall trigger sequence generation before draining.
- **AC-CL-002.3** — After sequence generation, the orchestrator shall update `.sequence.meta.yaml` with the current blueprint hash and a generation timestamp.

### REQ-CL-003 — Sequence generator produces flat work-order tree
**User Story.** As an operator, I want the generator to produce a flat sequence of scoped work orders with a machine-readable dependency graph, so that drain order is deterministic and no phase grouping is needed.
- **AC-CL-003.1** — The sequence generator shall run with the `blueprint-to-tasks` and `scope-task` skills.
- **AC-CL-003.2** — The generator shall read every approved blueprint before producing work orders.
- **AC-CL-003.3** — The generator shall read existing work orders first so partial regeneration works correctly.
- **AC-CL-003.4** — The generator shall produce flat `work-orders/wo-NNN/` directories (no phase groupings) with a leading-zero `wo-NNN` naming so lexicographic sort matches numeric order.
- **AC-CL-003.5** — Each work order's `description.md` shall follow the scoped-task body shape (Goal; In scope; Out of scope; Depends on; Produces; Acceptance criteria; optional Implementation notes).
- **AC-CL-003.6** — Each `.work-order.meta.yaml` shall carry `blocked_by[]` references and a `sort_order` field consistent with the dependency graph.

### REQ-CL-004 — Sequence-generation reviewers
**User Story.** As an operator, I want work-order scoping, coverage, and dependencies checked before any execution begins, so that sloppy scoping does not propagate into merged code.
- **AC-CL-004.1** — The orchestrator shall spawn `wo-scoping-judge` to verify each work order is atomic (one logical change), has an observable outcome, and does not bundle multiple changes.
- **AC-CL-004.2** — The orchestrator shall spawn `wo-coverage-judge` to verify the union of work orders covers every blueprint's delivery surface with no gaps and no overlaps.
- **AC-CL-004.3** — The orchestrator shall spawn `wo-dependency-judge` to verify the `blocked_by[]` graph is acyclic, no work order references an interface produced by a not-yet-defined work order, and `sort_order` is consistent with dependencies.
- **AC-CL-004.4** — Each reviewer shall run in a fresh context with `--disallowedTools Write,Edit,NotebookEdit,Bash` and emit its review ending with a `VERDICT:` line.
- **AC-CL-004.5** — On full pass of the sequence-generation reviewers, all produced work orders shall land with `status: ready`.

### REQ-CL-005 — Sequence-execution queue drain
**User Story.** As an operator, I want the orchestrator to drain the ready queue in dependency order, so that work orders run in the right order without my picking them manually.
- **AC-CL-005.1** — The orchestrator shall select the next ready work order whose `blocked_by[]` dependencies are all `done`, breaking ties by `sort_order`.
- **AC-CL-005.2** — Before spawning the generator, the orchestrator shall move the selected work order from `ready` to `in_progress`, initialize `harness/state/<task_id>.json`, and set `execution.branch = "task/<task_id>"`.
- **AC-CL-005.3** — The orchestrator shall drain all ready work orders in one invocation by default; `--one` shall cause it to exit after one.

### REQ-CL-006 — Per-work-order generator subprocess
**User Story.** As an operator, I want one generator subprocess per work order, running its own internal gen/review cycle, so that the orchestrator's role stays at work-order granularity and the session-internal cycle stays inside Claude Code.
- **AC-CL-006.1** — The orchestrator shall spawn one `claude -p "<prompt>"` subprocess per work order with the scoped-task body injected inline as context.
- **AC-CL-006.2** — The generator shall work on branch `task/<task_id>`.
- **AC-CL-006.3** — On first internal pass, the generator shall commit, push, and open a pull request using the `open-task-pr` skill (idempotent; safe to call again if the PR already exists).
- **AC-CL-006.4** — The generator shall exit with a summary ending in a `VERDICT:` trailer.

### REQ-CL-007 — Six per-work-order reviewer subprocesses
**User Story.** As an operator, I want every diff checked against tests, Playwright, spec, regression, security, and quality gates, so that merged code passes more than just a local test suite.
- **AC-CL-007.1** — The orchestrator shall spawn `tests` (execution gate: `make test`; non-zero exit = fail).
- **AC-CL-007.2** — The orchestrator shall spawn `playwright` (execution gate via `run-playwright-check`; blocking if the work order has any UI-visible criterion; skipped otherwise).
- **AC-CL-007.3** — The orchestrator shall spawn `spec-judge` (LLM-as-judge; compares `git diff` against the work order's acceptance-criteria checklist with per-criterion reasoning).
- **AC-CL-007.4** — The orchestrator shall spawn `regression-judge` (LLM-as-judge; scans the diff for breakage outside changed lines: shared utilities, sibling call sites, existing tests now exercising changed paths, implicit contracts).
- **AC-CL-007.5** — The orchestrator shall spawn `security-judge` (LLM-as-judge; OWASP Top 10 patterns: injection, auth/authz gaps, secret handling, input validation at boundaries, crypto misuse, unsafe deserialization, SSRF).
- **AC-CL-007.6** — The orchestrator shall spawn `quality-judge` (LLM-as-judge; structural maintainability plus textual quality; does not re-verify correctness).
- **AC-CL-007.7** — Reviewers shall be run in fastest-first order for short-circuit: tests → playwright → spec → regression → security → quality.
- **AC-CL-007.8** — LLM reviewer subprocesses shall run in fresh Claude Code contexts with `--disallowedTools Write,Edit,NotebookEdit,Bash` and emit their review ending in a `VERDICT:` line.

### REQ-CL-008 — Aggregation, retry, and PR comment mirroring
**User Story.** As an operator, I want reviewer verdicts aggregated and a final summary posted to the PR, so that the PR page is the single place I go to assess a work order's readiness.
- **AC-CL-008.1** — The orchestrator shall aggregate reviewer verdicts; on any fail, it shall re-spawn the generator with aggregated reviews as context; the generator shall fix, push back, or file gaps.
- **AC-CL-008.2** — On all pass, the orchestrator shall post the final summary as a comment on the open PR; the PR shall then be ready for operator merge.
- **AC-CL-008.3** — The orchestrator shall enforce a wall-clock cap per subprocess and an attempt cap per invocation.
- **AC-CL-008.4** — The generator's `VERDICT:` trailer shall carry each gate as `pass`, `fail`, or `not_run` (for gates that do not apply — for example, `playwright` on a pure-library work order).

### REQ-CL-009 — Merge detection and status transition
**User Story.** As an operator, I want merged PRs detected automatically so that the next run of the coding loop picks up from a clean state.
- **AC-CL-009.1** — On each `coding-loop` invocation, the orchestrator shall check each `in_progress` work order for a merged PR matching its branch name `task/<task_id>`.
- **AC-CL-009.2** — When a matching PR is merged, the orchestrator shall transition the work order's `.work-order.meta.yaml.status` from `in_progress` to `done`.
- **AC-CL-009.3** — The orchestrator shall never auto-merge; merge is always operator-driven.

### REQ-CL-010 — Gap filing
**User Story.** As an operator, I want the execution generator to file out-of-scope missing work as backlog entries, so that discovered gaps are captured without polluting the current work order's scope.
- **AC-CL-010.1** — When the execution generator discovers a missing prerequisite, a latent bug adjacent to changed code, or a useful refactor outside the current work order's scope, it shall create a `backlog` work order under `work-orders/_inbox/wo-NNN/` with a back-reference to the originating work order.
- **AC-CL-010.2** — Gaps shall never auto-promote to `ready`; the operator triages `_inbox/` on their own cadence.

## Feature Behavior & Rules

The coding loop is two loops fused into one orchestrator subcommand. Sequence generation runs at most once per invocation (triggered by empty or stale work-order state) and produces a reviewed work-order sequence. Sequence execution runs zero or more times per invocation (once per ready work order) and each run is its own gen/review cycle against six reviewers. The two sub-loops share plumbing — verdict parsing, state files, budget enforcement — but their reviewer stacks and target artifacts differ.

Scope is the load-bearing concept during sequence generation. All scopes across all work orders must compose into the whole blueprint surface without gaps or overlap. `In scope` plus `Out of scope` plus `Produces` carry the contract; if scoping is sloppy, work orders either leave gaps (the coding loop produces nothing for part of a blueprint) or double up (two work orders both try to produce the same interface and the second one conflicts with the first). `wo-coverage-judge` and `wo-scoping-judge` are the last line of defense before this propagates into execution.

During execution, the orchestrator's role stays at work-order granularity. The orchestrator spawns one generator per work order; the generator handles its own internal gen/review cycle, commits and pushes, and opens the PR. This means the session-internal loop — where Claude Code subagents evaluate the diff and push back for fixes — happens inside the single generator subprocess, not as an orchestrator cycle. The orchestrator only re-spawns the generator when the reviewer subprocesses it spawned after generator exit have flagged something the generator missed or failed to address.

The six execution reviewers are designed to catch failure modes that a test suite alone misses. Tests catch regressions in existing covered paths; Playwright catches UI behavior that does not have unit-level coverage; `spec-judge` catches code that passes tests but does not implement the acceptance criteria; `regression-judge` catches breakage to paths not yet covered by tests (shared utilities, sibling call sites); `security-judge` catches OWASP-class issues; `quality-judge` catches structural and textual issues that do not affect correctness but will rot the codebase over time. Run in fastest-first order, a failing cheap gate short-circuits the expensive LLM gates.

Merge is always operator-driven. The harness never auto-merges. This is intentional: the operator is the last line of defense before shipping. The harness gets the diff to a state where all six gates pass, posts a final summary as a PR comment, and then stops. The operator reviews the PR, merges when satisfied. On the next `coding-loop` invocation, the orchestrator detects the merge by branch name and transitions the work order to `done`.

The coding loop runs one work order at a time. Worktree-based parallelism is plausible but deferred. Non-web task shapes (library, CLI) need a different behavioral surface than Playwright — `playwright` is `not_run` for those, and a future iteration may add a behavioral surface for non-web work orders. Gap filing is supported via the `work-orders/_inbox/` mechanism; the operator triages `_inbox/` on their own cadence.
