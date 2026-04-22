# Python Orchestrator

## Overview

The Python orchestrator is the cross-session runtime of the harness — a thin Python program that spawns Claude Code generator and reviewer subprocesses, aggregates their verdicts, transitions artifact state on disk, enforces budgets, and handles bubble-up pauses. It is the only component that initiates sessions; everything that happens inside a session (generation, review, verdict emission) happens under the orchestrator's control through `claude -p`.

The operator needs this orchestrator because the three autonomous loops share a loop mechanic but execute across many subprocesses over many minutes. Keeping this mechanic out of Claude Code sessions — where every model call is billable session time and where hooks run at irregular boundaries — and putting it in a deterministic Python program is what makes the harness reliable. The orchestrator owns retry logic, verdict parsing, attempt counting, PR comment posting, merge detection, and status transitions so that skills and agents can focus on LLM-driven work.

## Terminology

- **Subcommand** — one of the four CLI entry points: `requirements-loop`, `blueprint-loop`, `coding-loop`, `status`.
- **Generator subprocess** — a `claude -p` invocation running a generator skill (for example, `prd-to-frds`, `frd-to-blueprint`, `blueprint-to-tasks`, or the per-work-order implementation generator).
- **Reviewer subprocess** — a `claude -p` invocation running an LLM-as-judge skill with write tools disallowed, emitting its review as the subprocess's final chat message.
- **Verdict** — a `pass|fail` decision extracted from the trailing `VERDICT:` line of a subprocess's stdout.
- **Bubble-up pause** — the `awaiting_clarification` (requirements loop) or `awaiting_decisions` (blueprint loop) exit condition, where the generator cannot progress further without operator input.
- **Reviewer review file** — the markdown file under `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md` where the orchestrator archives each reviewer subprocess's stdout.

## Requirements

### REQ-ORCH-001 — CLI entry point and subcommands
**User Story.** As an operator, I want a single CLI entry point with one subcommand per loop, so that I can trigger the right loop by name without switching tools.
- **AC-ORCH-001.1** — The orchestrator shall expose `python -m orchestrator <subcommand>` as its invocation shape.
- **AC-ORCH-001.2** — The orchestrator shall implement the subcommands `requirements-loop`, `blueprint-loop`, `coding-loop`, and `status`.
- **AC-ORCH-001.3** — The orchestrator shall run only one subcommand at a time; loops shall not be daemonized.

### REQ-ORCH-002 — Subprocess spawn with composed prompts
**User Story.** As an operator, I want the orchestrator to spawn generator and reviewer subprocesses with the right prompt context, so that skills run in the conditions they were designed for.
- **AC-ORCH-002.1** — The orchestrator shall spawn generator subprocesses via `claude -p "<prompt>"`, with scoped context for the loop (for the coding loop's per-work-order generator, the scoped-task body is injected inline into the prompt).
- **AC-ORCH-002.2** — The orchestrator shall spawn reviewer subprocesses via `claude -p "<prompt>"` with `--disallowedTools Write,Edit,NotebookEdit,Bash` so reviewers cannot mutate the tree.
- **AC-ORCH-002.3** — The orchestrator shall never make direct Anthropic API calls; every model interaction shall go through `claude -p`.

### REQ-ORCH-003 — Verdict capture and aggregation
**User Story.** As an operator, I want the orchestrator to extract verdicts deterministically, so that retry vs pass vs exhaust decisions are reproducible.
- **AC-ORCH-003.1** — The orchestrator shall capture each reviewer subprocess's stdout and archive it under `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md`.
- **AC-ORCH-003.2** — The orchestrator shall parse the trailing `VERDICT:` line of each reviewer's stdout to extract `pass` or `fail`.
- **AC-ORCH-003.3** — The orchestrator shall aggregate per-reviewer verdicts into a single loop-level verdict.
- **AC-ORCH-003.4** — For the generator, the orchestrator shall parse the generator's `VERDICT:` trailer, which carries per-gate results (including `not_run` where applicable).

### REQ-ORCH-004 — Retry and exhaustion
**User Story.** As an operator, I want the orchestrator to re-spawn the generator on any fail and to give up after budget exhaustion, so that the loop converges or exits cleanly rather than looping forever.
- **AC-ORCH-004.1** — On any reviewer fail, the orchestrator shall re-spawn the generator with aggregated reviewer feedback as context.
- **AC-ORCH-004.2** — The orchestrator shall enforce a wall-clock cap per subprocess.
- **AC-ORCH-004.3** — The orchestrator shall enforce an attempt cap per invocation.
- **AC-ORCH-004.4** — When either cap is hit, the orchestrator shall exit with verdict `exhausted` for operator inspection.

### REQ-ORCH-005 — Artifact commit on pass
**User Story.** As an operator, I want the orchestrator to commit artifact changes on pass, so that git history is a clean audit trail of accepted loop outputs.
- **AC-ORCH-005.1** — On full `pass` of a requirements, blueprint, or sequence-generation loop, the orchestrator shall commit the corresponding artifact-tree changes.
- **AC-ORCH-005.2** — On a requirements-loop `awaiting_clarification` or blueprint-loop `awaiting_decisions` exit, the orchestrator shall commit current progress plus the updated bubble-up file.
- **AC-ORCH-005.3** — The orchestrator shall not open a pull request for requirements or blueprint trees; for those, the commit history is the audit trail.

### REQ-ORCH-006 — Coding-loop execution: merge detection and status transition
**User Story.** As an operator, I want merged PRs detected automatically, so that the next coding-loop invocation does not retry work that is already shipped.
- **AC-ORCH-006.1** — On each `coding-loop` invocation, the orchestrator shall check each `in_progress` work order for a merged PR matching its branch name `task/<task_id>`.
- **AC-ORCH-006.2** — When the orchestrator detects a merged PR, it shall transition the work order's `.work-order.meta.yaml.status` from `in_progress` to `done`.
- **AC-ORCH-006.3** — The orchestrator shall never auto-merge PRs.

### REQ-ORCH-007 — PR comment mirroring
**User Story.** As an operator, I want final per-work-order summaries posted as PR comments, so that the PR page is the single place I go to review execution output.
- **AC-ORCH-007.1** — On a per-work-order all-pass during coding-loop execution, the orchestrator shall post the final pass-summary as a comment on the corresponding pull request.
- **AC-ORCH-007.2** — The orchestrator shall use a thin GitHub CLI layer (`gh`) for PR creation, comment posting, and merge detection.

### REQ-ORCH-008 — Bubble-up pause detection
**User Story.** As an operator, I want the orchestrator to detect when a loop's bubble-up file blocks further progress, so that the exit verdict correctly distinguishes `awaiting_*` from `pass`.
- **AC-ORCH-008.1** — For the requirements loop, the orchestrator shall inspect `requirements/_questions-pending.md` after each generator run; if reviewers pass on the concrete content but open questions remain that block further review, the orchestrator shall exit with verdict `awaiting_clarification`.
- **AC-ORCH-008.2** — For the blueprint loop, the orchestrator shall inspect `blueprints/_decisions-pending.md`; if reviewers pass but unanswered decisions remain and the generator cannot progress further, the orchestrator shall exit with verdict `awaiting_decisions`.
- **AC-ORCH-008.3** — Neither `awaiting_clarification` nor `awaiting_decisions` shall be treated as failure; both shall commit current progress and write an operator-facing summary.

### REQ-ORCH-009 — State files as first-class artifacts
**User Story.** As an operator, I want every loop run, verdict, and push-back logged in git-tracked state files, so that audit, replay, and failure-mode analysis are possible after the fact.
- **AC-ORCH-009.1** — The orchestrator shall maintain JSON state files under `harness/state/` with one file per loop and one file per in-progress work order.
- **AC-ORCH-009.2** — State files shall capture loop run duration, per-attempt reviewer verdicts, retry counts, push-back notes, and exhaustion events.
- **AC-ORCH-009.3** — The entire `harness/` tree shall be committed to git.
- **AC-ORCH-009.4** — State files shall never be deleted by the orchestrator; log files may be pruned on a documented retention policy.

### REQ-ORCH-010 — Operator-visible status subcommand
**User Story.** As an operator, I want a `status` subcommand that summarizes the current state of all loops and work orders, so that I can orient myself quickly after a break.
- **AC-ORCH-010.1** — `python -m orchestrator status` shall report the current state of the requirements tree, the blueprints tree, the work-orders queue (counts of `ready`, `in_progress`, `done`, and inbox entries), and any open bubble-up files.

### REQ-ORCH-011 — Local-planner and mirror-adapter modules
**User Story.** As an operator, I want the on-disk layout reads/writes centralized and external mirrors abstracted, so that adding or changing a mirror does not touch the loop code.
- **AC-ORCH-011.1** — The orchestrator shall include a local-planner module that reads and writes the on-disk layout as a single concrete class.
- **AC-ORCH-011.2** — The orchestrator shall expose a mirror adapter interface with one-way push hooks for status updates and comments to external systems.
- **AC-ORCH-011.3** — All mirrors shall be outbound-only in v1; inbound mirror sync is deferred.

## Feature Behavior & Rules

The orchestrator is deliberately thin. Every decision that requires LLM judgment — "did the generator produce correct output?", "is this blueprint coherent with its FRD?", "does this diff meet the acceptance criteria?" — happens inside a `claude -p` subprocess running a skill. The orchestrator's decisions are all deterministic: parse a `VERDICT:` line, compare to expected values, re-spawn or commit. This split is what lets the harness stay reliable despite nondeterministic model outputs, because the orchestrator's state machine is the part that can be tested traditionally.

The orchestrator is the only component that knows about cross-session state. Hooks run inside a session and can enforce things like "the subagent's final chat message must end in a `VERDICT:` line," but they cannot decide what to do when a reviewer fails — they just block. Skills run inside a session and produce artifacts, but they don't decide whether to re-spawn themselves. The orchestrator ties these together: it reads the hook's enforced outputs, parses them, and decides the next action.

Budget enforcement is the orchestrator's responsibility. Wall-clock caps prevent a runaway generator from consuming hours; attempt caps prevent a loop that is not converging from retrying forever. Exhaustion is not silent — it exits with a distinct verdict that surfaces to the operator for triage. The retry cap hitting should be a rare event; when it does happen, the fix is almost always to improve the input artifact, not to patch the orchestrator.

Subprocess spawn is the orchestrator's only channel to Claude Code. The orchestrator composes prompts (for the coding loop, the scoped-task body is injected inline), specifies disallowed tools for reviewers, captures stdout, and parses verdict trailers. There is no IPC back-channel from subprocess to orchestrator — the subprocess's stdout and its effect on disk are the entire protocol. This keeps the orchestrator simple and lets every subprocess be replayable from its archived stdout alone.

The orchestrator commits requirements and blueprint tree changes directly (no PR); for coding-loop execution, the generator opens a PR during the subprocess and the orchestrator only posts the final pass-summary comment. Merge is always operator-driven. This split — orchestrator commits upstream artifacts, generator opens PR for code, operator merges — is what keeps the human in control of shipping without having them in every loop.
