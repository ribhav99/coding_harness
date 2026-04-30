# Blueprint Loop

## Overview

The Blueprint Loop is the second autonomous stage. It reads approved FRDs from `requirements/features/` and produces technical blueprints under `blueprints/` across three types — **container blueprints** for deployable runtimes, **component blueprints** for cross-cutting reusable capabilities, and **feature blueprints** slug-matched 1:1 with each FRD. A single autonomous generator writes all three types; four reviewer subprocesses evaluate the tree against distinct rubrics; the orchestrator and the agents communicate bidirectionally through `blueprints_communication/` and the orchestrator commits the tree on full pass.

When the generator hits an architectural choice that requires operator judgment — tech stack, framework choice, hosting model, auth provider, ORM, major architectural pattern — it does not stop. It appends a structured block to `blueprints/_questions-pending.md` (bare or with pre-researched options), keeps working on everything that is not blocked by the open question, and the loop exits with `awaiting_clarification` once it has produced as much as it can. Same mechanism, same exit verdict as the requirements loop — only the file location and question shape (operator can answer with options, not just clarify a source) differ.

The operator needs this loop because blueprint authoring is where architectural decisions compound: a sloppy blueprint produces a sloppy work-order sequence, which produces unmaintainable code. The loop automates the mechanical translation from requirement to blueprint, isolates the choices that genuinely require human judgment into one operator-scannable file, and validates everything through four specialized reviewers before any blueprint is considered final.

## Terminology

- **Blueprint** — a technical artifact under `blueprints/` that resolves architectural decisions (data model, API contracts, library choices, module layout) for one feature, one cross-cutting capability, or one deployable runtime.
- **Container blueprint** — one per deployable runtime (web app, API server, worker, database, pipeline). Documents tech stack, deployment model, entry points, and the contracts the container exposes to other containers and systems. Boundary-first writing.
- **Component blueprint** — one per cross-cutting reusable capability (auth, notifications, file storage, observability). Documents a cohesive group of runtime components powering one capability, possibly spanning multiple containers.
- **Feature blueprint** — one per FRD, slug-matched 1:1 with `requirements/features/<slug>.md`. Documents how shared component blueprints compose to satisfy a feature, plus any feature-specific components.
- **Mention syntax** — three cross-blueprint link types: `#ComponentName` for runtime components that do work, `` `ElementName` `` (single backticks) for schemas/configs/types that describe shape, `@EntityName` for platform documents (Requirements, Blueprints, Work Orders, Artifacts).
- **Structured block** — fenced ` ```component ` or ` ```model ` block with required keys, used inside `## Core Components` and `## Feature-Specific Components` sections.
- **ADR** — `### ADR-NNN: Title` entry with three labeled paragraphs: **Context**, **Decision**, **Consequences**. Numbered sequentially within the blueprint.
- **Open question** — an architectural choice the generator cannot make autonomously and has appended to `blueprints/_questions-pending.md` for operator answer. Two shapes: bare question (clarification) or question-with-options (genuine architectural choice).
- **Communication folder** — `blueprints_communication/` at the project root, sibling to `blueprints/`. One markdown file per agent (one for the generator, one per reviewer); both sides read and append. Append-only conversation transcripts that survive across attempts.
- **Dual completion condition** — the pass condition for this loop: all four reviewers pass AND `blueprints/_questions-pending.md` has zero unanswered questions.
- **`awaiting_clarification`** — the loop exit verdict when reviewers pass on current content but open questions remain and the generator can make no further progress without them. Same verdict as the requirements loop.

## Requirements

### REQ-BL-001 — Loop orchestrator subcommand
**User Story.** As an operator, I want a single CLI command that runs the full blueprint loop, so that I can go from approved FRDs to reviewed blueprints (or to a scannable questions file) in one autonomous pass.
- **AC-BL-001.1** — When the operator runs `python -m orchestrator blueprint-loop`, the orchestrator shall spawn one generator subprocess, then spawn each reviewer subprocess, parse the trailing `VERDICT:` line from each reviewer's stdout, and commit the blueprints tree on full `pass` or on `awaiting_clarification`.
- **AC-BL-001.2** — The orchestrator shall re-spawn the generator on any reviewer fail; the generator reads each reviewer's communication file directly to see prior reviews and its own prior responses, so the orchestrator does not assemble a separate retry-context block.
- **AC-BL-001.3** — The orchestrator shall enforce an attempt cap per invocation and a wall-clock cap per subprocess and exit with an `exhausted` verdict if either is hit.

### REQ-BL-002 — Blueprint generation across three types
**User Story.** As an operator, I want the generator to produce container, component, and feature blueprints autonomously, so that the full architectural surface is documented from the FRD tree without me writing any of it by hand.
- **AC-BL-002.1** — The generator shall be a `claude -p` subprocess running with the `frd-to-blueprint` skill — single skill, no sub-skill co-invocation.
- **AC-BL-002.2** — The generator shall read the full `requirements/features/` tree, the full existing `blueprints/` tree, and the current `blueprints/_questions-pending.md` (if any) before deciding what to produce or edit.
- **AC-BL-002.3** — For each FRD in `requirements/features/<slug>.md`, the generator shall produce a feature blueprint at `blueprints/features/<slug>.md` with the same slug.
- **AC-BL-002.4** — For each cross-cutting capability that two or more features depend on, the generator shall produce a component blueprint under `blueprints/components/<slug>.md`.
- **AC-BL-002.5** — For each deployable runtime in the project, the generator shall produce a container blueprint under `blueprints/containers/<slug>.md`.
- **AC-BL-002.6** — Each blueprint shall follow the per-type structural shape pinned in the project's blueprint document-shape contract (sections in canonical order, mention syntax, fenced `component`/`model` blocks where applicable, ADRs as `### ADR-NNN: Title` with Context / Decision / Consequences).
- **AC-BL-002.7** — The generator shall be iterative: on every invocation it reads the existing tree first and edits only what needs changing rather than regenerating from scratch.
- **AC-BL-002.8** — The generator shall not redefine shared components inside feature blueprints; feature blueprints shall reference shared components via `#Component` mentions and component blueprints via `@Blueprint` mentions, never duplicate the underlying component blocks.
- **AC-BL-002.9** — Before producing or editing any blueprint, the generator shall check for an optional `BLUEPRINT.md` file at the project repo root. When present, the generator shall read it as a high-level architectural starting input and use it to inform the structured `blueprints/` tree it produces — for example, treating its component lists, data-model sketches, or stack choices as authoritative starting points to expand into the per-type blueprints. The root `BLUEPRINT.md` is a working scratchpad authored by the operator (often early in the project before the harness's blueprint loop has run); it is not part of the canonical `blueprints/` tree and the generator does not edit it. Absence of `BLUEPRINT.md` is normal and shall not be flagged as a defect.

### REQ-BL-003 — Non-blocking clarification questions
**User Story.** As an operator, I want the generator to bubble up architectural choices without stalling, so that I can answer them at my own pace while the loop continues producing everything that does not depend on the open question.
- **AC-BL-003.1** — When the generator hits an architectural choice that requires operator judgment (tech stack, framework choice, hosting model, auth provider, ORM, major architectural pattern), it shall append a structured block to `blueprints/_questions-pending.md`. The generator does this directly; there is no separate `bubble-up-decision` skill.
- **AC-BL-003.2** — Question blocks shall come in one of two shapes:
  - **Bare question** — used when the answer isn't a choice between alternatives. Fields: title, where (FRD slug or section), what's ambiguous / what's needed, what would unblock, blank `Your answer:`.
  - **Question with options** — used only when the choice is genuine. Fields: title, where, context, 2–4 pre-researched options each with one-sentence summary and `Pros`/`Cons` pair, recommended default with rationale, blank `Your answer:`.
  The generator shall not fabricate options to fill the second shape; it uses the bare shape unless there is a real choice to be made.
- **AC-BL-003.3** — After appending a block, the generator shall continue working on everything independent of the open question.
- **AC-BL-003.4** — The generator shall not stop or exit on an open question; appending and continuing is the only allowed response.
- **AC-BL-003.5** — Where an open question affects a blueprint, the generator may leave a brief `<!-- pending: <question-title> -->` HTML comment at the affected location; reviewers shall not flag these comments as defects.

### REQ-BL-004 — Reviewer-generator communication channel
**User Story.** As an operator, I want the generator and reviewers to communicate bidirectionally through visible files, so that I can read the conversation and so the generator can push back on findings it disagrees with.
- **AC-BL-004.1** — The orchestrator shall maintain a communication folder at the project root: `blueprints_communication/` — sibling to `blueprints/`, not nested inside it.
- **AC-BL-004.2** — The communication folder shall contain one markdown file per agent in the loop: `frd-to-blueprint.md` (generator outbound) plus one per reviewer (`bp-spec-judge.md`, `bp-coverage-judge.md`, `bp-consistency-judge.md`, `bp-decision-judge.md`).
- **AC-BL-004.3** — On every invocation that begins a fresh attempt-1 (no live conversation in the folder from a prior `awaiting_clarification` or `exhausted` exit), the orchestrator shall wipe the communication folder before spawning the generator.
- **AC-BL-004.4** — The generator shall read every reviewer's file in the communication folder before producing or editing artifacts. On retry attempts (attempts ≥ 2), the generator shall append per-finding responses (fix / push back / surface to operator) to each failing reviewer's file and a `## Changes since previous attempt` block to every reviewer's file.
- **AC-BL-004.5** — Each reviewer shall read its own communication file and the artifacts it judges, run its review, and **append** a `## Review — attempt N` block to the same file ending with a single trailing line of exactly `VERDICT: pass` or `VERDICT: fail`. The reviewer's stdout shall be a short acknowledgement ending with the same `VERDICT:` line.
- **AC-BL-004.6** — Reviewers shall append, never overwrite. The communication file accumulates the full back-and-forth across attempts so both sides see the conversation history.
- **AC-BL-004.7** — Race-free by sequential execution: the orchestrator runs generator → reviewers → generator → reviewers strictly sequentially per attempt; reviewers run in parallel within an attempt but each writes only its own dedicated file. No two processes ever write the same file concurrently.
- **AC-BL-004.8** — At every attempt boundary and on every loop-exit verdict (`pass`, `awaiting_clarification`, `exhausted`), the orchestrator shall snapshot each `<reviewer-name>.md` from the live communication folder into `harness/state/reviews/blueprint-loop/attempt-<N>/<reviewer-name>.md`.
- **AC-BL-004.9** — On full `pass`, the orchestrator shall wipe the live communication folder. On `awaiting_clarification` and `exhausted`, the live folder shall be left in place for operator inspection.

### REQ-BL-005 — Four reviewer subprocesses
**User Story.** As an operator, I want the blueprints checked against four distinct rubrics, so that structural defects, coverage gaps, cross-blueprint inconsistencies, and silent architectural decisions are all caught before the tree is committed.
- **AC-BL-005.1** — After the generator exits, the orchestrator shall spawn `bp-spec-judge` to verify each blueprint matches the per-type structural shape: correct section order, required sections present, fenced `component`/`model` blocks well-formed (required keys present, tab-indented bullets), ADR entries follow `### ADR-NNN: Title` + Context / Decision / Consequences. Fanned out per-blueprint so failures are attributable.
- **AC-BL-005.2** — The orchestrator shall spawn `bp-coverage-judge` to verify three things: (a) every approved FRD has a feature blueprint with matching slug (`requirements/features/<slug>.md` ↔ `blueprints/features/<slug>.md`); (b) every `#Component` mention resolves to a `component` block defined somewhere in the tree, every `` `Element` `` mention has a definition (model block or schema reference), every `@Blueprint` mention resolves; (c) no orphan blueprints, and no high-impact architectural choice is left unresolved without a matching open block in `blueprints/_questions-pending.md`.
- **AC-BL-005.3** — The orchestrator shall spawn `bp-consistency-judge` to verify three things: (a) cross-blueprint contract alignment (if a feature blueprint composes component X assuming behavior Y, component blueprint X actually exposes Y); (b) the **no-redefinition rule** — feature blueprints reference shared components rather than restating them; (c) the **boundary-first rule** — container blueprints don't drift into internal wiring (which belongs in component blueprints).
- **AC-BL-005.4** — The orchestrator shall spawn `bp-decision-judge` to verify no high-impact architectural decision (database choice, framework, auth provider, hosting model, ORM, major architectural pattern) was silently made by the generator without a matching question block in `blueprints/_questions-pending.md`.
- **AC-BL-005.5** — Each reviewer subprocess shall run with `--disallowedTools Bash,NotebookEdit`. `Write` and `Edit` are allowed so the reviewer can append to its own communication file; a `PreToolUse` path-guard hook shall block any `Write`/`Edit` call whose target path is not exactly the reviewer's own `blueprints_communication/<reviewer-name>.md` file.
- **AC-BL-005.6** — Each reviewer's stdout shall end with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`; a `Stop` hook shall block completion if the trailing line is missing or malformed.

### REQ-BL-006 — Dual completion condition
**User Story.** As an operator, I want the loop to exit `awaiting_clarification` when open questions remain, so that I know when to answer questions versus when the blueprint tree is fully accepted.
- **AC-BL-006.1** — Full `pass` shall require both all four reviewers pass AND `blueprints/_questions-pending.md` has zero unanswered questions.
- **AC-BL-006.2** — When reviewers pass on the current state but open questions remain and the generator can make no further progress without them, the orchestrator shall exit with verdict `awaiting_clarification`, commit current progress (blueprints with optional `<!-- pending: -->` markers and the updated questions doc), write a history entry, and print an operator-facing summary of the open questions.
- **AC-BL-006.3** — `awaiting_clarification` shall not be treated as a failure state; re-running the loop after the operator answers shall resume from the current blueprint state. This is the same verdict and mechanism the requirements loop uses — only the file location (`blueprints/_questions-pending.md` vs `requirements/_questions-pending.md`) differs.

### REQ-BL-007 — Operator-side question resolution
**User Story.** As an operator, I want to answer open questions by filling in `Your answer:` lines in one scannable file, so that resolution is a quick inspection-and-fill pass rather than a research exercise.
- **AC-BL-007.1** — The operator shall answer a question by editing `blueprints/_questions-pending.md` and filling in the `Your answer:` field of the relevant block.
- **AC-BL-007.2** — The operator may optionally rename answered blocks to `_questions-resolved-<timestamp>.md` for git-history audit, or leave them in place for the generator to detect.
- **AC-BL-007.3** — On the next loop run, the generator shall read the questions doc, treat any answered questions as resolved, and pick up where it left off.

### REQ-BL-008 — Verdict aggregation and retry
**User Story.** As an operator, I want the orchestrator to decide retry vs pass vs exhaust deterministically, so that the loop converges without operator intervention when the FRD inputs and answered questions are clear enough.
- **AC-BL-008.1** — The orchestrator shall parse only the trailing `VERDICT:` line from each reviewer's stdout to decide pass or fail. The full review prose lives in the communication file (§REQ-BL-004); the orchestrator does not parse that body for control flow.
- **AC-BL-008.2** — On any reviewer fail, the orchestrator shall re-spawn the generator. The retry prompt names only the failing reviewers; the generator reads each reviewer's file directly and decides which findings to fix and which to push back on.
- **AC-BL-008.3** — The orchestrator shall apply a `Stop` hook on reviewer subprocesses that validates the reviewer's final chat message ends with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`; the hook shall block completion if the trailing line is missing or malformed (in-session enforcement layer). If a reviewer subprocess does exit with malformed stdout (hook bypass, crash, truncation), the orchestrator's protocol-retry mechanism (REQ-ORCH-013) shall re-prompt the reviewer up to 2 times before treating the verdict as `fail` and continuing.

### REQ-BL-009 — Artifact commit and audit trail
**User Story.** As an operator, I want the approved tree committed to git, so that git history is the audit trail and no PR is needed for upstream-loop output.
- **AC-BL-009.1** — On full `pass` and on `awaiting_clarification`, the orchestrator shall commit the blueprints tree and the updated `blueprints/_questions-pending.md` file.
- **AC-BL-009.2** — The orchestrator shall not open a pull request for the blueprints tree.
- **AC-BL-009.3** — The orchestrator shall record loop-level iteration history in `harness/state/blueprint-loop.json` and snapshot the final attempt's communication folder into `harness/state/reviews/blueprint-loop/attempt-<N>/`.

### REQ-BL-010 — Interactive blueprint editing (out-of-loop)
**User Story.** As an operator, I want a way to refine specific blueprints interactively after the loop has run, so that I can fix or evolve a blueprint without triggering a full loop run.
- **AC-BL-010.1** — The harness shall provide a `blueprint-authoring` skill (renamed from the prior `foundation-blueprint-authoring`) that runs in an interactive Claude Code session, not as an orchestrator subprocess.
- **AC-BL-010.2** — `blueprint-authoring` shall know the three blueprint types (container / component / feature), the per-type structural shape, the mention syntax, the fenced `component`/`model` block format, and the boundary-first / no-redefinition writing principles.
- **AC-BL-010.3** — `blueprint-authoring` shall not be invoked by the autonomous blueprint loop; it is operator-driven only. Same posture as `prd-authoring` for the PRD.

## Feature Behavior & Rules

The blueprint loop is a near-symmetric mirror of the requirements loop. Same dual-completion mechanism, same `awaiting_clarification` exit verdict, same gen↔reviewer communication-folder pattern. The differences are: a different generator skill (`frd-to-blueprint` instead of `prd-to-frds`), a different reviewer set (`bp-*` rather than `req-*`), a different artifact tree (`blueprints/` rather than `requirements/`), and a different question shape (questions can carry pre-researched options when the choice is genuine, since architectural choices benefit from pre-research in a way that PRD clarifications usually don't). Everything else — orchestrator flow, communication-folder lifecycle, snapshot semantics, attempt caps, exit verdicts — is identical.

The defining mechanism is the non-blocking question. Architectural choices are the single class of blocker the generator cannot resolve autonomously, but they are also a class where the operator should not be pulled into every micro-decision. The questions file solves this by making each block self-contained: title, context, optional pre-researched options, optional recommended default. The operator reads one file at their own pace, fills in `Your answer:` lines, and re-runs the loop. The generator does the research; the operator does the judgment.

Pre-populating options is load-bearing when there is a genuine choice. If the generator merely flagged "I need a framework choice" without doing the research, the operator would either have to research themselves (defeating the point) or pick blindly. But fabricating options when the answer is just a clarification is worse — it wastes the operator's time. The two block shapes (bare and with-options) let the generator pick the right structure per question.

The four reviewers map to distinct failure modes. `bp-spec-judge` catches structural defects in individual blueprints — wrong section order, missing required sections, malformed fenced blocks, broken ADR shape — that would confuse the coding loop. `bp-coverage-judge` catches FRDs without matching feature blueprints, blueprints with broken `#`/`` ` ``/`@` mentions, and unresolved architectural choices left without a question block. `bp-consistency-judge` catches contract drift between blueprints, the no-redefinition rule (feature blueprints restating shared components), and the boundary-first rule (container blueprints drifting into internal wiring). `bp-decision-judge` catches silent architectural choices the generator made without surfacing.

The communication folder is what makes the gen↔reviewer back-and-forth visible and durable. Without it, every attempt is a one-shot exchange — the generator writes, reviewers judge, the generator gets aggregated feedback through orchestrator-assembled prompts. With it, the conversation persists across attempts, the generator can push back on a specific reviewer by appending to that reviewer's file, and the reviewer sees the push-back and may revise its position. The orchestrator stays small — it spawns subprocesses and reads `VERDICT:` lines; the bidirectional content lives where both sides can see it.

The `awaiting_clarification` exit is not failure. It means the generator did its job — produced everything that did not require human judgment, surfaced everything that did, passed all reviewers on the concrete parts — and now waits asynchronously for the operator. The loop may cycle through multiple `awaiting_clarification` exits before reaching full `pass`: the operator answers a subset of questions, re-triggers the loop, the generator continues, new questions surface, another `awaiting_clarification` exit. The cycle terminates when the questions doc is empty and all reviewers pass.

The interactive `blueprint-authoring` skill exists for cases the autonomous loop cannot reasonably handle: targeted refinement of a specific blueprint after the fact, ad-hoc editing the operator wants to drive themselves, or producing initial scaffolding before the loop runs. It is not part of the loop. The loop's generator is `frd-to-blueprint`, period.
