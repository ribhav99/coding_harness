# Python Orchestrator

## Feature Summary

The Python orchestrator feature is the cross-session runtime that drives every autonomous loop in the harness — a single Python program with five CLI subcommands (`requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, `status`) that spawns Claude Code subprocesses, parses `VERDICT:` lines, manages communication folders, transitions state on disk, enforces budgets, and posts PR comments. Implementation surface comes from the @Blueprint(python-orchestrator) container plus every cross-cutting capability used by every loop. See @Requirements(python-orchestrator) for the FRD this blueprint satisfies.

## Component Blueprint Composition

This feature composes essentially every component blueprint in the harness:

- **@Blueprint(loop-driver)** — `#LoopDriver` is the per-attempt state machine consumed by all three upstream-loop subcommands. `#VerdictAggregator` and `#BudgetEnforcer` are the driver's per-attempt collaborators.
- **@Blueprint(subprocess-runtime)** — `#SubprocessSpawner` is how every `claude -p` invocation is built and run. `#SessionContinuity` carries `--session-id` / `--resume` across attempts. `#RateLimitClassifier` + `#RateLimitRetryStrategy` handle infrastructure throttling. `#ProtocolRetryStrategy` recovers from malformed verdict trailers post-exit.
- **@Blueprint(communication-folder)** — `#CommunicationFolderManager` and `#CommunicationFolderSnapshotter` ensure-and-snapshot the upstream-loop conversation transcripts.
- **@Blueprint(questions-pending)** — `#QuestionsPendingDetector` reads each upstream-loop's `_questions-pending.md` after generator exit and triggers `awaiting_clarification` when needed.
- **@Blueprint(meta-materialization)** — `#MetaMaterialiser` walks artifact trees post-generator-exit to materialise dotted-hidden meta files. `#BlockedByMaterialiser` is the work-orders-specific specialisation.
- **@Blueprint(state-store)** — `#StateStore` is the only writer of `harness/state/<loop>.json` and `harness/state/<wo-slug>.json`. `#ReviewSnapshotter` is the snapshotting collaborator. `#StatusReporter` powers `python -m orchestrator status`.
- **@Blueprint(git-integration)** — `#GitIntegration` for commits; `#BranchManager` for task branches; `#PROperationLayer` + `#MergeDetector` + `#PRCommentMirror` for the coding-loop's GitHub interactions.
- **@Blueprint(local-planner)** — `#LocalPlanner` is the work-orders queue reader/writer consumed by the coding loop's drain.
- **@Blueprint(mirror-adapter)** — `#MirrorAdapter` Protocol plus configurable concrete mirrors (`#SoftwareFactoryMirror`, etc.). `#MirrorPushOrchestrator` is the per-WO push driver.

The orchestrator's container blueprint (@Blueprint(python-orchestrator)) describes the boundary; this feature blueprint describes the wiring.

## Feature-Specific Components

```component
name: CLIEntryPoint
container: Python Orchestrator
responsibilities:
	- Implements `python -m orchestrator <subcommand>` via `argparse`-driven dispatch in `orchestrator/main.py`
	- Five subcommands: `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, `status`
	- Loop subcommands accept flags: `--memoryless` (forces fresh sessions per attempt), `--one` (coding-loop only — runs a single work order)
	- Loads `config.yaml` once and passes the parsed config into the dispatched subcommand
	- Returns process exit codes: 0 (pass), 1 (exhausted), 2 (awaiting_clarification)
```

```component
name: ConfigLoader
container: Python Orchestrator
responsibilities:
	- Parses `config.yaml` at orchestrator startup
	- Default location: kit-repo root; project-repo root override layered on top via the same parser
	- Fields: `max_attempts` (default 25), `max_wall_minutes` (default 120), `max_agent_retries` (default 3), `mirrors[]`
```

```component
name: RequirementsLoopSubcommand
container: Python Orchestrator
responsibilities:
	- Wires `#LoopDriver` for the requirements loop: `prd-to-frds` generator, four reviewers (`req-spec-judge`, `req-cross-doc-judge`, `req-coverage-judge`, `req-scoping-judge`), artifact tree `requirements/`, communication folder `requirements_communication/`, questions file `requirements/_questions-pending.md`
	- Precondition check: `PRD.md` exists at the project repo root; aborts with error if not
	- Post-generator: invokes `#MetaMaterialiser` (requirements tree shape) before reviewer fan-out
	- Pass condition: all four reviewers pass AND `requirements/_questions-pending.md` has zero open questions
```

```component
name: BlueprintLoopSubcommand
container: Python Orchestrator
responsibilities:
	- Wires `#LoopDriver` for the blueprint loop: `frd-to-blueprint` generator, four reviewers (`bp-spec-judge`, `bp-coverage-judge`, `bp-consistency-judge`, `bp-decision-judge`), artifact tree `blueprints/`, communication folder `blueprints_communication/`, questions file `blueprints/_questions-pending.md`
	- Precondition check: `requirements/features/` non-empty
	- Post-generator: invokes `#MetaMaterialiser` (blueprints tree shape) before reviewer fan-out
	- Pass condition: all four reviewers pass AND `blueprints/_questions-pending.md` has zero open questions
```

```component
name: WorkOrdersLoopSubcommand
container: Python Orchestrator
responsibilities:
	- Wires `#LoopDriver` for the work-orders loop: `blueprint-to-work-orders` generator, four reviewers (`wo-spec-judge`, `wo-coverage-judge`, `wo-overlap-judge`, `wo-sequencing-judge`), artifact tree `work-orders/`, communication folder `work-orders_communication/`, questions file `work-orders/_questions-pending.md`
	- Precondition check: `blueprints/` non-empty
	- Post-generator: invokes `#BlockedByMaterialiser` (specialised meta materialiser) before reviewer fan-out
	- Pass condition: all four reviewers pass AND `work-orders/_questions-pending.md` has zero open questions
	- On full pass: updates `.sequence.meta.yaml` with current blueprints hash and a generation timestamp; all produced agent-executable work orders land with `status: ready`; operator-action work orders also land with `status: ready` (ready for the operator)
```

The fifth subcommand wiring — the coding loop — is the parallel #CodingLoopDriver. The orchestrator hosts that driver but its definition lives in @Feature(coding-loop) (where the coding-loop-specific concerns — gate-declaration reading, gap filing, the six-reviewer execution stack — naturally belong); the orchestrator side is thin glue invoking it from the `coding-loop` subcommand entry point. #CodingLoopDriver does not share #LoopDriver because the coding loop's mechanics differ structurally (per-WO drain, gate-declaration-based reviewer set, generator-owned PR open).

The five subcommand wirings are thin — each is essentially a per-loop configuration of the shared #LoopDriver (or, for the coding loop, #CodingLoopDriver as defined in @Feature(coding-loop)). All shared mechanics live in the component blueprints.

## System Contracts

### Key Contracts

- **`python -m orchestrator <subcommand>` is the only entry point.** No daemon, no scheduler, no in-process REPL. Operators invoke subcommands one at a time.
- **One subcommand per invocation; loops are not daemonised.** Operator runs the subcommand, it exits, the operator decides the next move.
- **The orchestrator never makes direct Anthropic API calls.** Every model interaction goes through `claude -p` via `#SubprocessSpawner`.
- **Three exit codes.** `0` = pass; `1` = exhausted; `2` = awaiting_clarification. Same shape across all loop subcommands.
- **State files committed on pass and on awaiting_clarification.** Per-loop state always rolls; per-WO state rolls on per-WO all-pass and on merge detection. Never on intermediate failures within an invocation.
- **No-op on no-git-repo.** When the project directory is not a git repository, `#GitIntegration` falls back to no-op commit so the kit can run in test environments.

### Integration Contracts

- **`config.yaml` schema.** `max_attempts: int`, `max_wall_minutes: int`, `max_agent_retries: int`, `mirrors: list[{kind, …}]`. Per-project overrides layered on top of kit defaults.
- **Per-loop state file path.** `harness/state/<subcommand-name>.json` — `requirements-loop.json`, `blueprint-loop.json`, `work-orders-loop.json`, `coding-loop.json`.
- **Per-WO state file path.** `harness/state/<wo-slug>.json`.
- **Per-loop reviews archive path.** `harness/state/reviews/<subcommand-name>/attempt-<N>/<reviewer-name>.md` (upstream loops); `harness/state/reviews/coding-loop/<wo-slug>/attempt-<N>/<reviewer-name>.md` (per-WO execution).
- **Subprocess invocation API.** `claude -p "<prompt>"` with `--session-id`, `--resume`, `--append-system-prompt`, `--disallowedTools` per spawn class (per @Blueprint(subprocess-runtime)).
- **Hooks.** `Stop` (for verdict trailer enforcement) and `PreToolUse` (reviewer path-guard) configured in the kit's `.claude/settings.json` (per @Blueprint(subprocess-runtime)).

## Architecture Decision Records

### ADR-001: Five subcommands behind one CLI entry point

**Context.** Each loop could be its own CLI binary (`harness-requirements`, `harness-blueprint`, etc.). That would isolate them but complicate config sharing, state layout, and discoverability.

**Decision.** One CLI entry point (`python -m orchestrator <subcommand>`), five subcommands. Shared `loop_driver.py` for the three upstream loops; a parallel `coding_loop.py` driver for the coding loop's distinct mechanics.

**Consequences.** Operators learn one entry point and discover subcommands via `--help`. Config and state are shared cleanly. Trade-off: a single dispatch site means one subcommand argument-parsing bug can block all loops; mitigated by the dispatch logic being trivially small.

### ADR-002: Coding loop has its own driver, parallel to the upstream-loop driver

**Context.** The coding loop's mechanics differ structurally from the three upstream loops (per-WO drain, gate-declaration-based reviewer set, generator-owned PR open, no communication folder). A single driver covering all four loops would have to thread these differences through polymorphism.

**Decision.** Two drivers: `loop_driver.py` for the three upstream loops (gen → reviewer fan-out → retry → commit) and `coding_loop.py` for the per-WO drain. The two share lower-level helpers (`#SubprocessSpawner`, `#StateStore`, `#GitIntegration`) but have separate top-level orchestration logic.

**Consequences.** Each driver is small and intent-revealing. Bugs in one cannot affect the other. Trade-off: a future fifth loop that resembles either pattern would extend the matching driver; a loop that resembles neither would need its own driver.

### ADR-003: Coding loop is execution-only; sequence generation lives in the work-orders loop

**Context.** Earlier designs entwined sequence generation and per-WO execution in the coding loop (one subcommand that produced and drained). That coupled two distinct concerns — decomposition and execution — and made it hard to refresh the sequence without re-running everything.

**Decision.** Sequence generation is the work-orders loop's responsibility (`work-orders-loop` subcommand). The coding loop reads what is on disk and drains it. If blueprints change and the sequence needs refreshing, the operator runs `work-orders-loop` first.

**Consequences.** Each loop has one concern. The operator has explicit control over when to refresh the sequence. Trade-off: two subcommand invocations instead of one when the sequence needs regenerating; acceptable given the operator-visible-handoff design principle.

### ADR-004: Status subcommand is read-only

**Context.** A `status` subcommand could be more ambitious (e.g. trigger merge detection, transition stuck work orders, prune stale state). But that would muddle "show me the state" with "fix the state".

**Decision.** `python -m orchestrator status` reads every per-loop state file, the work-orders queue, and every `_questions-pending.md`, then prints a summary. It does not write, transition, or commit anything.

**Consequences.** `status` is safe to run anytime. Operator gets a no-side-effects view of harness state. Trade-off: state-fix concerns belong to other subcommands or to direct file edits; that is the intent.
