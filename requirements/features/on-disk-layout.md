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
- **Questions file** — `<artifact-tree>/_questions-pending.md`. Present only while the loop has open questions for the operator. All three upstream loops use the same file convention (`requirements/_questions-pending.md` for the requirements loop, `blueprints/_questions-pending.md` for the blueprint loop, `work-orders/_questions-pending.md` for the work-orders loop).
- **Communication folder** — `requirements_communication/`, `blueprints_communication/`, or `work-orders_communication/` at the project root, sibling to the corresponding artifact tree. Holds one markdown file per agent in that loop (one for the generator, one per reviewer). Append-only conversation transcript; both the generator and the named reviewer read and write the file. Orchestrator manages folder-level lifecycle (wipe / snapshot) only — does not write inside the files.

## Requirements

### REQ-LAYOUT-001 — Project repo root layout
**User Story.** As an operator, I want every project to have the same root layout, so that navigating a new project is instant.
- **AC-LAYOUT-001.1** — The project repo root shall hold `PRD.md` (operator-authored monolithic PRD), `requirements/`, `requirements_communication/`, `blueprints/`, `blueprints_communication/`, `work-orders/`, `work-orders_communication/`, `artifacts/`, and `harness/` as top-level entries. The three `*_communication/` folders may be absent when no upstream loop has run yet, but are sibling-rooted (not nested inside the corresponding artifact tree) when present.
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
- **AC-LAYOUT-003.3** — In newly-materialised `.<slug>.overview.meta.yaml` and `.<slug>.feature.meta.yaml` files, the orchestrator shall populate four fields: `id: null`, `parent_id: null`, `position: <discovery order among siblings, starting at 0>`, and `title: <first H1 of the corresponding content file>`.
- **AC-LAYOUT-003.4** — In newly-materialised `.<slug>.requirements.meta.yaml` files, the orchestrator shall populate exactly one field: `id: null`. No other fields shall appear in this meta file.
- **AC-LAYOUT-003.5** — The `id` and `parent_id` fields remain `null` locally; an external mirror (for example, Software Factory) is expected to populate them on sync. The `position` field orders siblings deterministically so mirrors can render stable ordering.

### REQ-LAYOUT-004 — Node removal cleans up siblings and empty children dirs
**User Story.** As an operator, I want deleting a node's content file to fully remove the node, so that stale metas and empty directories do not linger.
- **AC-LAYOUT-004.1** — When the operator or a generator removes a visible `<slug>.md` file, the orchestrator shall remove the sibling dotted-hidden meta files.
- **AC-LAYOUT-004.2** — The orchestrator shall remove any now-empty `<slug>_children/` directory.

### REQ-LAYOUT-005 — Flat work-orders tree
**User Story.** As an operator, I want work orders in a single flat tree with dependency-encoded ordering, so that drain order is deterministic without phase groupings.
- **AC-LAYOUT-005.1** — `work-orders/` shall be flat at the top level; no phase groupings.
- **AC-LAYOUT-005.2** — Each work order shall be a directory named `wo-NNN` with leading zeros so lexicographic sort matches numeric order.
- **AC-LAYOUT-005.3** — Each `wo-NNN/` directory shall contain `description.md` (the scoped-task body) and `.work-order.meta.yaml` (with `id`, `status`, `priority`, `type`, `parent_id`, `sort_order`, `blocked_by[]`, `blueprint_ids[]`).
- **AC-LAYOUT-005.4** — The per-work-order document shape of `description.md` (sections, mention syntax, structured fenced YAML blocks for `Produces`/`Depends on`/`Gates`, acceptance-criteria schema) is pinned in the work-orders-loop FRD (`requirements/features/work-orders-loop.md` REQ-WO-002); this on-disk-layout FRD covers only the directory and meta-file structure.
- **AC-LAYOUT-005.5** — Subtasks (rare) shall live under a `children/` subdirectory inside the parent work order.
- **AC-LAYOUT-005.6** — `work-orders/.sequence.meta.yaml` at the work-orders directory level shall record the blueprint-tree hash at the time the sequence was generated plus a generation timestamp.
- **AC-LAYOUT-005.7** — `work-orders/_inbox/` shall hold gaps filed by the coding loop; the operator triages manually.
- **AC-LAYOUT-005.8** — `blocked_by[]` plus `sort_order` together shall encode everything SF used phase groupings for; no additional phase field shall exist.
- **AC-LAYOUT-005.9** — The orchestrator shall materialise `.work-order.meta.yaml.blocked_by[]` from the `Depends on.work_orders` list inside the work order's `description.md`; the description is the single source of truth for dependencies.

### REQ-LAYOUT-006 — Blueprints tree shape
**User Story.** As an operator, I want the blueprints tree organized by blueprint type so that container, component, and feature blueprints have clear homes and downstream tools can find them by convention.
- **AC-LAYOUT-006.1** — `blueprints/` shall hold three top-level subdirectories — `containers/`, `components/`, `features/` — corresponding to the three blueprint types (container, component, feature).
- **AC-LAYOUT-006.2** — Each blueprint shall consist of one visible `<slug>.md` file plus two dotted-hidden meta files as siblings: `.<slug>.<kind>.meta.yaml` (where `<kind>` is `container`, `component`, or `feature` matching the parent subdirectory) and `.<slug>.requirements.meta.yaml`.
- **AC-LAYOUT-006.3** — Feature-blueprint slugs shall be 1:1 with their corresponding FRD: `blueprints/features/<slug>.md` matches `requirements/features/<slug>.md` exactly.
- **AC-LAYOUT-006.4** — The orchestrator shall materialise the dotted-hidden meta files following the same pattern as the requirements tree (REQ-LAYOUT-003): four fields in the `.<slug>.<kind>.meta.yaml` (`id: null`, `parent_id: null`, `position: <discovery order>`, `title: <first H1>`); one field in the `.<slug>.requirements.meta.yaml` (`id: null`).
- **AC-LAYOUT-006.5** — The per-blueprint document shape (sections, mention syntax, fenced `component`/`model` blocks, ADRs) is pinned in the project's blueprint document-shape contract (referenced from the blueprint-loop FRD); this on-disk-layout FRD covers only the directory and meta-file structure.

### REQ-LAYOUT-007 — Questions files (bubble-up to operator)
**User Story.** As an operator, I want each upstream loop to log its open questions in a single file alongside its artifact tree, so that questions are co-located with the artifacts they describe and all upstream loops use the same mechanism.
- **AC-LAYOUT-007.1** — `requirements/_questions-pending.md` shall be present only while the requirements loop has open PRD-clarification questions.
- **AC-LAYOUT-007.2** — `blueprints/_questions-pending.md` shall be present only while the blueprint loop has open architectural-clarification questions. Same file convention as the requirements loop; only the location differs.
- **AC-LAYOUT-007.3** — `work-orders/_questions-pending.md` shall be present only while the work-orders loop has open decomposition-clarification questions. Same file convention as the requirements and blueprint loops; only the location differs.
- **AC-LAYOUT-007.4** — Optional audit-log files `requirements/_questions-resolved-<timestamp>.md`, `blueprints/_questions-resolved-<timestamp>.md`, and `work-orders/_questions-resolved-<timestamp>.md` may capture resolved entries for git-history audit.

### REQ-LAYOUT-012 — Communication folders (gen ↔ reviewer channel)
**User Story.** As an operator, I want each upstream loop's gen↔reviewer conversation in a dedicated project-root folder, so that I can read the conversation directly without it polluting the artifact tree.
- **AC-LAYOUT-012.1** — `requirements_communication/`, `blueprints_communication/`, and `work-orders_communication/` shall be top-level project-root directories — siblings of `requirements/`, `blueprints/`, and `work-orders/` respectively, not nested inside them.
- **AC-LAYOUT-012.2** — Each communication folder shall contain one markdown file per agent in its loop: one file for the generator (e.g. `prd-to-frds.md`, `frd-to-blueprint.md`, `blueprint-to-work-orders.md`) and one per reviewer (e.g. `req-spec-judge.md`, `bp-spec-judge.md`, `wo-scoping-judge.md`).
- **AC-LAYOUT-012.3** — Communication files are append-only conversation transcripts. Both the generator and the named reviewer read and write the file; the orchestrator does not write inside the files but manages the folder-level lifecycle.
- **AC-LAYOUT-012.4** — On every invocation that begins a fresh attempt-1 (no live conversation in the folder from a prior `awaiting_clarification` or `exhausted` exit), the orchestrator shall wipe the communication folder before spawning the generator.
- **AC-LAYOUT-012.5** — At every attempt boundary and on every loop-exit verdict, the orchestrator shall snapshot each agent file from the live communication folder into `harness/state/reviews/<loop>/attempt-<N>/<reviewer-name>.md`.
- **AC-LAYOUT-012.6** — On full `pass`, the orchestrator shall wipe the live communication folder. On `awaiting_clarification` and `exhausted`, the live folder shall be left in place for operator inspection.
- **AC-LAYOUT-012.7** — The coding loop has no communication folder — per-work-order execution communicates through the PR (commits + PR comments) and reviewer stdout. The work-orders loop, by contrast, is an upstream-loop and uses the standard communication-folder mechanism described above.

### REQ-LAYOUT-008 — Harness state and logs
**User Story.** As an operator, I want loop state and subprocess logs under one tree, so that audit and replay are simple.
- **AC-LAYOUT-008.1** — `harness/state/` shall hold JSON state files: one per loop (e.g. `requirements-loop.json`, `blueprint-loop.json`, `work-orders-loop.json`) and one per in-progress work order (e.g. `<task_id>.json`).
- **AC-LAYOUT-008.2** — `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md` shall archive each reviewer's review. For upstream loops (requirements, blueprint, work-orders), the archive is a snapshot of the reviewer's communication file at the attempt boundary. For coding-loop per-work-order execution, the archive is the captured stdout of the reviewer subprocess.
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

Questions files (`_questions-pending.md` in each upstream-loop artifact tree) live alongside their tree because that is where the operator reaches for them. The files exist only while there are open questions; resolved entries can optionally be renamed to `_questions-resolved-<timestamp>.md` for audit, but the active set always lives at the well-known path so subsequent loop runs find them. All three upstream loops use the same file convention — `requirements/_questions-pending.md` for PRD-clarification questions, `blueprints/_questions-pending.md` for architectural-clarification questions, `work-orders/_questions-pending.md` for decomposition-clarification questions — and exit with the same `awaiting_clarification` verdict when the file blocks further progress.

Communication folders (`requirements_communication/`, `blueprints_communication/`, `work-orders_communication/`) live as project-root siblings of the artifact trees rather than nested inside them. The artifact trees are the deliverable — the operator and downstream loops should be able to scan them as the spec without wading through generator-vs-reviewer conversation transcripts. Conversation lives next door, not in the deliverable. All three folders are wiped on a fresh invocation and on full pass; left in place on `awaiting_clarification` and `exhausted` so the operator can read the conversation directly. Snapshots into `harness/state/reviews/<loop>/attempt-<N>/` preserve every attempt's transcript independently of the live folder lifecycle. The coding loop, by contrast, has no communication folder — per-work-order execution communicates through the PR.

Harness state under `harness/` is a first-class project artifact committed to git. This is deliberate: when a loop misbehaves, the operator can read the snapshotted communication files, the attempt history, and reconstruct what happened. The state files are the ground truth for every retrospective and are the input to any future training data derived from real runs.
