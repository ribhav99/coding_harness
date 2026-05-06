# PRD Authoring

## Feature Summary

The PRD-authoring feature is the operator-driven, interactive Claude Code skill that produces and refines the single monolithic `PRD.md` at the project repo's root. It is the only stage of the harness where a human sits inside the loop. Implementation surface comes entirely from @Blueprint(agents-and-skills) (the `prd-authoring` interactive skill) and @Blueprint(project-repo) (the file the skill writes). See @Requirements(prd-authoring) for the FRD this blueprint satisfies.

## Component Blueprint Composition

This feature composes:

- **@Blueprint(agents-and-skills)** — The `#PRDAuthoringSkill` is the canonical implementation. It runs as an interactive Claude Code session loaded via the `prd-authoring` skill and applies the senior-PM identity, the writing rules (narrative prose, active voice, no fluff, WHAT not HOW), the no-fabrication and no-refactor-breadcrumb discipline, the clarification policy (ambiguous → ask and wait; specific → act; middle → propose plus up to two questions), and the five-category critique rubric (CONFLICT, MISSING, AMBIGUOUS, DUPLICATION, STALE).
- **@Blueprint(project-repo)** — `PRD.md` lives at the project repo root. The skill writes only this one file (per FRD AC-PRDA-001.3). All other artifact trees (`requirements/`, `blueprints/`, `work-orders/`, `harness/`) are owned by downstream loops.

The skill is **not** orchestrator-spawned — it runs only inside an interactive Claude Code session the operator opens. There is no @Blueprint(loop-driver) composition because there is no autonomous loop here.

## Feature-Specific Components

```component
name: PRDDocument
container: Project Repo
responsibilities:
	- Single monolithic markdown file at the project repo root: `PRD.md`
	- Operator-authored exclusively (via #PRDAuthoringSkill or direct edit); no autonomous loop ever writes this file
	- Input to the requirements loop (consumed by the `prd-to-frds` generator)
	- Updated in place to resolve `requirements/_questions-pending.md` blocks (per @Feature(requirements-loop)'s operator-side question resolution)
```

```component
name: CritiqueRubric
container: Claude Code Subprocess
responsibilities:
	- Five-category in-session feedback applied by #PRDAuthoringSkill on operator demand
	- Categories: `CONFLICT` (direct contradictions), `MISSING` (critical product-level gaps blocking understanding), `AMBIGUOUS` (genuine confusion about user experience or feature behavior), `DUPLICATION` (significant duplicated content needing consolidation), `STALE` (refactor residue that only makes sense against a prior version)
	- Critical-only filter — minor grammar or polish concerns are not surfaced
	- Findings live in the conversation, not in any external file; critique is a mode of the same skill, not a separate skill
```

```component
name: ClarificationPolicy
container: Claude Code Subprocess
responsibilities:
	- Three-branch decision the skill applies on every operator turn: ambiguous → ask a clarifying question and wait; specific → act directly; middle → propose plus up to two targeted clarifying questions
	- Operator can override at any time by giving a direct instruction
```

```component
name: FeatureUnitScopingHeuristic
container: Claude Code Subprocess
responsibilities:
	- Informal, in-session evaluation the skill applies when the operator describes a feature
	- Surfaces scoping concerns based on the four feature-unit dimensions: standalone value, implementation footprint, independent deployability, incremental value
	- Does not produce formal FRDs — that is the requirements loop's job; the skill points the operator at it if they ask for decomposition
```

The four feature-specific components are concerns of the interactive skill alone; nothing else in the harness uses them.

## System Contracts

### Key Contracts

- **Operator-driven only.** The skill is never invoked autonomously. There is no orchestrator subcommand for it; the operator opens an interactive Claude Code session and invokes the skill themselves.
- **Single output file.** `PRD.md` at the project repo root. The skill never writes outside this file — no FRD scaffolding, no blueprint stubs, no work-order seeds.
- **No-fabrication discipline.** The skill does not fill gaps with plausible-sounding prose. If the operator does not describe personas, the PRD has no personas section. Carries forward into every downstream loop.
- **Critique is conversational.** Critique findings live in the dialogue, never forwarded to an external file or another skill.
- **Senior-PM identity.** Narrative prose, active voice, focuses on WHAT and why. No fluff adjectives. No refactor breadcrumbs. No HOW.
- **Clarification policy is reactive, not initiative.** The skill follows the operator's lead; it asks only when genuinely ambiguous and acts when specific.

### Integration Contracts

- **Input to requirements loop.** `PRD.md` is read verbatim by the requirements-loop generator (see @Feature(requirements-loop)). The skill produces nothing else; downstream is one canonical input.
- **Question-resolution surface.** When the requirements loop logs a question in `requirements/_questions-pending.md`, the operator returns to the PRD authoring skill (or edits `PRD.md` directly) to resolve it. The skill is the canonical place to make PRD edits, but direct edits work too.
- **Critique output.** In-conversation only; no markdown file, no JSON output. The model speaks its findings; the operator reads them.

## Architecture Decision Records

### ADR-001: Critique is a mode of the same skill

**Context.** Critique could live in a separate skill (`prd-critique`) the operator switches to. That would have a clean boundary but require context-switching between authoring and reviewing.

**Decision.** Critique is invoked by asking ("what's missing?", "critique this section", "check for contradictions"). The skill applies the rubric inside the ongoing conversation and returns findings as part of the dialogue. No separate skill, no external file.

**Consequences.** The operator stays in one session, with full context; a critique finding can flow directly into a fix. Trade-off: critique findings are not persisted; the operator must act on them inline. The autonomous Requirements Loop downstream catches anything the operator missed.

### ADR-002: Skill writes only `PRD.md`

**Context.** A more ambitious skill could pre-scaffold the requirements tree based on the PRD draft. That would jump-start the requirements loop. But then the skill would couple to the requirements-loop's output schema and create an alternative authoring path for FRDs.

**Decision.** The skill writes one file: `PRD.md`. Nothing else. The operator passes the PRD to the requirements loop when ready; the loop produces the FRD tree autonomously.

**Consequences.** The skill stays simple; the loop boundary stays clean. Each stage of the harness has one canonical input/output. Trade-off: the operator does the explicit handoff (running the loop subcommand); fine because handoffs are operator-visible by design.

### ADR-003: Senior-PM identity for the skill

**Context.** A neutral "AI writing assistant" identity would let the operator drive every decision. But operators frequently make scope and clarity errors a senior PM would catch (fluff adjectives, undefined personas, decomposition that fails the feature-unit definition).

**Decision.** The skill wears a senior-PM identity with explicit writing rules and feature-unit scoping discipline. It surfaces scoping concerns and adheres to the writing rules even when the operator does not ask.

**Consequences.** PRD quality is higher in expectation; the downstream requirements loop has a cleaner input. Trade-off: the skill occasionally pushes back on operator phrasing; the clarification policy mediates this — the operator can always override.
