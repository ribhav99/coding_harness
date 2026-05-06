# Project Repo

## Container Summary

The Project Repo is the canonical local store for everything the harness produces and consumes — the operator's `PRD.md`, the generated artifact trees (`requirements/`, `blueprints/`, `work-orders/`), the gen↔reviewer communication folders, the harness's state and logs, and the project's source code (when the coding loop runs against it). It is the durable runtime for project state. Git is the audit trail. Stack: a normal git repository on the operator's local filesystem, written to by the @Blueprint(python-orchestrator) and @Blueprint(claude-code-subprocess) containers and read by every loop.

## Infrastructure

A standard git working tree on the operator's local disk. Single working tree, single git history. No clones, no forks, no parallel checkouts (the harness runs one work order at a time; worktree-based parallelism is plausible but deferred — see ADR-002).

Key platform dependencies:
- The local filesystem (POSIX semantics expected — kebab-case slugs, dotted-hidden meta files, flat directories with optional `<slug>_children/` subdirectories).
- The local `git` binary, used by the orchestrator for commits and by the per-work-order generator for branch creation, commits, push, and PR open.
- A GitHub remote (when the project is GitHub-hosted) for PRs and commit mirroring; project-repo state itself is local-first, GitHub is a sync target — see @Blueprint(github).

Deployment model: on a new project, the operator clones the kit's `project-template/` reference skeleton into a new git repo. From then on, every loop reads and writes through this single working tree.

## Entry Points and Boundaries

Work enters the project repo through filesystem operations and `git` commands. There are six entry-point classes, owned by the components that read/write each tree:

- **`PRD.md` at the repo root** — operator-authored monolithic PRD, never edited by any autonomous loop. Owned by the operator (via interactive `prd-authoring` skill or direct edit).
- **`BLUEPRINT.md` at the repo root (optional)** — operator-authored architectural scratchpad consumed by the blueprint-loop generator. Never edited by any autonomous loop.
- **`requirements/`** — overview tree (`requirements/overview/`) and features tree (`requirements/features/`). Visible content files written by the requirements-loop generator; dotted-hidden meta files written by #MetaMaterialiser. Layout pinned in @Blueprint(on-disk-layout).
- **`blueprints/`** — three subdirectories `containers/`, `components/`, `features/`. Visible content files written by the blueprint-loop generator; meta files by #MetaMaterialiser.
- **`work-orders/`** — flat `wo-NNN/` directories with `description.md` (generator-written) and `.work-order.meta.yaml` (orchestrator-materialised). Plus `.sequence.meta.yaml`, `_questions-pending.md`, and `_inbox/` (gaps from the coding loop).
- **`requirements_communication/`, `blueprints_communication/`, `work-orders_communication/`** — sibling-of-artifact-tree gen↔reviewer transcript folders; one markdown file per agent. Written by generator and reviewer subprocesses; folder lifecycle managed by the orchestrator (mkdir-with-exists-ok; never wiped).
- **`harness/`** — orchestrator-owned state and logs. `harness/state/` for JSON state files (per-loop, per-WO) and reviewer review snapshots; `harness/logs/` for hook and session logs. The entire `harness/` tree is committed to git as a first-class project artifact.
- **`artifacts/`** — byproducts of work-order execution organised by folder slug (`artifacts/{folder-slug}/`).
- **`project-template/`** (kit-side, not project-side) — the reference skeleton operators clone when starting a new project.

Outbound boundaries: git commit history is the local audit trail; pushes to GitHub mirror it remotely (see @Blueprint(github)).

## System Contracts

### Key Contracts

- **Local files are the source of truth.** Every loop reads and writes through this tree. Mirrors (Software Factory, GitHub Projects) are optional outbound push targets, never alternative read paths.
- **No local versioning.** Files represent one current fact, not a history of that fact. Git history is the audit trail; mirrors handle their own versioning if they need it. No version fields embedded in artifact content or meta files.
- **Slug rules.** Lowercase-kebab-case identifiers, unique within siblings, derived from the node's title. Slugs never contain underscores; the `_children` suffix is reserved.
- **Visible/hidden split.** Generators write only visible `<slug>.md` content files (or `description.md` for work orders). The orchestrator owns dotted-hidden meta files; generators do not write them.
- **Feature blueprint slug parity.** `blueprints/features/<slug>.md` matches `requirements/features/<slug>.md` exactly. Load-bearing for downstream `blueprint-to-work-orders`.
- **Communication folders are siblings of artifact trees.** They live next to `requirements/`, `blueprints/`, `work-orders/`, not nested inside. The artifact tree is the deliverable; the conversation lives next door.
- **`harness/` is committed.** State files, reviewer review snapshots, logs (subject to retention policy) — all in git. The first-class project artifact.
- **State-file write-through.** Status updates write through to `.work-order.meta.yaml`. The orchestrator is the only writer of state files; the local-planner module is the only reader/writer of `.work-order.meta.yaml`.
- **Append-only communication files.** Within a loop invocation, both generator and reviewer append; never overwrite. The folder is never wiped — it accumulates the full conversation across attempts and across invocations.
- **No autonomous loop edits `PRD.md` or `BLUEPRINT.md`.** Both are operator-authored; loops read but never write.

### Integration Contracts

- **Layout schema.** Pinned in @Blueprint(on-disk-layout). Every directory's shape (visible content file + meta files + optional `<slug>_children/` for the requirements tree) is enforced by the orchestrator's #MetaMaterialiser and validated by reviewers via the `bp-coverage-judge`-style checks.
- **Meta file schema.** `.<slug>.<kind>.meta.yaml` carries `id: null`, `parent_id: null`, `position: <int>`, `title: <H1>`. `.<slug>.requirements.meta.yaml` carries `id: null` only. `.work-order.meta.yaml` carries `id`, `status`, `priority`, `type`, `parent_id`, `sort_order`, `blocked_by[]`, `blueprint_ids[]`. `.sequence.meta.yaml` carries blueprint-tree hash and generation timestamp.
- **State file schemas.** Per-loop and per-WO JSON shapes pinned in @Blueprint(state-store). Two distinct shapes sharing top-level fields (`current`, `history`, `attempts`, `verification`, `limits`).
- **Questions-pending file format.** Pinned in @Blueprint(questions-pending). Bare-question or with-options block formats; same convention across all three upstream loops.
- **Communication-file format.** Pinned in @Blueprint(communication-folder). Markdown-only, append-only, top-level `## ` headers tagging speaker and attempt number.
- **Git commit messages.** `<loop-name>: attempt <N> passed`, `<loop-name>: attempt <N> — awaiting_clarification`, etc.

### Integration Boundaries

- **Project repo vs orchestrator.** The orchestrator commits artifact trees (`requirements/`, `blueprints/`, `work-orders/`, `harness/`) and writes state files. It does not edit communication-file content; it manages folder lifecycle (ensure / snapshot) only.
- **Project repo vs Claude Code subprocesses.** Subprocesses read inputs and write outputs through filesystem operations. Generators have full read/write access; reviewers are constrained by `--disallowedTools` and the `PreToolUse` path-guard hook.
- **Project repo vs GitHub.** Push and PR creation cross this boundary. Local commits are first; pushes mirror them. Merge state is observed by reading `gh pr list`/`gh pr view` rather than by trusting any local mirror.
- **Project repo vs operator.** The operator authors `PRD.md` and `BLUEPRINT.md`, fills in `Your answer:` lines in `_questions-pending.md` files, and merges PRs via GitHub. Everything else under the project repo is autonomous-loop-managed.

## Architecture Decision Records

### ADR-001: Local files are the source of truth; mirrors are outbound-only

**Context.** Software Factory and similar systems offer entity stores with their own queues. The harness could plausibly read from such a store and write back, treating the local repo as a cache. That would simplify mirroring but commit the harness to availability and consistency guarantees of an external service.

**Decision.** Local files are the only canonical store. Mirrors push outbound; nothing reads from them. The on-disk layout mirrors Software Factory's entity model so upload is mechanical, but the harness never depends on the mirror being reachable.

**Consequences.** The harness works fully offline (after the model API call). Re-running a loop deterministically converges to the same on-disk state regardless of mirror state. Trade-off: cross-machine collaboration is harder — there is no "single global queue" — but the harness explicitly serves a single operator, so this is fine.

### ADR-002: Git as the only audit trail; no per-artifact versioning

**Context.** Each artifact (FRD, blueprint, work order) could carry an embedded version field, a changelog, or both. That would make history visible without `git log`. But it introduces a parallel versioning system that has to stay in sync with git.

**Decision.** Git is the sole audit trail. No version numbers in artifacts or meta files. Mirrors serialise the current state of disk only; external versioning is the mirror's concern.

**Consequences.** Looking up a change is one `git log` away. The artifact representation stays simple — one file is one current fact. Trade-off: mirrors cannot derive change semantics from artifact content alone; they have to track git refs themselves if they want history.

### ADR-003: One working tree, single sequential drain

**Context.** Multiple work orders could in theory run in parallel on isolated worktrees (`git worktree add`). That would give wall-clock throughput at the cost of coordinating concurrent reviewer fan-outs and concurrent state writes.

**Decision.** One working tree. The coding loop runs one work order at a time. Worktree-based parallelism is plausible but deferred until measured demand justifies the coordination complexity.

**Consequences.** State-file writes are simple (no concurrent writers). Reviewer fan-out happens within an attempt for one work order, parallelised inside the orchestrator's `ThreadPoolExecutor`, never across work orders. Trade-off: total wall-clock through-put is bounded by single-work-order pace; acceptable for a single-operator tool.

### ADR-004: `harness/` is a first-class artifact, committed to git

**Context.** State files and logs are runtime byproducts. A common posture is to gitignore them. But losing them means losing the ability to replay a loop run, audit a verdict, or build training data from real runs.

**Decision.** Commit the entire `harness/` tree. State files are never deleted; log files may be pruned on a documented retention policy. Snapshots of every reviewer review live under `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md`.

**Consequences.** The repo grows with run history, but state files are small JSON and reviewer snapshots are small markdown. Replay and audit become trivial. Trade-off: a long-running project accumulates noise in commits — mitigated by single-commit-per-loop-pass discipline (ADR in @Blueprint(python-orchestrator)).
