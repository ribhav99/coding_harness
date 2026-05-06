# Local Planner

## Capability Summary

The local planner is the work-orders queue reader/writer — a single concrete class (no Protocol, since there is only one queue) that reads flat `work-orders/wo-<slug>.md` content files plus their sibling `.wo-<slug>.meta.yaml`, walks `work-orders/_sequence.md` top to bottom, and answers "what's the next ready work order?" for the coding loop drain. It also owns status transitions (`backlog → ready → in_progress → done`, plus the `blocked_external` mid-execution sink) writing through to the meta file. The orchestrator is the only writer; the planner is the only place that interprets `_sequence.md` ordering plus `blocked_by[]` plus `type` to choose a next work order.

## Core Components

### Planner

```component
name: LocalPlanner
container: Python Orchestrator
responsibilities:
	- Reads flat `work-orders/wo-<slug>.md` content files plus their sibling `.wo-<slug>.meta.yaml` files via #WorkOrderMetaReader
	- Returns the next ready work order via `get_next_ready()`: walks `work-orders/_sequence.md` top to bottom and returns the first work order whose `status: ready`, whose `blocked_by[]` are all `done`, and whose `type` is not `operator-action`
	- Returns the full ordered ready set via `get_ordered_ready()` for `status` subcommand reporting
	- Writes status transitions through to `.wo-<slug>.meta.yaml` via `update_status(wo_slug, new_status)`; valid status values include `blocked_external` (the per-WO coding agent's mid-execution discovery that operator action is needed)
	- Single concrete class — no Protocol abstraction, since there is only one queue (no remote backends, no parallel queues)
```

```component
name: WorkOrderMetaReader
container: Python Orchestrator
responsibilities:
	- Parses `.wo-<slug>.meta.yaml` via PyYAML or stdlib equivalent
	- Returns a `WorkOrder` TypedDict with fields aligned to the meta file plus a denormalised `description_markdown` (full `wo-<slug>.md` contents) and absolute `path` to the `wo-<slug>.md` file
	- Refreshes `local.*` denormalised fields in `harness/state/<wo-slug>.json` on every read so the per-WO state file mirrors the meta file
```

```component
name: SequenceReader
container: Python Orchestrator
responsibilities:
	- Parses `work-orders/_sequence.md` (numbered markdown list of backticked `wo-<slug>` IDs) into an ordered list of slugs
	- Used by `#LocalPlanner.get_next_ready()` to walk the execution order top to bottom
	- Read-only on the planner side; the work-orders-loop generator owns writes to `_sequence.md` (the operator may also re-order it manually between loop runs)
```

The #LocalPlanner is invoked at three points by the coding loop:
1. On each `coding-loop` invocation, by #MergeDetector from @Blueprint(git-integration) to update statuses post-merge.
2. On each work-order drain step, to pick the next ready WO (walking `_sequence.md`).
3. On status transition (`ready → in_progress`, `in_progress → done`, mid-execution `→ blocked_external`) by the coding loop driver and the merge detector.

The work-orders loop generator does not use the planner — it reads `work-orders/` directly and edits content. The orchestrator's #BlockedByMaterialiser from @Blueprint(meta-materialization) is the planner's downstream consumer for `blocked_by[]` field updates.

---

### Work-order shape

```model
name: WorkOrder
store: Filesystem (project repo, work-orders/)
description: Single canonical record of one work order, materialised by the work-orders loop and consumed by the coding loop
fields:
	- wo_slug: string (`wo-<slug>`, kebab-case, stable forever; renaming a slug breaks every cross-reference that points to it)
	- title: string
	- description_markdown: string (full wo-<slug>.md contents)
	- status: enum (backlog | ready | in_progress | done | blocked_external)
	- priority: string | null
	- type: enum (feature | refactor | bug-fix | infra | operator-action) | null
	- parent_id: string | null
	- blocked_by: list[string] (materialised from description's `Depends on.work_orders` block by #BlockedByMaterialiser)
	- blueprint_ids: list[string]
	- path: Path (absolute path to the wo-<slug>.md file)
constraints:
	- Status enum drives drain selection; only `ready` work orders with all `blocked_by[]` `done` AND `type != operator-action` are candidates
	- `_sequence.md` is the execution order; ties break by sequence position, not by an embedded `sort_order` field
	- `wo-<slug>.md` is the source of truth for dependencies; planner never accepts a `blocked_by[]` value that disagrees with the description
	- `blocked_external` is a discovery state set by the per-WO coding agent mid-execution; the operator clears it by transitioning `status` back to `ready` after completing the external action
	- Operator-action work orders carry `type: operator-action` and are skipped by the drain entirely (they appear in `_external-blockers.md` for the operator)
```

## System Contracts

### Key Contracts

- **Single concrete class, no Protocol.** There is only one queue (the local filesystem). Future remote-backed queues would have to be a separate component, not a polymorphism over this one.
- **Orchestrator is the only writer.** The planner mediates writes; nothing else writes to `.wo-<slug>.meta.yaml` (except the work-orders loop generator's authorship of `wo-<slug>.md`, which the planner reads).
- **Drain walks `_sequence.md`.** `get_next_ready()` walks the sequence file top to bottom and returns the first work order satisfying all three conditions (`status: ready`, all `blocked_by[]` `done`, `type != operator-action`). The intelligence lives upstream — the work-orders generator decided the order; the planner just walks it.
- **Operator-action skip.** Work orders with `type: operator-action` are unconditionally skipped by `get_next_ready()` regardless of their `status`; they are the operator's responsibility, surfaced via `work-orders/_external-blockers.md`.
- **`blocked_external` is a real status.** When the per-WO coding agent discovers mid-execution that it cannot proceed without operator action, it sets `status: blocked_external` via the planner and exits cleanly; subsequent drains skip the work order until the operator clears it.
- **Status transitions write through to disk immediately.** No in-memory cache. Crashes mid-transition leave the meta file in either the pre or post state, never a partial state (single YAML file write is atomic enough on POSIX for our purposes).
- **Description is the single source of truth for dependencies.** `blocked_by[]` is materialised from the description; never accepted from any other source.

### Integration Contracts

- **`LocalPlanner` interface.**
  - `get_next_ready() -> WorkOrder | None`
  - `get(wo_slug: str) -> WorkOrder`
  - `update_status(wo_slug: str, status: Status) -> None`
  - `get_ordered_ready() -> list[WorkOrder]`
  - `read_sequence() -> list[str]` (parses `_sequence.md` into a list of `wo-<slug>` strings)
- **YAML format.** UTF-8, two-space indent. PyYAML or stdlib-equivalent parser.
- **Status enum.** `backlog | ready | in_progress | done | blocked_external`. Loop-level state additionally has `awaiting_clarification` and `exhausted` (per @Blueprint(state-store)).
- **Type enum.** `feature | refactor | bug-fix | infra | operator-action`. The first four are agent-executable; `operator-action` is reserved for work the operator must do themselves (per @Feature(work-orders-loop) REQ-WO-002).

## Architecture Decision Records

### ADR-001: Single concrete class, no Protocol abstraction

**Context.** A Protocol abstraction (Python's structural typing) would let future code swap in a remote-queue implementation. But the harness's design explicitly commits to local files as the source of truth (per @Blueprint(project-repo) ADR-001); a remote queue would be a different shape entirely.

**Decision.** `LocalPlanner` is a single concrete class. No Protocol, no Mirror-style abstraction. If a remote queue ever becomes a real requirement, that is a different component, not a polymorphism over this one.

**Consequences.** The class is small and concrete. Tests run directly without mock-protocol setup. Trade-off: refactoring later is real work, but premature abstraction is worse.

### ADR-002: Description is single source of truth for `blocked_by[]`

**Context.** `blocked_by[]` could be hand-edited in `.wo-<slug>.meta.yaml`, with the description's `Depends on` block being a redundant view. Two sources of truth invite divergence.

**Decision.** `wo-<slug>.md`'s `Depends on.work_orders` is canonical. `BlockedByMaterialiser` (in @Blueprint(meta-materialization)) writes through to `.wo-<slug>.meta.yaml.blocked_by[]` after every work-orders-loop generator exit. External writes to that field are ignored (overwritten on next materialization).

**Consequences.** Editing dependencies is editing one file. Tooling can read either the description or the meta file and trust them to agree. Trade-off: a generator has to update the description even for trivial dependency changes; that is by design.

### ADR-003: `_sequence.md` is the execution order; planner walks it

**Context.** The planner could derive an execution order from `blocked_by[]` plus an embedded `sort_order` field on each work order (the prior shape). But that puts ordering in two places (graph + sort field) and forces the planner to topological-sort on every read. A flat, operator-editable `_sequence.md` is simpler and decouples ordering from per-WO meta.

**Decision.** Sequencing is the work-orders generator's responsibility (it produces a valid topological order in `_sequence.md`). The planner walks `_sequence.md` top to bottom and applies the three drain filters (`status: ready`, all `blocked_by[]` `done`, `type != operator-action`). No on-the-fly topological sort; no embedded `sort_order` field.

**Consequences.** The operator can re-order `_sequence.md` to push work earlier or later; `wo-sequencing-judge` catches re-orderings that violate the dependency graph. The planner is trivial — read sequence, apply filters, return the first match. Trade-off: a sequence-file edit is a separate operation from a meta-file edit; acceptable because re-ordering is an operator-cadence event.
