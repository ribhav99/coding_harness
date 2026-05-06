# Work-Orders Loop

## Feature Summary

The work-orders loop is the third autonomous stage. It reads approved blueprints from `blueprints/` and produces an ordered sequence of work orders under `work-orders/wo-NNN/` — one continuous flat sequence with `blocked_by[]` plus `sort_order` encoding the dependency graph (no phase groupings). Three reviewers evaluate scoping atomicity, blueprint-to-work-order coverage, and dependency-graph correctness. Decomposition ambiguities are surfaced as bare-question blocks in `work-orders/_questions-pending.md`. See @Requirements(work-orders-loop) for the FRD this blueprint satisfies.

## Component Blueprint Composition

This feature composes:

- **@Blueprint(loop-driver)** — `#LoopDriver` runs the per-attempt state machine; `#WorkOrdersLoopPromptBuilder` builds spawn prompts naming the `blueprint-to-work-orders` skill, the three reviewer skills, the `work-orders/` artifact path, the `.sequence.meta.yaml` short-circuit input, and the `work-orders_communication/` folder.
- **@Blueprint(subprocess-runtime)** — `#SubprocessSpawner`, `#StopHookGenerator`/`#StopHookReviewer`, `#ReviewerPathGuardHook` enforcing reviewer write isolation to `work-orders_communication/<reviewer-name>.md`.
- **@Blueprint(communication-folder)** — `#CommunicationFolderManager` ensures and snapshots `work-orders_communication/`; the folder holds `blueprint-to-work-orders.md`, `wo-scoping-judge.md`, `wo-coverage-judge.md`, `wo-dependency-judge.md`.
- **@Blueprint(questions-pending)** — `#QuestionsPendingDetector` inspects `work-orders/_questions-pending.md`; this loop uses bare-question shape only (like the requirements loop).
- **@Blueprint(meta-materialization)** — `#MetaMaterialiser` materialises per-WO meta files; `#BlockedByMaterialiser` is the work-orders-specific specialisation that derives `.work-order.meta.yaml.blocked_by[]` from each work order's `description.md` `Depends on.work_orders` block.
- **@Blueprint(state-store)** — `#StateStore` writes `harness/state/work-orders-loop.json`; `#ReviewSnapshotter` archives reviewer files into `harness/state/reviews/work-orders-loop/attempt-<N>/`.
- **@Blueprint(git-integration)** — `#GitIntegration` commits the work-orders tree on `pass` or `awaiting_clarification`.
- **@Blueprint(agents-and-skills)** — `#WorkOrdersGeneratorAgent` is the lead-tech-lead identity loading the `blueprint-to-work-orders` skill; `#WorkOrdersReviewerAgents` are the three LLM-as-judge reviewers.

The loop is the third in the upstream-loop family — a near-symmetric mirror of @Feature(blueprint-loop) and @Feature(requirements-loop). Differences: a different generator skill, three reviewers (vs four for the upstream loops), bare-only question shape, and the `.sequence.meta.yaml` short-circuit when blueprints have not changed since the last successful run.

## Feature-Specific Components

```component
name: BlueprintToWorkOrdersSkill
container: Claude Code Subprocess
responsibilities:
	- The generator skill loaded by `#WorkOrdersGeneratorAgent`; single skill, no sub-skill co-invocation
	- Reads every approved blueprint under `blueprints/`, the existing `work-orders/` tree, the current `work-orders/_questions-pending.md`, and `work-orders/.sequence.meta.yaml` before deciding what to produce or edit
	- Writes each work order's `description.md` directly in the canonical scoped-task body shape (no separate "stub then expand" step)
	- Writes work orders to `work-orders/wo-NNN/description.md` with leading-zero numbering so lexicographic sort matches numeric order
	- Writes each work order's `Depends on.work_orders` consistent with `sort_order` (no work order depends on a higher-numbered work order); the orchestrator materialises `.work-order.meta.yaml.blocked_by[]` from the description block
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
	- Defines the canonical `description.md` section shape pinned in @Requirements(work-orders-loop) REQ-WO-002: `# <Title>`, `## Goal`, `## Blueprints`, `## In scope`, `## Out of scope`, `## Produces`, `## Depends on`, `## Acceptance criteria`, `## Gates`, optional `## Implementation notes (non-binding)`
	- `## Goal` carries one observable-outcome sentence
	- `## Blueprints` lists `- #<blueprint-slug> — <one line>` bullets; every mention resolves to `blueprints/{containers,components,features}/<slug>.md`
	- `## Produces` holds a fenced YAML block listing produced interfaces with `kind`/`name`/`contract` per entry; empty list `[]` for refactor-only work orders
	- `## Depends on` holds a fenced YAML block with `work_orders: [wo-NNN, ...]` and `interfaces: [{from: wo-NNN, name: <interface-name>}]`
	- `## Acceptance criteria` holds checklist items in the format `- [ ] AC-WO-NNN.M (via <gate>) — <expected outcome>` where `<gate>` is `tests`, `playwright`, or `code-spec`
	- `## Gates` holds a fenced YAML block with six required keys (`tests`, `playwright`, `code-spec`, `code-regression`, `code-security`, `code-quality`) each `required` or `not_applicable`; the four LLM-as-judge gates are always `required`
```

```component
name: WoScopingJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying each work order is atomic per the atomicity definition: at most one named interface in `Produces` (or one cohesive purpose stated in `Goal` for refactor-only WOs with empty `Produces`), an observable Goal sentence, no bundled multiple changes
	- Flags work orders whose `Goal` sentence requires "and" to describe the change; flags work orders with multiple `Produces` entries that are not tightly cohesive; flags `In scope`/`Out of scope` boundaries that are unclear or contradictory
	- Fanned out per-work-order so failures are attributable to specific files
```

```component
name: WoCoverageJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying three things: (a) every approved blueprint's delivery surface (component blocks, model blocks, feature commitments) maps to at least one work order via a `#<blueprint-slug>` mention; (b) every `#<blueprint-slug>` mention resolves; (c) every acceptance criterion's observation gate (`tests`, `playwright`, `code-spec`) is declared `required` in the work order's `## Gates` block
```

```component
name: WoDependencyJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying three things: (a) the dependency graph derived from each work order's `Depends on` block is acyclic; (b) every `interfaces` entry resolves to an entry in the named upstream work order's `Produces` block; (c) `sort_order` is consistent with `Depends on.work_orders` (no WO depends on a higher-numbered WO)
```

The skills are concrete loadable artifacts. Three reviewer skills run in parallel; the generator runs alone between fan-outs.

## System Contracts

### Key Contracts

- **Flat sequence, no phases.** Work orders are flat at the top level. `blocked_by[]` plus `sort_order` together encode everything Software Factory used phase groupings for. No additional phase field exists.
- **Description as single source of truth for dependencies.** `description.md`'s `Depends on.work_orders` is canonical; `.work-order.meta.yaml.blocked_by[]` is materialised from it by `#BlockedByMaterialiser`.
- **Atomicity.** One named interface in `Produces` (or one cohesive purpose stated in `Goal` for refactor-only WOs). Goals requiring "and" to describe are sign of two work orders that should be split.
- **Coverage.** The union of all `Produces` plus all `In scope` items across all work orders has to compose into the full delivery surface of every approved blueprint. Gaps mean some blueprint section never gets implemented; overlaps mean two work orders both produce the same interface.
- **Dependency graph is acyclic.** `wo-dependency-judge` enforces. Every `interfaces` entry in `Depends on` resolves to a concrete entry in the upstream work order's `Produces`.
- **Hash short-circuit.** When the current blueprint-tree hash matches `.sequence.meta.yaml` AND no failing reviews to address, the generator produces no edits. The orchestrator then runs reviewers on the existing tree and exits with `pass` if they all pass.
- **Bare-question shape only.** Work-orders-loop questions are always bare; resolution is "clarify the relevant blueprint (or seed a manually-authored work order)", not "pick between alternatives".
- **Independent of the coding loop.** Running `work-orders-loop` produces or refreshes the sequence without executing any per-work-order implementation. Sequence generation does not happen inside the coding loop.
- **All produced work orders land `status: ready`.** On full pass, every work order in the tree has `.work-order.meta.yaml.status = ready`. `.sequence.meta.yaml` is updated with the current blueprints hash and a generation timestamp.

### Integration Contracts

- **Subcommand.** `python -m orchestrator work-orders-loop`. Exit codes: 0 (pass), 1 (exhausted), 2 (awaiting_clarification).
- **Artifact tree.** `work-orders/wo-NNN/description.md` (visible content), `work-orders/wo-NNN/.work-order.meta.yaml` (orchestrator-materialised), `work-orders/.sequence.meta.yaml` (orchestrator-managed), `work-orders/_inbox/` (gaps from the coding loop), `work-orders/_questions-pending.md` (open questions).
- **Communication folder.** `work-orders_communication/`. One file per agent: `blueprint-to-work-orders.md`, `wo-scoping-judge.md`, `wo-coverage-judge.md`, `wo-dependency-judge.md`.
- **Questions file.** `work-orders/_questions-pending.md`. Bare-question shape only.
- **State file.** `harness/state/work-orders-loop.json`.
- **Reviews archive.** `harness/state/reviews/work-orders-loop/attempt-<N>/<reviewer-name>.md`.
- **Generator verdict trailer.** `VERDICT: ready_for_review` or `VERDICT: awaiting_clarification\nopen_questions: <N>\nquestions_file: work-orders/_questions-pending.md`.

## Architecture Decision Records

### ADR-001: Three reviewers, no spec-judge equivalent

**Context.** The requirements and blueprint loops have four reviewers each, including a structural spec-judge. Work orders also have a canonical structural shape (the scoped-task body); a fourth reviewer for it would parallel the upstream-loop pattern. But the structural shape is mechanical (specific section headers, fenced YAML blocks with required keys) and is largely caught by the other reviewers when they fail to resolve mentions or parse blocks.

**Decision.** Three reviewers: scoping (atomicity), coverage (blueprint-to-WO mapping), and dependency (graph correctness). Structural-shape violations surface naturally when the other reviewers cannot find what they need.

**Consequences.** Wall-clock latency is bounded by three reviewers, not four. Trade-off: a structurally-malformed work order that does not break a coverage or dependency check could slip through; revisit if observed in practice.

### ADR-002: `.sequence.meta.yaml` hash short-circuit

**Context.** Re-running `work-orders-loop` after every blueprint edit would regenerate the entire sequence even when the blueprints have not changed. That wastes wall-clock and could destabilise existing work-order numbering.

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
