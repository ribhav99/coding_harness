# Work-Orders Loop

## Feature Summary

The work-orders loop is the third autonomous stage. It reads approved blueprints from `blueprints/` and produces a flat list of slug-named work orders under `work-orders/` — one visible `wo-<slug>.md` content file per work order, sibling `.wo-<slug>.meta.yaml` meta files, and a separate `_sequence.md` that records the execution order. Four reviewers evaluate structural shape, blueprint-to-work-order coverage, produced-interface overlap, and structural-plus-semantic sequencing. Decomposition ambiguities are surfaced as bare-question blocks in `work-orders/_questions-pending.md`. See @Requirements(work-orders-loop) for the FRD this blueprint satisfies.

## Component Blueprint Composition

This feature composes:

- **@Blueprint(loop-driver)** — `#LoopDriver` runs the per-attempt state machine; `#WorkOrdersLoopPromptBuilder` builds spawn prompts naming the `blueprint-to-work-orders` skill, the four reviewer skills, the `work-orders/` artifact path, the `.sequence.meta.yaml` short-circuit input, and the `work-orders_communication/` folder.
- **@Blueprint(subprocess-runtime)** — `#SubprocessSpawner`, `#StopHookGenerator`/`#StopHookReviewer`, `#ReviewerPathGuardHook` enforcing reviewer write isolation to `work-orders_communication/<reviewer-name>.md`.
- **@Blueprint(communication-folder)** — `#CommunicationFolderManager` ensures and snapshots `work-orders_communication/`; the folder holds `blueprint-to-work-orders.md`, `wo-spec-judge.md`, `wo-coverage-judge.md`, `wo-overlap-judge.md`, `wo-sequencing-judge.md`.
- **@Blueprint(questions-pending)** — `#QuestionsPendingDetector` inspects `work-orders/_questions-pending.md`; this loop uses bare-question shape only (like the requirements loop).
- **@Blueprint(meta-materialization)** — `#MetaMaterialiser` materialises per-WO meta files; `#BlockedByMaterialiser` is the work-orders-specific specialisation that derives `.wo-<slug>.meta.yaml.blocked_by[]` from each work order's `wo-<slug>.md` `Depends on.work_orders` block.
- **@Blueprint(state-store)** — `#StateStore` writes `harness/state/work-orders-loop.json`; `#ReviewSnapshotter` archives reviewer files into `harness/state/reviews/work-orders-loop/attempt-<N>/`.
- **@Blueprint(git-integration)** — `#GitIntegration` commits the work-orders tree on `pass` or `awaiting_clarification`.
- **@Blueprint(agents-and-skills)** — `#WorkOrdersGeneratorAgent` is the lead-tech-lead identity loading the `blueprint-to-work-orders` skill; `#WorkOrdersReviewerAgents` are the four LLM-as-judge reviewers.

The loop is the third in the upstream-loop family — a near-symmetric mirror of @Feature(blueprint-loop) and @Feature(requirements-loop). Differences: a different generator skill, bare-only question shape, and the `.sequence.meta.yaml` short-circuit when blueprints have not changed since the last successful run.

## Feature-Specific Components

```component
name: BlueprintToWorkOrdersSkill
container: Claude Code Subprocess
responsibilities:
	- The generator skill loaded by `#WorkOrdersGeneratorAgent`; single skill, no sub-skill co-invocation
	- Reads every approved blueprint under `blueprints/`, the existing `work-orders/` tree (every `wo-<slug>.md` plus `_sequence.md` if present), the current `work-orders/_questions-pending.md`, and `work-orders/.sequence.meta.yaml` before deciding what to produce or edit
	- Writes each work order's `wo-<slug>.md` directly in the canonical scoped-task body shape (no separate "stub then expand" step); slugs are stable kebab-case identifiers and never renamed (renaming a slug breaks every cross-reference that points to it)
	- Writes work orders flat under `work-orders/` — there are no per-WO directories; `wo-<slug>.md` and the sibling dotted `.wo-<slug>.meta.yaml` are siblings at the work-orders root
	- Updates `work-orders/_sequence.md` (a numbered markdown list of backticked `wo-<slug>` IDs in valid topological execution order); preserves operator re-orderings on subsequent runs and only re-orders entries when the dependency graph requires it
	- Marks operator-action work orders with `type: operator-action` in the meta; flags them at authoring time so the operator sees them surfaced in `work-orders/_external-blockers.md`
	- Writes each work order's `Depends on.work_orders` consistent with the order in `_sequence.md` (no work order depends on a later-listed work order); the orchestrator materialises `.wo-<slug>.meta.yaml.blocked_by[]` from the description block
	- Iterative: reads existing tree first, edits only what needs changing
	- Short-circuits when the current blueprint-tree hash matches the recorded hash in `.sequence.meta.yaml` AND there are no failing reviews from a prior attempt to address; produces no edits and exits, letting the orchestrator run reviewers on the existing tree and pass cleanly
	- Appends bare-question blocks to `work-orders/_questions-pending.md` for decomposition ambiguities (overlapping responsibilities between blueprints, unclear capability boundaries, unresolved blueprint pending markers); never fabricates options to choose between
	- May leave `<!-- pending: <question-title> -->` HTML comments at affected work-order locations
	- Reads every reviewer's file in `work-orders_communication/`; on retry attempts (≥ 2), appends per-finding responses and a `## Changes since previous attempt` block
```

```component
name: ScopedTaskBody
container: Project Repo
responsibilities:
	- Defines the canonical `wo-<slug>.md` section shape pinned in @Requirements(work-orders-loop) REQ-WO-002: `# <Title>`, `## Goal`, `## Blueprints`, `## In scope`, `## Out of scope`, `## Produces`, `## Depends on`, `## Acceptance criteria`, `## Gates`, optional `## Implementation notes (non-binding)`
	- `## Goal` carries one observable-outcome sentence
	- `## Blueprints` lists `- #<blueprint-slug> — <one line>` bullets; every mention resolves to `blueprints/{containers,components,features}/<slug>.md`
	- `## Produces` holds a fenced YAML block listing produced interfaces with `kind`/`name`/`contract` per entry; empty list `[]` for refactor-only work orders
	- `## Depends on` holds a fenced YAML block with `work_orders: [wo-<slug>, ...]` and `interfaces: [{from: wo-<slug>, name: <interface-name>}]`
	- `## Acceptance criteria` holds checklist items in the format `- [ ] AC-WO-<slug>.M (via <gate>) — <expected outcome>` where `<gate>` is `tests`, `playwright`, or `code-spec`
	- `## Gates` holds a fenced YAML block with six required keys (`tests`, `playwright`, `code-spec`, `code-regression`, `code-security`, `code-quality`) each `required` or `not_applicable`; the four LLM-as-judge gates are always `required`
```

```component
name: WoSpecJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying structural shape and content quality of each `wo-<slug>.md`: sections present in canonical order; fenced ` ```yaml ` blocks parse and have required keys; AC rows match `AC-WO-<slug>.M (via <gate>) — <outcome>` format; Goal is one observable, non-vague sentence; In/Out scope concrete and non-contradictory; produced interface contracts detailed enough that a downstream work order could consume them; AC rows are concrete and binary, never vague; implementation notes useful or absent, never prescriptive
	- Enforces the atomicity rule (one cohesive change per work order): flags work orders whose `Goal` sentence requires "and" to describe; flags multiple `Produces` entries that are not tightly cohesive; flags `In scope`/`Out of scope` boundaries that are unclear or contradictory
	- Flags refactor breadcrumbs (any `(renamed from …)`, `(was …)`, `(unchanged)`, `(existing)`, `(previously …)`, "the old name" parentheticals)
	- Fanned out per-work-order so failures are attributable to specific files
```

```component
name: WoCoverageJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying three things: (a) every approved blueprint's delivery surface (component blocks, model blocks, feature commitments) maps to at least one work order via a `#<blueprint-slug>` mention; (b) every `#<blueprint-slug>` mention in any work order resolves to a file in `blueprints/{containers,components,features}/<blueprint-slug>.md`; (c) every acceptance criterion declares an observation gate (`tests`, `playwright`, or `code-spec`) that the gate set in `## Gates` actually declares `required`
```

```component
name: WoOverlapJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying produced-interface uniqueness: for every pair of work orders, scans their `## Produces` blocks; flags any `kind`+`name` pair that appears in both
	- Exactly one work order owns a given interface; duplication signals either a decomposition mistake (the generator split a work order it shouldn't have) or two work orders that should be merged
	- Simplest of the four — pure pairwise comparison against produced-interface lists
```

```component
name: WoSequencingJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying both **structural** and **semantic** sequencing correctness
	- Structural: (a) the dependency graph derived from each work order's `Depends on.work_orders` is acyclic; (b) every `Depends on.interfaces` entry resolves to a `Produces` entry in the named upstream work order; (c) `_sequence.md` lists every work order in a valid topological order of the dependency graph (no work order appears before any of its declared dependencies)
	- Semantic: (d) for each declared dependency, does the dependent work order actually consume the upstream's output (vs an unnecessary or fabricated dependency); (e) are there missing dependencies (a work order needs another's output but didn't say so); (f) could the sequence be tightened (a work order positioned later than necessary)
	- Semantic findings are flagged with reasoning, not just structural verdicts
```

The skills are concrete loadable artifacts. Four reviewer skills run in parallel; the generator runs alone between fan-outs.

## System Contracts

### Key Contracts

- **Flat slug-named files.** Work orders are flat at the work-orders root: one visible `wo-<slug>.md` content file plus a sibling dotted `.wo-<slug>.meta.yaml` meta file. No per-work-order directories. The slug is a stable, human-readable, kebab-case identifier; once chosen, it never changes.
- **`_sequence.md` is the execution-order list.** A numbered markdown list of backticked `wo-<slug>` IDs in valid topological order, top to bottom. Mutable; the operator may re-order. The orchestrator's `pick_next` walks it top to bottom.
- **`_external-blockers.md` is the operator-readable surface.** Two sections — anticipated operator actions (`type: operator-action`) and discovered mid-execution blockers (`status: blocked_external`). Regenerated by the orchestrator on every loop-exit verdict. Operator clears entries by transitioning the affected work order's status; the next regeneration drops the entry.
- **Description as single source of truth for dependencies.** `wo-<slug>.md`'s `Depends on.work_orders` is canonical; `.wo-<slug>.meta.yaml.blocked_by[]` is materialised from it by `#BlockedByMaterialiser`.
- **Atomicity.** One named interface in `Produces` (or one cohesive purpose stated in `Goal` for refactor-only WOs). Goals requiring "and" to describe are sign of two work orders that should be split.
- **Coverage.** The union of all `Produces` plus all `In scope` items across all work orders has to compose into the full delivery surface of every approved blueprint. Gaps mean some blueprint section never gets implemented; overlaps are flagged separately by `wo-overlap-judge`.
- **Dependency graph is acyclic.** `wo-sequencing-judge` enforces. Every `interfaces` entry in `Depends on` resolves to a concrete entry in the upstream work order's `Produces`.
- **Hash short-circuit.** When the current blueprint-tree hash matches `.sequence.meta.yaml` AND no failing reviews to address, the generator produces no edits. The orchestrator then runs reviewers on the existing tree and exits with `pass` if they all pass.
- **Bare-question shape only.** Work-orders-loop questions are always bare; resolution is "clarify the relevant blueprint (or seed a manually-authored work order)", not "pick between alternatives".
- **Independent of the coding loop.** Running `work-orders-loop` produces or refreshes the sequence without executing any per-work-order implementation. Sequence generation does not happen inside the coding loop.
- **All produced work orders land `status: ready`.** On full pass, every work order in the tree has `.wo-<slug>.meta.yaml.status = ready`. Operator-action work orders also land `ready` — `ready` here means "ready for the operator to do" — but the orchestrator's coding-loop drain skips them per `type`. `.sequence.meta.yaml` is updated with the current blueprints hash and a generation timestamp.

### Integration Contracts

- **Subcommand.** `python -m orchestrator work-orders-loop`. Exit codes: 0 (pass), 1 (exhausted), 2 (awaiting_clarification).
- **Artifact tree.** `work-orders/wo-<slug>.md` (visible content), `work-orders/.wo-<slug>.meta.yaml` (orchestrator-materialised; flat sibling), `work-orders/_sequence.md` (execution-order list), `work-orders/_external-blockers.md` (orchestrator-regenerated when any work order needs operator action), `work-orders/.sequence.meta.yaml` (orchestrator-managed), `work-orders/_inbox/wo-<slug>.md` (gaps from the coding loop), `work-orders/_questions-pending.md` (open questions).
- **Communication folder.** `work-orders_communication/`. One file per agent: `blueprint-to-work-orders.md`, `wo-spec-judge.md`, `wo-coverage-judge.md`, `wo-overlap-judge.md`, `wo-sequencing-judge.md`.
- **Questions file.** `work-orders/_questions-pending.md`. Bare-question shape only.
- **State file.** `harness/state/work-orders-loop.json`.
- **Reviews archive.** `harness/state/reviews/work-orders-loop/attempt-<N>/<reviewer-name>.md`.
- **Generator verdict trailer.** `VERDICT: ready_for_review` or `VERDICT: awaiting_clarification\nopen_questions: <N>\nquestions_file: work-orders/_questions-pending.md`.

## Architecture Decision Records

### ADR-001: Four reviewers — spec, coverage, overlap, sequencing

**Context.** The requirements and blueprint loops have four reviewers each. The work-orders loop has four parallel concerns: structural shape (atomicity included), blueprint-to-WO coverage, produced-interface overlap, and dependency-plus-execution sequencing (structural and semantic). Folding overlap into coverage or sequencing into a single judge would either underweight semantic checks or muddle two distinct rubrics.

**Decision.** Four reviewers: `wo-spec-judge` (structural shape + atomicity + content quality), `wo-coverage-judge` (blueprint-to-WO coverage + mention resolution + AC-gate alignment), `wo-overlap-judge` (produced-interface uniqueness across pairs), `wo-sequencing-judge` (structural acyclic graph + valid topological `_sequence.md` + semantic dependency consumption). Each rubric is targeted; failures are attributable.

**Consequences.** Wall-clock latency is bounded by the slowest of four reviewers. The four-judge split mirrors the upstream-loop pattern. Trade-off: one more parallel subprocess than a three-judge configuration; cheap because reviewers are IO-bound on the model API.

### ADR-002: `.sequence.meta.yaml` hash short-circuit

**Context.** Re-running `work-orders-loop` after every blueprint edit would regenerate the entire sequence even when the blueprints have not changed. That wastes wall-clock and could destabilise existing work-order slugs.

**Decision.** The generator hashes the blueprints tree and compares to the hash in `.sequence.meta.yaml`. On match (and no failing reviews), produce no edits and exit. The orchestrator runs reviewers on the existing tree.

**Consequences.** Re-running the loop after a no-op blueprint change is fast. Trade-off: the hash has to capture every relevant change; we use a content hash of all blueprint files, which is conservative but reliable.

### ADR-003: Bare-question shape only

**Context.** The blueprint loop supports both bare and with-options shapes. Work-orders-loop questions are about source-artifact ambiguities (a blueprint with overlapping responsibilities, an unclear capability boundary). The generator cannot pre-research alternatives because the resolution is "clarify the source", not "pick".

**Decision.** Work-orders-loop questions use bare shape only. Same rule as the requirements loop.

**Consequences.** Operators answering work-orders-loop questions clarify a blueprint or seed a work order manually; they do not pick from generator-fabricated alternatives. Trade-off: nothing — the bare shape is the right fit.

### ADR-004: Sequence generation lives here, not in the coding loop

**Context.** Earlier designs entwined sequence generation and per-WO execution in the coding loop. That coupled two concerns and made it hard to refresh the sequence without touching execution.

**Decision.** Sequence generation is the work-orders loop's exclusive responsibility. The coding loop reads what is on disk and drains. If blueprints change, the operator runs `work-orders-loop` first to refresh, then `coding-loop` to drain.

**Consequences.** Each loop has one concern. The operator has explicit control over sequence refresh. Trade-off: two subcommand invocations when the sequence needs regenerating; aligned with operator-visible-handoff principle.
