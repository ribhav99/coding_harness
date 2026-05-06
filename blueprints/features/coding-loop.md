# Coding Loop

## Feature Summary

The coding loop is the fourth and final autonomous stage. It drains the ready work-order queue produced by the work-orders loop in dependency order, executing one work order at a time on its own `task/<task_id>` branch with its own PR opened on first internal pass. A six-reviewer execution stack — two execution gates plus four LLM-as-judge gates — verifies each diff before the orchestrator posts the final summary as a PR comment; the operator merges. The loop is execution-only — sequence generation lives in the work-orders loop. See @Requirements(coding-loop) for the FRD this blueprint satisfies.

## Component Blueprint Composition

This feature composes:

- **@Blueprint(subprocess-runtime)** — `#SubprocessSpawner` for `claude -p` invocations; `#StopHookGenerator` enforces the per-WO generator's per-gate `VERDICT:` trailer; `#StopHookReviewer` enforces each reviewer's `VERDICT: pass|fail` trailer; `#RateLimitRetryStrategy` and `#ProtocolRetryStrategy` recover from infrastructure throttling and malformed verdicts. The `#ReviewerPathGuardHook` is **not** active for coding-loop reviewers (which run with `Write,Edit,NotebookEdit,Bash` disallowed).
- **@Blueprint(state-store)** — `#StateStore` writes `harness/state/<task_id>.json` and `harness/state/coding-loop.json`; `#ReviewSnapshotter` archives per-WO reviewer stdout into `harness/state/reviews/coding-loop/<task-id>/attempt-<N>/<reviewer-name>.md`. (Per-WO execution does not use a communication folder; reviewer prose lives in stdout, archived directly.)
- **@Blueprint(local-planner)** — `#LocalPlanner.get_next_ready()` selects the next ready work order in dependency order; `#LocalPlanner.update_status()` transitions work orders through `ready → in_progress → done`.
- **@Blueprint(git-integration)** — `#BranchManager` ensures `task/<task_id>` branches; `#PROperationLayer` mediates GitHub CLI calls; `#MergeDetector` polls merged-PR state at invocation start; `#PRCommentMirror` posts the per-WO final summary on all-pass.
- **@Blueprint(agents-and-skills)** — `#CodingGeneratorAgent` is the IC identity loading the `open-task-pr` skill plus coding capabilities; `#CodingReviewerAgents` are the six per-WO execution reviewers (`tests-runner`, `playwright-runner`, `code-spec-judge`, `code-regression-judge`, `code-security-judge`, `code-quality-judge`).
- **@Blueprint(github)** — The external system PRs are opened on, comments are posted to, and merges are detected on.
- **@Blueprint(mirror-adapter)** — `#MirrorPushOrchestrator` pushes per-WO status changes and PR comments to configured outbound mirrors.

This loop does **not** use @Blueprint(loop-driver) or @Blueprint(communication-folder). The coding loop has its own driver because its mechanics differ structurally — per-WO drain, gate-declaration-based reviewer set, generator-owned PR open. Per-WO execution communicates through the PR (commits + comments) and reviewer stdout, not through a conversation transcript folder.

## Feature-Specific Components

```component
name: CodingLoopDriver
container: Python Orchestrator
responsibilities:
	- Implements `python -m orchestrator coding-loop [--one]` drain logic
	- At invocation start: invokes `#MergeDetector` to transition any merged `in_progress` work orders to `done`
	- Drain step: invokes `#LocalPlanner.get_next_ready()` (returns None → exit 0); transitions WO to `in_progress`; initialises `harness/state/<task_id>.json`; sets `execution.branch = "task/<task_id>"`; invokes `#BranchManager.ensure_task_branch`
	- Spawns `#CodingGeneratorAgent` via `#SubprocessSpawner` with the scoped-task body (`work-orders/wo-NNN/description.md`) injected inline
	- After per-WO generator exit: reads the work order's `## Gates` block via `#GateDeclarationReader`; spawns the `required` reviewer subprocesses (skipping `not_applicable`) in fastest-first order via `#GateOrchestrator`; aggregates verdicts
	- On any-fail: re-spawns `#CodingGeneratorAgent` with aggregated reviews as context; gen handles fix / push back / file gap (per `#GapFiler`)
	- On per-WO all-pass: invokes `#PRCommentMirror` to post the final summary, then `#MirrorPushOrchestrator` for outbound mirrors
	- By default, drains every ready work order in this invocation; `--one` exits after one
```

```component
name: GateOrchestrator
container: Python Orchestrator
responsibilities:
	- Reads the work order's `## Gates` block and spawns required gates in fastest-first order: `tests` → `playwright` → `code-spec-judge` → `code-regression-judge` → `code-security-judge` → `code-quality-judge`
	- Skips gates declared `not_applicable`; the four LLM-as-judge gates are always `required` per @Feature(work-orders-loop)
	- Short-circuits aggregate verdict on any-fail (does not run remaining gates) when the failure is structural and obvious; otherwise runs the full set so the operator sees a complete failure profile
	- Returns the per-gate verdict map plus the aggregate pass/fail decision
```

```component
name: GateDeclarationReader
container: Python Orchestrator
responsibilities:
	- Parses the work order's `description.md` `## Gates` fenced YAML block
	- Returns a typed view: `{tests, playwright, code-spec, code-regression, code-security, code-quality}` each `required` or `not_applicable`
	- Validates the four LLM-as-judge gates are always `required` (per the work-order document shape contract); reports a structural error if not
```

The per-WO generator runtime entity is `#CodingGeneratorAgent` from @Blueprint(agents-and-skills); the coding loop does not redefine it. Coding-loop-specific framing on top of that shared definition: the agent is spawned per work order with the scoped-task body inlined; it handles its own internal gen/review cycle inside the session (writes code, runs tests locally, fixes, re-runs); on first internal pass it commits, pushes, and opens a PR via `open-task-pr` (idempotent); on subsequent orchestrator-spawned attempts (because the post-exit reviewer stack flagged something) it pushes additional commits to the same branch; it files gaps via #GapFiler to `work-orders/_inbox/wo-NNN/`; and it exits with a stdout summary ending in a `VERDICT:` trailer listing each gate's result (`pass`, `fail`, `not_run`). All of that is `#CodingGeneratorAgent`'s responsibility surface — this paragraph is contextual prose, not a new component.

```component
name: GapFiler
container: Claude Code Subprocess
responsibilities:
	- When the per-WO generator discovers a missing prerequisite, a latent bug adjacent to changed code, or a useful refactor outside the current work order's scope, creates a `backlog` work order under `work-orders/_inbox/wo-NNN/` with a back-reference to the originating work order
	- Gaps never auto-promote to `ready`; the operator triages `_inbox/` on their own cadence
	- Filed gaps follow the same canonical scoped-task body shape as in-tree work orders (per @Feature(work-orders-loop) REQ-WO-002)
```

```component
name: TestsRunner
container: Claude Code Subprocess
responsibilities:
	- Execution gate (deterministic): runs the project's test command (typically `make test`)
	- Reports the exit code as `pass` or `fail` (non-zero exit = fail)
	- Runs first in fastest-first order
```

```component
name: PlaywrightRunner
container: Claude Code Subprocess
responsibilities:
	- Execution gate via `run-playwright-check`: boots the dev server, runs the Playwright suite, tears down
	- Runs only when `playwright: required` in the work order's `## Gates` block; skipped when `playwright: not_applicable`
	- Runs second in fastest-first order
```

```component
name: CodeSpecJudge
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge: compares `git diff` against the work order's acceptance-criteria checklist with per-criterion reasoning
	- Walks each `AC-WO-NNN.M` row and verifies the diff or running app satisfies the declared expected outcome
	- For criteria tagged `via tests` or `via playwright`, verifies they were actually exercised by their respective execution gates; for criteria tagged `via code-spec`, verifies directly against the diff
	- Catches code that passes tests but does not implement the acceptance criteria
```

```component
name: CodeRegressionJudge
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge: scans the diff for breakage outside changed lines — shared utilities, sibling call sites, existing tests now exercising changed paths, implicit contracts
	- Catches breakage to paths not yet covered by tests
```

```component
name: CodeSecurityJudge
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge: OWASP Top 10 patterns — injection, auth/authz gaps, secret handling, input validation at boundaries, crypto misuse, unsafe deserialisation, SSRF
```

```component
name: CodeQualityJudge
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge: structural maintainability plus textual quality
	- Does not re-verify correctness (tests + spec-judge cover that); focuses on structure and readability
```

The six-reviewer execution stack is fixed; each work order's `## Gates` block toggles `tests` and `playwright` between `required` and `not_applicable`. The four LLM-as-judge gates are always `required`.

## System Contracts

### Key Contracts

- **Execution-only.** Sequence generation lives in @Feature(work-orders-loop). The coding loop reads what is on disk and drains it.
- **One work order at a time.** Single working tree, single sequential drain. Worktree-based parallelism is plausible but deferred.
- **Per-WO generator owns commits and PR open.** The orchestrator does not commit per-WO code; the generator does, as part of its internal flow. Per-WO commits live on `task/<task_id>` branches.
- **No auto-merge.** Merge is always operator-driven. The orchestrator detects merged PRs at the start of each `coding-loop` invocation and transitions WOs to `done`.
- **No communication folder.** Per-WO execution communicates through the PR (commits + posted summary comment) and reviewer stdout. The coding loop is execution-only and the artifact under review is `git diff`, which already lives on disk and in git — the prose-conversation transcript pattern does not fit.
- **Six-reviewer fixed stack; gate declaration toggles two.** `tests` and `playwright` may be `not_applicable`; the four LLM-as-judge gates are always `required`.
- **Fastest-first reviewer order.** Tests → playwright → code-spec → code-regression → code-security → code-quality. A failing cheap gate short-circuits expensive LLM gates when the orchestrator decides not to run the remaining set.
- **Gap filing without auto-promotion.** Gaps go to `work-orders/_inbox/`; operator triages.
- **One PR comment per work order.** The final pass-summary, posted only when all required gates have passed.
- **Standard `exhausted` exit applies.** Wall-clock cap and attempt cap apply per work order; either causes the WO to exit `exhausted` and the coding loop to move to the next one (or stop on `--one`).

### Integration Contracts

- **Subcommand.** `python -m orchestrator coding-loop`, with `--one` to run a single work order. Exit code: 0 (drain complete or `--one` succeeded), 1 (per-WO exhausted), 2 (none — coding loop has no `awaiting_clarification`).
- **Branch convention.** `task/<task_id>` for the per-WO branch.
- **PR convention.** One PR per work order, opened by the per-WO generator via `open-task-pr` (idempotent).
- **State files.** `harness/state/<task_id>.json` (per-WO) and `harness/state/coding-loop.json` (loop-level).
- **Reviews archive.** `harness/state/reviews/coding-loop/<task-id>/attempt-<N>/<reviewer-name>.md` — captured stdout, not communication-file snapshot.
- **Per-WO generator verdict trailer.** `VERDICT:` line carrying each gate result (`pass`, `fail`, `not_run`); the orchestrator parses the trailer for both control flow and `verification.*` field updates in the per-WO state.
- **Reviewer verdict trailer.** `VERDICT: pass` or `VERDICT: fail`. Captured stdout is the full review prose.
- **Gate declaration block.** YAML inside `## Gates` in the work order's `description.md`. Schema pinned in @Feature(work-orders-loop) REQ-WO-002.

## Architecture Decision Records

### ADR-001: No communication folder for the coding loop

**Context.** The upstream loops use the communication-folder mechanism for the gen↔reviewer back-and-forth. Per-WO execution could plausibly adopt the same. But the artifact under review in the coding loop is a `git diff` that already lives on disk and in git, not a prose document; the conversation pattern does not fit.

**Decision.** No communication folder. Per-WO reviewers run with `Write,Edit,NotebookEdit,Bash` disallowed and emit their full review as stdout. The orchestrator captures stdout and archives it directly.

**Consequences.** Reviewer subprocesses are simpler (no file appending). The PR's commit history and the orchestrator-posted summary comment carry the operator-facing record. Trade-off: there is no place for a per-WO generator to append a push-back to a specific reviewer; the per-WO generator pushes back inline in its next attempt's commit messages or by editing its diff. Acceptable because per-WO scope is narrow and pushes-back are rare in execution.

### ADR-002: Per-WO generator owns commits and PR open; orchestrator owns comment and merge detection

**Context.** Splitting commit/push between orchestrator and generator was an option (orchestrator commits after a clean generator exit). But that would require the orchestrator to know about code-shaped artifacts and to interpret when a per-WO generator is "done" versus "needs another attempt".

**Decision.** Per-WO generator commits, pushes, and opens the PR inside its subprocess. Orchestrator posts the final pass-summary comment after the per-WO reviewer stack reports all-pass. Merge detection is the orchestrator's read-only check at invocation start.

**Consequences.** The generator's internal cycle (write code, run tests, fix, re-commit) stays inside the session where iteration is cheap. The orchestrator's role stays at WO granularity. Trade-off: the per-WO generator needs `Bash` access (to run `git`, `gh`, project-specific commands); reviewers explicitly do not.

### ADR-003: Gate declaration in the work-order body, not in the orchestrator

**Context.** The orchestrator could infer "is this a UI work order?" from prose or from a heuristic. But heuristics are wrong sometimes; the operator (via the work-orders generator) is the right party to declare which gates apply.

**Decision.** Each work order declares which gates apply in its `## Gates` block. The orchestrator reads the block and spawns the required gates. The four LLM-as-judge gates are always `required` (because their failure modes apply to every diff regardless of WO shape); `tests` and `playwright` may be `not_applicable`.

**Consequences.** No heuristic ambiguity. Doc-only and pure-library work orders explicitly skip Playwright. Trade-off: the work-orders generator must produce a correct `## Gates` block; verified by `wo-coverage-judge` (per @Feature(work-orders-loop)) cross-referencing the block with the acceptance criteria's `via <gate>` tags.

### ADR-004: Operator-driven merge as the last gate

**Context.** Auto-merge on all-gates-pass would close the loop autonomously. But the harness's safety posture is to keep the operator as the last line of defence before shipping.

**Decision.** Merge is always operator-driven. The harness pushes the diff to a state where all required gates pass, posts the summary, then stops. Merge happens on GitHub; the orchestrator detects it post-facto on the next invocation.

**Consequences.** The operator decides when to ship. Wrong-turn diffs do not auto-merge. Trade-off: the operator must merge manually; aligned with the single-operator persona.
