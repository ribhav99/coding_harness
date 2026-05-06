# Loop Driver

## Capability Summary

The loop driver is the shared upstream-loop mechanic — generator → reviewer fan-out → verdict aggregation → retry-or-pass-or-await — consumed by `requirements-loop`, `blueprint-loop`, and `work-orders-loop` subcommands. It owns the per-attempt state machine that turns a sequence of `claude -p` subprocess invocations into either a `pass` commit, an `awaiting_clarification` commit-and-pause, or an `exhausted` exit. Per-loop specialisations (artifact tree, communication folder path, reviewer set, prompt builders) are injected; the mechanic itself is one piece of code reused across the three upstream loops.

## Core Components

### Driver

```component
name: LoopDriver
container: Python Orchestrator
responsibilities:
	- Implements the per-attempt state machine: spawn generator via #SubprocessSpawner, parse generator `VERDICT:` trailer, on `awaiting_clarification` snapshot via #CommunicationFolderManager and exit 2; otherwise fan out reviewers via #SubprocessSpawner concurrently and aggregate via #VerdictAggregator
	- Owns the retry loop: on any reviewer fail, re-spawn the generator (passing only the failing-reviewer names in the retry prompt); on all-pass, snapshot via #CommunicationFolderManager and commit via #GitIntegration
	- Enforces `max_attempts` per invocation and `max_wall_minutes` per subprocess via #BudgetEnforcer; on cap-hit emits `VERDICT: exhausted` and exits 1
	- Builds spawn prompts via the per-loop prompt builders (`#RequirementsLoopPromptBuilder`, `#BlueprintLoopPromptBuilder`, `#WorkOrdersLoopPromptBuilder`)
	- Coordinates with #StateStore for `attempt_count`, `verification.<gate>`, `attempts[]`, and `history[]` field updates
```

```component
name: VerdictAggregator
container: Python Orchestrator
responsibilities:
	- Greps the final `VERDICT:` line from each reviewer subprocess's captured stdout
	- Computes `all_pass = all(v == "pass" for v in verdicts)`; treats malformed or missing `VERDICT:` lines as `fail` for aggregation purposes (per @Blueprint(subprocess-runtime) protocol-retry contract)
	- Returns the per-reviewer verdict map plus the loop-level decision (pass / fail)
```

```component
name: BudgetEnforcer
container: Python Orchestrator
responsibilities:
	- Enforces wall-clock cap (`max_wall_minutes`, default 120) per subprocess by killing the subprocess via SIGKILL and recording it as `exhausted` in #StateStore
	- Enforces attempt cap (`max_attempts`, default 25) per loop invocation; on cap-hit, snapshots via #CommunicationFolderManager and exits 1 with `verdict: exhausted` recorded in `harness/state/<loop>.json`
	- Treats rate-limit retries as out-of-budget for `max_attempts` (loop-level) but in-budget for `max_wall_minutes` (per-subprocess), per @Blueprint(subprocess-runtime)
```

The #LoopDriver consumes #VerdictAggregator and #BudgetEnforcer per attempt. The actual subprocess spawn (with the right disallowed-tools, hooks, and session-id wiring) is delegated to #SubprocessSpawner inside @Blueprint(subprocess-runtime), so the driver itself does not know about Claude Code arguments.

---

### Per-loop prompt builders

```component
name: RequirementsLoopPromptBuilder
container: Python Orchestrator
responsibilities:
	- On generator spawn: builds a prompt that names the `prd-to-frds` skill, the path to `PRD.md`, the path to `requirements/` (if exists), the path to `requirements/_questions-pending.md` (if any), and the path to `requirements_communication/` so the generator reads each reviewer's file directly
	- On reviewer spawn: builds a prompt that names the reviewer's skill (`req-spec-judge`, `req-cross-doc-judge`, `req-coverage-judge`, or `req-scoping-judge`), the artifact tree it should read, and the path to its own `requirements_communication/<reviewer-name>.md`
	- Adds the retry preamble on attempts ≥ 2 listing only failing reviewer names and the current working-tree changes since the previous attempt
```

```component
name: BlueprintLoopPromptBuilder
container: Python Orchestrator
responsibilities:
	- On generator spawn: builds a prompt naming `frd-to-blueprint`, the `requirements/features/` path, the existing `blueprints/` tree, the `blueprints/_questions-pending.md` path, the optional `BLUEPRINT.md` path, and the `blueprints_communication/` folder
	- On reviewer spawn: builds a prompt naming the reviewer's skill (`bp-spec-judge`, `bp-coverage-judge`, `bp-consistency-judge`, or `bp-decision-judge`), the artifact tree, and the path to its own `blueprints_communication/<reviewer-name>.md`
	- Adds the retry preamble on attempts ≥ 2 the same way
```

```component
name: WorkOrdersLoopPromptBuilder
container: Python Orchestrator
responsibilities:
	- On generator spawn: builds a prompt naming `blueprint-to-work-orders`, the `blueprints/` tree, the existing `work-orders/` tree (every `wo-<slug>.md` plus `_sequence.md` if present), the `work-orders/.sequence.meta.yaml`, the `work-orders/_questions-pending.md`, and the `work-orders_communication/` folder
	- On reviewer spawn: builds a prompt naming the reviewer's skill (`wo-spec-judge`, `wo-coverage-judge`, `wo-overlap-judge`, or `wo-sequencing-judge`), the artifact tree, and the path to its own `work-orders_communication/<reviewer-name>.md`
	- Adds the retry preamble on attempts ≥ 2 the same way
```

The three prompt builders share a base — retry preamble, working-tree change list — extracted into a small `prompt_helpers.py` module. Per-loop differences are confined to which skill, which artifact tree, and which communication folder path each builder writes into the prompt.

## System Contracts

### Key Contracts

- **Strictly sequential gen↔reviewer per attempt.** The driver invokes the generator, waits for exit, then fan-outs reviewers in parallel, then aggregates, then loops. No two generator/reviewer subprocesses ever overlap; the only parallelism is across reviewers within an attempt.
- **Retry isolation.** Failing reviewers' communication files are foregrounded in the retry prompt; passing reviewers are not. The generator can still read passing reviewers' files (they exist on disk in the same folder), but the prompt does not call attention to them.
- **Full re-review on every retry.** Every reviewer runs again on attempt N+1, not only the ones that failed on attempt N. A fix for one rubric can regress another.
- **Three exit verdicts.** `pass` (exit 0, all reviewers pass and questions empty), `awaiting_clarification` (exit 2, generator emitted that verdict and there are open questions), `exhausted` (exit 1, attempt cap or wall-clock cap hit). Distinct exit codes so wrapper scripts can react.
- **No-write of state files until verdict resolved.** Attempt-level state records (`attempts[]`, `verification.<gate>`) are written through to `harness/state/<loop>.json` per attempt; final `history[]` entry is written only on the loop-exit verdict.

### Integration Contracts

- **Driver entry point.** `loop_driver.run(loop_name: str, prompt_builder: PromptBuilder, reviewers: list[str], artifact_paths: list[Path], comm_dir: Path) -> int`. Returns exit code 0/1/2.
- **Reviewer fan-out.** `concurrent.futures.ThreadPoolExecutor` with one job per reviewer. Each job spawns one `claude -p` subprocess via #SubprocessSpawner and returns the captured `(stdout, stderr, exit_code, reviewer_name)`.
- **Generator verdict trailer.** `VERDICT: ready_for_review` (continue to reviewer fan-out) or `VERDICT: awaiting_clarification\nopen_questions: <N>\nquestions_file: <path>` (snapshot, commit, exit 2).
- **Reviewer verdict trailer.** `VERDICT: pass` or `VERDICT: fail`. Driver does not parse review prose.
- **State writes.** `state.record_generator_output(attempt_n, stdout)` and `state.record_reviewer_verdicts(attempt_n, [{reviewer, verdict}])` after every attempt; `state.finalise(verdict)` on loop exit.

## Architecture Decision Records

### ADR-001: Shared driver across the three upstream loops

**Context.** The three upstream loops (requirements, blueprint, work-orders) share the same gen-then-reviewer-fan-out pattern with the same dual-completion condition and the same `awaiting_clarification` exit verdict. Re-implementing the loop per subcommand would triplicate the test surface and the bug surface.

**Decision.** One `loop_driver.py` consumed by three subcommand entry points. Per-loop specialisations live in three small prompt-builder modules and the per-loop reviewer list. The coding loop does not share this driver because its mechanics differ structurally (per-WO drain, gate-declaration, generator-owned PR open).

**Consequences.** A spec change to upstream-loop mechanics edits one file. Tests can hit the driver directly without spinning up subprocesses (by injecting a mock `SubprocessSpawner`). Trade-off: the driver has to remain agnostic to per-loop content; that agnosticism is preserved by the prompt-builder split.

### ADR-002: Reviewer fan-out via ThreadPoolExecutor

**Context.** Reviewers run `claude -p` subprocesses; each is IO-bound on the model API call, not CPU-bound. Sequential fan-out would multiply latency by reviewer count. Async I/O via `asyncio` would work but adds an event-loop layer.

**Decision.** `concurrent.futures.ThreadPoolExecutor` with one thread per reviewer. Each thread shells out via `subprocess.run` and collects stdout/stderr.

**Consequences.** Wall-clock latency is bounded by the slowest reviewer rather than the sum. The race-free invariant holds because each reviewer writes only to its own communication file and captures its own stdout. Trade-off: thread per reviewer; fine since reviewer counts are 3–4 per loop and threads are cheap for IO-bound work.
