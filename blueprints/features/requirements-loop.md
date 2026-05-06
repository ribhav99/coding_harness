# Requirements Loop

## Feature Summary

The requirements loop is the first autonomous stage. It reads `PRD.md` and produces the structural requirements tree under `requirements/overview/` and `requirements/features/`, with four reviewer subprocesses verifying structural spec, cross-doc consistency, PRD coverage, and feature scoping. The orchestrator commits the tree on full pass and exits with `awaiting_clarification` when open PRD-clarification questions remain. See @Requirements(requirements-loop) for the FRD this blueprint satisfies.

## Component Blueprint Composition

This feature composes:

- **@Blueprint(loop-driver)** — `#LoopDriver` runs the per-attempt state machine; `#RequirementsLoopPromptBuilder` builds spawn prompts naming the `prd-to-frds` skill, the four reviewer skills, the `requirements/` artifact path, and the `requirements_communication/` folder.
- **@Blueprint(subprocess-runtime)** — `#SubprocessSpawner` spawns each `claude -p` subprocess; `#StopHookGenerator` and `#StopHookReviewer` enforce the `VERDICT:` trailer in-session; `#ReviewerPathGuardHook` blocks any reviewer write outside `requirements_communication/<reviewer-name>.md`; `#RateLimitRetryStrategy` and `#ProtocolRetryStrategy` recover from infrastructure throttling and malformed verdicts respectively.
- **@Blueprint(communication-folder)** — `#CommunicationFolderManager` ensures and snapshots `requirements_communication/`; the folder holds one file per agent (`prd-to-frds.md`, `req-spec-judge.md`, `req-cross-doc-judge.md`, `req-coverage-judge.md`, `req-scoping-judge.md`).
- **@Blueprint(questions-pending)** — `#QuestionsPendingDetector` inspects `requirements/_questions-pending.md` after each attempt; the file uses bare-question shape only.
- **@Blueprint(meta-materialization)** — `#MetaMaterialiser` walks the requirements tree post-generator-exit to materialise `.<slug>.overview.meta.yaml`, `.<slug>.feature.meta.yaml`, and `.<slug>.requirements.meta.yaml` files.
- **@Blueprint(state-store)** — `#StateStore` writes `harness/state/requirements-loop.json`; `#ReviewSnapshotter` archives reviewer files at every attempt boundary into `harness/state/reviews/requirements-loop/attempt-<N>/`.
- **@Blueprint(git-integration)** — `#GitIntegration` commits the tree on `pass` (`requirements-loop: attempt N passed`) or on `awaiting_clarification` (`requirements-loop: attempt N — awaiting_clarification`).
- **@Blueprint(agents-and-skills)** — `#RequirementsGeneratorAgent` is the lead-PM identity loading the `prd-to-frds` skill; `#RequirementsReviewerAgents` are the four LLM-as-judge reviewers.

The loop is a near-symmetric mirror of @Feature(blueprint-loop): same dual-completion mechanism, same `awaiting_clarification` exit verdict, same gen↔reviewer communication-folder pattern. Differences: different generator skill, different reviewer set, different artifact tree, bare-only question shape (vs blueprint-loop's bare-or-with-options).

## Feature-Specific Components

```component
name: PrdToFrdsSkill
container: Claude Code Subprocess
responsibilities:
	- The generator skill loaded by `#RequirementsGeneratorAgent`
	- Reads `PRD.md` and produces `requirements/overview/<slug>.md` files (product-overview sections) and `requirements/features/<slug>.md` files (FRDs)
	- Creates sibling `<slug>_children/` directories when a feature decomposes further (recursive flat shape)
	- Writes only visible `<slug>.md` content files; never writes meta files
	- Iterative: reads existing tree first, edits only what needs changing, never regenerates from scratch
	- Appends bare-question blocks to `requirements/_questions-pending.md` for genuine PRD ambiguities (contradictions between sections, undefined concepts, features named but never described); does not log questions for sections skipped by design or for minor grammar issues
	- Reads every reviewer's file in `requirements_communication/` before producing or editing artifacts; on retry attempts (≥ 2), appends per-finding responses (fix / push back / surface) to each failing reviewer's file plus a `## Changes since previous attempt` block to every reviewer's file
	- Each `<slug>.md` file begins with an H1 matching the human title of the node
```

```component
name: ReqSpecJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying structural spec for each FRD: required sections present (Overview, Terminology, Requirements, Feature Behavior & Rules), each requirement has a REQ-ID, user story, and acceptance criteria in testable `shall`/`should`/`may` phrasing
	- Reads `requirements_communication/req-spec-judge.md` plus the FRDs being judged
	- Appends a `## Review — attempt N` block ending with `VERDICT: pass` or `VERDICT: fail`
	- Catches structurally-malformed FRDs that would confuse the blueprint generator
```

```component
name: ReqCrossDocJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying whole-tree consistency: contradictions between FRDs, terminology drift, duplication that should be consolidated or cross-referenced
	- Reads `requirements_communication/req-cross-doc-judge.md` plus the full overview and features trees
	- Catches drift that would let the blueprint generator produce inconsistent blueprints
```

```component
name: ReqCoverageJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying the union of FRDs and overview sections covers the PRD's scope without gaps or overlaps
	- Reads `requirements_communication/req-coverage-judge.md`, `PRD.md`, plus both `requirements/overview/` and `requirements/features/` trees
	- Catches PRD scope that did not make it into any FRD — the load-bearing check
```

```component
name: ReqScopingJudgeSkill
container: Claude Code Subprocess
responsibilities:
	- LLM-as-judge reviewer verifying each FRD individually passes the feature-unit definition (standalone value, implementation footprint, independent deployability, incremental value) and that parent/child relationships are valid (parent delivers value alone; child meaningless without parent)
	- Reads `requirements_communication/req-scoping-judge.md` plus the FRDs being judged
	- Catches FRDs that would not decompose cleanly into work orders downstream
```

The five skills are concrete loadable artifacts under `.claude/skills/`. The four reviewer skills run in parallel inside an attempt's reviewer fan-out; the generator runs alone before each fan-out.

## System Contracts

### Key Contracts

- **Dual completion condition.** Full `pass` requires all four reviewers pass AND `requirements/_questions-pending.md` has no open questions blocking the review.
- **`awaiting_clarification` exit.** When reviewers pass on the concrete content but open questions remain, the loop commits current progress (tree + updated questions doc) and exits with code 2. Operator resolves by editing `PRD.md` and either deleting resolved blocks or renaming the file to `_questions-resolved-<timestamp>.md`.
- **Bare-question shape only.** Requirements-loop questions are always bare ("what does X mean?", "did you intend Y or Z?") because the answer is "clarify the PRD" — there's nothing for the generator to pre-research.
- **No PR for output.** The requirements tree is documentation, not code. Git commit history is the audit trail; the orchestrator does not open a pull request for the tree.
- **Iterative generator posture.** The generator reads existing tree first; preserves nodes that are correct, edits nodes that need changes, deletes nodes that no longer have PRD source. Regenerating from scratch on every run would destroy prior good work and prevent convergence.
- **One generator skill, no sub-skill co-invocation.** The `prd-to-frds` skill carries every responsibility for this loop in one prompt.

### Integration Contracts

- **Subcommand.** `python -m orchestrator requirements-loop`. Exit codes: 0 (pass), 1 (exhausted), 2 (awaiting_clarification).
- **Artifact tree.** `requirements/overview/` (flat) and `requirements/features/` (flat with optional `<slug>_children/` recursive subtrees).
- **Communication folder.** `requirements_communication/` at the project repo root, sibling of `requirements/`. One file per agent: `prd-to-frds.md`, `req-spec-judge.md`, `req-cross-doc-judge.md`, `req-coverage-judge.md`, `req-scoping-judge.md`.
- **Questions file.** `requirements/_questions-pending.md`. Bare-question shape only.
- **State file.** `harness/state/requirements-loop.json` per @Blueprint(state-store).
- **Reviews archive.** `harness/state/reviews/requirements-loop/attempt-<N>/<reviewer-name>.md`.
- **Generator verdict trailer.** `VERDICT: ready_for_review` or `VERDICT: awaiting_clarification\nopen_questions: <N>\nquestions_file: requirements/_questions-pending.md`.
- **Reviewer verdict trailer.** `VERDICT: pass` or `VERDICT: fail`.

## Architecture Decision Records

### ADR-001: Four reviewers, each focused on a distinct downstream failure

**Context.** Reviewer overlap wastes wall-clock and creates inconsistent verdicts when reviewers disagree on overlapping rubric. Reviewer gaps let defects through. The four-rubric split must be MECE for the failure modes that matter.

**Decision.** Four reviewers covering four distinct downstream failures. `req-spec-judge` for structurally-malformed FRDs. `req-cross-doc-judge` for terminology drift and duplication that would confuse the blueprint generator. `req-coverage-judge` for PRD scope that did not make it into any FRD. `req-scoping-judge` for FRDs that fail the feature-unit definition.

**Consequences.** Each reviewer is focused; none repeats another's work. Wall-clock latency is bounded by the slowest reviewer in the parallel fan-out. Trade-off: a future failure mode that does not fit any of the four rubrics would need a fifth reviewer; revisit if the need surfaces.

### ADR-002: Bare-question shape only

**Context.** The blueprint loop supports both bare and with-options question shapes because architectural decisions benefit from pre-research. Requirements-loop questions are about PRD ambiguities — the generator cannot pre-research a contradiction the operator wrote into the PRD.

**Decision.** Requirements-loop questions use the bare shape only. The skill prompt explicitly forbids fabricating options.

**Consequences.** Operators answering requirements-loop questions clarify their own PRD; they do not pick from generator-fabricated alternatives. Trade-off: nothing — the bare shape is the right fit for the resolution mechanism (PRD edit).

### ADR-003: Generator never edits `PRD.md`

**Context.** The generator could in principle propose PRD edits to resolve the ambiguities it finds. But that would let the autonomous loop overwrite operator-authored content, and it would couple resolution to generator-attempt timing.

**Decision.** The generator never edits `PRD.md`. It only logs questions and continues. Resolution is operator-only — the operator edits the PRD, then re-runs the loop.

**Consequences.** PRD authorship stays human. Re-runs are deterministic (the loop sees the operator's edits, not generator-proposed alternatives). Trade-off: the operator does the explicit resolution work; aligned with the design principle that PRD is human.
