# State Store

## Capability Summary

The state store is the JSON-backed durable record of every loop run, every per-work-order execution, and every reviewer review the harness produces. It lives under `harness/state/` (committed to git) and is composed of two file shapes — per-loop and per-work-order — sharing top-level schema fields. Reviewer review snapshots accumulate in `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md` for audit, replay, and future training-data extraction. The orchestrator is the only writer; everything else reads.

## Core Components

### Reads/writes

```component
name: StateStore
container: Python Orchestrator
responsibilities:
	- Loads or initialises a per-loop state file at `harness/state/<loop>.json` on every loop subcommand entry
	- Loads or initialises a per-WO state file at `harness/state/<task_id>.json` when the coding loop selects a work order
	- Records generator output, per-attempt reviewer verdicts, retry counts, and exhaustion events as the loop progresses
	- On loop exit, finalises the file: rolls `attempts[]`'s final entry into `history[]`, sets the final `status` and `verdict`, writes timestamps
	- Never deletes state files; never edits past `history[]` entries (append-only)
```

```component
name: ReviewSnapshotter
container: Python Orchestrator
responsibilities:
	- Snapshots each agent file from the live communication folder into `harness/state/reviews/<loop>/attempt-<N>/<agent-name>.md` at every attempt boundary and on every loop-exit verdict (delegating actual file copy to #CommunicationFolderSnapshotter from @Blueprint(communication-folder))
	- For coding-loop per-WO execution, captures reviewer subprocess stdout and writes to `harness/state/reviews/coding-loop/<task-id>/attempt-<N>/<reviewer-name>.md`
	- Idempotent: re-running an attempt overwrites the snapshot for that attempt (rare; happens on attempt re-runs, not on cross-attempt updates)
```

```component
name: StatusReporter
container: Python Orchestrator
responsibilities:
	- Implements `python -m orchestrator status`
	- Reads every per-loop state file under `harness/state/`, the work-orders queue (via #LocalPlanner from @Blueprint(local-planner)), and every `_questions-pending.md` in the three upstream-loop trees
	- Prints a per-loop summary: current status, last attempt's verdict, open-question count
	- Prints the queue summary: counts of `ready`, `in_progress`, `done`, plus inbox entries
	- Read-only — never writes state files
```

The #StateStore is the canonical writer; #ReviewSnapshotter is its sibling for non-JSON snapshots; #StatusReporter is the read-only consumer.

---

### Per-loop state shape

```model
name: PerLoopState
store: Filesystem (project repo, harness/state/<loop>.json)
description: Per-invocation state for an upstream loop (requirements, blueprint, work-orders) or the coding loop's overall queue
fields:
	- loop: { name, artifact_paths[], communication_dir }
	- created_at: ISO-8601 UTC
	- updated_at: ISO-8601 UTC
	- status: enum (running | pass | awaiting_clarification | exhausted)
	- attempt_count: integer (current invocation only; resets on next invocation)
	- limits: { max_wall_minutes, max_attempts }
	- current: { last_output: string }
	- verification: { <reviewer-key>: { result: "pass"|"fail"|"not_run", ran_at } }
	- open_questions: integer (upstream loops only)
	- attempts[]: append-only per-attempt log within an invocation; cleared at start of next invocation
	- history[]: append-only across invocations; one entry per invocation final summary
	- sessions: { generator: <uuid>, reviewers: { <name>: <uuid> } } (per-invocation; not persisted across invocations)
	- rate_limit_failures[]: array of incident records (subprocess kind, reviewer name, attempt, retry count, stderr)
	- protocol_failures[]: array of incident records (reviewer name, attempt, retry count, malformed stdout) <!-- pending: post-exit-protocol-retry-vs-blueprint-md -->
constraints:
	- Orchestrator is the only writer
	- `attempts[]` resets at the start of each invocation; `history[]` accumulates across all invocations
	- Never deleted; log files may be pruned but state files persist
```

```model
name: PerWorkOrderState
store: Filesystem (project repo, harness/state/<task_id>.json)
description: Per-work-order state for the coding loop's per-WO execution flow
fields:
	- task_id: string (wo-NNN, zero-padded, stable forever)
	- local: { title, path, blueprint_ids[] } (denormalised snapshot of the WO meta)
	- created_at, updated_at: ISO-8601 UTC
	- status: enum (backlog | ready | in_progress | done)
	- attempt_count: integer
	- limits: { max_wall_minutes, max_attempts }
	- execution: { branch: "task/<task_id>", pr_url, pr_number }
	- current: { last_output: string }
	- verification: { tests, playwright, code_spec_judge, code_regression_judge, code_security_judge, code_quality_judge } (each: { result, ran_at })
	- attempts[]: append-only per-attempt log
	- history[]: append-only across invocations
	- mirror: { last_posted_session, last_mirrored_at }
constraints:
	- Mirrors `.work-order.meta.yaml` for `local.*` and `status`; `local.*` refreshed on every read
	- `attempts[]` resets per invocation; `history[]` persists
	- Orchestrator is the only writer
```

```model
name: ReviewSnapshot
store: Filesystem (project repo, harness/state/reviews/...)
description: Frozen per-attempt snapshot of either a reviewer's communication file (upstream loops) or a reviewer subprocess's captured stdout (coding loop per-WO execution)
fields:
	- path: harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md
	- content: markdown (verbatim copy of the live communication file or stdout)
constraints:
	- Written by orchestrator at every attempt boundary and on every loop-exit verdict
	- Never modified after the attempt boundary; new attempts get new snapshot files
	- Committed to git as part of the harness/ tree
```

## System Contracts

### Key Contracts

- **Orchestrator-only writes.** `harness/state/<loop>.json`, `harness/state/<task_id>.json`, and `harness/state/reviews/...` are written exclusively by the orchestrator. Generators and reviewers never touch state files.
- **Append-only history.** `history[]` accumulates across invocations; entries are never modified or deleted. `attempts[]` is per-invocation and cleared at the start of each new invocation (the prior invocation's final summary already lives in `history[]`).
- **Per-attempt snapshots are immutable.** Once written, `harness/state/reviews/<loop>/attempt-<N>/<reviewer-name>.md` is not modified. Re-running an attempt within an invocation can overwrite, but cross-attempt updates never touch prior snapshots.
- **State files committed to git.** The entire `harness/state/` tree is committed as a first-class project artifact. Replay, audit, and training-data extraction depend on this.
- **Schema evolution implicit in harness version.** Breaking changes to state-file shape need a documented migration; schema-version field is not embedded.

### Integration Contracts

- **Per-loop file path.** `harness/state/<loop>.json` where `<loop>` is the full subcommand name (`requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`).
- **Per-WO file path.** `harness/state/<task_id>.json` where `<task_id>` is `wo-NNN`.
- **Snapshot path.** `harness/state/reviews/<loop>/attempt-<N>/<reviewer-name>.md` (upstream loops); `harness/state/reviews/coding-loop/<task-id>/attempt-<N>/<reviewer-name>.md` (per-WO execution).
- **JSON encoding.** UTF-8, two-space indent, sorted keys for stable diffs.
- **Timestamp format.** ISO-8601 UTC, fixed format (`%Y-%m-%dT%H:%M:%SZ`).
- **Status enum.** `backlog | ready | in_progress | done` for per-WO; `running | pass | awaiting_clarification | exhausted` for per-loop.

## Architecture Decision Records

### ADR-001: Two file shapes sharing top-level schema

**Context.** Per-loop state and per-WO state diverge in important ways (per-WO has `execution.*` for branches/PRs; per-loop has `loop.*` for the artifact tree). They could live as two entirely separate schemas. But ~70% of the fields are identical (`attempts[]`, `history[]`, `verification.*`, `limits`, `current`).

**Decision.** Two file shapes share top-level fields. Differences live in `loop.*` (per-loop only) and `local.*` + `execution.*` (per-WO only). One reader/writer module handles both shapes via shape-detection.

**Consequences.** Adding a shared field (e.g. a new attempt-tracker counter) is one change. Per-shape fields stay isolated. Trade-off: the reader has to detect which shape it is reading; small price for the shared-plumbing payoff.

### ADR-002: Reviews archived as markdown snapshots, not embedded in JSON state

**Context.** Reviewer review prose could live inline in the state JSON (in a `reviews[]` array). That would put everything in one place but bloat the state file with markdown content and make per-review diffing painful.

**Decision.** Reviewer reviews are markdown files snapshotted into `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md`. The state JSON references attempt directories; the prose lives next door.

**Consequences.** State JSON stays compact and structured. Review prose stays in a format reviewers and operators can read directly without JSON-extraction. Trade-off: two file types to manage; mitigated by both being committed to the same `harness/` tree under git.

### ADR-003: Commit `harness/` to git as a first-class artifact

**Context.** State files and logs are runtime byproducts. The default posture is to gitignore them. But losing them means losing the ability to replay a loop run, audit a verdict, or extract training data from real runs.

**Decision.** Commit the entire `harness/` tree. State files are never deleted; log files may be pruned on a documented retention policy. The audit trail lives in git history.

**Consequences.** The repo grows over time, but state files are small and snapshots are markdown. Operator can `git log` any state field's history. Future training data extraction reads directly from the committed tree. Trade-off: noisy commits during long-running projects; mitigated by single-commit-per-loop-pass discipline.
