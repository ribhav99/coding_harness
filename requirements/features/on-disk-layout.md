# On-Disk Layout

## Overview

The on-disk layout is the canonical artifact shape of the harness. It lives entirely at the project repo's root as markdown content files, dotted-hidden YAML meta files, and JSON state files. The layout mirrors Software Factory's entity model so that upload to SF or any system adopting a similar shape is mechanical. Local files are the source of truth; external mirrors are optional outbound push targets only.

The operator needs this feature because a consistent, versioned, git-committed on-disk layout is what lets every loop hand off cleanly to the next, lets every subprocess be replayable from disk state, and lets external mirrors sync without maintaining their own queue. The layout is deliberately flat where flatness suits the shape of the data (work orders) and flat-with-recursive-children where that suits it (requirements tree). Generators write only the visible content files; the orchestrator materialises the hidden metas so generators do not need to track meta bookkeeping.

## Terminology

- **Project repo root** — the root of the git repository for a single project. One repo per project.
- **Visible content file** — a `<slug>.md` file that the generator writes directly (for example, `business-problem.md`, `auth.md`, `description.md`).
- **Dotted-hidden meta file** — a file like `.<slug>.overview.meta.yaml`, `.<slug>.feature.meta.yaml`, `.<slug>.requirements.meta.yaml`, `.work-order.meta.yaml`, or `.sequence.meta.yaml`. Orchestrator-managed.
- **Children directory** — a `<slug>_children/` sibling directory that holds the children of a node. Only present if the node has children. The `_children` suffix is reserved; kebab-case slugs never contain underscores.
- **Slug** — a lowercase-kebab-case identifier unique within its siblings, derived from the node's title.
- **Bubble-up file** — one of `requirements/_questions-pending.md` or `blueprints/_decisions-pending.md`. Present only while open questions or decisions exist.

## Requirements

### REQ-LAYOUT-001 — Project repo root layout
**User Story.** As an operator, I want every project to have the same root layout, so that navigating a new project is instant.
- **AC-LAYOUT-001.1** — The project repo root shall hold `PRD.md` (operator-authored monolithic PRD), `requirements/`, `blueprints/`, `work-orders/`, `artifacts/`, and `harness/` as top-level entries.
- **AC-LAYOUT-001.2** — No autonomous loop shall edit `PRD.md`; only the operator edits it (via the `prd-authoring` skill or directly).

### REQ-LAYOUT-002 — Flat node shape in requirements tree
**User Story.** As an operator, I want every requirements-tree node to follow the same flat shape, so that I can read or modify any node without special-casing.
- **AC-LAYOUT-002.1** — Each node in `requirements/overview/` or `requirements/features/` shall consist of one visible `<slug>.md` file plus two dotted-hidden meta files as siblings.
- **AC-LAYOUT-002.2** — Overview-tree nodes shall have `.<slug>.overview.meta.yaml` and `.<slug>.requirements.meta.yaml` metas.
- **AC-LAYOUT-002.3** — Feature-tree nodes shall have `.<slug>.feature.meta.yaml` and `.<slug>.requirements.meta.yaml` metas.
- **AC-LAYOUT-002.4** — If a node has children, a sibling `<slug>_children/` directory shall hold them with the same flat shape, recursively.
- **AC-LAYOUT-002.5** — A `<slug>_children/` directory shall exist only if the node has at least one child; empty children directories shall not persist.
- **AC-LAYOUT-002.6** — The `_children` suffix shall be reserved; kebab-case slugs shall never contain underscores.

### REQ-LAYOUT-003 — Meta file materialisation is orchestrator-owned
**User Story.** As a generator author, I want the orchestrator to handle meta-file materialisation, so that generators can focus on content and not on meta bookkeeping.
- **AC-LAYOUT-003.1** — Generators shall write only visible `<slug>.md` content files.
- **AC-LAYOUT-003.2** — The orchestrator shall materialise the two dotted-hidden meta files per node after the generator exits.
- **AC-LAYOUT-003.3** — The orchestrator shall derive each meta file's `title` field from the first H1 of the corresponding content file.
- **AC-LAYOUT-003.4** — The orchestrator shall set `id` and `parent_id` to `null` in newly-materialised meta files, leaving them for later mirror sync to populate.
- **AC-LAYOUT-003.5** — Each meta file shall also carry a `position` field used by mirrors to render deterministic ordering.

### REQ-LAYOUT-004 — Node removal cleans up siblings and empty children dirs
**User Story.** As an operator, I want deleting a node's content file to fully remove the node, so that stale metas and empty directories do not linger.
- **AC-LAYOUT-004.1** — When the operator or a generator removes a visible `<slug>.md` file, the orchestrator shall remove the sibling dotted-hidden meta files.
- **AC-LAYOUT-004.2** — The orchestrator shall remove any now-empty `<slug>_children/` directory.

### REQ-LAYOUT-005 — Flat work-orders tree
**User Story.** As an operator, I want work orders in a single flat tree with dependency-encoded ordering, so that drain order is deterministic without phase groupings.
- **AC-LAYOUT-005.1** — `work-orders/` shall be flat at the top level; no phase groupings.
- **AC-LAYOUT-005.2** — Each work order shall be a directory named `wo-NNN` with leading zeros so lexicographic sort matches numeric order.
- **AC-LAYOUT-005.3** — Each `wo-NNN/` directory shall contain `description.md` (the scoped-task body) and `.work-order.meta.yaml` (with `id`, `status`, `priority`, `type`, `parent_id`, `sort_order`, `blocked_by[]`, `blueprint_ids[]`).
- **AC-LAYOUT-005.4** — Subtasks (rare) shall live under a `children/` subdirectory inside the parent work order.
- **AC-LAYOUT-005.5** — `work-orders/.sequence.meta.yaml` at the work-orders directory level shall record the blueprint-tree hash at the time the sequence was generated plus a generation timestamp.
- **AC-LAYOUT-005.6** — `work-orders/_inbox/` shall hold gaps filed by any loop; the operator triages manually.
- **AC-LAYOUT-005.7** — `blocked_by[]` plus `sort_order` together shall encode everything SF used phase groupings for; no additional phase field shall exist.

### REQ-LAYOUT-006 — Blueprints tree (layout deferred)
**User Story.** As an operator, I want `blueprints/` reserved as the target tree for the blueprint loop, so that the loop has a known location to write into even before its document shape is pinned.
- **AC-LAYOUT-006.1** — `blueprints/` shall be reserved at the project repo root as the blueprint loop's target tree.
- **AC-LAYOUT-006.2** — The exact on-disk layout under `blueprints/` and the fields of `.blueprint.meta.yaml` shall be pinned at the start of v0.2 and are deferred in this FRD.
- **AC-LAYOUT-006.3** — `blueprints/_decisions-pending.md` shall be present only while open decisions exist; resolved decisions may be captured in `blueprints/_decisions-resolved-<timestamp>.md` for audit.

### REQ-LAYOUT-007 — Bubble-up files
**User Story.** As an operator, I want bubble-up files alongside their tree, so that questions and decisions are co-located with the artifacts they describe.
- **AC-LAYOUT-007.1** — `requirements/_questions-pending.md` shall be present only while PRD-clarification questions are open.
- **AC-LAYOUT-007.2** — `blueprints/_decisions-pending.md` shall be present only while architectural decisions are open.
- **AC-LAYOUT-007.3** — Optional audit-log files `requirements/_questions-resolved-<timestamp>.md` and `blueprints/_decisions-resolved-<timestamp>.md` may capture resolved entries for git-history audit.

### REQ-LAYOUT-008 — Harness state and logs
**User Story.** As an operator, I want loop state and subprocess logs under one tree, so that audit and replay are simple.
- **AC-LAYOUT-008.1** — `harness/state/` shall hold JSON state files: one per loop (e.g. `requirements-loop.json`, `blueprint-loop.json`, `coding-loop-seq-gen.json`) and one per in-progress work order (e.g. `<task_id>.json`).
- **AC-LAYOUT-008.2** — `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md` shall archive each reviewer subprocess's stdout.
- **AC-LAYOUT-008.3** — `harness/logs/<task_id>/` shall hold hook and session logs.
- **AC-LAYOUT-008.4** — The entire `harness/` tree shall be committed to git as a first-class project artifact.
- **AC-LAYOUT-008.5** — State files shall never be deleted; log files may be pruned on a documented retention policy.

### REQ-LAYOUT-009 — Artifacts tree
**User Story.** As an operator, I want a dedicated artifacts tree so that byproducts of work orders (screenshots, exports, fixtures) have a canonical home.
- **AC-LAYOUT-009.1** — `artifacts/{folder-slug}/` shall hold artifact folder trees, organized by folder slug.

### REQ-LAYOUT-010 — No local versioning; git is the audit trail
**User Story.** As an operator, I want the layout to rely on git for history rather than embedded version fields, so that I do not maintain parallel version bookkeeping.
- **AC-LAYOUT-010.1** — The layout shall not embed version numbers in artifact content or meta files.
- **AC-LAYOUT-010.2** — Git history shall be the sole audit trail for all artifact and state changes.
- **AC-LAYOUT-010.3** — Mirrors shall serialise only the current document state; external versioning is the mirror's concern.

### REQ-LAYOUT-011 — Reference skeleton at `project-template/`
**User Story.** As an operator, I want a reference skeleton to clone into a new project, so that starting a new project is a single copy operation.
- **AC-LAYOUT-011.1** — A reference skeleton of the on-disk layout shall live at `project-template/` inside the coding_harness kit repo.
- **AC-LAYOUT-011.2** — Cloning `project-template/` into a new project repo shall produce a valid starting state for the requirements loop.

## Feature Behavior & Rules

The layout is the harness's contract with itself. Every loop reads and writes through it; every subprocess assumes it. Breaking the layout — for example, dropping a meta file or putting a work order in a phase directory — breaks the orchestrator's reads. This is why meta-file materialisation is owned by the orchestrator rather than by generators: generators can evolve (new skills, new prompt shapes) without risking the layout, because they only write visible content files and the orchestrator handles everything else.

Flat-with-recursive-children suits the requirements tree because features sometimes decompose further and sometimes do not, and the flat shape makes siblings unambiguous. The `_children` suffix is reserved precisely so a slug cannot collide with a children directory — kebab-case slugs never contain underscores, which prevents accidental collisions. Every recursion level is the same flat shape, so tooling can walk the tree uniformly.

Work orders are flat, no phases. The Software Factory model uses phase groupings to give humans a mental model of when things run; the harness's work orders are agent-consumed and do not need that. `blocked_by[]` plus `sort_order` together encode the same information in a form the orchestrator can consume programmatically: pick the next `ready` work order whose `blocked_by[]` is all `done`, breaking ties by `sort_order`. Flat leading-zero naming (`wo-001`, `wo-002`, …) means lexicographic sort matches numeric order, which simplifies every piece of tooling that lists work orders.

Mirrors serialise the current state of disk only. There is no local versioning, no archive-on-edit, no change log embedded in meta files. Git history handles audit; a mirror (for example, Software Factory) handles its own versioning on its end. This keeps the on-disk layout simple — a file represents one current fact, not a history of that fact.

Bubble-up files (`_questions-pending.md`, `_decisions-pending.md`) live alongside their tree because that is where the operator reaches for them. The files exist only while there are open questions or decisions; resolved entries can optionally be renamed to `_*-resolved-<timestamp>.md` for audit, but the active set always lives at the well-known path so subsequent loop runs find them.

Harness state under `harness/` is a first-class project artifact committed to git. This is deliberate: when a loop misbehaves, the operator can read the archived reviewer reviews, the attempt history, the push-back notes, and reconstruct what happened. The state files are the ground truth for every retrospective and are the input to any future training data derived from real runs.
