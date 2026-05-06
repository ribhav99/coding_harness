# On-Disk Layout

## Feature Summary

The on-disk layout feature is the canonical artifact and state shape of the harness — markdown content files, dotted-hidden YAML meta files, JSON state files, and three sibling-of-artifact-tree communication folders, all under the project repo root and committed to git. Every loop reads and writes through this layout; every subprocess assumes it. See @Requirements(on-disk-layout) for the FRD this blueprint satisfies.

## Component Blueprint Composition

This feature composes:

- **@Blueprint(project-repo)** — The container blueprint for the project repo itself. Provides the filesystem boundary, git history as audit trail, and the contracts for what lives at the project root vs inside artifact trees.
- **@Blueprint(meta-materialization)** — `#MetaMaterialiser`, `#SlugDiscoverer`, `#H1Extractor`, and `#BlockedByMaterialiser` materialise the dotted-hidden meta files after generators exit, across the requirements, blueprints, and work-orders trees.
- **@Blueprint(communication-folder)** — Defines the sibling-of-artifact-tree communication folder shape (`requirements_communication/`, `blueprints_communication/`, `work-orders_communication/`), the conversation-file format, and the never-wipe lifecycle.
- **@Blueprint(questions-pending)** — Defines the `_questions-pending.md` mechanism inside each upstream-loop artifact tree, the bare-question and with-options block shapes, and the optional `_questions-resolved-<timestamp>.md` audit-log files.
- **@Blueprint(state-store)** — Defines the per-loop and per-WO JSON state-file shapes plus the reviewer review snapshot archive under `harness/state/reviews/`.

This feature is largely a contract-document — the actual implementations live in the composed component blueprints. What is feature-specific here is the project-repo-root entry layout and the slug-and-children rules that govern the requirements tree.

## Feature-Specific Components

```component
name: ProjectRepoRootLayout
container: Project Repo
responsibilities:
	- Defines the canonical top-level entries at the project repo root: `PRD.md`, `BLUEPRINT.md` (optional), `requirements/`, `requirements_communication/`, `blueprints/`, `blueprints_communication/`, `work-orders/`, `work-orders_communication/`, `artifacts/`, `harness/`
	- Communication folders may be absent when no upstream loop has run yet, but are sibling-rooted (not nested) when present
	- No autonomous loop edits `PRD.md` or `BLUEPRINT.md`; only the operator does (interactive `prd-authoring` skill or direct edit)
```

```component
name: FlatNodeShape
container: Project Repo
responsibilities:
	- Defines the canonical shape of each node in `requirements/overview/` and `requirements/features/`: one visible `<slug>.md` content file plus two dotted-hidden meta files (`.<slug>.<kind>.meta.yaml`, `.<slug>.requirements.meta.yaml`)
	- For nodes with children, a sibling `<slug>_children/` directory holds them with the same flat shape recursively
	- A `<slug>_children/` directory exists only if the node has at least one child; empty children directories do not persist
	- The `_children` suffix is reserved; kebab-case slugs never contain underscores
```

```component
name: BlueprintsTreeShape
container: Project Repo
responsibilities:
	- Defines the three top-level subdirectories under `blueprints/`: `containers/`, `components/`, `features/`
	- Each blueprint consists of a visible `<slug>.md` plus two dotted-hidden meta files: `.<slug>.<kind>.meta.yaml` (where `<kind>` is `container`, `component`, or `feature` matching the parent subdirectory) and `.<slug>.requirements.meta.yaml`
	- Feature-blueprint slugs are 1:1 with their corresponding FRD: `blueprints/features/<slug>.md` matches `requirements/features/<slug>.md` exactly
```

```component
name: WorkOrdersTreeShape
container: Project Repo
responsibilities:
	- Defines the flat shape under `work-orders/`: `wo-NNN/` directories with leading-zero numbering so lexicographic sort matches numeric order
	- Each `wo-NNN/` contains `description.md` (the scoped-task body — section shape pinned by @Feature(work-orders-loop) REQ-WO-002) and `.work-order.meta.yaml` (with `id`, `status`, `priority`, `type`, `parent_id`, `sort_order`, `blocked_by[]`, `blueprint_ids[]`)
	- Subtasks (rare) live under a `children/` subdirectory inside the parent work order
	- `work-orders/.sequence.meta.yaml` records the blueprint-tree hash and a generation timestamp
	- `work-orders/_inbox/` holds gaps filed by the coding loop; the operator triages manually
	- `blocked_by[]` plus `sort_order` together encode everything Software Factory used phase groupings for; no additional phase field exists
```

```component
name: HarnessTreeShape
container: Project Repo
responsibilities:
	- Defines the orchestrator-owned state and logs tree at `harness/`
	- `harness/state/` holds JSON state files (per-loop, per-WO) plus the reviewer review snapshot archive at `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md`
	- `harness/logs/<task_id-or-loop-name>/hooks.log` holds hook and session logs
	- The entire `harness/` tree is committed to git as a first-class project artifact
	- State files are never deleted; log files may be pruned on a documented retention policy
```

```component
name: ProjectTemplate
container: Project Repo
responsibilities:
	- Reference skeleton at `project-template/` inside the kit repo (not at the project repo root — this is kit-side, distributed with the harness)
	- Cloning `project-template/` into a new project repo produces a valid starting state for the requirements loop
	- The skeleton declares the canonical top-level layout but leaves artifact trees empty
```

These six feature-specific components define the layout itself; the materialisation, communication-folder, questions-pending, and state-store mechanics live in the composed component blueprints.

## System Contracts

### Key Contracts

- **No local versioning.** Files represent one current fact, not a history. Git history is the audit trail. No version fields embedded in artifact content or meta files.
- **Slug rules.** Lowercase-kebab-case, unique within siblings, derived from the node's title. Slugs never contain underscores; the `_children` suffix is reserved.
- **Visible/hidden split.** Generators write only visible content files (`<slug>.md`, `description.md`). The orchestrator owns dotted-hidden meta files via `#MetaMaterialiser`.
- **Communication folders are siblings of artifact trees.** They live next to `requirements/`, `blueprints/`, `work-orders/`, not nested inside.
- **`harness/` is committed to git.** State files, reviewer review snapshots, hook logs (subject to retention policy) — all in git.
- **Feature blueprint slug parity.** `blueprints/features/<slug>.md` matches `requirements/features/<slug>.md` exactly. Load-bearing for `blueprint-to-work-orders`.
- **Single source of truth for work-order dependencies.** `description.md`'s `Depends on.work_orders` is canonical; `.work-order.meta.yaml.blocked_by[]` is materialised from it.
- **Mirrors serialise current state only.** The on-disk layout has no embedded change log, no archive-on-edit. Git handles audit; mirrors handle their own versioning if needed.

### Integration Contracts

- **Project-root entry list.** `PRD.md`, `BLUEPRINT.md` (optional), `requirements/`, `requirements_communication/`, `blueprints/`, `blueprints_communication/`, `work-orders/`, `work-orders_communication/`, `artifacts/`, `harness/`. Communication folders may be absent when no loop has run; never nested inside artifact trees.
- **Meta file paths.** `.<slug>.<kind>.meta.yaml` (overview/feature/container/component/feature kinds) and `.<slug>.requirements.meta.yaml` per node. Schemas pinned in @Blueprint(meta-materialization).
- **State file paths.** `harness/state/<loop>.json`, `harness/state/<task_id>.json`, `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md`. Schemas pinned in @Blueprint(state-store).
- **Communication file paths.** `<loop>_communication/<agent-name>.md`. Format pinned in @Blueprint(communication-folder).
- **Questions file paths.** `<artifact-tree>/_questions-pending.md`. Block formats pinned in @Blueprint(questions-pending).

## Architecture Decision Records

### ADR-001: Mirror Software Factory's entity model

**Context.** The local on-disk layout could be designed entirely for harness-local convenience. But operators may want to upload to Software Factory or a similar system. Designing the layout to mirror SF's entity model from day one means upload is mechanical rather than translation-heavy.

**Decision.** The layout mirrors SF's entity model: nodes have content + position + parent_id + id, work orders have status + blocked_by + sort_order, etc. Mirrors implement push-only adapters that serialise current state.

**Consequences.** SF upload is an adapter, not a translation layer. Other entity-model-similar systems can be added with a small adapter. Trade-off: the layout is shaped slightly more verbosely than a pure-local design would be (id and parent_id fields that stay null locally); price paid for mechanical mirror support.

### ADR-002: Flat-with-recursive-children for the requirements tree, flat-only for work-orders

**Context.** Requirements features sometimes decompose further (sub-features) and sometimes do not. Work orders are agent-consumed and have no human-mental-model need for grouping. Different shapes serve different consumers.

**Decision.** Requirements tree is flat-with-recursive-children: each level is the same flat shape, with `<slug>_children/` for nodes that have children. Work-orders tree is flat at the top level, leading-zero-padded `wo-NNN/` directories; subtasks (rare) live under a `children/` subdirectory inside the parent work order.

**Consequences.** Each shape suits its consumer. Trade-off: two shapes to remember; mitigated by both being canonical and documented inline.

### ADR-003: `_children` suffix is reserved

**Context.** A child directory could be named arbitrarily (e.g. `sub-features/` or `<slug>-subs/`). But every such convention requires careful collision detection between slug names and directory names.

**Decision.** The `_children` suffix is reserved exclusively for sibling children directories. Kebab-case slugs never contain underscores. A slug cannot collide with a children directory because slugs cannot have underscores.

**Consequences.** Tooling can walk the tree without ambiguity. Trade-off: slugs cannot use underscores even when they would be the natural choice; acceptable for kebab-case.

### ADR-004: Commit `harness/` to git as a first-class artifact

**Context.** State files and logs are runtime byproducts. Default posture: gitignore them. But losing them means losing replay, audit, and training-data potential.

**Decision.** Commit the entire `harness/` tree. State files are never deleted; log files may be pruned on a documented retention policy.

**Consequences.** Replay and audit become trivial. Trade-off: the repo grows over time; mitigated by single-commit-per-loop-pass discipline (per @Blueprint(git-integration)) and small JSON files.
