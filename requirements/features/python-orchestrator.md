# Python Orchestrator

## Overview

The Python orchestrator is the cross-session runtime of the harness — a thin Python program that spawns Claude Code generator and reviewer subprocesses, parses their `VERDICT:` lines from stdout, manages each loop's communication folder (the bidirectional gen↔reviewer channel for the upstream loops), transitions artifact state on disk, enforces budgets, and handles clarification-pending pauses. It is the only component that initiates sessions; everything that happens inside a session (generation, review, verdict emission) happens under the orchestrator's control through `claude -p`.

The operator needs this orchestrator because the four autonomous loops share core machinery but execute across many subprocesses over many minutes. Keeping this mechanic out of Claude Code sessions — where every model call is billable session time and where hooks run at irregular boundaries — and putting it in a deterministic Python program is what makes the harness reliable. The orchestrator owns retry logic, verdict parsing, attempt counting, PR comment posting, merge detection, and status transitions so that skills and agents can focus on LLM-driven work.

## Terminology

- **Subcommand** — one of the five CLI entry points: `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, `status`.
- **Generator subprocess** — a `claude -p` invocation running a generator skill (for example, `prd-to-frds`, `frd-to-blueprint`, `blueprint-to-work-orders`, or the per-work-order implementation generator).
- **Reviewer subprocess** — a `claude -p` invocation running an LLM-as-judge skill. For upstream loops (requirements, blueprint, work-orders), the reviewer runs with `--disallowedTools Bash,NotebookEdit` and appends its review to its own communication file; for coding-loop execution, it runs with `--disallowedTools Write,Edit,NotebookEdit,Bash` and emits its review as stdout. In all cases, stdout ends with a `VERDICT:` line.
- **Verdict** — a `pass|fail` decision extracted from the trailing `VERDICT:` line of a subprocess's stdout.
- **Communication folder** — `requirements_communication/` (for the requirements loop), `blueprints_communication/` (for the blueprint loop), or `work-orders_communication/` (for the work-orders loop): a project-root-level directory containing one markdown file per agent in that loop. Append-only conversation transcripts; both the generator and the named reviewer read and write the file. The orchestrator manages the folder lifecycle but does not write inside the files.
- **Clarification-pending pause** — the `awaiting_clarification` exit condition for any upstream loop (requirements, blueprint, work-orders). Triggered when reviewers pass on the concrete content but `<artifact-tree>/_questions-pending.md` has unanswered questions and the generator cannot progress further without operator input. Same exit verdict for all three upstream loops.
- **Reviewer review file** — the markdown file under `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md` where the orchestrator snapshots each reviewer's communication file (upstream loops) or captures stdout (coding-loop execution) for audit.

## Requirements

### REQ-ORCH-001 — CLI entry point and subcommands
**User Story.** As an operator, I want a single CLI entry point with one subcommand per loop, so that I can trigger the right loop by name without switching tools.
- **AC-ORCH-001.1** — The orchestrator shall expose `python -m orchestrator <subcommand>` as its invocation shape.
- **AC-ORCH-001.2** — The orchestrator shall implement the subcommands `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, and `status`.
- **AC-ORCH-001.3** — The orchestrator shall run only one subcommand at a time; loops shall not be daemonized.

### REQ-ORCH-002 — Subprocess spawn with composed prompts
**User Story.** As an operator, I want the orchestrator to spawn generator and reviewer subprocesses with the right prompt context, so that skills run in the conditions they were designed for.
- **AC-ORCH-002.1** — The orchestrator shall spawn generator subprocesses via `claude -p "<prompt>"`, with scoped context for the loop (for the upstream loops — requirements, blueprint, work-orders — the prompt names the loop's communication folder so the generator can read prior reviews; for the coding loop's per-work-order generator, the scoped-task body is injected inline).
- **AC-ORCH-002.2** — For upstream-loop reviewer subprocesses (requirements, blueprint, work-orders), the orchestrator shall spawn `claude -p "<prompt>"` with `--disallowedTools Bash,NotebookEdit` (allowing `Write`/`Edit` so the reviewer can append to its own communication file); a `PreToolUse` path-guard hook configured by the orchestrator shall block any `Write`/`Edit` call whose target path is not exactly the reviewer's own `<loop>_communication/<reviewer-name>.md` file.
- **AC-ORCH-002.3** — For coding-loop per-work-order execution reviewer subprocesses, the orchestrator shall spawn `claude -p "<prompt>"` with `--disallowedTools Write,Edit,NotebookEdit,Bash` (the original constraint, since per-WO execution does not use the communication-folder mechanism).
- **AC-ORCH-002.4** — The orchestrator shall never make direct Anthropic API calls; every model interaction shall go through `claude -p`.

### REQ-ORCH-003 — Verdict capture and aggregation
**User Story.** As an operator, I want the orchestrator to extract verdicts deterministically, so that retry vs pass vs exhaust decisions are reproducible.
- **AC-ORCH-003.1** — The orchestrator shall parse only the trailing `VERDICT:` line from each reviewer subprocess's stdout to extract `pass` or `fail`. It shall not parse the body of the review (which lives in the reviewer's communication file for upstream loops, or in stdout for coding-loop execution) for control flow.
- **AC-ORCH-003.2** — At every attempt boundary and on every loop-exit verdict, the orchestrator shall snapshot each reviewer's communication file (upstream loops) or captured stdout (coding-loop execution) into `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md`.
- **AC-ORCH-003.3** — The orchestrator shall aggregate per-reviewer verdicts into a single loop-level verdict.
- **AC-ORCH-003.4** — For the generator, the orchestrator shall parse the generator's `VERDICT:` trailer, which carries per-gate results (including `not_run` where applicable).

### REQ-ORCH-004 — Retry and exhaustion
**User Story.** As an operator, I want the orchestrator to re-spawn the generator on any fail and to give up after budget exhaustion, so that the loop converges or exits cleanly rather than looping forever.
- **AC-ORCH-004.1** — On any reviewer fail, the orchestrator shall re-spawn the generator. The retry prompt shall name only the failing reviewers; for upstream loops, the generator reads each reviewer's communication file directly (so the orchestrator does not assemble or inline review bodies into the prompt).
- **AC-ORCH-004.2** — The orchestrator shall enforce a wall-clock cap per subprocess.
- **AC-ORCH-004.3** — The orchestrator shall enforce an attempt cap per invocation.
- **AC-ORCH-004.4** — When either cap is hit, the orchestrator shall exit with verdict `exhausted` for operator inspection.

### REQ-ORCH-005 — Artifact commit on pass
**User Story.** As an operator, I want the orchestrator to commit artifact changes on pass, so that git history is a clean audit trail of accepted loop outputs.
- **AC-ORCH-005.1** — On full `pass` of any upstream loop (requirements, blueprint, work-orders), the orchestrator shall commit the corresponding artifact-tree changes.
- **AC-ORCH-005.2** — On an upstream-loop `awaiting_clarification` exit (any of requirements, blueprint, work-orders), the orchestrator shall commit current progress plus the updated `_questions-pending.md` file in that loop's artifact tree.
- **AC-ORCH-005.3** — The orchestrator shall not open a pull request for requirements, blueprint, or work-orders trees; for those, the commit history is the audit trail.

### REQ-ORCH-006 — Coding-loop execution: merge detection and status transition
**User Story.** As an operator, I want merged PRs detected automatically, so that the next coding-loop invocation does not retry work that is already shipped.
- **AC-ORCH-006.1** — On each `coding-loop` invocation, the orchestrator shall check each `in_progress` work order for a merged PR matching its branch name `task/<wo-slug>`.
- **AC-ORCH-006.2** — When the orchestrator detects a merged PR, it shall transition the work order's `.work-order.meta.yaml.status` from `in_progress` to `done`.
- **AC-ORCH-006.3** — The orchestrator shall never auto-merge PRs.

### REQ-ORCH-007 — PR comment mirroring
**User Story.** As an operator, I want final per-work-order summaries posted as PR comments, so that the PR page is the single place I go to review execution output.
- **AC-ORCH-007.1** — On a per-work-order all-pass during coding-loop execution, the orchestrator shall post the final pass-summary as a comment on the corresponding pull request.
- **AC-ORCH-007.2** — The orchestrator shall use a thin GitHub CLI layer (`gh`) for PR creation, comment posting, and merge detection.

### REQ-ORCH-008 — Clarification-pause detection
**User Story.** As an operator, I want the orchestrator to detect when a loop's questions file blocks further progress, so that the exit verdict correctly distinguishes `awaiting_clarification` from `pass`.
- **AC-ORCH-008.1** — For the requirements loop, the orchestrator shall inspect `requirements/_questions-pending.md` after each generator run; if reviewers pass on the concrete content but open questions remain that block further review, the orchestrator shall exit with verdict `awaiting_clarification`.
- **AC-ORCH-008.2** — For the blueprint loop, the orchestrator shall inspect `blueprints/_questions-pending.md`; if reviewers pass but open questions remain and the generator cannot progress further, the orchestrator shall exit with verdict `awaiting_clarification`. Same verdict and mechanism as the requirements loop — only the file location differs.
- **AC-ORCH-008.3** — For the work-orders loop, the orchestrator shall inspect `work-orders/_questions-pending.md`; if reviewers pass but open questions remain and the generator cannot progress further, the orchestrator shall exit with verdict `awaiting_clarification`. Same verdict and mechanism as the requirements and blueprint loops.
- **AC-ORCH-008.4** — `awaiting_clarification` shall not be treated as failure; the orchestrator shall commit current progress and write an operator-facing summary.

### REQ-ORCH-012 — Communication folder lifecycle
**User Story.** As an operator, I want the orchestrator to manage the upstream-loop communication folders so that each invocation starts from a known state and every attempt's transcript is preserved for audit.
- **AC-ORCH-012.1** — For the requirements loop, the orchestrator shall manage `requirements_communication/` at the project root. For the blueprint loop, the orchestrator shall manage `blueprints_communication/`. For the work-orders loop, the orchestrator shall manage `work-orders_communication/`. All three are siblings of the corresponding artifact tree, not nested inside it.
- **AC-ORCH-012.2** — The orchestrator shall ensure the communication folder exists before spawning the generator (mkdir-with-exists-ok). The folder shall never be wiped — it accumulates the full reviewer-generator conversation across attempts and across invocations forever.
- **AC-ORCH-012.3** — At every attempt boundary and on every loop-exit verdict (`pass`, `awaiting_clarification`, `exhausted`), the orchestrator shall snapshot each agent file from the live communication folder into `harness/state/reviews/<loop>/attempt-<N>/<reviewer-name>.md`. The per-attempt archive is the frozen audit record; the live folder is preserved as the running conversation.
- **AC-ORCH-012.4** — On every loop-exit verdict (`pass`, `awaiting_clarification`, `exhausted`), the live communication folder shall be left in place. A subsequent loop run picks up the prior conversation as context.
- **AC-ORCH-012.5** — The orchestrator shall not write inside the agent files in the communication folder. Generator and reviewer subprocesses are the only writers; the orchestrator manages folder-level lifecycle (ensure / snapshot) only.
- **AC-ORCH-012.6** — The coding-loop's per-work-order execution does not use the communication-folder mechanism; per-WO execution review content lives in stdout and is archived directly.

### REQ-ORCH-013 — Protocol-retry on malformed reviewer verdicts
**User Story.** As an operator, I want the orchestrator to recover from reviewer subprocesses that emit a malformed `VERDICT:` trailer, so that an occasional model deviation from the protocol doesn't wedge the loop. The Stop hook (in-session) blocks most malformed completions; this requirement covers the post-exit recovery layer for cases the hook cannot catch (crashed subprocess, truncated output, hook bypass, etc.).
- **AC-ORCH-013.1** — When a reviewer subprocess exits with stdout that does not end with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`, the orchestrator shall treat the output as **malformed** and re-prompt the same reviewer with a fresh `claude -p` subprocess (a new chat — protocol retries are not multi-turn within one session).
- **AC-ORCH-013.2** — The protocol-retry prompt shall include the original reviewer prompt plus a prepended corrective note: "Your previous response did not end with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`. The captured stdout was: `<verbatim trailing 200 chars>`. Re-run the review and emit a final chat message that ends with that exact trailer line." The reviewer reads the same artifacts and the same communication file, runs the review again, and emits a new final chat message.
- **AC-ORCH-013.3** — The orchestrator shall cap protocol-retries at 2 per reviewer per attempt (3 total invocations: original + 2 retries). This counter is independent of the loop-level `max_attempts` cap; protocol-retries do not consume loop-level attempts.
- **AC-ORCH-013.4** — If the reviewer still emits a malformed verdict after the protocol-retry budget is exhausted, the orchestrator shall record the incident in the loop's state file under a `protocol_failures[]` array (capturing reviewer name, attempt number, retry count, and the malformed stdout) and treat that reviewer's verdict as `fail` for verdict-aggregation purposes. The loop continues to the next reviewer / next loop attempt; protocol-retry exhaustion does not by itself exhaust the loop.
- **AC-ORCH-013.5** — Protocol-retry invocations shall append to the reviewer's communication file like any other review pass — the retry block shall be tagged so the audit trail shows both the malformed attempt and the corrective re-run (e.g. `## Review — attempt N (protocol-retry M)`).

### REQ-ORCH-014 — Rate-limit handling on subprocess spawn
**User Story.** As an operator, I want the orchestrator to recover from transient Anthropic API rate-limit errors when spawning `claude -p` subprocesses, so that an occasional throttling event doesn't fail an entire loop run. This is a different failure mode from a malformed verdict (REQ-ORCH-013): the subprocess never produced output at all because the API throttled it before the model could run.
- **AC-ORCH-014.1** — When a generator or reviewer subprocess exits with a non-zero exit code and stderr matching a known rate-limit pattern (e.g. `Rate limited`, `429`, `Server is temporarily limiting requests`), the orchestrator shall classify the failure as a transient rate-limit event rather than a loop-level fail or a malformed-verdict case.
- **AC-ORCH-014.2** — On a rate-limit classification, the orchestrator shall pause **30 seconds** and re-spawn the same subprocess with the identical prompt (rate-limit retry 1).
- **AC-ORCH-014.3** — If retry 1 also rate-limits, the orchestrator shall pause **60 seconds** and re-spawn once more (rate-limit retry 2).
- **AC-ORCH-014.4** — If retry 2 also rate-limits, the orchestrator shall record the incident in the loop's state file under a `rate_limit_failures[]` array (capturing subprocess kind, reviewer name if applicable, loop attempt number, retry count, and the captured stderr) and exit the loop invocation with verdict `exhausted`. The artifact tree shall not be committed; the operator can re-run the loop when capacity recovers.
- **AC-ORCH-014.5** — Rate-limit retries shall not consume the loop-level `max_attempts` budget (REQ-ORCH-004) or the protocol-retry budget (REQ-ORCH-013). They are independent recovery from infrastructure throttling.
- **AC-ORCH-014.6** — Rate-limit retries shall continue to count against the per-subprocess wall-clock cap (`max_wall_minutes`); if backoff pauses push a subprocess past wall-clock, the orchestrator shall exit with `exhausted` for wall-clock-breach reasons.
- **AC-ORCH-014.7** — Rate-limit handling shall apply uniformly to all subprocess kinds: loop-level generators, loop-level reviewers, reviewer protocol-retry invocations (REQ-ORCH-013), and per-work-order coding-loop generators and reviewers.

### REQ-ORCH-009 — State files as first-class artifacts
**User Story.** As an operator, I want every loop run, verdict, and push-back logged in git-tracked state files, so that audit, replay, and failure-mode analysis are possible after the fact.
- **AC-ORCH-009.1** — The orchestrator shall maintain JSON state files under `harness/state/` with one file per loop and one file per in-progress work order.
- **AC-ORCH-009.2** — State files shall capture loop run duration, per-attempt reviewer verdicts, retry counts, and exhaustion events. Push-back notes and reviewer reasoning live in the snapshotted communication files under `harness/state/reviews/<loop>/attempt-<N>/`, not in the JSON state file itself.
- **AC-ORCH-009.3** — The entire `harness/` tree shall be committed to git.
- **AC-ORCH-009.4** — State files shall never be deleted by the orchestrator; log files may be pruned on a documented retention policy.

### REQ-ORCH-010 — Operator-visible status subcommand
**User Story.** As an operator, I want a `status` subcommand that summarizes the current state of all loops and work orders, so that I can orient myself quickly after a break.
- **AC-ORCH-010.1** — `python -m orchestrator status` shall report the current state of the requirements tree, the blueprints tree, the work-orders queue (counts of `ready`, `in_progress`, `done`, and inbox entries), and any open `_questions-pending.md` files in any of the three upstream-loop artifact trees.

### REQ-ORCH-011 — Local-planner and mirror-adapter modules
**User Story.** As an operator, I want the on-disk layout reads/writes centralized and external mirrors abstracted, so that adding or changing a mirror does not touch the loop code.
- **AC-ORCH-011.1** — The orchestrator shall include a local-planner module that reads and writes the on-disk layout as a single concrete class.
- **AC-ORCH-011.2** — The orchestrator shall expose a mirror adapter interface with one-way push hooks for status updates and comments to external systems.
- **AC-ORCH-011.3** — All mirrors shall be outbound-only; inbound mirror sync is deferred.

## Feature Behavior & Rules

The orchestrator is deliberately thin. Every decision that requires LLM judgment — "did the generator produce correct output?", "is this blueprint coherent with its FRD?", "does this diff meet the acceptance criteria?" — happens inside a `claude -p` subprocess running a skill. The orchestrator's decisions are all deterministic: parse a `VERDICT:` line, compare to expected values, re-spawn or commit. This split is what lets the harness stay reliable despite nondeterministic model outputs, because the orchestrator's state machine is the part that can be tested traditionally.

The orchestrator is the only component that knows about cross-session state. Hooks run inside a session and can enforce things like "the subprocess's final chat message must end in a `VERDICT:` line," but they cannot decide what to do when a reviewer fails — they just block. Skills run inside a session and produce artifacts, but they don't decide whether to re-spawn themselves. The orchestrator ties these together: it reads the hook's enforced outputs, parses them, and decides the next action.

Budget enforcement is the orchestrator's responsibility. Wall-clock caps prevent a runaway generator from consuming hours; attempt caps prevent a loop that is not converging from retrying forever. Exhaustion is not silent — it exits with a distinct verdict that surfaces to the operator for triage. The retry cap hitting should be a rare event; when it does happen, the fix is almost always to improve the input artifact, not to patch the orchestrator.

Subprocess spawn is the orchestrator's only channel to Claude Code. The orchestrator composes prompts (for the coding loop, the scoped-task body is injected inline; for upstream loops, the prompt names the loop's communication folder), specifies disallowed tools for reviewers, captures stdout, and parses verdict trailers. There is no IPC back-channel from subprocess to orchestrator — the subprocess's stdout, its effect on disk (artifact tree edits and communication-file appends), and the trailing `VERDICT:` line are the entire protocol. This keeps the orchestrator simple and lets every subprocess be replayable from its archived stdout plus the snapshot of its communication file at that attempt boundary.

The orchestrator commits upstream-loop artifact-tree changes directly (no PR for requirements, blueprint, or work-orders trees); for coding-loop execution, the generator opens a PR during the subprocess and the orchestrator only posts the final pass-summary comment. Merge is always operator-driven. This split — orchestrator commits upstream artifacts, generator opens PR for code, operator merges — is what keeps the human in control of shipping without having them in every loop.
