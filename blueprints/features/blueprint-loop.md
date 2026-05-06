# Blueprint Loop

## Feature Summary

The blueprint loop is the second autonomous stage. It reads approved FRDs from `requirements/features/` and produces technical blueprints under `blueprints/` across three types — container, component, feature — slug-matched 1:1 with each FRD on the feature side. Four reviewers evaluate structural spec, FRD-to-blueprint coverage, cross-blueprint consistency, and decision hygiene. Architectural choices that need operator judgment are surfaced as bare or with-options blocks in `blueprints/_questions-pending.md`. See @Requirements(blueprint-loop) for the FRD this blueprint satisfies.

## Component Blueprint Composition

This feature composes:

- **@Blueprint(loop-driver)** — `#LoopDriver` runs the per-attempt state machine; `#BlueprintLoopPromptBuilder` builds spawn prompts naming the `frd-to-blueprint` skill, the four reviewer skills, the `blueprints/` artifact path, the optional `BLUEPRINT.md`, and the `blueprints_communication/` folder.
- **@Blueprint(subprocess-runtime)** — `#SubprocessSpawner` for `claude -p` invocations; `#StopHookGenerator`/`#StopHookReviewer` enforce verdict trailers; `#ReviewerPathGuardHook` blocks reviewer writes outside `blueprints_communication/<reviewer-name>.md`.
- **@Blueprint(communication-folder)** — `#CommunicationFolderManager` ensures and snapshots `blueprints_communication/`; the folder holds `frd-to-blueprint.md` plus `bp-spec-judge.md`, `bp-coverage-judge.md`, `bp-consistency-judge.md`, `bp-decision-judge.md`.
- **@Blueprint(questions-pending)** — `#QuestionsPendingDetector` inspects `blueprints/_questions-pending.md`; this loop uses **both** the bare-question and with-options block shapes (with-options for genuine architectural choices, bare for clarifications).
- **@Blueprint(meta-materialization)** — `#MetaMaterialiser` walks the blueprints tree post-generator-exit to materialise `.<slug>.<kind>.meta.yaml` (where `<kind>` is `container`, `component`, or `feature`) plus `.<slug>.requirements.meta.yaml` files.
- **@Blueprint(state-store)** — `#StateStore` writes `harness/state/blueprint-loop.json`; `#ReviewSnapshotter` archives reviewer files into `harness/state/reviews/blueprint-loop/attempt-<N>/`.
- **@Blueprint(git-integration)** — `#GitIntegration` commits the blueprints tree on `pass` or `awaiting_clarification`.
- **@Blueprint(agents-and-skills)** — `#BlueprintGeneratorAgent` is the lead-engineer identity loading the `frd-to-blueprint` skill; `#BlueprintReviewerAgents` are the four LLM-as-judge reviewers. `#BlueprintAuthoringSkill` is an interactive operator-driven counterpart, **not** invoked by this autonomous loop.

The loop is a near-symmetric mirror of @Feature(requirements-loop): same dual-completion mechanism, same `awaiting_clarification` exit verdict, same gen↔reviewer communication-folder pattern. Differences: a different generator skill, a different reviewer set, a different artifact tree, and a richer question-shape repertoire because architectural choices benefit from pre-research.

## Feature-Specific Components

```component
name: FrdToBlueprintSkill
container: Claude Code Subprocess
responsibilities:
	- The generator skill loaded by `#BlueprintGeneratorAgent`; single skill, no sub-skill co-invocation
	- Reads the full `requirements/features/` tree, the existing `blueprints/` tree, the current `blueprints/_questions-pending.md`, and the optional `BLUEPRINT.md` at the project repo root before deciding what to produce or edit
	- Produces a feature blueprint at `blueprints/features/<slug>.md` for each FRD `requirements/features/<slug>.md` (slug parity is load-bearing)
	- Produces a component blueprint at `blueprints/components/<slug>.md` for each cross-cutting capability that two or more features depend on (or that `BLUEPRINT.md` lifts out as a foundational concern)
	- Produces a container blueprint at `blueprints/containers/<slug>.md` for each deployable runtime
	- Each blueprint follows the per-type structural shape pinned in the project's blueprint document-shape contract: section order, mention syntax (`#Component`, `` `Element` ``, `@Blueprint`/`@Requirement`), fenced `component`/`model` blocks, ADRs as `### ADR-NNN: Title` with Context/Decision/Consequences
	- Iterative: reads existing tree first, edits only what needs changing, never regenerates from scratch
	- Does not redefine shared components inside feature blueprints; feature blueprints reference shared components via `#Component` mentions and component blueprints via `@Blueprint`, never duplicating component blocks
	- Appends question blocks (bare or with-options per the choice's nature) to `blueprints/_questions-pending.md` for high-impact architectural decisions (database, framework, auth provider, hosting, ORM, major architectural pattern); does not fabricate options to fill the with-options shape
	- May leave `<!-- pending: <question-title> -->` HTML comments at affected blueprint locations; reviewers tolerate these
	- Reads every reviewer's file in `blueprints_communication/` before producing or editing artifacts; on retry attempts (≥ 2), appends per-finding responses and a `## Changes since previous attempt` block
```

```component
name: BpSpecJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying each blueprint's per-type structural shape: correct section order, required sections present, fenced `component`/`model` blocks well-formed (required keys present, tab-indented bullets), ADRs follow `### ADR-NNN: Title` + Context/Decision/Consequences
	- Fanned out per-blueprint so failures are attributable to specific files
	- Catches structural defects that would confuse downstream `blueprint-to-work-orders`
```

```component
name: BpCoverageJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying three things: (a) every approved FRD has a feature blueprint with matching slug; (b) every `#Component` mention resolves, every `` `Element` `` mention has a definition (model block or schema reference), every `@Blueprint` mention resolves; (c) no orphan blueprints, no high-impact architectural choice unresolved without a matching block in `blueprints/_questions-pending.md`
	- Walks `BLUEPRINT.md` end-to-end (when present) and ensures each pinned element has either a matching blueprint or a matching open question block
```

```component
name: BpConsistencyJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying three things: (a) cross-blueprint contract alignment (if a feature blueprint composes component X assuming behaviour Y, component blueprint X actually exposes Y); (b) the no-redefinition rule (feature blueprints reference shared components rather than restating them); (c) the boundary-first rule (container blueprints don't drift into internal wiring, which belongs in component blueprints)
```

```component
name: BpDecisionJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying no high-impact architectural decision (database, framework, auth provider, hosting, ORM, major architectural pattern) was silently made by the generator without a matching question block in `blueprints/_questions-pending.md`
	- Does not flag low-stakes implementation choices (linting library, log format, internal helper module names)
```

The five skills are concrete loadable artifacts. The four reviewer skills run in parallel inside an attempt's reviewer fan-out; the generator runs alone between fan-outs.

## System Contracts

### Key Contracts

- **Three blueprint types.** Container, component, feature. Each has its own canonical structural shape. A blueprint exists as a component when two or more features depend on it (or `BLUEPRINT.md` lifts it out); single-feature use stays inside that feature blueprint.
- **Feature blueprint slug parity.** `blueprints/features/<slug>.md` matches `requirements/features/<slug>.md` exactly. Load-bearing for downstream `blueprint-to-work-orders`.
- **No redefinition.** Feature blueprints reference shared components via `#Component` and component blueprints via `@Blueprint`; never paste a fresh `component` block for a component already defined in a component blueprint.
- **Boundary-first containers.** Container blueprints describe what crosses the container's boundary; internal component-to-component wiring belongs in component blueprints.
- **Two question shapes.** Bare for clarifications; with-options for genuine architectural choices (with 2–4 pre-researched options each carrying Pros/Cons and a recommended default). Generator picks per-question; never fabricates options.
- **Pending markers tolerated.** `<!-- pending: <title> -->` HTML comments at affected blueprint locations are not flagged by reviewers; what they flag is a high-impact decision made silently with no question block (`SILENT_DECISION`).
- **Optional `BLUEPRINT.md`.** A project-root `BLUEPRINT.md` may exist as the operator's high-level architectural starting input; the generator reads it as authoritative starting points but does not edit it. Absence is normal.
- **Dual completion condition.** Full `pass` requires all four reviewers pass AND `blueprints/_questions-pending.md` has zero unanswered questions.
- **`awaiting_clarification` exit.** Same verdict as the requirements and work-orders loops; same exit code (2). Operator answers in-place by filling `Your answer:` lines.

### Integration Contracts

- **Subcommand.** `python -m orchestrator blueprint-loop`. Exit codes: 0 (pass), 1 (exhausted), 2 (awaiting_clarification).
- **Artifact tree.** `blueprints/containers/<slug>.md`, `blueprints/components/<slug>.md`, `blueprints/features/<slug>.md`. Per-type structural shapes pinned in the project's blueprint document-shape contract (this very tree is an example).
- **Communication folder.** `blueprints_communication/` at the project repo root. One file per agent: `frd-to-blueprint.md`, `bp-spec-judge.md`, `bp-coverage-judge.md`, `bp-consistency-judge.md`, `bp-decision-judge.md`.
- **Questions file.** `blueprints/_questions-pending.md`. Bare and with-options block shapes; pinned in @Blueprint(questions-pending).
- **State file.** `harness/state/blueprint-loop.json`.
- **Reviews archive.** `harness/state/reviews/blueprint-loop/attempt-<N>/<reviewer-name>.md`.
- **Generator verdict trailer.** `VERDICT: ready_for_review` or `VERDICT: awaiting_clarification\nopen_questions: <N>\nquestions_file: blueprints/_questions-pending.md`.
- **Operator-driven question resolution.** Operator fills `Your answer:` lines in-place (or moves resolved blocks to `_questions-resolved-<timestamp>.md`). On the next loop run, the generator reads the answers and continues.

## Architecture Decision Records

### ADR-001: Single skill across three blueprint types

**Context.** A multi-skill generator could load one skill per blueprint type (`frd-to-feature-blueprint`, `frd-to-component-blueprint`, `frd-to-container-blueprint`). That would make per-type rules easy to evolve but require cross-skill coordination on shared concerns (mention resolution, slug parity, no-redefinition).

**Decision.** One generator skill (`frd-to-blueprint`) handles all three types. The skill body explains per-type rules; the generator decides which type each blueprint should be.

**Consequences.** Cross-type concerns (mention resolution, slug parity) are coherent because one prompt handles them. Trade-off: the prompt is longer; mitigated by clear per-type sections.

### ADR-002: Two question shapes

**Context.** Architectural choices range from clarifications ("what does the operator mean by 'cohort' in FRD-X?") to genuine picks ("Postgres vs DynamoDB for the user store"). Forcing one shape for both wastes pre-research effort on clarifications or under-specifies architectural picks.

**Decision.** Two shapes. Bare for clarifications. With-options for genuine architectural choices, with 2–4 pre-researched options each carrying Pros/Cons and a recommended default. Generator picks per-question; the skill prompt forbids fabricating options.

**Consequences.** Operators do not have to research architectural alternatives themselves. Operators do not get artificial options for what is really a clarification. Trade-off: discipline on the generator's part not to fabricate; reviewers can catch this via `bp-decision-judge`.

### ADR-003: Interactive `blueprint-authoring` skill is out of the loop

**Context.** A fully autonomous blueprint loop is what the harness needs for happy-path generation. But blueprint authoring sometimes calls for ad-hoc operator-driven refinement after the loop has run. Folding interactive editing into the loop would muddle autonomy posture.

**Decision.** `blueprint-authoring` is an interactive Claude Code skill the operator invokes themselves outside the loop. The autonomous loop's generator is `frd-to-blueprint`, period. Same posture as `prd-authoring` for the PRD.

**Consequences.** Each posture has its own skill. The autonomous loop never pauses for operator input mid-attempt; if input is needed, it goes to `_questions-pending.md`. Trade-off: the operator has to decide when to use the interactive skill vs re-running the loop; aligned with operator-visible-handoff design.

### ADR-004: Operator-resolved questions in-place via `Your answer:`

**Context.** Operators could resolve questions by editing the source artifact (an FRD) and re-running. That works for clarifications but not for picks — a pick like "Postgres vs DynamoDB" is not embedded in an FRD; it is an architectural decision the FRD might not even mention.

**Decision.** Operators answer by filling `Your answer:` lines in `blueprints/_questions-pending.md` directly. They may optionally rename answered blocks to `_questions-resolved-<timestamp>.md`, or leave them in place for the generator to detect.

**Consequences.** One file to scan, one line to fill per question. Architectural-pick context lives next to the question. Trade-off: the operator must edit a generated file, which is a slight conceptual oddity; mitigated by the file being explicitly designed for operator edit.
