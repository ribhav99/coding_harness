# Requirements Loop

## Overview

The Requirements Loop is the first autonomous stage after PRD authoring. It reads the monolithic `PRD.md` at the project repo's root and decomposes it into the full structural requirements tree — product-overview sections under `requirements/overview/` and Feature Requirements Documents under `requirements/features/`. An autonomous generator writes the tree; four reviewer subprocesses evaluate it against distinct rubrics; the orchestrator re-spawns the generator with aggregated feedback on any fail and commits the tree on all-pass.

The operator needs this loop because hand-decomposing a PRD into correctly-scoped FRDs is the most time-consuming and error-prone stage of the pre-code workflow. The loop automates the decomposition and catches defects through four specialized reviewers — structural spec, cross-doc consistency, PRD coverage, and feature scoping — each focused on one class of failure that would otherwise wreck the downstream Blueprint Loop.

## Terminology

- **Overview tree** — the flat directory `requirements/overview/` containing product-overview section documents (business problem, current state, personas, success metrics, measurement, product description, design principles, architecture, project lifecycle, technical requirements, appendix, and others as the PRD warrants). Each node is a `<slug>.md` file.
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

### REQ-RL-006 — Four reviewer subprocesses
**User Story.** As an operator, I want the requirements tree checked against four distinct rubrics, so that defects in structure, cross-doc consistency, PRD coverage, and feature scoping are all caught before the tree is committed.
- **AC-RL-006.1** — After the generator exits, the orchestrator shall spawn `req-spec-judge` to verify each FRD matches structural expectations (sections present; requirements have REQ-IDs, user stories, and acceptance criteria in testable `shall/should/may` phrasing).
- **AC-RL-006.2** — The orchestrator shall spawn `req-cross-doc-judge` to verify whole-tree consistency (contradictions between FRDs, terminology drift, duplication that should be consolidated or cross-referenced).
- **AC-RL-006.3** — The orchestrator shall spawn `req-coverage-judge` to verify the union of FRDs covers the PRD's scope without gaps or overlaps, reading both `requirements/overview/` and `requirements/features/`.
- **AC-RL-006.4** — The orchestrator shall spawn `req-scoping-judge` to verify each FRD individually passes the feature-unit definition (standalone value, implementation footprint, independent deployability, incremental value) and that parent/child relationships are valid (parent delivers value alone; child meaningless without parent).
- **AC-RL-006.5** — Each reviewer subprocess shall run in a fresh Claude Code context with `--disallowedTools Bash,NotebookEdit`. `Write` and `Edit` are allowed so the reviewer can append its review to its own communication file (§REQ-RL-011); a `PreToolUse` path-guard hook shall block any `Write`/`Edit` call whose target path is not exactly the reviewer's own `requirements_communication/<reviewer-name>.md` file.
- **AC-RL-006.6** — Each reviewer shall append a `## Review — attempt N` block to its communication file, ending with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`. The reviewer's stdout shall be a short acknowledgement ending with the same `VERDICT:` line — that's the only signal the orchestrator parses for loop control.
- **AC-RL-006.7** — At every attempt boundary and on every loop-exit verdict (`pass`, `awaiting_clarification`, `exhausted`), the orchestrator shall snapshot each reviewer's communication file from `requirements_communication/` into `harness/state/reviews/requirements-loop/attempt-<N>/<reviewer-name>.md`.

### REQ-RL-007 — Verdict aggregation and retry
**User Story.** As an operator, I want the orchestrator to decide retry vs pass vs exhaust deterministically, so that the loop converges without operator intervention when the PRD is clear enough.
- **AC-RL-007.1** — The orchestrator shall parse only the trailing `VERDICT:` line from each reviewer's stdout to decide pass or fail. The full review prose lives in the reviewer's communication file (§REQ-RL-011); the orchestrator does not parse that body for control flow.
- **AC-RL-007.2** — On any reviewer fail, the orchestrator shall re-spawn the generator. The retry prompt names only the failing reviewers; the generator reads each reviewer's communication file directly for prior reviews and its own prior responses, so the orchestrator does not assemble a separate retry-context block.
- **AC-RL-007.3** — The orchestrator shall apply a `Stop` hook on reviewer subprocesses that validates the reviewer's final chat message ends with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`; the hook shall block completion if the trailing line is missing or malformed (in-session enforcement layer). If a reviewer subprocess does exit with malformed stdout (hook bypass, crash, truncation), the orchestrator's protocol-retry mechanism (REQ-ORCH-013) shall re-prompt the reviewer up to 2 times before treating the verdict as `fail` and continuing.

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

### REQ-RL-011 — Reviewer-generator communication channel
**User Story.** As an operator, I want the generator and reviewers to communicate bidirectionally through visible files, so that I can read the conversation and so the generator can push back on findings it disagrees with.
- **AC-RL-011.1** — The orchestrator shall maintain a communication folder at the project root: `requirements_communication/` — sibling to `requirements/`, not nested inside it.
- **AC-RL-011.2** — The communication folder shall contain one markdown file per agent in the loop: `prd-to-frds.md` (generator outbound) plus one per reviewer (`req-spec-judge.md`, `req-cross-doc-judge.md`, `req-coverage-judge.md`, `req-scoping-judge.md`).
- **AC-RL-011.3** — On every invocation that begins a fresh attempt-1 (no live conversation in the folder from a prior `awaiting_clarification` or `exhausted` exit), the orchestrator shall wipe the communication folder before spawning the generator.
- **AC-RL-011.4** — The generator shall read every reviewer's file in the communication folder before producing or editing artifacts. On retry attempts (attempts ≥ 2), the generator shall append per-finding responses (fix / push back / surface to operator) to each failing reviewer's file and a `## Changes since previous attempt` block to every reviewer's file.
- **AC-RL-011.5** — Each reviewer shall read its own communication file and the artifacts it judges, run its review, and **append** to the same file. The communication file accumulates the full back-and-forth across attempts so both sides see the conversation history; reviewers append, never overwrite.
- **AC-RL-011.6** — Race-free by sequential execution: the orchestrator runs generator → reviewers → generator → reviewers strictly sequentially per attempt; reviewers run in parallel within an attempt but each writes only its own dedicated file. No two processes ever write the same file concurrently.
- **AC-RL-011.7** — On full `pass`, the orchestrator shall wipe the live communication folder. On `awaiting_clarification` and `exhausted`, the live folder shall be left in place for operator inspection.

## Feature Behavior & Rules

The loop mechanic is identical to the Blueprint Loop: orchestrator spawns generator → generator exits → orchestrator spawns each reviewer → reviewers append their reviews to their communication files → orchestrator parses each reviewer's stdout `VERDICT:` line → retry on fail or commit on pass. Generators write artifact-tree changes; reviewers append to their own communication file under `requirements_communication/<reviewer-name>.md` and nowhere else (enforced by a `PreToolUse` path-guard hook); the orchestrator commits artifacts and snapshots reviews. Reviewers do not cross-contaminate each other's context because each runs in a fresh Claude Code session.

The generator's iterative posture is load-bearing. Regenerating from scratch on every run would destroy the prior attempt's edits and prevent convergence when the fix is small. By reading the existing tree first, the generator can apply surgical edits in response to aggregated reviewer feedback — fix one reviewer's grounded finding, push back on another's ungrounded finding, log a question for a third that depends on PRD clarification.

Non-blocking clarification questions are the loop's escape valve for PRD-level defects. The requirements loop cannot resolve contradictions in the PRD (that requires operator judgment), but it can isolate the contradictions and keep working on everything else. The operator resolves by editing `PRD.md`; the loop does not block waiting for an answer. The Blueprint Loop uses the identical mechanism — same `_questions-pending.md` file convention, same `awaiting_clarification` exit verdict — only the file location (`requirements/` vs `blueprints/`) differs. Blueprint-loop questions can additionally carry pre-researched options when the choice is genuine, since architectural decisions benefit from pre-research in a way PRD clarifications usually don't.

The four reviewers are designed to prevent distinct downstream failures. `req-spec-judge` catches structurally-malformed FRDs that would confuse the blueprint generator. `req-cross-doc-judge` catches terminology drift and duplication that would let the blueprint generator produce inconsistent blueprints. `req-coverage-judge` catches PRD scope that did not make it into any FRD — the load-bearing check. `req-scoping-judge` catches FRDs that do not pass the feature-unit definition and would therefore produce blueprints that do not decompose cleanly into work orders. Each reviewer is focused; none repeats another's work.

The communication folder is what makes the gen↔reviewer back-and-forth visible and durable. Without it, the orchestrator would have to assemble retry-context prompt blocks every attempt and the generator's push-backs would only persist as inlined prose. With it, the conversation accumulates across attempts in markdown files the operator can read directly, and the generator can push back on a specific reviewer by appending to that reviewer's file — the reviewer sees the push-back on its next run and may revise its position. The orchestrator stays small: spawn subprocesses, parse `VERDICT:` lines, snapshot at attempt boundaries, wipe on full pass.

The approved tree is documentation, not code. No PR is opened. Git commit history is the audit trail. The operator verifies the final state via `git diff` before triggering the Blueprint Loop.
