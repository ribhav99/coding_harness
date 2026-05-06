# Communication Folder

## Capability Summary

The communication folder is the bidirectional gen↔reviewer channel for the three upstream loops. Each loop has a dedicated project-root sibling folder (`requirements_communication/`, `blueprints_communication/`, `work-orders_communication/`) holding one append-only markdown file per agent. Both the generator and the named reviewer read and write the file across attempts; the conversation accumulates indefinitely, surviving every loop-exit verdict and every subsequent invocation. The orchestrator manages folder lifecycle (mkdir-with-exists-ok, snapshot, never wipe) and never writes inside the files.

## Core Components

### Lifecycle management

```component
name: CommunicationFolderManager
container: Python Orchestrator
responsibilities:
	- Resolves the loop's communication folder path from the loop name (`requirements-loop` → `requirements_communication/`, etc.)
	- Ensures the folder exists before the generator spawns via `Path.mkdir(parents=True, exist_ok=True)`; never wipes the folder
	- Snapshots each `<agent-name>.md` file into `harness/state/reviews/<loop>/attempt-<N>/<agent-name>.md` at every attempt boundary and on every loop-exit verdict
	- Leaves the live folder in place on every loop-exit verdict (`pass`, `awaiting_clarification`, `exhausted`); a subsequent loop run picks up the prior conversation as context
```

```component
name: CommunicationFolderSnapshotter
container: Python Orchestrator
responsibilities:
	- For each `<agent-name>.md` in the live folder, copies the file content to `harness/state/reviews/<loop>/attempt-<N>/<agent-name>.md`
	- For coding-loop per-WO execution (which does not use the communication-folder mechanism), captures reviewer subprocess stdout instead and writes to `harness/state/reviews/coding-loop/<wo-slug>/attempt-<N>/<reviewer-name>.md`
	- Idempotent on re-run: overwriting an existing snapshot file is fine since attempts are uniquely numbered per invocation
```

The #CommunicationFolderManager is invoked at three points by #LoopDriver inside @Blueprint(loop-driver): on attempt-start to ensure the folder exists, after each attempt's reviewer fan-out to snapshot the per-attempt frozen record, and on loop-exit to take the final snapshot.

---

### Conversation file shape

```model
name: CommunicationFile
store: Filesystem (project repo)
description: One markdown file per agent; append-only conversation transcript shared between the generator and the named reviewer
fields:
	- path: <loop>_communication/<agent-name>.md
	- format: markdown only; no JSON, no schema
	- structure: top-level `## ` blocks, each tagged with the speaker and attempt number (e.g. `## Generator — attempt 1 proposal`, `## Review — attempt 1`, `## Generator — attempt 2 response`, `## Review — attempt 2 (protocol-retry 1)`)
constraints:
	- Generator and reviewer both write; the orchestrator never writes inside the file
	- Append-only — never overwrite prior content; new turns append at the end
	- Reviewer files are exclusively writable by their named reviewer (enforced by #ReviewerPathGuardHook in @Blueprint(subprocess-runtime))
	- Race-free by sequential execution: orchestrator runs generator → reviewers → generator → reviewers strictly per attempt; reviewers run in parallel within an attempt but each writes only its own file
	- Folder is never wiped; survives every loop-exit verdict and every subsequent invocation
```

The agent files inside the folder follow a consistent naming convention per loop:

| Loop | Generator file | Reviewer files |
|---|---|---|
| Requirements | `prd-to-frds.md` | `req-spec-judge.md`, `req-cross-doc-judge.md`, `req-coverage-judge.md`, `req-scoping-judge.md` |
| Blueprint | `frd-to-blueprint.md` | `bp-spec-judge.md`, `bp-coverage-judge.md`, `bp-consistency-judge.md`, `bp-decision-judge.md` |
| Work-Orders | `blueprint-to-work-orders.md` | `wo-spec-judge.md`, `wo-coverage-judge.md`, `wo-overlap-judge.md`, `wo-sequencing-judge.md` |

The coding loop has no communication folder — per-WO execution uses PR comments and reviewer stdout instead, per @Blueprint(coding-loop).

## System Contracts

### Key Contracts

- **Append-only.** Both sides append; neither overwrites. Prior content from the same invocation, prior invocations, or prior full passes is preserved verbatim.
- **Single-writer-per-file invariant.** No two processes write the same file concurrently. The orchestrator's spawn order (generator → reviewers → generator → reviewers) is the enforcement; each reviewer writes only its own file inside its parallel fan-out.
- **Never wiped.** The folder survives every loop-exit verdict (`pass`, `awaiting_clarification`, `exhausted`) and every subsequent invocation. A re-run after a previous full pass sees the prior conversation as context.
- **Snapshots are frozen audit records.** Per-attempt snapshots in `harness/state/reviews/<loop>/attempt-<N>/` are immutable copies of the live file at the attempt boundary. The live file is the running conversation; snapshots are the audit trail.
- **Stale-content tolerated.** A re-run after a previous pass or after `awaiting_clarification` may carry findings written against an older artifact-tree state. Generators and reviewers re-read current artifacts on every spawn; the conversation is contextual, not authoritative. If a prior finding no longer applies, the generator notes it briefly in its next response and moves on.

### Integration Contracts

- **Folder paths.** `<project-root>/<loop>_communication/`. `<loop>` is `requirements`, `blueprints`, or `work-orders`. Sibling of the artifact tree, not nested.
- **Agent files.** One per agent per loop. Filenames match the agent's skill name (generator) or the reviewer's name (reviewer).
- **Conversation block shape.** Top-level `## ` headers; speaker + attempt tag in the title. Final block always ends with the appropriate `VERDICT:` line for reviewer turns.
- **Snapshot path.** `harness/state/reviews/<loop>/attempt-<N>/<agent-name>.md`. `<loop>` is the full subcommand name (`requirements-loop`, etc.).
- **Lifecycle hook points.** `ensure_communication_folder(comm_dir)` before generator spawn; `snapshot_communication_folder(loop_name, attempt_n, comm_dir)` at every attempt boundary and on loop-exit; never `rm -rf comm_dir`.

## Architecture Decision Records

### ADR-001: Sibling of artifact tree, not nested inside

**Context.** The communication folder could live inside `requirements/`, `blueprints/`, or `work-orders/`. That would co-locate conversation with artifacts. But the artifact tree is the deliverable — operators and downstream loops want to read it as the spec, not wade through generator-vs-reviewer transcripts.

**Decision.** Communication folders are siblings of the corresponding artifact trees: `requirements_communication/`, `blueprints_communication/`, `work-orders_communication/`. They live at the project repo root next door to the artifact tree they document.

**Consequences.** The artifact tree stays scannable as a deliverable; the conversation lives next door for anyone who wants to read it. Trade-off: an extra top-level entry per upstream loop in the project repo root; small price for the cleanliness of the artifact tree.

### ADR-002: Never wipe; conversation accumulates across invocations

**Context.** Each invocation could clear the folder to start clean, or the orchestrator could preserve it across attempts within an invocation but wipe at invocation start. Both options would force the generator to re-derive prior context from scratch on every fresh run.

**Decision.** The folder is never wiped. Whatever's there from prior runs — incomplete or already-passed — is preserved and read by the generator and reviewers as conversation context. Per-attempt snapshots under `harness/state/reviews/<loop>/attempt-<N>/` provide the frozen audit record.

**Consequences.** A re-run after a previous full pass sees what was previously decided, what was previously contested, and what reviewers cared about. Iterative project evolution (PRD edited, scope expanded) does not lose accumulated reasoning. Trade-off: stale findings can mislead; mitigated by always re-reading current artifacts and noting briefly when a prior finding no longer applies.

### ADR-003: Single-writer-per-file by sequential spawn order, not file locking

**Context.** Concurrent writes to the same file would race. Options: file locks (heavyweight, OS-specific quirks), append-with-atomic-tmpfile (works but adds bookkeeping), or sequential ordering by the orchestrator.

**Decision.** No file locking. The orchestrator's spawn order guarantees no two processes ever write the same file: generator runs alone, reviewers fan out in parallel but each writes only its own dedicated file, then generator runs alone again. The path-guard hook enforces "only your own file" at the reviewer level.

**Consequences.** Zero file-locking infrastructure. The single-writer invariant is a property of the orchestrator's design, testable directly. Trade-off: a future feature that wanted concurrent generator + reviewer mutation would have to revisit this — not anticipated in the current design.
