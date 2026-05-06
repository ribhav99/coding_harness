# Mirror Adapter

## Capability Summary

The mirror adapter is the orchestrator's outbound-only push interface to external systems (Software Factory, GitHub Projects, future analogues). Local files are the source of truth (per @Blueprint(project-repo)); mirrors are convenience surfaces that accept pushes but are never read from. The adapter exposes a Protocol with two methods (`push_status`, `push_comment`); concrete implementations ship per mirror. Mirror failures are logged but never block orchestrator progress.

## Core Components

### Protocol

```component
name: MirrorAdapter
container: Python Orchestrator
responsibilities:
	- Defines the outbound-only push contract: `push_status(work_order: WorkOrder)` and `push_comment(work_order: WorkOrder, body: str)`
	- A Python Protocol (structural typing); concrete mirrors implement the methods
	- Mirrors are loaded from `config.yaml` `mirrors:` list at orchestrator startup; an empty list means local-only operation (the default)
	- Mirror failures are caught and logged; never raised back to the loop driver
```

```component
name: SoftwareFactoryMirror
container: Python Orchestrator
responsibilities:
	- Concrete #MirrorAdapter for Software Factory
	- Pushes work-order status and comments to SF via SF's upload API once that ships
	- Already structurally compatible because the local on-disk layout mirrors SF's entity model (per @Blueprint(on-disk-layout))
	- Config: `kind: software_factory`, `base_url: <url>`, `project_id: <uuid>`
```

```component
name: GitHubProjectsMirror
container: Python Orchestrator
responsibilities:
	- Concrete #MirrorAdapter for GitHub Projects (read-mostly kanban view)
	- Pushes work-order status changes as GitHub Projects card moves
	- Deferred — included as a stub; not a v1 deliverable
```

The adapter is invoked by #MirrorPushOrchestrator on per-WO status transitions and PR-comment posts, after #StateStore has updated the per-WO state and before the orchestrator returns control to the loop driver.

---

### Push orchestration

```component
name: MirrorPushOrchestrator
container: Python Orchestrator
responsibilities:
	- After every per-WO status transition (ready → in_progress, in_progress → done), iterates the configured mirrors and calls `push_status(work_order)` on each
	- After every per-WO PR-comment post by #PRCommentMirror from @Blueprint(git-integration), calls `push_comment(work_order, body)` on each mirror
	- Tracks `mirror.last_posted_session` and `mirror.last_mirrored_at` in the per-WO state file so retries and re-runs are deterministic
	- Catches and logs every mirror exception; never propagates up the call stack
```

## System Contracts

### Key Contracts

- **One-way only (push).** Inbound sync is deferred and may never be built. The orchestrator never reads from a mirror.
- **Failures are non-blocking.** A failed mirror push logs and the loop continues. Next successful push reconciles automatically because mirrors track their own state from the canonical local data.
- **Failures don't roll back local state.** Local state advances regardless of mirror state.
- **Explicit opt-in.** `config.yaml`'s `mirrors:` list is empty by default; local-only is the default operating mode.
- **Mirrors are convenience.** The harness operates fully without any mirror configured. Adding a mirror does not change the loop mechanic.

### Integration Contracts

- **Protocol shape.**
  ```python
  class Mirror(Protocol):
      def push_status(self, work_order: WorkOrder) -> None: ...
      def push_comment(self, work_order: WorkOrder, body: str) -> None: ...
  ```
- **Config shape.**
  ```yaml
  mirrors:
    - kind: software_factory
      base_url: https://sf.internal
      project_id: 0f1e2d3c-4b5a-6978-8765-432101234567
  ```
- **Authentication.** Per-mirror; the SF mirror reads its API token from environment variables; future mirrors may use other mechanisms. Authentication errors are logged like any other mirror failure.

## Architecture Decision Records

### ADR-001: Outbound-only push, never inbound read

**Context.** A bidirectional sync would let mirrors propose changes that show up in the local tree. But that introduces conflict resolution, race conditions, and a meaningful dependency on mirror availability for the harness to operate.

**Decision.** Mirrors are outbound only. The orchestrator pushes status and comments; nothing reads back. Local files are canonical.

**Consequences.** The harness operates fully offline (post-model-call). No conflict resolution layer. Trade-off: a mirror cannot drive harness behaviour; if Software Factory wants to assign work, that flows through some operator-driven mechanism, not the mirror itself.

### ADR-002: Protocol-based, multiple concrete mirrors

**Context.** Software Factory is the obvious initial mirror. But the harness should be re-usable enough that other operators can plug in their own external system without rewriting the orchestrator.

**Decision.** A Python `Protocol` with two methods (`push_status`, `push_comment`); concrete mirrors implement the methods. Mirrors are loaded from `config.yaml`. Adding a new mirror is one new file plus a config entry.

**Consequences.** New mirrors do not touch the loop code or the planner. Trade-off: the protocol is small (intentional — minimal contract), so mirror-specific features (e.g. SF's parent_id reconciliation) live entirely inside each mirror's implementation.

### ADR-003: Mirror failures are non-blocking

**Context.** A failed push could either abort the loop (strict consistency) or be logged and retried later (eventual consistency). Strict consistency would couple the harness to mirror availability.

**Decision.** Failures are logged to `harness/logs/<wo-slug-or-loop-name>/hooks.log` and never propagated. The next successful push reconciles automatically because the local state is canonical and mirrors are stateless from the harness's perspective.

**Consequences.** Network blips, mirror outages, and auth failures do not break the harness. Trade-off: mirror state can lag local state for as long as the mirror is unreachable; acceptable since the local tree is the source of truth.
