# Questions Pending

## Capability Summary

The questions-pending mechanism is the harness's universal escape valve when an upstream loop's generator hits an input it cannot resolve autonomously: an ambiguous PRD passage, an architectural choice that needs operator judgment, a decomposition ambiguity between blueprints. Each upstream loop has one append-only `_questions-pending.md` file in its artifact tree (`requirements/_questions-pending.md`, `blueprints/_questions-pending.md`, `work-orders/_questions-pending.md`); the generator appends a structured block, keeps working on everything not blocked by the question, and the loop exits with the unified `awaiting_clarification` verdict if open questions remain at exit time. One mechanism, one verdict, three file locations.

## Core Components

### Detection and exit

```component
name: QuestionsPendingDetector
container: Python Orchestrator
responsibilities:
	- Inspects the loop's `_questions-pending.md` file after the generator exits
	- Counts blocks with empty `Your answer:` fields (open questions); blocks with filled-in answers are treated as resolved
	- Returns the open-question count to #LoopDriver inside @Blueprint(loop-driver)
	- Triggers the `awaiting_clarification` exit when the count is non-zero AND reviewers pass on the concrete content AND the generator emitted `VERDICT: awaiting_clarification` (i.e. the generator itself signalled it cannot make further progress)
```

The detector runs once per attempt's reviewer fan-out completion. It does not parse block bodies for control flow — only counts open vs answered.

---

### Block shapes

```model
name: BareQuestionBlock
store: Filesystem (project repo)
description: Generator-appended structured block used when the answer isn't a choice between alternatives — e.g. "what does X mean?", "did you intend Y or Z?". Used by all three upstream loops.
fields:
	- title: short H2 heading (e.g. "## What does 'cohort' mean here?")
	- where: FRD slug, blueprint slug, work-order slug, section heading, or short verbatim quote
	- whats_ambiguous: one paragraph naming the ambiguity
	- what_would_unblock: what the operator needs to add or clarify
	- your_answer: blank line for the operator to fill in
constraints:
	- Block ends with `---` separator
	- All four labelled fields present in the order shown
```

```model
name: WithOptionsQuestionBlock
store: Filesystem (project repo)
description: Generator-appended structured block used only when there's a genuine choice between defensible alternatives (e.g. "Postgres vs DynamoDB"). Used by the blueprint loop only — pre-research is load-bearing because architectural decisions benefit from it; the requirements and work-orders loops do not use this shape.
fields:
	- title: short H2 heading
	- where: blueprint slug or section heading
	- context: one paragraph on why the decision matters now
	- options: 2–4 entries each with name, one-sentence summary, Pros bullets, Cons bullets
	- recommended: option name plus one-paragraph rationale
	- your_answer: blank line for the operator to fill in
constraints:
	- Block ends with `---` separator
	- 2–4 options total; do not fabricate options to fill the shape
	- Recommended default is the generator's best-judgment choice; the operator can override
```

The two block shapes are differentiated by use case, not by file location. The blueprint generator picks per-question whether to use bare or with-options; the requirements and work-orders generators use bare-only since their resolution is "clarify a source artifact", not "pick between alternatives".

---

### Pending markers in artifacts

```component
name: PendingMarkerSyntax
container: Project Repo
responsibilities:
	- Defines the `<!-- pending: <question-title> -->` HTML-comment syntax generators use to mark spots in artifact files affected by an open question
	- Markers are reviewer-tolerated — the four reviewer rubrics (`bp-spec-judge`, `bp-coverage-judge`, etc.) treat marked locations as expected-incomplete rather than defect
	- Markers are removed by the generator on the next loop run after the question is answered
```

When a question affects a specific blueprint (or FRD or work order), the generator may leave a brief `<!-- pending: <question-title> -->` HTML comment at the affected location. Reviewers do not flag these markers as defects but do flag a high-impact decision made silently with no question block as `SILENT_DECISION`.

## System Contracts

### Key Contracts

- **Append-only file.** The file accumulates blocks during a loop attempt and across attempts within an invocation. Resolution is operator-driven (filling in `Your answer:`); the orchestrator never edits block content.
- **Three file locations, one mechanism.** `requirements/_questions-pending.md` for the requirements loop, `blueprints/_questions-pending.md` for the blueprint loop, `work-orders/_questions-pending.md` for the work-orders loop. Same shape, same resolution flow, same exit verdict.
- **Bare-question shape only for requirements and work-orders loops.** The blueprint loop additionally supports the with-options shape for genuine architectural choices; pre-research is part of the value the generator adds.
- **`awaiting_clarification` is a non-failure exit.** The orchestrator commits current progress (artifacts plus the updated questions doc) and exits with code 2. A subsequent run continues from the updated state once the operator resolves the pending items.
- **Operator-driven resolution.** The operator answers by editing the source artifact (PRD for requirements-loop questions, in-place `Your answer:` for blueprint-loop questions, source blueprint for work-orders-loop questions) and either deleting the resolved block or renaming the file to `_questions-resolved-<timestamp>.md` for git-history audit.
- **Pending markers are tolerated.** Reviewers do not flag `<!-- pending: <title> -->` markers as defects; they do flag high-impact decisions made silently without a corresponding question block.

### Integration Contracts

- **File path convention.** `<artifact-tree>/_questions-pending.md`, where `<artifact-tree>` is `requirements/`, `blueprints/`, or `work-orders/`.
- **Block separator.** `---` between blocks.
- **Open-question detection.** A block is "open" when its `Your answer:` line has no following text on the same line and no non-empty content before the next `---`. The detector parses minimally — it does not interpret the answer.
- **Pending-marker syntax.** `<!-- pending: <question-title> -->` HTML comment, embedded inline in the affected artifact location.
- **Generator emit contract.** When at least one open question remains at the end of a generator run AND the generator cannot make further progress without operator input, the generator emits `VERDICT: awaiting_clarification\nopen_questions: <N>\nquestions_file: <path>` and exits.

## Architecture Decision Records

### ADR-001: One file per loop, not one file per question

**Context.** Each open question could live in its own file (better diffability per question) or all questions could share one file per loop (simpler scan). The single-file-per-loop pattern is what Software Factory uses for similar "questions for the operator" surfaces.

**Decision.** One `_questions-pending.md` file per upstream loop, append-only during a loop attempt. Resolved blocks are deleted in place (or moved to `_questions-resolved-<timestamp>.md`); open blocks remain.

**Consequences.** The operator scans one file per loop, fills in `Your answer:` lines, re-runs the loop. No per-question file proliferation. Trade-off: heavy concurrent edits across many questions could create merge friction; in practice the operator answers all open questions in one sitting, so concurrency is low.

### ADR-002: Two block shapes (bare and with-options)

**Context.** Some questions are clarifications (no choice to make — operator clarifies a source artifact). Others are genuine architectural picks (Postgres vs DynamoDB). Forcing one shape for both either wastes pre-research effort on clarifications or under-specifies architectural picks.

**Decision.** Two shapes. Bare for clarifications. With-options for genuine architectural choices, with 2–4 pre-researched options each carrying Pros/Cons and a recommended default. The blueprint generator picks per-question; requirements and work-orders generators use bare-only because their domain is clarification, not choice.

**Consequences.** Operators do not have to research architectural alternatives themselves — the generator does. Operators do not get artificial options for what is really a clarification. Trade-off: the generator must be disciplined about not fabricating options to fill the shape; the skill prompt explicitly forbids this.

### ADR-003: `awaiting_clarification` is one verdict across three loops

**Context.** Each loop could have its own clarification-pause verdict (e.g. `prd_unclear`, `decision_pending`, `decomposition_unclear`). That would surface different problems with different vocabulary, but it would multiply the orchestrator's exit-code semantics.

**Decision.** One verdict (`awaiting_clarification`) and one exit code (2) across all three upstream loops. The verdict line carries `open_questions: <N>` and `questions_file: <path>` so wrapper scripts can react per-loop if they need to.

**Consequences.** Wrapper scripts that handle "pause for operator input" can do so generically across all three loops. The orchestrator's exit-code surface stays small (0 pass, 1 exhausted, 2 awaiting). Trade-off: the operator has to look at the file location to know which loop is paused; mitigated by the orchestrator printing the operator-facing summary on stdout before exit.
