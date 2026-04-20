---
cssclasses:
  - wide-mermaid
---

# Coding Harness

## 1. Overview

A reusable harness for running long-horizon coding work through Claude Code autonomously, with verification as the primary correctness gate. The harness drives the Claude Code CLI as a subprocess from a Python orchestrator, pulls tasks from a canonical local layout (filesystem mirror of Software Factory's entity model — see §6.2), and enforces a layered verification stack (tests, spec-judge, behavioral) before any task is marked done.

Local files are the source of truth — for plans, blueprints, work orders, and execution state. They always exist regardless of which (if any) external backend is configured. External systems like Software Factory are optional outbound mirrors, never alternative queues.

The user plans and prioritizes tasks; the harness executes them.

## 2. Goals & Non-Goals

### Goals
- Solve verification as a first-class concern so long-running autonomous work becomes trustworthy.
- Drive Claude Code via its CLI to leverage the Claude Max subscription and inherit every Claude Code improvement for free.
- Keep the orchestration surface small: thin Python loop + rich in-session hooks/skills/agents.
- Local-first planner. The canonical task queue lives in `projects/{slug}/` as markdown + meta files, structured to mirror Software Factory's entity model so upload to SF (or any future external system) is mechanical.
- Pull-based execution: the user stays in the planning loop; agents only execute pre-defined work orders.
- Polished, self-maintainable documentation and code for long-term single-operator use.

### Non-Goals
- Multi-user, team, or OSS-release polish. Personal tool.
- Cross-agent portability (Cursor, Aider, Codex). Claude Code only.
- Autonomous sprint planning or task decomposition. The user decomposes work.
- L1-only or L2-only shapes. This is an L3 (autonomous loop) product.
- Token-level cost optimization. Subscription model; wall-clock time is the budget unit.
- Replacing Claude Code features (Plan Mode, subagents via Task tool) with reimplementations. Use them where they fit.

## 3. Design Principles

1. **Verification and generation quality are co-equal.** The harness must confirm that the agent did the thing (verification), *and* that the resulting code is maintainable enough to build on forever (quality). A passing test suite on unmaintainable code is a failure mode the harness must prevent.
2. **Claude Code is the runtime.** The orchestrator never makes direct Anthropic API calls. Every model interaction happens through `claude -p`.
3. **In-session work uses hooks; cross-session work uses Python.** Hooks are deterministic and reactive. The Python orchestrator is the only thing that initiates sessions, transitions state, and enforces budgets.
4. **The code is ground truth.** Reviewers never trust generator self-reports. They read `git diff` and run gates.
5. **Pull-based, not plan-based.** The harness never invents work. It consumes a queue the user maintains.
6. **Local files are the source of truth; external backends are optional outbound mirrors.** The canonical task queue, plans, blueprints, and execution state live in `projects/{slug}/` and `harness/`. The orchestrator always reads from and writes to local files. Software Factory (or any future system) is a sync target the orchestrator can push to, never the queue itself. Local persists regardless of which mirrors are configured.
7. **Machine-readable state for agents; human-readable artifacts for the operator.** Agents read and write JSON in `harness/state/`; the operator authors and reads markdown + meta files in `projects/`. A sync script projects updates into PR comments on GitHub (the unchanged code surface) and, when configured, into external mirrors.

## 4. Architecture

### 4.1 Component map

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 40, 'rankSpacing': 40, 'padding': 10}}}%%
flowchart TB
    Op([Operator])
    Local[(Local planner<br/>projects/{slug}/)]
    Repo[(GitHub repo<br/>commits, PRs, comments)]
    Mirrors[(Optional outbound mirrors<br/>Software Factory, ...)]

    subgraph Harness [Coding Harness]
      direction TB
      Orch[Orchestrator<br/>orchestrator/main.py]
      Gen[Generator session<br/>claude -p subprocess]
      Sync[Sync script<br/>orchestrator/sync.py]
      State[(harness/state/)]
      Logs[(harness/logs/)]

      Orch -->|spawns| Gen
      Orch -->|writes| State
      Orch -->|writes| Logs
      Sync -->|reads| State
    end

    Op -->|authors plans, blueprints,<br/>work orders| Local
    Op -->|reviews & merges PR| Repo
    Local <-->|work orders + status| Orch
    Gen -->|commits, opens PR| Repo
    Sync -->|mirrors state as PR comments| Repo
    Sync -.->|optional outbound sync| Mirrors
```

### 4.2 Layers of responsibility

| Concern | Owner |
|---|---|
| Task queue, priority, dependencies | Local planner (`projects/{slug}/work-orders/`) |
| Plans, FRDs, blueprints | Local planner (`projects/{slug}/features/`, `projects/{slug}/blueprints/`) |
| Next-task selection, status transitions, budget enforcement, session lifecycle | Python orchestrator |
| Cross-session memory, handoff context | `harness/state/<id>.json` |
| In-session enforcement: verification gates, formatting, context injection, preventing premature stop | Claude Code hooks |
| Reusable capabilities: how to write a plan, how to verify, how to review | Skills |
| Operator-invoked entry points | Slash commands |
| Role-specialized session prompts | Agents (`.claude/agents/*.md`) |
| Ground truth about what changed | Git |
| Human audit trail | GitHub PR comments + git history (via sync script) |
| External system mirrors (SF, etc.) | Sync script (outbound only, optional) |

## 5. Task Lifecycle

One ticket, end to end. Two phases: **planning** (shape the ticket) and **execution** (build the thing).

### 5.1 Planning phase

1. **Operator starts from a product document** (PRD, feature brief, prose). In a Claude Code session, invokes `prd-to-frds` to decompose it into per-feature FRDs (single-feature PRDs may skip this), then `frd-to-blueprint` per FRD to produce a feature blueprint, then `blueprint-to-tasks` per blueprint to break it into discrete work-order stubs. Reviews and edits at each step. Foundation/shared blueprints are authored separately via `foundation-blueprint-authoring` and referenced by feature blueprints to avoid duplication.
2. **Operator creates work-order files** at `projects/{slug}/work-orders/{phase-slug}/{wo-number}/` from those stubs. Each work order is a directory containing `description.md` plus a sibling `.work-order.meta.yaml` (id, status, priority, parent, sort-order, dependencies, blueprint links). Status starts at `backlog`.
3. **Operator fleshes out each work order** by invoking `scope-task` on it. This produces a body in the standard scoped-task format (§5.1.1) which is written into the work-order's `description.md`. Operator reviews and edits.
4. **Operator moves a work order to `ready`** by updating `status` in its `.work-order.meta.yaml` once the scope is solid enough for an autonomous generator to execute without asking questions.

#### 5.1.1 Scoped-task format

Every ticket body the generator executes against must be in this shape. The `scope-task` skill produces it; operators edit it in place. Consistent format means the generator always knows where to find each piece of information.

```markdown
## Goal
One sentence describing what this ticket delivers.

## In scope
- Bullet list of what is included.

## Out of scope
- Explicit list of what this ticket does NOT cover, especially things a reasonable reader might assume are included. Forces the scope boundary to be thought through.

## Depends on
- #<other-ticket> — one line explaining what this task needs from it.
(Empty if no dependencies.)

## Produces
- Interfaces, modules, artifacts, or contracts this ticket makes available for downstream tasks. What can other tickets assume exists after this is done?

## Acceptance criteria
- [ ] Observable outcomes, each verifiable by the reviewer's gates.
- [ ] ...

## Implementation notes (non-binding)
Optional. Hints about files, approach, libraries. Never prescriptive — the generator owns implementation choices.
```

**Scope is the load-bearing concept.** All scopes across all tickets must compose into the whole project without gaps or overlap. `In scope` + `Out of scope` + `Produces` are the fields that carry this contract. If scoping is sloppy, tasks either leave gaps (nothing covers area X) or double up (two tickets both produce X differently). Either failure mode wastes iteration cycles and produces incoherent code.

### 5.2 Execution phase
```mermaid
%%{init: {'flowchart': {'nodeSpacing': 40, 'rankSpacing': 40, 'padding': 10}}}%%
flowchart TB
    subgraph Plan [Planning]
      direction TB
      Op1([Operator])
      PRD[PRD<br/>overview/]
      PS0[prd-to-frds]
      FRD[FRDs<br/>features/*/requirements/]
      PS1[frd-to-blueprint]
      BP[Feature blueprints<br/>features/*/blueprint/]
      PS2[blueprint-to-tasks]
      PS3[scope-task]
      WO[(Backlog work orders<br/>work-orders/{phase}/{wo-n}/)]
      Op1 --> PRD
      PRD --> PS0
      PS0 --> FRD
      FRD --> PS1
      PS1 --> BP
      BP --> PS2
      PS2 --> WO
      PS3 --> WO
    end

    WO -. move to ready .-> Run([python -m orchestrator run])
    Run --> Orch{{Orchestrator}}
    Orch -->|spawn claude -p| Gen

    Gen["<b>Generator session</b><br/>━━━━━━━<br/><i>skills</i><br/>• autonomous-execution<br/>• open-task-pr<br/>━━━━━━━<br/><i>hook</i><br/>• Stop → spawn reviewers"]

    Gen -->|on Stop, Task-tool fan-out| Rev

    Rev["<b>Reviewer subagents</b><br/>━━━━━━━<br/>Tests<br/>Playwright<br/>spec-judge<br/>regression-judge<br/>security-judge<br/>quality-judge"]

    Rev --> D{All pass?}
    D -->|any fail| Gen
    D -->|all pass| Post{{Post-processing}}
    Post --> State[(State file)]
    Post --> PR[(GitHub PR)]
    State --> Merge([Operator merges PR])
    PR --> Merge
    Merge -.->|next task| Orch
```

The diagram shows the architecture you described: orchestrator spawns one generator session; the generator, on its `Stop` hook, fans out to reviewer subagents via the Task tool; verdicts fan back in to a decision node; fails loop back to the generator (same session, continues working), passes fall through to orchestrator post-processing.

Each reviewer subagent additionally pulls in `autonomous-execution` (omitted from the diagram for space — it's a universal dependency like the generator's).

4. **Operator invokes the orchestrator.** It queries the local planner, takes the topmost ready work order, moves it to `in_progress` (writes through to `.work-order.meta.yaml`), and initializes `harness/state/<task_id>.json` with `execution.branch = "task/<task_id>"`. Exits cleanly if no ready work orders.
5. **Orchestrator spawns one generator session** — `claude -p "<prompt>"` with the work-order description and scoped-task contents injected inline. A single subprocess per task; the generator handles the gen/review cycle internally.
6. **Generator does the work** on branch `task/<task_id>`. On its first pass it commits, pushes, and opens a PR (title from the work order, body referencing the work-order id and path — no `Closes #N` since the queue is local, not GitHub Issues). Its `autonomous-execution` posture means it proceeds without asking questions or waiting for input.
7. **Generator fans out reviewer subagents via the Task tool** when it believes its pass is ready for verification. One subagent per gate: `tests`, `playwright`, `spec-judge`, `regression-judge`, `security-judge`, `quality-judge`. Each subagent runs in a fresh Claude Code context with only the inputs its gate needs (diff, ticket body, etc.) and returns a structured verdict (`pass | fail | not_run`) plus a short rationale.
8. **Generator aggregates the verdicts** from all reviewer subagents.
    - **If any gate `fail`:** the generator reads the rationales, makes fixes, pushes more commits, and fans out the reviewer subagents again. This retry loop is internal to the generator session — no new `claude -p` subprocess is spawned.
    - **If all gates `pass`:** the generator emits a final summary to stdout and exits.
    - **Budget:** the orchestrator enforces a wall-clock cap on the generator subprocess as the outer backstop. Inside, the generator is told to try-and-fix until it runs out of time or verdict cycles.
9. **Orchestrator post-processes the generator session** (one time, after it exits):
    - Runs `gh pr list --head task/<task_id>` to populate `execution.pr_url` and `execution.pr_number`.
    - Captures stdout into `current.last_output`; rotates the prior `current` to `history`.
    - Posts the final summary as a PR comment.
10. **Operator reviews the PR and merges** when satisfied. The harness never auto-merges.
11. **On the next orchestrator invocation**, the orchestrator checks each `in_progress` work order for a merged PR (matched by branch name `task/<task_id>`); any it finds are transitioned to `done` in the local `.work-order.meta.yaml`. Then it picks up the next ready work order. Queue drain continues until nothing is ready.

#### 5.2.1 Gap filing

Any execution-phase session can file a gap work order when it encounters out-of-scope missing work. The capability is how the harness stays honest about what it's seeing without blowing the current work order's scope.

**When it fires** (agent judgment, guided by `autonomous-execution`):
- Generator finds a prerequisite that isn't in place ("this endpoint needs a shared auth middleware that doesn't exist yet; not in scope for this work order").
- Generator notices a latent bug adjacent to the area being changed.
- Reviewer sees a concern outside the work order's declared `In scope` — code smell, test gap, security issue in unrelated code — something important but not this work order's job.

**What the agent does:** calls the `file-gap` skill with a title, a body describing the gap, and (optionally) a category hint like `refactor | bug | security | infra`.

**What the skill does mechanically:**
1. Allocates the next `wo-<n>` number for the project.
2. Creates `projects/{slug}/work-orders/_inbox/{wo-n}/` containing `description.md` (the body) and `.work-order.meta.yaml` (`status: backlog`, `type` from the category hint, `parent_id` set to the originating work order's id).
3. Description includes a back-reference (e.g. `Discovered while working on wo-42`).
4. Returns the new work order's path to the agent so it can mention it in its final output.

**What the skill does NOT do:**
- Does not promote the gap to `ready` — operator triages.
- Does not affect the current iteration's verdict — gap filing is a side effect, not a gate signal.
- Does not trigger a new session — the orchestrator ignores the new work order until a future `run` picks it up (and only if the operator moves it to `ready` and assigns it to a real phase).
- Does not dedupe (v1). If two sessions file similar gaps, both exist. Operator merges/closes during triage.

**Where gaps show up:**
- Local planner: under `projects/{slug}/work-orders/_inbox/`, distinguished by their `_inbox` phase placement and `parent_id` back-reference.
- Originating PR: the agent mentions `Filed wo-99 for [...]` in its prose, which lands in the PR comments.
- State file `history[]`: the prose is preserved there too.

**Guardrails for in-scope vs gap:** the agent checks the work order's `In scope` / `Out of scope` fields (§5.1.1) before filing. If the work plausibly falls under the current work order's scope, it's in-line — don't file. If it's plausibly out, file. When ambiguous, file (cheap, reversible) and continue.

## 6. Components

### 6.1 Python orchestrator

Entry point: `python -m orchestrator run` or `make run`.

Responsibilities:
- Load `config.yaml` (project root, mirrors, repo, caps, paths).
- Instantiate `LocalPlanner(project_root)` and any configured `Mirror` adapters.
- Main flow (invoked by the operator; not a daemon):
  1. Detect any `in_progress` work orders whose PR was merged since the last run (matched by branch name `task/<task_id>`). For each, `planner.update_status(task_id, "done")` and notify mirrors.
  2. `planner.get_next_ready()` — returns work order or None.
  3. If None: exit 0.
  4. `planner.update_status(task_id, "in_progress")` and notify mirrors.
  5. Initialize or load `harness/state/<task_id>.json`; set `execution.branch = "task/<task_id>"`.
  6. Build generator prompt (work-order description + scoped-task body + any prior `current.last_output` + branch info) and spawn `claude -p "<prompt>"` as a single subprocess. Generator handles the gen/review retry loop internally via Task-tool reviewer subagents.
  7. Enforce a wall-clock cap on the subprocess; kill and mark the task as `exhausted` if it exceeds the cap.
  8. After the subprocess exits:
     - `gh pr list --head task/<task_id>` → populate `execution.pr_url` / `execution.pr_number`.
     - Rotate state: prior `current` → `history`; new `current.last_output` = captured stdout.
     - Post `current.last_output` as a PR comment.
  9. By default, drain the queue: repeat from step 1 until no `ready` work orders remain. A `--one` flag stops after a single task.

Scope constraints:
- No direct LLM calls. All model interactions happen via `claude -p` subprocesses.
- No edits to application source files. Only writes inside `harness/`.
- Everything else is permitted: subprocess management, prompt construction, stdout capture, state-file rotation, `gh`/`git` queries to refresh `execution.pr_*` and detect merges, PR comment posting, status transitions.

Target: ≤ 400 lines of Python. The inner gen/review loop moving into the generator session cuts orchestrator surface substantially.

### 6.2 Local planner + optional outbound mirrors

The canonical task queue lives on disk under `projects/{slug}/`. The orchestrator reads from and writes to this layout directly — there is no abstraction layer between the orchestrator and the local files, because there is only one queue. The pluggability that previously sat at the queue level moves to a separate, optional outbound sync layer: zero or more `Mirror` adapters that push local state to external systems (Software Factory, GitHub Projects, etc.). Mirrors are convenience; local persists regardless.

#### 6.2.1 On-disk layout

The shape mirrors Software Factory's entity model so that upload to SF (or any system that adopts a similar shape) is mechanical:

```
projects/{slug}/
  features/{feature-slug}/
    .feature.meta.yaml                  # id, parent_id, position
    requirements/
      document.md                       # FRD
      .requirements.meta.yaml           # id, feature_id
    blueprint/
      document.md                       # feature blueprint
      .blueprint.meta.yaml              # id, blueprint_type=FEATURE, feature_node_id
      code-links/                       # BlueprintCodeChunkLink rows (deferred)
    children/                           # nested FeatureNodes (recursive)
  overview/{section-slug}/...           # PRD / Product Overview tree
  blueprints/{blueprint-slug}/...       # Foundation + System Diagram blueprints
  work-orders/{phase-slug}/
    .phase.meta.yaml                    # phase id, name, sort_order
    {wo-number}/
      description.md                    # scoped-task body (§5.1.1)
      .work-order.meta.yaml             # id, status, priority, type, parent_id, sort_order, blocked_by[], blueprint_ids[]
      children/                         # subtasks
  artifacts/{folder-slug}/...           # Artifact folder tree
```

A reference skeleton lives at `projects/_template/` for cloning. Risks inherent to mirroring a DB shape onto a filesystem (FK resolution at upload time, mutual-exclusivity validation, ordering encoded in metadata not filename order) are upload-API concerns and don't affect local read/write.

**Versioning:** none locally. Git history is the audit trail. SF maintains immutable per-save snapshots (`RequirementsDocumentVersion`, `BlueprintDocumentVersion`, `WorkOrderVersion`); when the upload API ships, the mirror serializes only the current document state and lets SF create the version on its end.

#### 6.2.2 Local planner module

A thin Python module (`orchestrator/planner.py`) reads and writes the on-disk layout. Single concrete class — no Protocol, no plug-in surface — because there is only one queue.

```python
Status = Literal["backlog", "ready", "in_progress", "in_review", "done"]

class WorkOrder(TypedDict):
    task_id: str                  # "wo-42", scoped within project
    title: str
    description_markdown: str     # full description.md contents
    status: Status
    priority: str | None
    type: str | None              # BUILD | FIX | REQUIREMENTS | BLUEPRINT | ARTIFACT | OTHER
    phase_id: str | None
    parent_id: str | None
    sort_order: str               # lexicographic, for stable ordering
    blocked_by: list[str]
    blueprint_ids: list[str]
    path: Path                    # absolute path to the work-order directory

class LocalPlanner:
    def __init__(self, project_root: Path): ...
    def get_next_ready(self) -> WorkOrder | None: ...
    def get(self, task_id: str) -> WorkOrder: ...
    def update_status(self, task_id: str, status: Status) -> None: ...   # writes through to .work-order.meta.yaml
    def get_ordered_ready(self) -> list[WorkOrder]: ...
```

Status updates are written directly to `.work-order.meta.yaml`. The orchestrator is the only writer. Git history is the audit trail — no separate event log needed.

#### 6.2.3 Optional outbound mirrors

A mirror is a one-way adapter that pushes local state to an external system. Mirrors are configured in `config.yaml` and called by the orchestrator at well-defined trigger points (status transition, PR merge, comment post). Zero mirrors is a valid configuration — local-only is the v0.1 default.

```python
class Mirror(Protocol):
    """Outbound sync. Reads local state; writes to an external system."""
    def push_status(self, work_order: WorkOrder) -> None: ...
    def push_comment(self, work_order: WorkOrder, body: str) -> None: ...
```

Planned mirrors:
- `software_factory.py` — pushes work-order status and comments to SF via its upload API once it ships. Already structurally compatible because the local layout mirrors SF's entity model.
- `github_projects.py` — optional read-mostly mirror that surfaces a kanban view on GitHub when off-laptop visibility matters. Deferred.

Mirror constraints:
- One-way only in v1 (push). Inbound sync (operator edits the kanban → local files update) is deferred and may never be built.
- Failures are logged but never block orchestrator progress. Local is the source of truth; mirrors are convenience.
- A mirror failure does not roll back local state. The next successful push reconciles.

`config.yaml` example:

```yaml
project:
  root: projects/billing-revamp

mirrors:                           # empty list = local-only (v0.1 default)
  - kind: software_factory
    base_url: https://sf.internal
    project_id: 0f1e2d3c-4b5a-6978-8765-432101234567
```

#### 6.2.4 Code surface (unchanged)

Code-level operations — branch, push, PR open, PR comment — are always GitHub via `gh` and `git`, wrapped in `orchestrator/git_ops.py`. Not abstracted; not a "backend." The local planner does not know about PRs, and the git layer does not know about work-order metadata. The orchestrator stitches them together.

### 6.3 State file schema

One file per task at `harness/state/<task_id>.json`. Owned by the orchestrator; updated by hooks inside sessions.

The entire `harness/` directory (`state/`, `logs/`, `cache/`, `index.md`) is **committed to git**. It is a permanent record of every task, every iteration, every verdict, and every hook firing — treated as first-class project artifact, not runtime scratch. Future uses include training data, fine-tuning signals, failure-mode analysis, and operator audit. Log files are the only entries that may be compressed or pruned on a documented retention policy; state files are never deleted.

Format:

```json
{
  "task_id": "wo-42",
  "local": {
    "title": "Add login endpoint",
    "project_slug": "billing-revamp",
    "phase_slug": "phase-1-core",
    "path": "projects/billing-revamp/work-orders/phase-1-core/42/",
    "blueprint_ids": ["bp-uuid-1"]
  },
  "created_at": "2026-04-18T10:00:00Z",
  "updated_at": "2026-04-18T10:45:12Z",
  "status": "in_progress",
  "session_count": 1,

  "limits": {
    "max_wall_minutes": 120
  },

  "execution": {
    "branch": "task/wo-42",
    "pr_url": "https://github.com/owner/repo/pull/123",
    "pr_number": 123
  },

  "current": {
    "last_role": "generator",
    "last_output": "Ran all six reviewer subagents after three internal fix passes.\n\nRound 1: tests pass, spec-judge failed on acceptance criterion 2 — /login accepted empty passwords. Added pydantic validation and a test for empty/missing fields.\n\nRound 2: spec-judge passed, quality-judge flagged duplication between validation logic in /login and /signup. Extracted shared validator into auth/validators.py.\n\nRound 3: all six gates passed. PR https://github.com/owner/repo/pull/123 is ready for operator review."
  },

  "verification": {
    "tests":              { "result": "pass", "ran_at": "2026-04-18T10:43:00Z" },
    "playwright":         { "result": "pass", "ran_at": "2026-04-18T10:44:00Z" },
    "spec_judge":         { "result": "pass", "ran_at": "2026-04-18T10:44:10Z" },
    "regression_judge":   { "result": "pass", "ran_at": "2026-04-18T10:44:20Z" },
    "security_judge":     { "result": "pass", "ran_at": "2026-04-18T10:44:30Z" },
    "quality_judge":      { "result": "pass", "ran_at": "2026-04-18T10:44:40Z" }
  },

  "history": [
    { "session": 1, "at": "2026-04-18T10:45:00Z", "verdict": "pass", "output": "(full text of the generator's final summary for this session)" }
  ],

  "mirror": {
    "last_posted_session": 1,
    "last_mirrored_at": "2026-04-18T10:45:30Z"
  }
}
```

Field rules:
- `task_id` is the harness-stable identifier used everywhere in `harness/` paths, log names, and cross-references. Format: `wo-<n>` (per-project work-order number).
- `local.*` is a denormalized snapshot of the work order's location and identity in `projects/{project_slug}/`. Refreshed by the orchestrator from `.work-order.meta.yaml` on every read; never edited by hand. The on-disk meta file is canonical; this block is a convenience copy.
- `status` uses the canonical enum: `backlog` | `ready` | `in_progress` | `in_review` | `done`. Mirrors `.work-order.meta.yaml`.
- `session_count` — how many generator sessions this task has required. Usually 1; increments only if the orchestrator has to respawn (timeout, crash).
- `limits.max_wall_minutes` — outer time cap on the generator subprocess. The orchestrator kills the subprocess if it exceeds this. Internal retry count is not capped explicitly; wall time is the backstop.
- `current.last_output` — the full verbatim stdout of the most recent generator session.
- `current.last_role` — always `generator` (reviewer subagents don't produce top-level output). Retained for forward compatibility if we ever add other top-level roles.
- `verification.<gate>.result` — populated by the orchestrator from the generator's final VERDICT block. Each `pass | fail | not_run`.
- `history` — append-only, one entry per generator session. Carries the full `output` text and the session-level `verdict` (`pass | fail | exhausted`). Powers replay, audit, and future training data. Never truncated in place.
- `execution.branch` is set by the orchestrator before spawning. `execution.pr_url` / `pr_number` are populated after the subprocess exits via `gh pr list`.
- `mirror.last_posted_session` tracks which `history[]` sessions have been mirrored as PR comments. (External-system mirrors per §6.2.3 maintain their own per-mirror cursors; not stored here.)
- All timestamps are ISO 8601 UTC.
- Schema version implicit in the harness version; breaking changes require a migration step documented in the release notes.

**Write access:**
- The **orchestrator is the only writer** of the state file.
- Per task: orchestrator spawns generator → generator runs (including internal reviewer fan-outs) → generator exits → orchestrator captures stdout, parses gate verdicts, rotates `current` into `history`, refreshes `execution.pr_*`, posts PR comment. Single rotation per orchestrator invocation per task.
- The generator is told in its prompt to end its final message with a structured summary of the per-gate outcomes (see §6.5) so the orchestrator can populate `verification.*` deterministically.
- Per-reviewer-subagent outputs are not directly written to the state file. They live in the Claude Code session transcript (which Claude Code persists on its own) and are referenced by the generator's final summary. If per-subagent persistence is later wanted, a `SubagentStop` hook can capture each subagent's return value into a sibling log file.

### 6.4 Skills

Installed under `.claude/skills/`. Each is a short `SKILL.md` describing when and how to apply it.

**Skills are for LLM-driven work only.** Deterministic mechanics (state-file rotation, iteration counting, history appending, PR comment posting) live in the orchestrator, not in skills. A skill exists in one of two shapes:

- **Tool-wrappers** — reusable "here is how to do X" instructions plus a thin CLI recipe. The agent decides *when* to use the tool; the skill documents *how* consistently.
- **LLM-as-judge** — pure prompting skills that produce a verdict. The judgment is the skill.

**Orientation skill** (pulled in by every autonomously-invoked agent — generator, reviewer, any future execution-phase agent):

- `autonomous-execution` *(orientation)* — sets the baseline posture for any session spawned via `claude -p`:
  - No human is listening. No questions will be answered.
  - When uncertain, make a reasonable decision with the information available and proceed. Prefer action over deliberation.
  - Never end the session by asking a clarifying question, proposing a plan, or waiting for approval. Execute.
  - Read the full state file and prior output before acting; the previous iteration usually contains the signal you need.
  - Be decisive about naming, structure, and stylistic choices. Don't hedge.
  - Block only if truly stuck (missing auth, broken tool, contradiction in the ticket). When blocked: document what you tried, what's missing, and what decision would unblock you, then stop. The orchestrator treats this as a failed iteration.

**Execution-phase skills:**

- `open-task-pr` *(tool-wrapper)* — how the generator opens a PR on its first internal pass: branch naming (`task/<task_id>`), commit, push, `gh pr create` with a standard title drawn from the work order and a body referencing the work-order id and local path. Idempotent (safe to call if a PR already exists). The orchestrator does not depend on this skill running — it always re-checks branch state via `gh pr list` afterward.
- `file-gap` *(tool-wrapper)* — any execution-phase agent calls this when it discovers missing work (a prerequisite that wasn't scoped, a supporting abstraction needed, a latent bug found, a refactor that would unblock this or future work orders). Creates a new local work order in `projects/{slug}/work-orders/_inbox/{wo-n}/` with `status: backlog` and a body that references the originating work order. The operator triages these on their own cadence; they never auto-enter the execution queue.
- `run-playwright-check` *(tool-wrapper)* — how to run Playwright against a locally-booted dev server and interpret exit codes, using a standard `scripts/with_server.py`-style wrapper.
- `spec-judge` *(LLM-as-judge)* — compares `git diff` to the acceptance-criteria checklist and returns per-criterion pass/fail with reasoning. Invoked by the generator as a Task-tool subagent.
- `regression-judge` *(LLM-as-judge)* — assesses whether the diff breaks or endangers code outside the changed lines (sibling call sites, shared utilities, implicit contracts, tests not modified but now exercising changed paths). Invoked by the generator as a Task-tool subagent.
- `security-judge` *(LLM-as-judge)* — scans the diff for injection, auth/authz gaps, secret handling, input validation at boundaries, crypto misuse, unsafe deserialization, SSRF, common OWASP patterns. Invoked by the generator as a Task-tool subagent.
- `quality-judge` *(LLM-as-judge)* — assesses structural and textual maintainability: module boundaries, layering, coupling, abstraction level; and naming, duplication, dead code, test quality, API shape, convention adherence. Invoked by the generator as a Task-tool subagent.

Each judge runs as a Task-tool subagent in a fresh Claude Code context — the judge only sees the inputs the generator passes it (diff, ticket, etc.), not the generator's session history. Each subagent's return value feeds back into the generator; the generator aggregates all six into its final summary.

**Generator ↔ reviewer communication** happens inside the generator's session, via Task-tool fan-out and return values. Each reviewer subagent returns its verdict + reason to the generator directly. No state-file round-trip needed within a task. The state file still persists the end-of-task summary across tasks for operator review and future training data.

**Planning-phase skills** (operator-driven, in ad-hoc Claude Code sessions, no state file involved):

- `prd-authoring` *(LLM work)* — interactive PRD (Product Overview) authoring. Helps the operator draft and refine `projects/{slug}/overview/{section}/requirements/document.md`. Optional — operators can write the PRD by hand.
- `prd-to-frds` *(LLM work)* — decomposes a PRD into a set of FRDs (Feature Requirements Documents), one per feature. Each FRD lands at `projects/{slug}/features/{feature}/requirements/document.md`. For single-feature PRDs the operator may skip this and treat the PRD as the FRD.
- `frd-to-blueprint` *(LLM work)* — takes one FRD and produces a feature blueprint that resolves architectural decisions (data model, API contracts, library choices, module layout). Reads `projects/{slug}/blueprints/` first to reuse foundation/shared blueprints instead of duplicating shared concerns. Output: `projects/{slug}/features/{feature}/blueprint/document.md`.
- `foundation-blueprint-authoring` *(LLM work)* — interactive authoring of project-wide blueprints — foundation patterns (auth, data model, error handling) and system diagrams. Output lands at `projects/{slug}/blueprints/{slug}/document.md` with `blueprint_type` set to FOUNDATION or SYSTEM_DIAGRAM in the meta file.
- `blueprint-to-tasks` *(LLM work)* — takes an approved feature blueprint (with the corresponding FRD as secondary context) and proposes a set of discrete work-order stubs that together deliver it. Output: a numbered list of stubs (titles + one-line goals), grouped into phases. Operator reviews, edits, and creates them as work-order directories under `projects/{slug}/work-orders/{phase}/{wo-n}/`.
- `scope-task` *(LLM work)* — takes one raw work-order idea and produces a fully-scoped body in the standard format (see §5.1.1), written to the work order's `description.md`. The scope is the load-bearing part: all scopes across all work orders must compose into a coherent project without gaps or double-coverage. This skill encodes the discipline — it forces explicit `In scope` / `Out of scope` lines, names dependencies, and commits to the interfaces the work order produces for downstream work.

**Not skills** (and why):

- State-file rotation, history append, iteration counter, PR comment mirror, `execution.pr_*` refresh, status column transitions — all deterministic, all orchestrator code.
- Verdict parsing — deterministic trailer parse; orchestrator code.

### 6.5 Hooks

Configured in `.claude/settings.json`. All hooks log to `harness/logs/<task_id>/hooks.log`.

Hooks only do work that **must** happen inside the session — context the orchestrator cannot provide from outside. State management stays in the orchestrator.

- **`Stop` (generator)** — signals completion to the orchestrator; triggers the reviewer fan-out phase. No validation logic here in v1.
- **`Stop` (reviewer subagents)** — defensively checks that each reviewer's output ends with a valid verdict line. If missing or malformed, the hook blocks completion with an error message telling the agent to append the verdict. Catches the failure mode where a reviewer forgets or mangles the verdict, so the aggregator doesn't have to guess.

Not hooks (and why):

- Context injection at session start — the orchestrator builds the full prompt (ticket body, scoped-task body, prior `current.last_output` if any) and passes it as the argument to `claude -p`. No `SessionStart` hook needed.
- State rotation, `history` appending, iteration counting — orchestrator, after the subprocess exits.
- PR comment mirroring — orchestrator (or a separate sync pass).
- `SessionEnd` — nothing for hooks to do; the orchestrator owns post-session work.

**Output formats.**

*Generator final summary.* The generator's system prompt instructs it to end its final message (when it has decided all gates pass and it's exiting) with:

```
VERDICT:
tests: pass | fail | not_run
playwright: pass | fail | not_run
spec_judge: pass | fail | not_run
regression_judge: pass | fail | not_run
security_judge: pass | fail | not_run
quality_judge: pass | fail | not_run
```

All six keys must be present. The generator aggregates these from the reviewer subagents it ran most recently. Everything before this block is free-form prose (the generator's narrative across the session — what it built, what each reviewer round surfaced, what it fixed) and becomes `last_output`. The block itself is parsed deterministically by the orchestrator.

*Reviewer subagent return value.* Each reviewer subagent (spawned via Task tool) is instructed to end its own return message with:

```
VERDICT: pass | fail | not_run
REASON: <one-sentence summary>
```

The generator reads these to aggregate into its own final summary. The `Stop` hook on reviewer subagents validates this two-line format is present.

### 6.6 Agents

Under `.claude/agents/`. Role-specialized prompts. Split by phase.

**Execution-phase — top-level agent.** Spawned by the orchestrator as a `claude -p` subprocess. Pulls in `autonomous-execution`. May call `file-gap`.

- `generator` — implements a task end-to-end in a single session. Receives ticket + scoped-task body in the prompt. Writes code on `task/<task_id>`. Opens the PR on the first pass. When it believes its code is ready, fans out the reviewer subagents (§6.6 below) via the Task tool, aggregates their verdicts, fixes on any fail, and re-runs reviewers until all pass or time runs out. Emits a final summary (with the VERDICT block) and exits.

**Execution-phase — reviewer subagents** (invoked by the generator via Task tool, not by the orchestrator). Each runs in a fresh Claude Code context. Each pulls in `autonomous-execution` and returns a `VERDICT` / `REASON` two-line tail.

- `tests-runner` — runs `make test` (or equivalent) and reports pass/fail based on exit code. Thin wrapper; the "judgment" is just the test outcome.
- `playwright-runner` — runs the Playwright suite via `run-playwright-check` and reports.
- `spec-judge` — LLM-as-judge over `git diff` vs acceptance criteria.
- `regression-judge` — LLM-as-judge over `git diff` + sibling code for unintended breakage.
- `security-judge` — LLM-as-judge over `git diff` for OWASP-class issues.
- `quality-judge` — LLM-as-judge over `git diff` for structural + textual maintainability.

**Planning-phase agents** (operator-invoked, interactive Claude Code sessions, no state file). These are thin wrappers around the planning skills for convenience.

- `task-breakdown` — drives the full planning chain (`prd-to-frds` → `frd-to-blueprint` → `blueprint-to-tasks`): takes a product document and produces a list of work-order stubs for the operator to review and turn into work-order directories.
- `task-scoper` — drives `scope-task`: takes one work order and fleshes its `description.md` into the standard scoped-task format (§5.1.1).

**Utility:**

- `index-updater` — regenerates `harness/index.md` from the local planner state. Invoked on a schedule and after any status transition.

## 7. Verification Stack

All six gates run as Task-tool subagents fanned out by the generator whenever it's ready to verify. Any gate failing sends the generator back to fix; all six passing lets the generator exit successfully. Gates enforce correctness (did it do the thing), safety (is it secure), and maintainability (is the code worth keeping — structurally and textually).

Gates divide into:
- **Execution gates** (deterministic; the subagent runs a command and reports exit code): `tests`, `playwright`.
- **LLM-as-judge gates** (the subagent reads the diff and emits a verdict based on a focused prompt): `spec_judge`, `regression_judge`, `security_judge`, `quality_judge`.

Each subagent runs in a fresh Claude Code context, so judges do not cross-contaminate and the generator's session context doesn't balloon with reviewer transcripts.

### 7.1 Gate 1 — Tests *(execution)*
- **What:** existing and newly-added test suites pass. Enforced via `make test`.
- **Signal:** exit code + `pytest`/equivalent output.
- **Blocking:** yes. Non-zero exit = fail.

### 7.2 Gate 2 — Playwright *(execution)*
- **What:** the running application behaves as the ticket specifies. A Playwright script exercises the feature end-to-end.
- **Signal:** Playwright exit code + screenshot/trace artifacts.
- **Blocking:** yes if the ticket has any UI-visible acceptance criterion. Skipped otherwise (detected by checklist content or a `skip-playwright` label).
- **Implementation:** `run-playwright-check` skill. Uses a standard `scripts/with_server.py`-style wrapper that boots the dev server, runs the test, and tears down.

### 7.3 Gate 3 — Spec judge *(LLM)*
- **What:** LLM-as-judge comparing `git diff` against the acceptance-criteria checklist.
- **Signal:** overall `pass` | `fail` | `not_run`. Per-criterion reasoning lives in the subagent's return value (surfaced through the generator's final summary).
- **Blocking:** `fail` = fail.
- **Implementation:** `spec-judge` skill. Reads only the ticket, the diff, and the acceptance criteria. Fresh context.

### 7.4 Gate 4 — Regression judge *(LLM)*
- **What:** LLM-as-judge assessing whether the diff breaks or endangers code outside the changed lines. Focuses on: shared utilities the diff modified, sibling call sites that rely on changed signatures, existing tests that weren't updated but now exercise changed paths, implicit contracts (types, docstrings, README claims).
- **Signal:** overall `pass` | `fail` | `not_run`. Specific risks live in `last_output`.
- **Blocking:** `fail` = fail.
- **Implementation:** `regression-judge` skill. Reads the diff, the list of files the diff touches, and the contents of files that *reference* those files (via grep/import graph). Fresh context.

### 7.5 Gate 5 — Security judge *(LLM)*
- **What:** LLM-as-judge scanning the diff for security problems: injection (SQL, shell, template), auth/authz gaps, secret handling, input validation at boundaries, crypto misuse, unsafe deserialization, SSRF, common OWASP Top 10 patterns.
- **Signal:** overall `pass` | `fail` | `not_run`.
- **Blocking:** `fail` = fail.
- **Implementation:** `security-judge` skill. Reads the diff with attention to boundaries (request handlers, shell-out, DB calls, file I/O). Fresh context.

### 7.6 Gate 6 — Quality judge *(LLM)*
- **What:** LLM-as-judge assessing long-term maintainability across two levels — **structural** (module boundaries, layering, coupling, correct placement, abstraction level — "is this the right shape?") and **textual** (naming, duplication, dead code, over-abstraction, test quality, public API shape, adherence to nearby repo conventions — "will I still want to read this in 6 months?").
- **Signal:** overall `pass` | `fail` | `not_run`.
- **Blocking:** `fail` = fail. The generator reads the subagent's rationale and fixes in the next internal iteration.
- **Implementation:** `quality-judge` skill. Reads the diff, a view of the repo's top-level module/directory structure (for structural judgment), and a small sample of surrounding code (for convention detection). Explicitly does *not* re-verify correctness — that's for gates 1–4.

### 7.7 Gate ordering and short-circuiting
Fastest-first: tests → playwright → spec-judge → regression-judge → security-judge → quality-judge. A short-circuit on any failure skips slower gates for the current iteration.

Judges may also run in parallel if the implementation supports it (e.g. Task-tool fan-out). Order matters only for the fail-fast short-circuit.

### 7.8 On pass
- Reviewer's VERDICT trailer has all six gates = `pass`.
- The PR already exists (generator opened it on its first internal pass).
- Orchestrator posts a final pass-comment on the PR summarizing the verdict, and notifies the operator that the PR is ready for merge.
- Status stays `in_progress` until the operator merges the PR. On merge, the next `python -m orchestrator run` detects the merged PR (matched by branch name `task/<task_id>`) and updates the work order's `.work-order.meta.yaml` to `done`.
- Merge is always operator-driven. The harness never auto-merges.

## 8. Deferred / Open Questions

- **Software Factory mirror.** Outbound sync to SF deferred until SF ships an upload API. Local layout already mirrors SF's entity model so the integration is mechanical when ready. Independently, the operator periodically diffs SF's prompt/skill repository against local prompts in ad-hoc Claude Code sessions to harvest improvements; no harness tooling needed for this practice.
- **GitHub Projects mirror.** Optional read-mostly board view for off-laptop visibility. Deferred; build only if the absence of a kanban surface becomes a real friction.
- **Distribution mechanism.** Copy-per-project initially. Reconsider as a Claude Code plugin, Python package, or git submodule after the second project.
- **Failure-recovery heuristics.** When should the orchestrator respawn a generator vs give up? Start with a single wall-clock cap and manual operator triage on exhaustion; refine based on observed failure modes.
- **Multiple concurrent tasks.** v1 runs one task at a time. Worktree-based parallelism is plausible but deferred.
- **Review column.** Omitted from the status model for v1. Add if PR review becomes a meaningful bottleneck.
- **Blocked state.** Omitted as a status. Dependencies are encoded in `.work-order.meta.yaml.blocked_by[]` and respected by `LocalPlanner.get_next_ready()`, but not surfaced as a distinct lifecycle state.
- **Non-web task shapes.** Behavioral gate is web-shaped via Playwright. Library/CLI-shaped tasks need a different behavioral surface (pure `pytest` output suffices for some; TBD).
- **Inbound mirror sync.** All planned mirrors are push-only in v1. Pulling external edits (e.g. operator changes a SF status from the SF UI) back into local files is deferred; may never be built if local stays the canonical edit surface.

## 9. Milestones

### v0.1 — End-to-end skeleton
- Local planner (`projects/{slug}/work-orders/`) as the queue. No external mirrors.
- One-task-at-a-time.
- Generator session driven by the orchestrator; reviewer subagents driven by the generator via Task tool. All pull in `autonomous-execution`.
- Tests gate only.
- Generator opens the PR on its first internal pass.
- Sync script posts each history entry as a PR comment.
- State file schema implemented.
- Hooks: `Stop` on reviewer subagents validates verdict line.
- `file-gap` skill wired up (creates a new local work order in `backlog`, no dedup).

### v0.2 — Spec + quality judges
- `spec-judge` gate live.
- `quality-judge` gate live (covers structural + textual).
- Status transitions fully automated end-to-end.

### v0.3 — Behavioral gate
- Playwright gate live for web tasks.
- Wall-clock budget cap enforced on generator subprocess.
- `index-updater` agent and `harness/index.md`.

### v0.4 — Regression + security judges
- `regression-judge` gate live.
- `security-judge` gate live.
- Parallel judge execution via Task-tool fan-out (if it pays off).

### v1.0 — Polish
- Software Factory mirror (when SF ships an upload API).
- Planning-phase skills: `prd-authoring`, `prd-to-frds`, `frd-to-blueprint`, `foundation-blueprint-authoring`, `blueprint-to-tasks`, `scope-task`.
- Operator documentation (`README.md`, `docs/` with runbook).
- Failure-mode catalog based on first 20 real tasks.

---

*Version: 0.1-draft · Last updated: 2026-04-19*
