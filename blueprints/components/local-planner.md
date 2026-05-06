# Local Planner

## Capability Summary

The local planner is the work-orders queue reader/writer — a single concrete class (no Protocol, since there is only one queue) that reads `work-orders/wo-NNN/` directories, inspects `.work-order.meta.yaml`, and answers "what's the next ready work order?" for the coding loop drain. It also owns status transitions (`backlog → ready → in_progress → done`) writing through to the meta file. The orchestrator is the only writer; the planner is the only place that interprets `blocked_by[]` plus `sort_order` to choose a next work order.

## Core Components

### Planner

```component
name: LocalPlanner
container: Python Orchestrator
responsibilities:
	- Reads `work-orders/wo-NNN/` directories, parses each `.work-order.meta.yaml` via #WorkOrderMetaReader
	- Returns the next ready work order via `get_next_ready()`: scans for `status == "ready"` work orders whose `blocked_by[]` are all `done`, breaking ties by `sort_order`
	- Returns the full ordered ready set via `get_ordered_ready()` for `status` subcommand reporting
	- Writes status transitions through to `.work-order.meta.yaml` via `update_status(task_id, new_status)`
	- Single concrete class — no Protocol abstraction, since there is only one queue (no remote backends, no parallel queues)
```

```component
name: WorkOrderMetaReader
container: Python Orchestrator
responsibilities:
	- Parses `.work-order.meta.yaml` via PyYAML or stdlib equivalent
	- Returns a `WorkOrder` TypedDict with fields aligned to the meta file plus a denormalised `description_markdown` and absolute `path`
	- Refreshes `local.*` denormalised fields in `harness/state/<task_id>.json` on every read so the per-WO state file mirrors the meta file
```

The #LocalPlanner is invoked at three points by the coding loop:
1. On each `coding-loop` invocation, by #MergeDetector from @Blueprint(git-integration) to update statuses post-merge.
2. On each work-order drain step, to pick the next ready WO.
3. On status transition (ready → in_progress, in_progress → done) by the coding loop driver and the merge detector.

The work-orders loop generator does not use the planner — it reads `work-orders/` directly and edits content. The orchestrator's #BlockedByMaterialiser from @Blueprint(meta-materialization) is the planner's downstream consumer for `blocked_by[]` field updates.

---

### Work-order shape

```model
name: WorkOrder
store: Filesystem (project repo, work-orders/wo-NNN/)
description: Single canonical record of one work order, materialised by the work-orders loop and consumed by the coding loop
fields:
	- task_id: string (wo-NNN, zero-padded, stable forever)
	- title: string
	- description_markdown: string (full description.md contents)
	- status: enum (backlog | ready | in_progress | done)
	- priority: string | null
	- type: enum (BUILD | FIX | REQUIREMENTS | BLUEPRINT | ARTIFACT | OTHER) | null
	- parent_id: string | null
	- sort_order: string (lexicographic, stable ordering)
	- blocked_by: list[string] (materialised from description's `Depends on.work_orders` block by #BlockedByMaterialiser)
	- blueprint_ids: list[string]
	- path: Path (absolute path to the work-order directory)
constraints:
	- Status enum drives drain selection; only `ready` work orders with all `blocked_by[]` `done` are candidates
	- `task_id` is zero-padded so lexicographic and numeric ordering match
	- `description.md` is the source of truth for dependencies; planner never accepts a `blocked_by[]` value that disagrees with the description
```

## System Contracts

### Key Contracts

- **Single concrete class, no Protocol.** There is only one queue (the local filesystem). Future remote-backed queues would have to be a separate component, not a polymorphism over this one.
- **Orchestrator is the only writer.** The planner mediates writes; nothing else writes to `.work-order.meta.yaml` (except the work-orders loop generator's authorship of `description.md`, which the planner reads).
- **Drain is dependency-respecting.** `get_next_ready()` returns a WO whose `blocked_by[]` are all `done`. Ties broken by `sort_order`. No phase awareness — the dependency graph plus stable sort is all the ordering needed.
- **Status transitions write through to disk immediately.** No in-memory cache. Crashes mid-transition leave the meta file in either the pre or post state, never a partial state (single YAML file write is atomic enough on POSIX for our purposes).
- **Description is the single source of truth for dependencies.** `blocked_by[]` is materialised from the description; never accepted from any other source.

### Integration Contracts

- **`LocalPlanner` interface.**
  - `get_next_ready() -> WorkOrder | None`
  - `get(task_id: str) -> WorkOrder`
  - `update_status(task_id: str, status: Status) -> None`
  - `get_ordered_ready() -> list[WorkOrder]`
- **YAML format.** UTF-8, two-space indent. PyYAML or stdlib-equivalent parser.
- **Status enum.** `backlog | ready | in_progress | done`. Loop-level state additionally has `awaiting_clarification` and `exhausted` (per @Blueprint(state-store)).

## Architecture Decision Records

### ADR-001: Single concrete class, no Protocol abstraction

**Context.** A Protocol abstraction (Python's structural typing) would let future code swap in a remote-queue implementation. But the harness's design explicitly commits to local files as the source of truth (per @Blueprint(project-repo) ADR-001); a remote queue would be a different shape entirely.

**Decision.** `LocalPlanner` is a single concrete class. No Protocol, no Mirror-style abstraction. If a remote queue ever becomes a real requirement, that is a different component, not a polymorphism over this one.

**Consequences.** The class is small and concrete. Tests run directly without mock-protocol setup. Trade-off: refactoring later is real work, but premature abstraction is worse.

### ADR-002: Description is single source of truth for `blocked_by[]`

**Context.** `blocked_by[]` could be hand-edited in `.work-order.meta.yaml`, with the description's `Depends on` block being a redundant view. Two sources of truth invite divergence.

**Decision.** `description.md`'s `Depends on.work_orders` is canonical. `BlockedByMaterialiser` (in @Blueprint(meta-materialization)) writes through to `.work-order.meta.yaml.blocked_by[]` after every work-orders-loop generator exit. External writes to that field are ignored (overwritten on next materialization).

**Consequences.** Editing dependencies is editing one file. Tooling can read either the description or the meta file and trust them to agree. Trade-off: a generator has to update the description even for trivial dependency changes; that is by design.
