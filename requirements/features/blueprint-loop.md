# Blueprint Loop

## Overview

The Blueprint Loop is the second autonomous stage. It reads approved FRDs from `requirements/features/` and produces technical blueprints under `blueprints/` — foundation blueprints for cross-feature concerns (auth, data model, error handling, observability) and feature blueprints per FRD. When the generator hits a decision that requires operator judgment — tech stack, framework choice, hosting model, auth provider, ORM, major architectural pattern — it does not stop. Instead it appends a structured block to `blueprints/_decisions-pending.md` with pre-researched options and a recommended default, drops a `TBD: <decision-title>` marker in the affected blueprint, and keeps working on everything else.

The operator needs this loop because blueprint authoring is where architectural decisions compound: a sloppy blueprint produces a sloppy work-order sequence, which produces unmaintainable code. The loop automates the mechanical translation from requirement to blueprint, isolates the decisions that genuinely require human judgment into a single operator-scannable file, and validates everything through four specialized reviewers before any blueprint is considered final.

## Terminology

- **Blueprint** — a technical artifact under `blueprints/` that resolves architectural decisions (data model, API contracts, library choices, module layout) for one FRD or one cross-cutting concern.
- **Feature blueprint** — a blueprint produced per FRD.
- **Foundation blueprint** — a blueprint for a cross-feature concern (auth, data model, error handling, observability) that multiple feature blueprints reference instead of duplicating.
- **Open decision** — an architectural choice the generator cannot make autonomously and has appended to `blueprints/_decisions-pending.md` for operator resolution.
- **TBD marker** — a `TBD: <decision-title>` token in a blueprint that references an open decision and marks content that is deliberately incomplete.
- **Dual completion condition** — the pass condition for this loop: all four reviewers pass AND `blueprints/_decisions-pending.md` has zero unanswered decisions.
- **`awaiting_decisions`** — the loop exit verdict when reviewers pass on current content but open decisions remain and the generator can make no further progress without them.

## Requirements

### REQ-BL-001 — Loop orchestrator subcommand
**User Story.** As an operator, I want a single CLI command that runs the full blueprint loop, so that I can go from approved FRDs to reviewed blueprints (or to a scannable decisions file) in one autonomous pass.
- **AC-BL-001.1** — When the operator runs `python -m orchestrator blueprint-loop`, the orchestrator shall spawn one generator subprocess, then spawn each reviewer subprocess, aggregate verdicts, and commit the blueprints tree on full `pass` or on `awaiting_decisions`.
- **AC-BL-001.2** — The orchestrator shall re-spawn the generator with aggregated reviewer feedback on any reviewer fail.
- **AC-BL-001.3** — The orchestrator shall enforce an attempt cap per invocation and a wall-clock cap per subprocess and exit with an `exhausted` verdict if either is hit.

### REQ-BL-002 — Feature-blueprint generation
**User Story.** As an operator, I want the generator to produce a feature blueprint per approved FRD, so that every FRD has a matching technical blueprint.
- **AC-BL-002.1** — The generator shall run with the `frd-to-blueprint` skill.
- **AC-BL-002.2** — The generator shall read the full `requirements/features/` tree before deciding what to produce.
- **AC-BL-002.3** — For each FRD, the generator shall produce a feature blueprint under `blueprints/` (exact on-disk layout deferred to v0.2 design).

### REQ-BL-003 — Foundation-blueprint generation
**User Story.** As an operator, I want the generator to produce foundation blueprints for shared concerns before feature blueprints, so that feature blueprints reference shared patterns instead of duplicating them.
- **AC-BL-003.1** — The generator shall co-invoke the `foundation-blueprint-authoring` skill when a cross-feature concern needs pinning.
- **AC-BL-003.2** — The generator shall read existing foundation and feature blueprints first to reuse shared patterns rather than re-introducing duplication.
- **AC-BL-003.3** — Feature blueprints shall reference foundation blueprints rather than inlining the foundation content.

### REQ-BL-004 — Non-blocking decision bubble-ups
**User Story.** As an operator, I want the generator to bubble up architectural decisions without stalling, so that I can resolve them asynchronously while the loop continues producing everything that does not depend on the decision.
- **AC-BL-004.1** — When the generator hits a decision that requires operator judgment (tech stack, framework choice, hosting model, auth provider, ORM, major architectural pattern), it shall append a structured block to `blueprints/_decisions-pending.md` via the `bubble-up-decision` skill.
- **AC-BL-004.2** — Each decision block shall contain: a one-line title, a one-paragraph context identifying which FRD or foundation concern needs the decision, two to four pre-researched options each with a one-sentence summary and a Pros/Cons pair, a one-paragraph recommended default with rationale, and a blank `Your choice:` field.
- **AC-BL-004.3** — After appending a block, the generator shall continue working on everything independent of the decision.
- **AC-BL-004.4** — Where the decision affects a blueprint, the generator shall leave a `TBD: <decision-title>` marker referencing the pending decision.
- **AC-BL-004.5** — The generator shall not stop or exit on a decision; appending is the only allowed response.

### REQ-BL-005 — Four reviewer subagents
**User Story.** As an operator, I want the blueprints checked against four distinct rubrics, so that structural defects, FRD coverage gaps, cross-blueprint inconsistencies, and silent architectural decisions are all caught before the tree is committed.
- **AC-BL-005.1** — After the generator exits, the orchestrator shall spawn `bp-spec-judge` to verify each blueprint matches structural expectations (exact shape defined when blueprint artifact design lands).
- **AC-BL-005.2** — The orchestrator shall spawn `bp-coverage-judge` to verify every approved FRD has a blueprint, every foundation concern referenced by a feature blueprint is defined, there are no orphan blueprints, and TBD markers appear only where a decision is pending.
- **AC-BL-005.3** — The orchestrator shall spawn `bp-consistency-judge` to verify cross-blueprint contracts align (for example, if feature A depends on foundation X v2, foundation X blueprint defines v2 with compatible interfaces).
- **AC-BL-005.4** — The orchestrator shall spawn `bp-decision-judge` to verify (a) no high-impact decision was silently made by the generator without bubble-up and (b) every `TBD: <decision-title>` marker in a blueprint has a matching open block in `_decisions-pending.md`.
- **AC-BL-005.5** — Each reviewer subagent shall run in a fresh Claude Code context with `--disallowedTools Write,Edit,NotebookEdit,Bash`.
- **AC-BL-005.6** — Each reviewer shall emit its review as the subprocess's final chat message, ending with a `VERDICT: pass|fail` line, captured by the orchestrator as stdout and archived under `harness/state/reviews/blueprint-loop/attempt-<N>/<reviewer-name>.md`.

### REQ-BL-006 — Dual completion condition
**User Story.** As an operator, I want the loop to exit `awaiting_decisions` when open decisions remain, so that I know when to resolve decisions versus when the blueprint tree is fully accepted.
- **AC-BL-006.1** — Full `pass` shall require both all four reviewers pass AND `blueprints/_decisions-pending.md` has zero unanswered decisions.
- **AC-BL-006.2** — When reviewers pass on the current state but open decisions remain and the generator can make no further progress without them, the orchestrator shall exit with verdict `awaiting_decisions`, commit current progress (blueprints with TBD markers and the updated decisions doc), write a history entry, and print an operator-facing summary of the open decisions.
- **AC-BL-006.3** — `awaiting_decisions` shall not be treated as a failure state; re-running the loop after the operator answers decisions shall resume from the current blueprint state.

### REQ-BL-007 — Operator-side decision resolution
**User Story.** As an operator, I want to resolve decisions by filling in `Your choice:` lines in one scannable file, so that resolution is a quick inspection-and-fill pass rather than a research exercise.
- **AC-BL-007.1** — The operator shall resolve a decision by editing `blueprints/_decisions-pending.md` and filling in the `Your choice:` field of the relevant block.
- **AC-BL-007.2** — The operator may optionally rename resolved blocks to `_decisions-resolved-<timestamp>.md` for git-history audit, or leave them in place for the generator to detect.
- **AC-BL-007.3** — On the next loop run, the generator shall read the decisions doc, treat any answered decisions as resolved, and pick up where it left off.

### REQ-BL-008 — Verdict aggregation and retry
**User Story.** As an operator, I want the orchestrator to decide retry vs pass vs exhaust deterministically, so that the loop converges without operator intervention when the FRD inputs and resolved decisions are clear enough.
- **AC-BL-008.1** — The orchestrator shall parse each reviewer's trailing `VERDICT:` line to extract pass or fail.
- **AC-BL-008.2** — On any reviewer fail, the orchestrator shall re-spawn the generator with aggregated reviewer feedback as context.
- **AC-BL-008.3** — The orchestrator shall apply a `Stop` hook on reviewer subagents that validates the reviewer's final chat message ends with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`; the hook shall block completion if the trailing line is missing or malformed.

### REQ-BL-009 — Artifact commit and audit trail
**User Story.** As an operator, I want the approved tree committed to git, so that git history is the audit trail and no PR is needed for upstream-loop output.
- **AC-BL-009.1** — On full `pass` and on `awaiting_decisions`, the orchestrator shall commit the blueprints tree and the updated `_decisions-pending.md` file.
- **AC-BL-009.2** — The orchestrator shall not open a pull request for the blueprints tree.
- **AC-BL-009.3** — The orchestrator shall record loop-level iteration history in `harness/state/blueprint-loop.json`.

## Feature Behavior & Rules

The blueprint loop's defining mechanism is the non-blocking bubble-up. Architectural decisions are the single class of blocker that the generator cannot resolve autonomously — but they are also a class where the operator should not be pulled into every micro-decision. The decisions file solves this by making each bubble-up self-contained: title, context, pre-researched options, recommended default. The operator reads one file at their own pace, fills in `Your choice:` lines, and re-runs the loop. The generator does the research; the operator does the judgment.

Pre-populating options is load-bearing. If the generator merely flagged "I need a framework choice" without doing the research, the operator would have to either research themselves (defeating the point) or pick blindly. The `bubble-up-decision` skill requires the generator to present two to four pre-researched options with pros and cons and a recommended default before bubbling up. This keeps the operator's resolution pass fast and scannable.

The four reviewers map to distinct failure modes. `bp-spec-judge` catches structural defects in individual blueprints that would confuse the coding loop. `bp-coverage-judge` catches FRDs that did not produce a blueprint and blueprints that reference nonexistent foundations. `bp-consistency-judge` catches contract drift between blueprints — the specific failure mode where feature A expects foundation X v2 but the foundation blueprint defines X v1. `bp-decision-judge` is the bubble-up auditor — it verifies the generator did not make high-impact decisions silently, and that every TBD marker in a blueprint has a corresponding open block in the decisions file.

The `awaiting_decisions` exit is not failure. It means the generator did its job — produced everything that did not require human judgment, bubbled up everything that did, passed all reviewers on the concrete parts — and now waits asynchronously for the operator. The loop may cycle through multiple `awaiting_decisions` exits before reaching full `pass`: the operator resolves a subset of decisions, re-triggers the loop, the generator continues, new decisions surface, another `awaiting_decisions` exit. The cycle terminates when the decisions doc is empty and all reviewers pass.

The blueprint artifact shape is not yet pinned at the FRD level. Software Factory blueprints are authored for humans who will read, debate, and hand off to teams; the harness's blueprints are read by an autonomous coding loop and need tighter contracts (explicit interfaces, listed invariants, machine-readable dependency graphs) and less discursive prose. The exact on-disk layout lands at the start of v0.2; this FRD describes the loop mechanic, not the blueprint document shape.
