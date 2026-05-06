# Meta Materialization

## Capability Summary

The meta-materialization mechanism is the orchestrator's post-generator step that converts visible content files (`<slug>.md`, `description.md`) into the canonical on-disk shape by writing the dotted-hidden meta files alongside them. Generators write only visible content; the orchestrator owns slug discovery, sibling-position computation, H1-title extraction, and the dependency materialization for work orders. The same mechanism runs for the requirements tree, the blueprints tree, and the work-orders tree, with per-tree differences in which meta files are produced.

## Core Components

### Tree-walking materializer

```component
name: MetaMaterialiser
container: Python Orchestrator
responsibilities:
	- After the generator exits and before reviewers spawn, walks the loop's artifact tree (`requirements/`, `blueprints/`, or `work-orders/`)
	- For every visible `<slug>.md` content file, ensures two dotted-hidden sibling meta files exist with canonical content per the `NodeMetaFile`, `RequirementsMetaFile`, `WorkOrderMetaFile`, and `SequenceMetaFile` model definitions below
	- For every dotted-hidden meta file whose `<slug>.md` counterpart was deleted, removes the meta file
	- After cleanup, removes any empty `<slug>_children/` directory (parent node lost all children)
	- Preserves existing meta files whose fields hold non-null values (an external mirror sync may have populated IDs; never clobber)
```

```component
name: SlugDiscoverer
container: Python Orchestrator
responsibilities:
	- Walks the artifact tree directory by directory
	- Collects visible `<slug>.md` files in directory-listing order; assigns `position: 0..N-1` to siblings
	- Detects `<slug>_children/` subdirectories and recurses (requirements tree only — blueprint and work-orders trees are flat at the type level)
	- Returns the (slug, kind, position, content_path) tuples #MetaMaterialiser uses to compose meta-file content
```

```component
name: H1Extractor
container: Python Orchestrator
responsibilities:
	- Reads the first non-empty line of each visible content file
	- Strips a leading `# ` to recover the title
	- Falls back to the slug (kebab-case → Title Case) if no H1 is present (rare; reviewers flag missing H1 as STRUCTURE)
```

The #MetaMaterialiser is invoked exactly once per loop attempt, between generator exit and reviewer fan-out. It is idempotent — running it twice on the same tree produces the same meta-file content.

---

### Per-tree meta files

```model
name: NodeMetaFile
store: Filesystem (project repo)
description: Dotted-hidden YAML file holding canonical metadata for a node in the requirements or blueprints tree
fields:
	- path: `.<slug>.<kind>.meta.yaml` (where `<kind>` is `overview`, `feature`, `container`, `component`, or `feature` matching the parent subdirectory)
	- id: null (populated by external mirror on sync; orchestrator never writes a non-null value)
	- parent_id: null (same)
	- position: integer 0..N-1 (discovery order among siblings)
	- title: string (first H1 of the corresponding content file)
constraints:
	- `id` and `parent_id` remain `null` locally; orchestrator never writes a non-null value
	- `position` is recomputed every materialization pass to reflect current sibling order
	- Existing files with non-null `id` or `parent_id` are preserved (mirror may have populated them)
```

```model
name: RequirementsMetaFile
store: Filesystem (project repo)
description: Dotted-hidden YAML file recording the requirements-tree linkage for a node, present in both the requirements tree and the blueprints tree
fields:
	- path: `.<slug>.requirements.meta.yaml`
	- id: null
constraints:
	- Exactly one field; no other keys appear
	- Present alongside every `<slug>.md` in `requirements/overview/`, `requirements/features/`, `blueprints/containers/`, `blueprints/components/`, `blueprints/features/`
```

```model
name: WorkOrderMetaFile
store: Filesystem (project repo)
description: Dotted-hidden YAML file recording per-work-order metadata derived partly from the description and partly from orchestrator state
fields:
	- path: `work-orders/wo-NNN/.work-order.meta.yaml`
	- id: string (stable, populated on first materialization)
	- status: enum (backlog | ready | in_progress | done)
	- priority: string | null
	- type: string (BUILD | FIX | REQUIREMENTS | BLUEPRINT | ARTIFACT | OTHER)
	- parent_id: string | null
	- sort_order: string (lexicographic, stable ordering)
	- blocked_by: list[string] (materialised by #BlockedByMaterialiser from the description's `Depends on.work_orders` block)
	- blueprint_ids: list[string]
constraints:
	- Single source of truth for dependencies is `description.md`'s `Depends on.work_orders`; orchestrator never accepts an external write to `blocked_by[]`
	- Status transitions are owned by the orchestrator (#LocalPlanner from @Blueprint(local-planner) writes through to this file)
```

```model
name: SequenceMetaFile
store: Filesystem (project repo)
description: Top-level work-orders metadata file recording sequence-generation context
fields:
	- path: work-orders/.sequence.meta.yaml
	- blueprint_tree_hash: string (hash of the blueprints tree at the time the sequence was generated)
	- generated_at: ISO-8601 UTC timestamp
constraints:
	- Updated by the orchestrator on full work-orders-loop pass; otherwise read-only
	- Hash mismatch is the work-orders-loop generator's signal that blueprints have changed and regeneration may be needed
```

---

### Work-order dependency materializer

```component
name: BlockedByMaterialiser
container: Python Orchestrator
responsibilities:
	- After the work-orders-loop generator exits and before reviewers spawn, parses each work order's `description.md` `## Depends on` fenced YAML block
	- Extracts `work_orders: [wo-NNN, ...]` and writes the list to `.work-order.meta.yaml.blocked_by[]`
	- Treats `description.md` as the single source of truth for dependencies; never accepts a `blocked_by[]` value that disagrees with the description
	- Runs only for the work-orders loop (not requirements or blueprint loops)
```

The #BlockedByMaterialiser is the work-orders-specific specialization of the generic #MetaMaterialiser. It runs in the same post-generator window so reviewers see consistent metadata.

## System Contracts

### Key Contracts

- **Generators write only visible content.** Generators never write `.<slug>.<kind>.meta.yaml`, `.<slug>.requirements.meta.yaml`, `.work-order.meta.yaml`, or `.sequence.meta.yaml`. Trying to do so is a generator-skill violation reviewers can catch.
- **Idempotent materialization.** Running `MetaMaterialiser` twice on the same tree produces identical output. `position` is recomputed; titles are re-extracted; existing non-null `id`/`parent_id` values are preserved.
- **Cleanup on delete.** When a generator deletes a `<slug>.md`, the orchestrator removes the sibling meta files and any now-empty `<slug>_children/` directory.
- **Single source of truth for dependencies.** `description.md`'s `Depends on.work_orders` is canonical. `blocked_by[]` is materialised from it; never written by the generator and never accepted from any other source.
- **No external versioning.** Meta files do not carry version fields, change logs, or history. Git history is the audit trail (per @Blueprint(project-repo)).

### Integration Contracts

- **Materializer entry point.** `materialise(tree_root: Path, tree_kind: Literal["requirements", "blueprints", "work-orders"]) -> None`. Runs synchronously between generator exit and reviewer fan-out.
- **YAML format.** UTF-8, two-space indent, no comments. Parsed and emitted via `PyYAML` or stdlib `yaml`-equivalent (small enough to hand-parse if PyYAML is rejected as a dependency).
- **Slug rules.** Lowercase-kebab-case. No underscores; the `_children` suffix is reserved for sibling children directories. Enforced by reviewers (`bp-spec-judge` for blueprints; `req-spec-judge` for requirements; `wo-coverage-judge` for work orders).
- **H1 extraction.** First non-empty line of the content file; strip leading `# `. Empty H1 falls back to slug-derived title (kebab-case → Title Case).

## Architecture Decision Records

### ADR-001: Orchestrator owns meta files; generators own only visible content

**Context.** Generators could materialize meta files themselves. That would couple every generator skill to the meta schema. A generator change (new field, renamed field) would require updates to every generator skill plus careful coordination with reviewers.

**Decision.** The orchestrator materializes all dotted-hidden meta files in one centralized pass after the generator exits. Generators evolve independently of the meta schema; reviewers read the materialized metas and trust them as canonical.

**Consequences.** Adding a meta field touches one file (the materializer) plus the schema documentation. Generators do not need to track meta bookkeeping. Trade-off: the orchestrator must run before reviewers see the tree; this is enforced by the loop driver's strict sequencing.

### ADR-002: Description as single source of truth for work-order dependencies

**Context.** `blocked_by[]` could live independently in `.work-order.meta.yaml`, with the description's `Depends on` block being a redundant human-readable view. That would let operators or future tooling write to the meta file directly. But two sources of truth invite divergence — a meta file says X, a description says Y, behaviour depends on which one the orchestrator reads.

**Decision.** `description.md`'s `Depends on.work_orders` is the only source. `BlockedByMaterialiser` derives `blocked_by[]` after every work-orders-loop generator exit. External writes to `.work-order.meta.yaml.blocked_by[]` are never accepted; the next materialization round overwrites them.

**Consequences.** Operators editing a work order's dependencies edit one file (`description.md`). Tooling reads `.work-order.meta.yaml` (machine-friendly) but cannot diverge from the description. Trade-off: a generator can never partially update `blocked_by[]` without changing the description; that is by design — the description is the contract.

### ADR-003: `id` and `parent_id` stay null locally

**Context.** Software Factory and similar mirrors expect stable IDs on entities they ingest. The harness could generate UUIDs locally, but then mirror sync would have to reconcile harness-generated IDs against mirror-side IDs, doubling the bookkeeping.

**Decision.** Local meta files leave `id: null` and `parent_id: null`. Mirrors populate them on sync; the orchestrator never overwrites a non-null value, so once a mirror has populated an ID, it persists.

**Consequences.** Mirror sync is mechanical — pick up null-IDed nodes, assign IDs, write back. No reconciliation logic. Trade-off: a node's identity is purely path-based locally (slug + position); a renamed slug breaks the link to the mirror's ID, which is the operator's signal that they have done something semantically lossy.
