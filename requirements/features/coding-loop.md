# Coding Loop

## Overview

The Coding Loop is the fourth and final autonomous stage. It drains the ready work-order queue produced by the work-orders loop, executing each work order in dependency order — one work order at a time, each on its own `task/<task_id>` branch, each with its own PR opened on first pass and its own reviewer stack run to pass before the PR is ready for operator merge. Sequence generation is not part of this loop; it lives in the work-orders loop (`requirements/features/work-orders-loop.md`).

The operator needs this loop because per-work-order execution is where the harness actually produces shipped code. It is also where verification costs compound: every work order is independently generated and independently reviewed, so slippage in reviewer quality directly produces merged bugs. The loop solves this with a six-reviewer execution stack — two execution gates plus four LLM-as-judge gates — and an operator-driven merge gate that keeps the harness from auto-shipping anything.

Unlike the upstream loops (requirements, blueprint, work-orders), the coding loop does not use a communication folder. Each work order runs as its own generator subprocess that handles its internal gen/review cycle inside the session; the orchestrator and the per-work-order subprocesses communicate through the artifact (the diff), the PR (commits + PR comments), and the reviewer stdout. This is the right shape for execution because the artifact under review is a `git diff` that already lives on disk and in git, not a prose document that benefits from a back-and-forth conversation transcript.

## Terminology

- **Work order** — one `work-orders/wo-NNN/` directory with `description.md` (scoped-task body) and `.work-order.meta.yaml`. The work-orders loop produces and refreshes these; the coding loop reads them.
- **Ready queue** — the set of work orders whose `.work-order.meta.yaml.status` is `ready` and whose `blocked_by[]` dependencies are all `done`.
- **Per-work-order generator subprocess** — one `claude -p` subprocess per work order, with the scoped-task body injected inline as context. The generator handles its internal gen/review cycle, commits, pushes, and opens a PR on first pass.
- **Execution gate** — a deterministic gate where the reviewer subprocess runs a command and reports the exit code. `tests` and `playwright` are the two execution gates.
- **LLM-as-judge gate** — a gate where the reviewer subprocess reads the artifact (`git diff` plus relevant context) and emits a verdict. `code-spec-judge`, `code-regression-judge`, `code-security-judge`, and `code-quality-judge` are the four LLM-as-judge gates.
- **Gate declaration** — the `## Gates` block in the work order's `description.md`, which declares which gates are `required` and which are `not_applicable`. The orchestrator reads this block to decide which gates to spawn.
- **Gap** — an out-of-scope missing piece of work (missing prerequisite, latent bug, useful refactor) the per-work-order generator discovers mid-run and files as a backlog work order under `work-orders/_inbox/wo-NNN/` with a back-reference to the originator.

## Requirements

### REQ-CL-001 — Loop orchestrator subcommand and drain modes
**User Story.** As an operator, I want one CLI command that drains the ready work-order queue, so that I can drive execution without operating intermediate steps.
- **AC-CL-001.1** — When the operator runs `python -m orchestrator coding-loop`, the orchestrator shall drain all ready work orders in dependency order until the queue is empty or exhausted.
- **AC-CL-001.2** — The `--one` flag shall cause the orchestrator to execute one work order and exit.
- **AC-CL-001.3** — The coding loop shall not generate or refresh the work-order sequence; that responsibility belongs to the work-orders loop. If no work orders exist or the operator wants the sequence refreshed against changed blueprints, the operator runs `python -m orchestrator work-orders-loop` first.

### REQ-CL-002 — Queue drain in dependency order
**User Story.** As an operator, I want the orchestrator to drain the ready queue in dependency order, so that work orders run in the right order without my picking them manually.
- **AC-CL-002.1** — The orchestrator shall select the next ready work order whose `blocked_by[]` dependencies are all `done`, breaking ties by `sort_order`.
- **AC-CL-002.2** — Before spawning the per-work-order generator, the orchestrator shall transition the selected work order from `ready` to `in_progress`, initialise `harness/state/<task_id>.json`, and set `execution.branch = "task/<task_id>"`.
- **AC-CL-002.3** — The orchestrator shall drain all ready work orders in one invocation by default; `--one` shall cause it to exit after one.
- **AC-CL-002.4** — At the start of each invocation, the orchestrator shall check each `in_progress` work order for a merged PR matching its branch name `task/<task_id>` and transition any matched work order to `done` before drain selection.

### REQ-CL-003 — Per-work-order generator subprocess
**User Story.** As an operator, I want one generator subprocess per work order, running its own internal gen/review cycle, so that the orchestrator's role stays at work-order granularity and the session-internal cycle stays inside Claude Code.
- **AC-CL-003.1** — The orchestrator shall spawn one `claude -p "<prompt>"` subprocess per work order with the scoped-task body (`work-orders/wo-NNN/description.md`) injected inline as context.
- **AC-CL-003.2** — The generator shall work on branch `task/<task_id>`.
- **AC-CL-003.3** — On first internal pass, the generator shall commit, push, and open a pull request using the `open-task-pr` skill (idempotent; safe to call again if the PR already exists).
- **AC-CL-003.4** — The generator shall exit with a summary ending in a `VERDICT:` trailer that carries each gate's result.

### REQ-CL-004 — Six per-work-order reviewer subprocesses
**User Story.** As an operator, I want every diff checked against tests, Playwright, spec, regression, security, and quality gates, so that merged code passes more than just a local test suite.
- **AC-CL-004.1** — The orchestrator shall read the work order's `## Gates` block to decide which gates to spawn. Gates marked `required` shall be spawned; gates marked `not_applicable` shall be skipped.
- **AC-CL-004.2** — The orchestrator shall spawn `tests` (execution gate: runs the project's test command — typically `make test` — non-zero exit = fail).
- **AC-CL-004.3** — The orchestrator shall spawn `playwright` (execution gate via `run-playwright-check`; runs only when `playwright: required` in the work order's `## Gates` block; skipped when `playwright: not_applicable`).
- **AC-CL-004.4** — The orchestrator shall spawn `code-spec-judge` (LLM-as-judge; compares `git diff` against the work order's acceptance-criteria checklist with per-criterion reasoning, walking each `AC-WO-NNN.M` row and verifying the diff or running app satisfies the declared expected outcome).
- **AC-CL-004.5** — The orchestrator shall spawn `code-regression-judge` (LLM-as-judge; scans the diff for breakage outside changed lines: shared utilities, sibling call sites, existing tests now exercising changed paths, implicit contracts).
- **AC-CL-004.6** — The orchestrator shall spawn `code-security-judge` (LLM-as-judge; OWASP Top 10 patterns: injection, auth/authz gaps, secret handling, input validation at boundaries, crypto misuse, unsafe deserialisation, SSRF).
- **AC-CL-004.7** — The orchestrator shall spawn `code-quality-judge` (LLM-as-judge; structural maintainability plus textual quality; does not re-verify correctness).
- **AC-CL-004.8** — The four LLM-as-judge gates (`code-spec`, `code-regression`, `code-security`, `code-quality`) shall always be `required` in every work order's gate declaration; gate-skipping applies only to the two execution gates (`tests`, `playwright`).
- **AC-CL-004.9** — Reviewers shall be run in fastest-first order for short-circuit: tests → playwright → code-spec → code-regression → code-security → code-quality.
- **AC-CL-004.10** — LLM reviewer subprocesses shall run in fresh Claude Code contexts with `--disallowedTools Write,Edit,NotebookEdit,Bash` and emit their review ending in a `VERDICT:` line. Per-work-order execution does not use the communication-folder mechanism; review content lives in stdout and is captured by the orchestrator.

### REQ-CL-005 — Aggregation, retry, and PR comment mirroring
**User Story.** As an operator, I want reviewer verdicts aggregated and a final summary posted to the PR, so that the PR page is the single place I go to assess a work order's readiness.
- **AC-CL-005.1** — The orchestrator shall aggregate reviewer verdicts; on any fail, it shall re-spawn the per-work-order generator with aggregated reviews as context; the generator shall fix, push back, or file gaps.
- **AC-CL-005.2** — On all-pass for a work order, the orchestrator shall post the final summary as a comment on the open PR; the PR shall then be ready for operator merge.
- **AC-CL-005.3** — The orchestrator shall enforce a wall-clock cap per subprocess and an attempt cap per invocation; the standard `exhausted` exit applies if either is hit.
- **AC-CL-005.4** — The per-work-order generator's `VERDICT:` trailer shall carry each gate as `pass`, `fail`, or `not_run` (where `not_run` reflects gates declared `not_applicable` in the work order's `## Gates` block).

### REQ-CL-006 — Merge detection and status transition
**User Story.** As an operator, I want merged PRs detected automatically so that the next coding-loop invocation picks up from a clean state.
- **AC-CL-006.1** — When the orchestrator detects a merged PR for an `in_progress` work order (matched by branch name `task/<task_id>`), it shall transition the work order's `.work-order.meta.yaml.status` from `in_progress` to `done`.
- **AC-CL-006.2** — The orchestrator shall never auto-merge; merge is always operator-driven.

### REQ-CL-007 — Gap filing
**User Story.** As an operator, I want the per-work-order generator to file out-of-scope missing work as backlog entries, so that discovered gaps are captured without polluting the current work order's scope.
- **AC-CL-007.1** — When the per-work-order generator discovers a missing prerequisite, a latent bug adjacent to changed code, or a useful refactor outside the current work order's scope, it shall create a `backlog` work order under `work-orders/_inbox/wo-NNN/` with a back-reference to the originating work order.
- **AC-CL-007.2** — Gaps shall never auto-promote to `ready`; the operator triages `_inbox/` on their own cadence and may, after triage, move accepted gaps into the main `work-orders/` tree (typically by re-running the work-orders loop with the gap as seed input).

## Feature Behavior & Rules

The coding loop is execution-only. Sequence generation lives in the work-orders loop (`requirements/features/work-orders-loop.md`); the coding loop reads what is on disk and drains it. This split means each loop has one concern: the work-orders loop produces and verifies the sequence; the coding loop produces and verifies code per work order. The operator orders the loops manually — typically `work-orders-loop` first when blueprints have changed, then `coding-loop` to drain the queue.

The orchestrator's role stays at work-order granularity. The orchestrator spawns one generator per work order; the generator handles its own internal gen/review cycle inside the Claude Code session, commits and pushes, and opens the PR. This means the session-internal loop — where the generator writes code, runs tests, reads errors, fixes, and re-runs — happens inside the single per-work-order subprocess, not as an orchestrator cycle. The orchestrator only re-spawns the generator when the reviewer subprocesses it spawned after generator exit have flagged something the generator missed or failed to address.

The six execution reviewers are designed to catch failure modes that a test suite alone misses. Tests catch regressions in existing covered paths; Playwright catches UI behavior that does not have unit-level coverage; `code-spec-judge` catches code that passes tests but does not implement the acceptance criteria; `code-regression-judge` catches breakage to paths not yet covered by tests (shared utilities, sibling call sites); `code-security-judge` catches OWASP-class issues; `code-quality-judge` catches structural and textual issues that do not affect correctness but will rot the codebase over time. Run in fastest-first order, a failing cheap gate short-circuits the expensive LLM gates.

The gate declaration block in each work order's `description.md` (`## Gates`) is the explicit signal for which gates apply. The orchestrator does not infer "is this UI-shaped?" from the prose — it reads the YAML. `playwright: not_applicable` skips Playwright; `tests: not_applicable` skips the test runner (rare, but valid for doc-only work orders). The four LLM-as-judge gates are always `required` because their failure modes apply to every diff regardless of work-order shape.

`code-spec-judge` walks the work order's acceptance-criteria checklist mechanically. Each criterion declares its observation gate (`tests`, `playwright`, or `code-spec`) — the bare gate key, matching the keys in the `## Gates` block. `code-spec-judge` verifies criteria tagged `via code-spec` directly against the diff and verifies criteria tagged `via tests` or `via playwright` were actually exercised by their respective gates. The structured AC schema is what makes this mechanical rather than guesswork.

Merge is always operator-driven. The harness never auto-merges. This is intentional: the operator is the last line of defense before shipping. The harness gets the diff to a state where all six gates pass, posts a final summary as a PR comment, and then stops. The operator reviews the PR, merges when satisfied. On the next `coding-loop` invocation, the orchestrator detects the merge by branch name and transitions the work order to `done`.

The coding loop runs one work order at a time. Worktree-based parallelism is plausible but deferred. Non-web work orders (library, CLI) declare `playwright: not_applicable` in their `## Gates` block; a future iteration may add a behavioral surface for non-web work orders. Gap filing is supported via the `work-orders/_inbox/` mechanism; the operator triages `_inbox/` on their own cadence.

The coding loop does not use the communication-folder mechanism. Per-work-order execution review content lives in stdout (captured by the orchestrator) and on the PR (commits + posted summary comment). The artifact under review — a `git diff` — already lives on disk and in git, so the prose-conversation transcript pattern that the upstream loops use is not the right fit here.
