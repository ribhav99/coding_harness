# Requirements Loop

## Overview

The Requirements Loop is the first autonomous stage after PRD authoring. It reads the monolithic `PRD.md` at the project repo's root and decomposes it into the full structural requirements tree — product-overview sections under `requirements/overview/` and Feature Requirements Documents under `requirements/features/`. An autonomous generator writes the tree; four reviewer subagents evaluate it against distinct rubrics; the orchestrator re-spawns the generator with aggregated feedback on any fail and commits the tree on all-pass.

The operator needs this loop because hand-decomposing a PRD into correctly-scoped FRDs is the most time-consuming and error-prone stage of the pre-code workflow. The loop automates the decomposition and catches defects through four specialized reviewers — structural spec, cross-doc consistency, PRD coverage, and feature scoping — each focused on one class of failure that would otherwise wreck the downstream Blueprint Loop.

## Terminology

- **Overview tree** — the flat directory `requirements/overview/` containing product-overview section documents (business problem, current state, personas, success metrics, measurement, product description, design principles, architecture, project lifecycle, technical requirements, phases, appendix, and others as the PRD warrants). Each node is a `<slug>.md` file.
- **Features tree** — the flat directory `requirements/features/` containing FRDs. Each node is a `<slug>.md` file; children live in a sibling `<slug>_children/` directory with the same flat shape recursively.
- **FRD** — Feature Requirements Document. One `<slug>.md` file describing a feature with Overview, Terminology, Requirements, and Feature Behavior & Rules sections per the canonical structural shape.
- **Dual completion condition** — the pass condition for this loop: all four reviewers pass AND `requirements/_questions-pending.md` has no open questions blocking further review.
- **`awaiting_clarification`** — the loop exit verdict when reviewers pass on concrete content but open PRD-clarification questions remain.
- **Non-blocking clarification questions** — structured blocks the generator appends to `requirements/_questions-pending.md` when the PRD is ambiguous; the generator keeps working on everything not blocked by the ambiguity.

## Requirements

### REQ-RL-001 — Loop orchestrator subcommand
**User Story.** As an operator, I want a single CLI command that runs the full requirements loop, so that I can go from PRD to reviewed requirements tree without babysitting intermediate steps.
- **AC-RL-001.1** — When the operator runs `python -m orchestrator requirements-loop`, the orchestrator shall spawn one generator subprocess, then spawn each reviewer subprocess, aggregate verdicts, and commit the tree on all-pass.
- **AC-RL-001.2** — The orchestrator shall re-spawn the generator with aggregated reviewer feedback on any reviewer fail.
- **AC-RL-001.3** — The orchestrator shall enforce an attempt cap per invocation and a wall-clock cap per subprocess and exit with an `exhausted` verdict if either is hit.

### REQ-RL-002 — Generator reads PRD and writes structural tree
**User Story.** As an operator, I want the generator to read `PRD.md` and produce both the overview and features trees, so that I get the full structural decomposition in one autonomous pass.
- **AC-RL-002.1** — The generator shall be a `claude -p` subprocess running with the `prd-to-frds` skill.
- **AC-RL-002.2** — The generator shall read `PRD.md` at the project repo's root.
- **AC-RL-002.3** — The generator shall produce product-overview sections as flat `<slug>.md` files inside `requirements/overview/`, one file per structural piece of the PRD it identifies.
- **AC-RL-002.4** — The generator shall produce Feature Requirements Documents as flat `<slug>.md` files inside `requirements/features/`, one file per feature identified in the PRD.
- **AC-RL-002.5** — When a feature decomposes further, the generator shall create a sibling `<slug>_children/` directory with the same flat shape, recursively.
- **AC-RL-002.6** — The generator shall write only visible `<slug>.md` content files; it shall not write dotted-hidden meta files.
- **AC-RL-002.7** — Each `<slug>.md` file shall begin with an H1 matching the human title of the node.

### REQ-RL-003 — Meta-file materialisation
**User Story.** As an operator, I want the orchestrator to materialise the hidden meta files so generators do not have to think about them, so that the generator's job stays focused on content.
- **AC-RL-003.1** — For each overview node (a visible `<slug>.md` file under `requirements/overview/` or its recursive `<slug>_children/` directories), the orchestrator shall materialise two sibling meta files: `.<slug>.overview.meta.yaml` and `.<slug>.requirements.meta.yaml`.
- **AC-RL-003.2** — For each feature node (a visible `<slug>.md` file under `requirements/features/` or its recursive `<slug>_children/` directories), the orchestrator shall materialise two sibling meta files: `.<slug>.feature.meta.yaml` and `.<slug>.requirements.meta.yaml`.
- **AC-RL-003.3** — In newly-materialised `.<slug>.overview.meta.yaml` and `.<slug>.feature.meta.yaml` files, the orchestrator shall populate `id: null`, `parent_id: null`, `position: <discovery order among siblings, starting at 0>`, and `title: <first H1 of the corresponding content file>`.
- **AC-RL-003.4** — In newly-materialised `.<slug>.requirements.meta.yaml` files, the orchestrator shall populate `id: null` and no other fields.
- **AC-RL-003.5** — When the operator removes a node by deleting its `<slug>.md`, the orchestrator shall remove the sibling meta files and clean up any now-empty `<slug>_children/` directory.

### REQ-RL-004 — Iterative editing
**User Story.** As an operator, I want the generator to read the existing tree and edit only what needs changing, so that regenerating from scratch every run doesn't destroy prior good work.
- **AC-RL-004.1** — The generator shall read any existing `requirements/overview/` and `requirements/features/` trees before deciding what to write.
- **AC-RL-004.2** — The generator shall preserve nodes that are already correct, edit nodes that need changes, and delete nodes that no longer have PRD source.

### REQ-RL-005 — Non-blocking clarification questions
**User Story.** As an operator, I want the generator to log PRD-clarification questions without stalling, so that I can resolve them asynchronously in the PRD while the loop continues producing everything else.
- **AC-RL-005.1** — When the PRD is genuinely ambiguous (contradictions between sections, features named but never described, undefined concepts used throughout), the generator shall append a structured block to `requirements/_questions-pending.md` at the project repo's root.
- **AC-RL-005.2** — Each block shall include a short title, where in the PRD the issue is (section heading or verbatim quote), what is ambiguous (one paragraph), and what would unblock the generator.
- **AC-RL-005.3** — After logging a question, the generator shall continue producing everything that is not blocked by the ambiguity.
- **AC-RL-005.4** — The generator shall not log questions for sections skipped by design (operator omitted a topic) or for minor grammar or phrasing issues in the PRD.

### REQ-RL-006 — Four reviewer subagents
**User Story.** As an operator, I want the requirements tree checked against four distinct rubrics, so that defects in structure, cross-doc consistency, PRD coverage, and feature scoping are all caught before the tree is committed.
- **AC-RL-006.1** — After the generator exits, the orchestrator shall spawn `req-spec-judge` to verify each FRD matches structural expectations (sections present; requirements have REQ-IDs, user stories, and acceptance criteria in testable `shall/should/may` phrasing).
- **AC-RL-006.2** — The orchestrator shall spawn `req-cross-doc-judge` to verify whole-tree consistency (contradictions between FRDs, terminology drift, duplication that should be consolidated or cross-referenced).
- **AC-RL-006.3** — The orchestrator shall spawn `req-coverage-judge` to verify the union of FRDs covers the PRD's scope without gaps or overlaps, reading both `requirements/overview/` and `requirements/features/`.
- **AC-RL-006.4** — The orchestrator shall spawn `req-scoping-judge` to verify each FRD individually passes the feature-unit definition (standalone value, implementation footprint, independent deployability, incremental value) and that parent/child relationships are valid (parent delivers value alone; child meaningless without parent).
- **AC-RL-006.5** — Each reviewer subagent shall run in a fresh Claude Code context with `--disallowedTools Write,Edit,NotebookEdit,Bash` so it cannot mutate the tree.
- **AC-RL-006.6** — Each reviewer shall emit its review as the subprocess's final chat message, ending with a `VERDICT: pass|fail` line.
- **AC-RL-006.7** — The orchestrator shall capture each reviewer's stdout and archive it under `harness/state/reviews/requirements-loop/attempt-<N>/<reviewer-name>.md`.

### REQ-RL-007 — Verdict aggregation and retry
**User Story.** As an operator, I want the orchestrator to decide retry vs pass vs exhaust deterministically, so that the loop converges without operator intervention when the PRD is clear enough.
- **AC-RL-007.1** — The orchestrator shall parse each reviewer's trailing `VERDICT:` line to extract pass or fail.
- **AC-RL-007.2** — On any reviewer fail, the orchestrator shall re-spawn the generator with aggregated reviewer feedback as context.
- **AC-RL-007.3** — The orchestrator shall apply a `Stop` hook on reviewer subagents that validates the reviewer's final chat message ends with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`; the hook shall block completion if the trailing line is missing or malformed.

### REQ-RL-008 — Dual completion condition
**User Story.** As an operator, I want the loop to exit `awaiting_clarification` when open PRD questions remain, so that I know when to edit the PRD versus when the tree is fully accepted.
- **AC-RL-008.1** — Full `pass` shall require both all four reviewers pass AND `requirements/_questions-pending.md` has no open questions blocking the review.
- **AC-RL-008.2** — When reviewers pass on concrete content but open questions remain, the orchestrator shall exit with verdict `awaiting_clarification`, commit the current tree and updated questions doc, write a history entry, and print an operator-facing summary of the open questions.
- **AC-RL-008.3** — `awaiting_clarification` shall not be treated as a failure state; re-running the loop after the operator edits the PRD shall continue from the current tree state.

### REQ-RL-009 — Artifact commit and audit trail
**User Story.** As an operator, I want the approved tree committed to git, so that git history is the audit trail and no PR is needed for upstream-loop output.
- **AC-RL-009.1** — On full `pass` and on `awaiting_clarification`, the orchestrator shall commit the requirements tree and any updated `_questions-pending.md` file.
- **AC-RL-009.2** — The orchestrator shall not open a pull request for the requirements tree; the tree is documentation, not code, and its audit trail lives in git log.
- **AC-RL-009.3** — The orchestrator shall record loop-level iteration history in `harness/state/requirements-loop.json`.

### REQ-RL-010 — Operator-side question resolution
**User Story.** As an operator, I want a simple resolution mechanism for logged questions, so that I can answer by editing the PRD without touching any other file.
- **AC-RL-010.1** — The operator shall resolve a question by editing `PRD.md` to remove the ambiguity and deleting the corresponding block in `requirements/_questions-pending.md` (or renaming the file to `_questions-resolved-<timestamp>.md` to preserve git-history audit).
- **AC-RL-010.2** — On the next loop run, the generator shall consume the updated PRD and treat resolved questions as addressed.

## Feature Behavior & Rules

The loop mechanic is identical to the Blueprint Loop and Coding Loop sequence generation: orchestrator spawns generator → generator exits → orchestrator spawns each reviewer → orchestrator aggregates → retry on fail or commit on pass. Reviewers never touch the filesystem; the generator writes, the orchestrator commits. Reviewers do not cross-contaminate each other's context because each runs in a fresh Claude Code session.

The generator's iterative posture is load-bearing. Regenerating from scratch on every run would destroy the prior attempt's edits and prevent convergence when the fix is small. By reading the existing tree first, the generator can apply surgical edits in response to aggregated reviewer feedback — fix one reviewer's grounded finding, push back on another's ungrounded finding, log a question for a third that depends on PRD clarification.

Non-blocking clarification questions are the loop's escape valve for PRD-level defects. The requirements loop cannot resolve contradictions in the PRD (that requires operator judgment), but it can isolate the contradictions and keep working on everything else. The operator resolves by editing `PRD.md`; the loop does not block waiting for an answer. This is the same philosophy the Blueprint Loop uses for decisions, implemented with a different file (`_questions-pending.md` vs `_decisions-pending.md`) because the response shape differs — for questions, the answer is "clarify the PRD"; for decisions, the answer is "pick an option."

The four reviewers are designed to prevent distinct downstream failures. `req-spec-judge` catches structurally-malformed FRDs that would confuse the blueprint generator. `req-cross-doc-judge` catches terminology drift and duplication that would let the blueprint generator produce inconsistent blueprints. `req-coverage-judge` catches PRD scope that did not make it into any FRD — the load-bearing check. `req-scoping-judge` catches FRDs that do not pass the feature-unit definition and would therefore produce blueprints that do not decompose cleanly into work orders. Each reviewer is focused; none repeats another's work.

The approved tree is documentation, not code. No PR is opened. Git commit history is the audit trail. The operator verifies the final state via `git diff` before triggering the Blueprint Loop.
