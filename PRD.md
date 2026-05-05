---
cssclasses:
  - wide-mermaid
---

# Coding Harness

## 1. Overview

A reusable harness for running long-horizon software engineering work through Claude Code autonomously, with verification as the primary correctness gate. The project goes through four stages — one manual, three autonomous:

1. **Manual PRD authoring.** Operator writes a single `PRD.md` at the project repo's root with the `prd-authoring` skill (interactive, Claude-assisted). One monolithic prose document.
2. **Requirements Loop** (autonomous, with non-blocking clarification questions). Reads the root `PRD.md` and decomposes it into the full structural tree: product-overview sections (business problem, personas, product description, success metrics, etc. — the `requirements/overview/` tree) *and* Feature Requirements Documents (`requirements/features/` tree). Reviews against four rubrics (spec structure, cross-doc consistency, PRD-coverage, feature scoping) and iterates until all pass. When the PRD itself is ambiguous or contradictory, the generator logs questions to `requirements/_questions-pending.md` and keeps working on everything else; the operator resolves by editing `PRD.md`.
3. **Blueprint Loop** (autonomous, with non-blocking clarification questions). Produces technical blueprints from approved FRDs across three blueprint types (container, component, feature). When the generator hits an architectural choice that requires operator judgment (tech stack, framework, hosting model, ORM, auth provider), it logs a question to `blueprints/_questions-pending.md` and keeps generating everything else. Questions can be bare ("what does X mean?") or carry 2–4 pre-researched options with pros/cons and a recommended default when the choice is genuine. The loop exits either when all reviewers pass and there are no open questions (full pass), or when it has done as much as it can and can't make further progress without operator input (`awaiting_clarification` — same exit verdict as the requirements loop). The operator answers in the file and re-triggers the loop. Cycle continues until all questions are resolved and all reviewers pass.
4. **Coding Loop** (autonomous). Auto-generates an ordered work-order sequence from approved blueprints, then executes each work order in dependency order on `task/<id>` branches with its own reviewer stack and PR-per-work-order flow. No phases — one continuous task sequence. This materially differs from SF's human-team model; our work orders are agent-consumed and can be much finer-grained, more ordered, and more mechanical.

Each autonomous loop has the same shape: orchestrator spawns a generator → orchestrator spawns each reviewer → orchestrator aggregates verdicts → if any fail, orchestrator re-spawns the generator with the aggregated feedback → if all pass, artifact is committed. The orchestrator owns the loop; generators and reviewers are single-purpose subprocesses. Identical plumbing (state files, reviewer review files, PR comment mirroring) across all three loops.

The harness drives the Claude Code CLI as a subprocess from a Python orchestrator. Canonical state lives on disk at the project repo's root; the entity layout mirrors Software Factory's model so upload to SF is mechanical.

**One repo per project.** The coding_harness repo itself is a reusable kit (orchestrator, skills, template). Each project the harness runs against is its own git repo, with `requirements/`, `blueprints/`, `work-orders/`, `artifacts/`, and `harness/` trees at its root. The orchestrator runs with the project repo as its working directory.

Local files are the source of truth. External systems like Software Factory are optional outbound mirrors, never alternative queues.

The operator authors the PRD and answers loop clarification questions; the harness does everything else.

## 2. Context

### Business Problem

Autonomous long-horizon coding through Claude Code today is manual at the seams. The operator interactively authors requirements, breaks them into features by hand, writes work orders, then executes each one in a Claude Code session with in-session subagents for verification. Every step is valuable but the operator is the bottleneck, and verification across steps is ad-hoc — a passing test suite on incoherent requirements still produces unmaintainable code. The operator needs a way to go from a drafted product description to merged pull requests without spending their day on the intermediate decomposition and scoping work.

### Current State

Claude Code provides the runtime primitives: subprocess invocation via `claude -p`, skills, hooks, subagents via the Task tool. The operator has been using these primitives manually — one-off sessions for PRD drafting, another for decomposition, another per work order. Software Factory exists as a separate service for multi-person teams to manage requirements, blueprints, and work orders with an agent assistant, but it assumes humans in every loop and isn't structured for single-operator autonomy. Nothing today gives one operator an end-to-end autonomous pipeline from PRD to merged PR, with verification as a first-class gate at each stage.

### Personas

One persona: the **single operator** running Claude Code on their own projects. Technical enough to diagnose a failed autonomous run and fix it (edit a prompt, tweak a skill, adjust config); not interested in building a team-scale product or shipping this to others as-is. Comfortable with the command line, git, and reading JSON state files. Values wall-clock throughput over process rigor.

### Success Metrics

- A single operator takes a drafted PRD to a stream of merged pull requests without writing Python code between steps and without hand-authoring individual work orders.
- Autonomous loops converge: a typical run passes within a bounded number of attempts. Exhaustion (hitting the retry cap) is rare, and when it happens the fix is almost always to improve the input artifact, not to patch the harness itself.
- The harness is self-maintainable by one operator: adding a reviewer, tweaking a prompt, or adjusting the loop mechanic doesn't require a multi-person review cycle.
- Per-loop operator involvement stays bounded: the operator answers clarification questions (requirements-loop and blueprint-loop) and reviews PRs, but doesn't do the authoring, decomposition, or scoping work the loops are meant to automate.

### Measurement

State files under `harness/state/` log every loop run's duration, per-attempt reviewer verdicts, retry counts, and exhaustion events; the live conversation transcripts in `requirements_communication/` and `blueprints_communication/` (snapshotted into `harness/state/reviews/<loop>/attempt-<N>/` at attempt boundaries) capture push-backs and reviewer reasoning. Git history captures commit cadence across artifact trees. Operator-observable from these: open-question count per blueprint run, attempts-to-pass distribution per loop, time-from-trigger-to-pass, and which reviewers most often flag issues. No external telemetry; no dashboards. Trends surface through ad-hoc inspection.

## 3. Goals & Non-Goals

### Goals
- Solve verification as a first-class concern so long-running autonomous work becomes trustworthy at *every* stage — requirements, blueprints, and code.
- Drive Claude Code via its CLI to leverage the Claude Max subscription and inherit every Claude Code improvement for free.
- Keep the orchestration surface small: thin Python loop + rich in-session hooks/skills/agents. The same loop runs all three autonomous phases, parameterized by which generator + reviewers to spawn.
- Local-first. Canonical PRD, FRDs, blueprints, work orders, and execution state live at the project repo's root as markdown + meta files, structured to mirror Software Factory's entity model so upload to SF (or any future external system) is mechanical.
- Autonomous where structure is clear; human where judgment is irreplaceable. The PRD is human. Bubble-ups during blueprint synthesis are human. Everything else is autonomous.
- Polished, self-maintainable documentation and code for long-term single-operator use.

### Non-Goals
- Multi-user, team, or OSS-release polish. Personal tool.
- Cross-agent portability (Cursor, Aider, Codex). Claude Code only.
- Autonomous PRD writing. The PRD is the operator's voice; skills assist but the operator drafts.
- Chat-style assistant flows. This is an autonomous-loop product — no human in the session once a loop is triggered.
- Token-level cost optimization. Subscription model; wall-clock time is the budget unit.
- Replacing Claude Code features (Plan Mode, subagents via Task tool) with reimplementations. Use them where they fit.

## 4. Design Principles

1. **Every generation step is a gen/review loop.** The same pattern — generator writes, reviewers judge, generator fixes — runs at three levels: requirements, blueprint, code. One loop mechanic, three sets of reviewers. Autonomy lives *inside* each loop; handoffs between loops are discrete, operator-visible gates.
2. **Verification and generation quality are co-equal.** The harness must confirm the artifact is correct (verification) *and* that it will hold up as input to the next loop (quality). A passing but incoherent FRD wrecks the blueprint loop; a passing but hand-wavy blueprint wrecks the coding loop. The reviewer stack at each level is designed to prevent the downstream failure, not just the local one.
3. **Claude Code is the runtime.** The orchestrator never makes direct Anthropic API calls. Every model interaction happens through `claude -p`.
4. **In-session work uses hooks; cross-session work uses Python.** Hooks are deterministic and reactive. The Python orchestrator is the only thing that initiates sessions, transitions state, enforces budgets, and detects clarification-pending pauses.
5. **The artifacts are ground truth.** Reviewers never trust generator self-reports. They read the written files (or `git diff` in the coding loop) and run gates.
6. **Local files are the source of truth; external backends are optional outbound mirrors.** The canonical PRD, FRDs, blueprints, work orders, and execution state live at the project repo's root (`requirements/`, `blueprints/`, `work-orders/`, `artifacts/`, `harness/`). The orchestrator always reads from and writes to local files. Software Factory (or any future system) is a sync target, never the queue itself.
7. **Machine-readable state for agents; human-readable artifacts for the operator.** Agents read and write JSON in `harness/state/`; the operator authors and reads markdown + meta files in the rest of the project repo. A sync script mirrors updates to PR comments on GitHub and, when configured, to external mirrors.
8. **Clarification questions are first-class, and non-blocking.** Both upstream autonomous loops surface operator-required input via the same mechanism: an append-only `_questions-pending.md` file alongside the artifact tree (`requirements/_questions-pending.md` for the requirements loop, `blueprints/_questions-pending.md` for the blueprint loop). The block shape differs by loop because the response shape differs: requirements-loop questions are always bare ("what does X mean?", "did you intend Y or Z?") since the answer is "clarify the PRD" — there's nothing for the generator to pre-research; blueprint-loop questions are bare *or* carry 2–4 pre-researched options with pros, cons, and a recommended default when the choice is genuine (e.g. "Postgres vs DynamoDB"). In both loops, the generator keeps producing everything that doesn't depend on the blocked input, and the loop only terminates as incomplete when it has done as much as it can. The operator resolves asynchronously; subsequent loop runs consume the answers and continue. Both loops exit with the same `awaiting_clarification` verdict — one mechanism, one verdict, two file locations, two question shapes.

## 5. Architecture

The project lives in a single git repo containing the operator's `PRD.md` at the root plus generated trees for `requirements/`, `blueprints/`, `work-orders/`, `artifacts/`, and `harness/` state. A reusable kit — the coding harness itself — hosts the orchestrator, skills, and agents that drive the three autonomous loops. External mirrors (Software Factory, GitHub Projects) are optional outbound sync targets.

### 5.1 Layers of responsibility

| Concern | Owner |
|---|---|
| PRD / Product Overview authoring | Operator + `prd-authoring` skill (manual, interactive) |
| FRD decomposition + review + iteration | Requirements loop (§6.2) |
| Blueprint synthesis + review + iteration, clarification questions | Blueprint loop (§6.3) |
| Work-order generation + scoping, per-work-order code execution | Coding loop (§6.4) |
| Canonical artifacts (PRD, FRDs, blueprints, work orders) | Local files at project repo root |
| Next-loop selection, status transitions, budget enforcement, session lifecycle, clarification-pause detection, communication-folder lifecycle | Python orchestrator |
| Cross-session memory, handoff context | `harness/state/<id>.json` |
| In-session enforcement: verdict-trailer validation, preventing premature stop | Claude Code hooks |
| Reusable capabilities: generator prompts, reviewer judges, authoring assist | Skills |
| Operator-invoked entry points | Slash commands |
| Role-specialized session prompts | Agents (`.claude/agents/*.md`) |
| Ground truth about what changed | Git |
| Human audit trail | GitHub PR comments + git history (via sync script) |
| External system mirrors (SF, etc.) | Sync script (outbound only, optional) |

## 6. Project Lifecycle

One project, end to end. Four stages: a manual PRD-authoring stage followed by three autonomous loops. Each autonomous loop uses the same mechanic — orchestrator spawns a generator, then spawns each reviewer; the generator and reviewers communicate bidirectionally through files in a per-loop communication folder (`<loop>_communication/<reviewer-name>.md`); the orchestrator aggregates `VERDICT:` lines from reviewer stdouts, re-spawns the generator on any fail, commits on all-pass. The three loops share state-file plumbing, communication-folder plumbing, reviewer review snapshots, PR-comment mirroring, and budget enforcement. They differ in generator skill, reviewer set, target artifact tree, and (for the upstream loops) the dual completion condition (all reviewers pass AND `_questions-pending.md` empty).

### 6.1 Stage 1 — Manual PRD authoring

The operator opens a Claude Code session, invokes the `prd-authoring` skill, and drafts a single `PRD.md` at the project repo's root. One monolithic document in prose. The skill wears a senior-PM role: feature-unit scoping discipline, the clarification policy (ambiguous → ask and wait; specific → act; middle → propose plus ≤ 2 questions), overview-style writing rules (narrative prose, active voice, no fluff, WHAT not HOW), no-fabrication and no-refactor-breadcrumb discipline.

**Critique is conversational, not a separate skill.** The harness keeps review inside the same authoring session. The operator just asks the agent to review what's written ("what's missing?", "critique this section", "check for contradictions") and the skill responds with a five-category rubric, filtered to critical-only:

- **CONFLICT** — direct contradictions within the PRD.
- **MISSING** — critical product-level gaps blocking understanding.
- **AMBIGUOUS** — genuine confusion about user experience or feature behavior.
- **DUPLICATION** — significant duplicated content needing consolidation.
- **STALE** — refactor residue that only makes sense against a prior version: `(unchanged)` / `(existing)` annotations, breadcrumbs like "previously…" or "the old X", references to renamed artifacts, external file/repo paths a fresh reader can't resolve. Downstream agents can't reconstruct this context; flag and remove.

This works because the operator is already conversing with the agent; forcing a skill boundary would be friction. The autonomous requirements loop downstream applies stricter checks than in-conversation critique, catching defects the operator misses.

No autonomous loop here — authoring the PRD is the human's job. The PRD is the only artifact the operator writes by hand; everything downstream is generated.

When the PRD is ready, the operator triggers the Requirements Loop.

### 6.2 Stage 2 — Requirements Loop (autonomous)

**Trigger.** `python -m orchestrator requirements-loop`.

**Generator.** A single `claude -p` subprocess running with the `prd-to-frds` skill. It reads `PRD.md` and decomposes it into the full structural tree. Two output surfaces:
- **Product-overview sections** (flat inside `requirements/overview/`). The generator identifies the structural pieces of the PRD — business problem, current state, personas, product description, success metrics, measurement, phases, audit/compliance, technical requirements, appendix — and writes each as a visible `<slug>.md` content file (e.g. `business-problem.md`). The orchestrator then materialises the dotted-hidden meta files alongside.
- **Feature Requirements Documents** (flat inside `requirements/features/`). One `<slug>.md` per feature identified in the PRD, following the feature-unit definition (standalone value, implementation footprint, independent deployability, incremental value). When a feature decomposes further, the generator creates a sibling `<slug>_children/` directory with the same flat shape recursively.

The generator is iterative: reads any existing overview+features trees first and edits what needs changing rather than regenerating from scratch on every run.

**Non-blocking clarification questions.** When the PRD is genuinely ambiguous — contradictions between sections, features named but never described, undefined concepts used throughout — the generator appends a structured block to `requirements/_questions-pending.md` and keeps working on everything that isn't blocked by the ambiguity. Each block has: a short title, where in the PRD the issue is (section heading or verbatim quote), what's ambiguous (one paragraph), and what would unblock. The operator resolves by editing `PRD.md` and deleting the block (or renaming the file to `_questions-resolved-<timestamp>.md` for git audit), then re-triggers the loop. Unlike the blueprint loop's decisions file, there are no options to pick — the answer is "clarify the PRD".

**Reviewers.** Orchestrator spawns four reviewer subprocesses after the generator exits: structural spec, cross-doc consistency, PRD coverage, feature scoping. See §8.1 for rubric detail.

**Loop mechanic.** Orchestrator aggregates reviewer verdicts. Any fail → re-spawn the generator with aggregated review context; generator fixes grounded findings, pushes back on ungrounded ones, logs questions for PRD-level ambiguities. Completion is dual: full `pass` requires all reviewers pass AND `_questions-pending.md` has no open questions blocking the review. If reviewers pass on what's concrete but open questions remain, the loop exits `awaiting_clarification` — artifact is committed, operator resolves and re-runs.

**Session continuity within an invocation.** By default the generator and each reviewer run as a single Claude Code session that persists across attempts within one orchestrator invocation: attempt 1 spawns fresh with `--session-id <uuid>`; attempts 2+ re-use the same id via `--resume <uuid>` and receive a short follow-up message naming the failing reviewers and listing the working-tree changes since the previous attempt (or "made updates" if a diff isn't readily available). This preserves the agent's reasoning and pushes-back across attempts without re-paying the cost of re-reading every file from scratch. New invocations always start fresh — session ids are per-invocation, never persisted across `python -m orchestrator …` runs. The `--memoryless` CLI flag overrides the default and forces every spawn to be a fresh session, falling back on the communication folder as the only memory channel (the v0.1 baseline behavior — useful when the operator has edited the PRD or the artifact tree between attempts and wants the agents to re-derive without prior bias). Full re-review still applies (all reviewers run every attempt) regardless of session mode.

**Output.** Approved `requirements/overview/` and `requirements/features/` trees. State file records the iteration history. No PR is opened — the requirements tree is documentation; git commit history is the audit trail. The operator verifies the final state (`git diff`) before triggering the blueprint loop.

### 6.3 Stage 3 — Blueprint Loop (autonomous, non-blocking clarification questions)

**Trigger.** `python -m orchestrator blueprint-loop`.

**Generator.** A single `claude -p` subprocess running with the `frd-to-blueprint` skill. It reads `requirements/features/` and produces three kinds of blueprints under `blueprints/`:

- **Container blueprints** (`blueprints/containers/<slug>.md`) — one per deployable runtime (web app, API server, worker, database, pipeline). Tech stack, deployment model, entry points, system contracts, integration boundaries.
- **Component blueprints** (`blueprints/components/<slug>.md`) — one per cross-cutting reusable capability (auth, notifications, file storage, observability). A cohesive group of runtime components powering one capability, possibly spanning containers.
- **Feature blueprints** (`blueprints/features/<slug>.md`) — slug-matched 1:1 with `requirements/features/<slug>.md`. Documents how shared component blueprints compose to satisfy a feature, plus any feature-only components.

The generator writes all three types itself — single skill, no sub-skill co-invocation. It is iterative: reads any existing blueprints tree first and edits what needs changing rather than regenerating from scratch on every run.

**Blueprint document shape.** Pinned. See `BLUEPRINT.md §11` (and the future `requirements/features/blueprint-document-shape.md` once that doc lands). Three types each with a fixed section order, a shared mention syntax (`#Component`, `` `Element` ``, `@Entity`), fenced ` ```component ` / ` ```model ` blocks, and an Architecture Decision Records section with `### ADR-NNN: Title` entries. Adopted from the SF blueprints module's seeded category presets, simplified for the harness's autonomous loop.

**Non-blocking clarification questions.** When the generator hits an architectural choice that requires operator judgment — tech stack, framework, hosting model, auth provider, ORM, major architectural pattern — it does not stop. Same mechanism as the requirements loop:

1. Generator appends a structured block to `blueprints/_questions-pending.md`. Each block is one of two shapes, picked by the generator per question:
   - **Bare question** — when the answer isn't a choice between alternatives (e.g. "did you mean X or Y?", "which FRD does this relate to?"). Title, where (FRD slug or section), what's ambiguous, what would unblock, blank `Your answer:`.
   - **Question with options** — when the choice is genuine (e.g. "Postgres vs DynamoDB", "JWT vs session cookies"). Title, where, context, 2–4 pre-researched options each with a one-sentence summary and `Pros`/`Cons`, a recommended default with rationale, blank `Your answer:`. The generator does the homework so the operator doesn't have to.

   Don't fabricate options to fill the second shape — only use it when the choice is genuine.
2. Generator keeps working on everything that doesn't depend on the blocked question. The blueprint may carry a brief `<!-- pending: <question-title> -->` comment where the answer matters; reviewers do not flag these as defects (they flag missing answers, not the comment style).
3. Generator exits. Orchestrator spawns the four blueprint reviewers. Reviewers may pass on everything that's concrete; `bp-decision-judge` specifically tracks whether any high-impact decision was made silently without a question block.
4. Orchestrator aggregates. Exit verdicts:
   - **`pass`** — all reviewers pass *and* `_questions-pending.md` has no unanswered questions. Full completion.
   - **`awaiting_clarification`** — reviewers pass on the current state, but open questions remain and the generator can make no further progress without them. The orchestrator commits current progress, summarises pending questions, exits. Operator answers and re-triggers. (Same exit verdict as the requirements loop.)
   - (Plus the standard **`fail`** and **`exhausted`** outcomes.)
5. Operator answers in `blueprints/_questions-pending.md`. Fills in each `Your answer:` line. Optionally renames resolved blocks to `_questions-resolved-<timestamp>.md` for git-history audit.
6. Operator re-runs `python -m orchestrator blueprint-loop`. Generator reads the questions doc, treats any answered questions as resolved, picks up where it left off. Repeats the cycle until full `pass`.

**Reviewer ↔ generator communication folder.** Live conversation between the generator and the four reviewers happens in `blueprints_communication/` at the project root (sibling to `blueprints/`). One file per reviewer (`bp-spec-judge.md`, `bp-coverage-judge.md`, `bp-consistency-judge.md`, `bp-decision-judge.md`). Append-only conversation transcripts; both sides read and write. The generator pushes back on findings it disagrees with by appending to the relevant reviewer's file; the reviewer reads the push-back on its next run and may revise its position. Race-free because the orchestrator runs gen→reviewers strictly sequentially per attempt, and reviewers each write only their own file. See `BLUEPRINT.md §1.8` for the full lifecycle (preserved across invocations and never wiped, snapshot to `harness/state/reviews/blueprint-loop/attempt-<N>/` at attempt boundaries — the audit dir is the frozen per-attempt record, the live folder is the running conversation).

**Reviewers.** Orchestrator spawns four: structural spec, FRD-to-blueprint coverage, cross-blueprint consistency, decision hygiene. See §8.2 for rubric detail.

**Interactive blueprint editing.** Outside the autonomous loop, the operator can invoke the `blueprint-authoring` skill inside an interactive Claude Code session to refine specific blueprints. Same posture as `prd-authoring`. Not orchestrator-spawned; not part of the loop.

**Output.** Approved blueprints under `blueprints/` when all questions are resolved and all reviewers pass. Commit history is the audit trail.

### 6.4 Stage 4 — Coding Loop (autonomous)

**Trigger.** `python -m orchestrator coding-loop`.

No phases — one continuous task sequence. The loop reads approved blueprints, produces an ordered sequence of work orders, and then drains that sequence in dependency order. `blocked_by[]` + `sort_order` on each work order encode the sequence; there are no phase groupings.

**Sequence generation** (runs once at the start of a `coding-loop` invocation whenever there are no ready work orders OR blueprints have changed since the last generation — recorded as a hash in `work-orders/.sequence.meta.yaml`):

- Generator runs with `blueprint-to-tasks` and `scope-task`. Reads every approved blueprint, produces an ordered list of work orders, scopes each one into the standard scoped-task body (§6.4.1), and writes them to `work-orders/wo-NNN/` with proper `blocked_by[]` and `sort_order` in each `.work-order.meta.yaml`. Existing work orders are read first so partial regeneration works.
- Reviewers: orchestrator spawns three — scoping, coverage, dependencies. See §8.3.
- On pass, all work orders land with `status: ready`.

**Open design.** Work-order artifact shape must support autonomous execution: tight scope, explicit acceptance criteria, machine-readable dependency graph, unambiguous in-scope/out-of-scope, explicit verification hooks. Pinning the exact shape happens at the start of v0.3 — see §9.

**Sequence execution** (drains the ready queue in dependency order, one work order per orchestrator subprocess):

1. Orchestrator selects the next ready work order whose `blocked_by[]` dependencies are all `done` (ordered by `sort_order` as a tiebreaker). Moves it to `in_progress`, initializes `harness/state/<task_id>.json`, sets `execution.branch = "task/<task_id>"`.
2. Orchestrator spawns one generator subprocess — `claude -p "<prompt>"` with the scoped-task body injected inline. A single subprocess per work order; the generator handles its gen/review cycle internally.
3. Generator works on branch `task/<task_id>`. First pass commits, pushes, opens a PR.
4. Generator exits with a summary. Orchestrator spawns six reviewers: tests, Playwright, spec, regression, security, quality. See §8.4 for rubrics.
5. Orchestrator aggregates.
   - Any fail → re-spawn generator with aggregated reviews; generator fixes, pushes back, or files gaps.
   - All pass → post final summary as a PR comment; PR is ready for operator merge.
   - Budget: wall-clock cap per subprocess, attempt cap per invocation.
6. Operator reviews and merges when satisfied. The harness never auto-merges.
7. On the next orchestrator invocation: check each `in_progress` work order for a merged PR (by branch name); transition to `done`. Select next ready work order. Continue.

**Queue drain.** By default, a single `coding-loop` invocation drains all work orders whose dependencies are ready, in order. A `--one` flag runs one work order and exits. A `--gen-only` flag runs only the sequence-generation step without executing any implementation.

#### 6.4.1 Scoped-task format

Every work-order body is in this shape. The `scope-task` skill produces it during sequence generation; the operator (or a failing sequence-gen reviewer) can edit it. Consistent format means the implementation generator always knows where to find each piece of information.

```markdown
## Goal
One sentence describing what this work order delivers.

## In scope
- Bullet list of what is included.

## Out of scope
- Explicit list of what this work order does NOT cover, especially things a reasonable reader might assume are included. Forces the scope boundary to be thought through.

## Depends on
- #<other-wo> — one line explaining what this work order needs from it.
(Empty if no dependencies.)

## Produces
- Interfaces, modules, artifacts, or contracts this work order makes available for downstream work orders.

## Acceptance criteria
- [ ] Observable outcomes, each verifiable by the reviewer's gates.
- [ ] ...

## Implementation notes (non-binding)
Optional. Hints about files, approach, libraries. Never prescriptive — the generator owns implementation choices.
```

**Scope is the load-bearing concept.** All scopes across all work orders must compose into the whole blueprint surface without gaps or overlap. `In scope` + `Out of scope` + `Produces` carry the contract. If scoping is sloppy, work orders either leave gaps or double up — both wreck execution. `wo-coverage-judge` and `wo-scoping-judge` during sequence generation are the last line of defense before this propagates into execution.

#### 6.4.2 Gap filing (coding-loop concept, deferred)

When the coding loop is built, its generator will need a way to file new work orders for out-of-scope missing work it discovers mid-execution — a missing prerequisite, a latent bug adjacent to changed code, a useful refactor that's not part of the current ticket. The mechanism: create a `backlog` work order under `work-orders/_inbox/wo-NNN/` with a back-reference to the originating work order. The operator triages on their own cadence; gaps never auto-promote to `ready`.

The upstream loops do not file gaps — both upstream loops log clarification questions to `_questions-pending.md` in their artifact tree (§6.2, §6.3). Different mechanisms from gap-filing because the response shape differs (clarify the source / pick an option vs. queue new code work).

The gap-filing skill is deferred until the coding loop ships in v0.4.

## 7. Components

### 7.1 Python orchestrator

Entry point: `python -m orchestrator <subcommand>`. Subcommands: `requirements-loop`, `blueprint-loop`, `coding-loop`, `status`. The operator runs one subcommand at a time; loops are not daemons. Each subcommand drives one autonomous loop, spawning generator and reviewer subprocesses per §6 and committing artifacts on pass.

The orchestrator's full responsibilities: detect merged PRs and transition work orders to `done`, spawn generator and reviewer subprocesses with composed prompts, aggregate reviewer `VERDICT:` lines from stdout and decide retry vs pass vs exhaust, manage the per-loop communication folder (ensure it exists, snapshot to `harness/state/reviews/<loop>/attempt-<N>/` at attempt boundaries; never wipe — it accumulates the full project conversation), commit artifact changes on pass when a git repo is present, post PR comments on coding-loop execution, handle the upstream-loop `awaiting_clarification` exit (same verdict for both requirements and blueprint loops).

### 7.2 On-disk layout

The canonical task queue lives on disk at the project repo's root. One repo per project. Local files are the source of truth; external mirrors are optional outbound push targets, never alternative queues.

The shape mirrors Software Factory's entity model so that upload to SF (or any system that adopts a similar shape) is mechanical. Everything below lives at the project repo's root:

```
<project-repo-root>/
  PRD.md                               # single monolithic PRD authored by the operator (Stage 1)
  requirements/                        # generated in Stage 2 from PRD.md
    _questions-pending.md              # only present while PRD-clarification questions are open (§6.2)
    _questions-resolved-*.md           # optional audit-log of resolved questions
    overview/                          # nodes are flat at this level
      <slug>.md                        # visible content file (e.g. business-problem.md)
      .<slug>.overview.meta.yaml       # hidden; id, parent_id, position, title
      .<slug>.requirements.meta.yaml   # hidden; id
      <slug>_children/                 # only if this node has children; same flat shape inside, recursive
        ...
    features/                          # same shape, with .feature.meta.yaml instead of .overview.meta.yaml
      <slug>.md                        # FRD body (e.g. auth.md)
      .<slug>.feature.meta.yaml
      .<slug>.requirements.meta.yaml
      <slug>_children/...
  requirements_communication/          # bidirectional gen↔reviewer channel for the requirements loop (§6.2)
    prd-to-frds.md                     # generator's outbound (responses, push-backs, change-summaries)
    req-spec-judge.md                  # one file per reviewer; appended-to by both sides
    req-cross-doc-judge.md
    req-coverage-judge.md
    req-scoping-judge.md
  blueprints/                          # generated in Stage 3
    _questions-pending.md              # only present while clarification questions are open (§6.3)
    _questions-resolved-*.md           # optional audit-log of resolved questions
    containers/                        # one blueprint per deployable runtime
      <slug>.md
      .<slug>.container.meta.yaml      # hidden; id, parent_id, position, title
      .<slug>.requirements.meta.yaml
    components/                        # one blueprint per cross-cutting capability
      <slug>.md
      .<slug>.component.meta.yaml
      .<slug>.requirements.meta.yaml
    features/                          # one blueprint per FRD; slug-matched 1:1 with requirements/features/<slug>.md
      <slug>.md
      .<slug>.feature.meta.yaml
      .<slug>.requirements.meta.yaml
  blueprints_communication/            # bidirectional gen↔reviewer channel for the blueprint loop (§6.3)
    frd-to-blueprint.md                # generator's outbound
    bp-spec-judge.md                   # one file per reviewer
    bp-coverage-judge.md
    bp-consistency-judge.md
    bp-decision-judge.md
  work-orders/                         # generated in Stage 4 (flat, no phase groupings)
    .sequence.meta.yaml                # blueprints hash + generation timestamp (for change detection)
    wo-NNN/
      description.md                   # scoped-task body (§6.4.1)
      .work-order.meta.yaml            # id, status, priority, type, parent_id, sort_order, blocked_by[], blueprint_ids[]
      children/                        # subtasks (rare; most work orders are leaf)
    _inbox/                            # gaps filed by the coding loop (§6.4.2); operator triages
  artifacts/{folder-slug}/...          # Artifact folder tree
  harness/
    state/<task_id>.json               # per-work-order state (§7.3)
    state/requirements-loop.json       # loop-level state
    state/blueprint-loop.json          # loop-level state
    state/coding-loop-seq-gen.json     # loop-level state for the sequence-generation step
    state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer>.md   # snapshots from communication folders (upstream loops) or stdout (coding execution)
    logs/<task_id>/...                 # hook/session logs
```

**Key shape facts:**
- **`PRD.md` at root.** The operator-authored monolithic PRD (Stage 1). Input to the requirements loop; never edited by any autonomous loop.
- **`requirements/` is generated.** Nodes are flat at each level: a `<slug>.md` visible content file plus two dotted-hidden meta files (`.<slug>.<overview|feature>.meta.yaml` and `.<slug>.requirements.meta.yaml`) as siblings. If a node has children, a sibling directory `<slug>_children/` holds them with the same flat shape, recursively. The `_children` suffix is reserved — kebab-case slugs never contain underscores.
- **Meta files are orchestrator-managed.** Generators write only the visible `<slug>.md` content file. The orchestrator materialises the two dotted-hidden meta files per node after the generator exits, deriving titles from each doc's first H1 and setting IDs to `null` for later mirror sync to populate.
- **`work-orders/` is flat** (no phase groupings). Work-order directories sort lexicographically by `wo-NNN` name with leading zeros; `sort_order` in `.work-order.meta.yaml` provides the canonical order; `blocked_by[]` provides dependency constraints. Together these encode everything SF used phase groupings for.
- **`.sequence.meta.yaml`** at the work-orders dir level records the hash of the blueprint tree at the time the sequence was generated. On each `coding-loop` run, the orchestrator compares the current blueprint hash to this; if changed, it triggers a regeneration before draining.

A reference skeleton lives at `project-template/` inside this kit repo. Clone it into a new project repo to start.

**`blueprints/` subtree** has the same per-node shape as `requirements/` (visible `<slug>.md` plus two dotted-hidden meta files), divided into three subdirectories — `containers/`, `components/`, `features/` — corresponding to the three blueprint types. Feature-blueprint slugs are 1:1 with `requirements/features/<slug>.md` (enforced by `bp-coverage-judge`). Per-type document shape (sections, mention syntax, fenced blocks, ADRs) is pinned in `BLUEPRINT.md §11`.

**Communication folders** (`requirements_communication/`, `blueprints_communication/`) sit at the project root, sibling to the artifact trees. Each holds one markdown file per agent in the loop (one for the generator, one per reviewer) — append-only conversation transcripts. Both the generator and the named reviewer read and write the file; the orchestrator never wipes the folder — it accumulates the project's full reviewer-generator conversation across attempts and across invocations forever. The orchestrator snapshots it to `harness/state/reviews/<loop>/attempt-<N>/` at attempt boundaries for audit. Lifecycle and race-condition argument live in `BLUEPRINT.md §1.8`.

Work-order subtree shape is sketched above but its concrete document shape is TBD (§9). Work-order shape lands in v0.3.

**Versioning:** none locally. Git history is the audit trail. Mirrors serialise only the current document state; if an external system maintains its own versioning, it does so on its end.

A local-planner module reads and writes the on-disk layout as a single concrete class. A mirror adapter interface exposes one-way push hooks for status updates and comments to external systems. Git operations (branch, commit, PR open, PR comment, merge detection) are wrapped in a thin GitHub CLI layer.

### 7.3 State files

All loop and per-work-order state is JSON under `harness/state/`. Reviewer reviews are archived under `harness/state/reviews/<loop>/[<task-id>/]attempt-<N>/<reviewer-name>.md`. For the upstream loops (requirements, blueprint), the orchestrator snapshots each reviewer's communication file from the live folder at attempt boundaries and on every loop-exit verdict — the reviewer wrote that file directly during the attempt (§6.2, §6.3). For the coding-loop's per-work-order execution, the orchestrator captures each reviewer subprocess's stdout (the reviewer's final chat message ending in a `VERDICT:` line) and writes it to the same archive path. The entire `harness/` tree is committed to git as a first-class project artifact — audit, replay, failure-mode analysis, future training data. State files are never deleted; log files may be pruned on a documented retention policy.

### 7.4 Skills

Installed under `.claude/skills/`. Each is a short `SKILL.md` describing when and how to apply it.

**Skills are for LLM-driven work only.** Deterministic mechanics (state-file rotation, iteration counting, history appending, PR comment posting) live in the orchestrator, not in skills. A skill exists in one of two shapes:

- **Tool-wrappers** — reusable "here is how to do X" instructions plus a thin CLI recipe. The agent decides *when* to use the tool; the skill documents *how* consistently.
- **LLM-as-judge** — pure prompting skills that produce a verdict. The judgment is the skill.

Each skill carries its own autonomy posture: no clarifying questions mid-loop, decide and proceed. Generators write artifact files to disk; reviewers output their review as the subprocess's final chat message (captured by the orchestrator as stdout).

**Manual-stage skills (operator-driven interactive Claude Code sessions):**

- `prd-authoring` *(LLM work)* — interactive PRD authoring. Helps the operator draft and refine the single monolithic `PRD.md` at the project repo's root. Output is one file, not a tree — the requirements loop does the decomposition. Role as product manager; clarification policy (ambiguous → ask; specific → act; middle → propose + ≤2 questions); overview-style writing rules (narrative prose, active voice, no fluff, WHAT not HOW); no-fabrication and no-refactor-breadcrumb discipline. The operator writes detailed feature descriptions; formal feature-unit scoping lives in `prd-to-frds`. Uses Claude Code's filesystem tools (Read/Write/Edit). **Also handles critique on demand** — when the operator asks for review, the same skill applies a CONFLICT / MISSING / AMBIGUOUS / DUPLICATION / STALE rubric (critical-only filter) in-line. No separate review skill.
- `blueprint-authoring` *(LLM work)* — interactive blueprint editing. Helps the operator refine specific blueprints after the autonomous blueprint loop has run. Same posture as `prd-authoring`: ask-and-wait dialogue, no autonomous loop, role as senior engineer. Knows the three blueprint types (container / component / feature), the per-type structural shape (sections, mention syntax, fenced `component`/`model` blocks, ADRs — see `BLUEPRINT.md §11`), and the boundary-first / no-redefinition writing principles. Uses Read/Write/Edit. Not orchestrator-spawned, not part of the loop.

**Requirements-loop skills** (autonomous; `requirements-loop` generator pulls in these):

- `prd-to-frds` *(generator, LLM work)* — reads `PRD.md` at project repo root, decomposes it into the full structural tree under `requirements/` — flat `<slug>.md` files inside `overview/` (business problem, personas, product description, success metrics, measurement, phases, audit/compliance, technical requirements, appendix) and inside `features/`, with `<slug>_children/` subdirs when nodes decompose further. Applies the feature-unit definition (§6.2) and the split/merge/nest heuristics to turn PRD-level feature descriptions into correctly-scoped FRDs — this is where formal feature shaping lives, not in `prd-authoring`. Iterative: reads existing trees on every session and only edits what needs changing.
- `req-spec-judge` *(reviewer, LLM-as-judge)* — each FRD matches structural expectations: sections present, requirements have REQ-IDs + user stories + testable acceptance criteria. Single-doc check; the orchestrator spawns one reviewer subprocess per FRD.
- `req-cross-doc-judge` *(reviewer, LLM-as-judge)* — whole-tree consistency: contradictions between FRDs, terminology drift, duplication across FRDs.
- `req-coverage-judge` *(reviewer, LLM-as-judge)* — union of FRDs covers the PRD's scope without gaps or overlaps.
- `req-scoping-judge` *(reviewer, LLM-as-judge)* — each FRD individually passes the feature-unit definition (standalone value, independent deployability, parent/child semantics).

**Blueprint-loop skills** (autonomous):

- `frd-to-blueprint` *(generator, LLM work)* — sole loop generator. Reads `requirements/features/`, the existing `blueprints/` tree (containers, components, features), `blueprints/_questions-pending.md`, and an **optional root `BLUEPRINT.md`** if the operator has authored one (a high-level architectural scratchpad treated as a starting input — not edited by the loop, not part of the canonical `blueprints/` tree). Produces all three blueprint types itself in a single skill — no sub-skill co-invocation. Writes structured question blocks (bare or with-options) to `blueprints/_questions-pending.md` for architectural choices that require operator judgment. Reads each reviewer's communication file in `blueprints_communication/` and appends per-finding responses (fix / push back / surface to operator) plus a change-summary on retries.
- `bp-spec-judge`, `bp-coverage-judge`, `bp-consistency-judge`, `bp-decision-judge` *(reviewers, LLM-as-judge)* — per §6.3 / §8.2. Each reads its own communication file in `blueprints_communication/<reviewer-name>.md`, runs its review, and appends the review block to that same file. The decision-judge verifies (a) no high-impact decision was silently made by the generator without writing a question block, and (b) any unresolved architectural choice has a matching open block in `blueprints/_questions-pending.md`.

**Coding-loop skills — sequence generation** (autonomous, runs at the start of a coding-loop invocation when needed):

- `blueprint-to-tasks` *(generator, LLM work)* — reads approved blueprints, produces an ordered list of work orders with dependency graph. No phase grouping — flat sequence with `blocked_by[]` + `sort_order`.
- `scope-task` *(generator, LLM work)* — fleshes each work order into the standard scoped-task body (§6.4.1). Co-invoked with `blueprint-to-tasks`.
- `wo-scoping-judge`, `wo-coverage-judge`, `wo-dependency-judge` *(reviewers, LLM-as-judge)* — per §6.4.

**Coding-loop skills — sequence execution** (autonomous, one subprocess per work order):

- `open-task-pr` *(tool-wrapper)* — how the generator opens a PR on its first internal pass: branch naming (`task/<task_id>`), commit, push, `gh pr create`. Idempotent.
- `run-playwright-check` *(tool-wrapper)* — how to run Playwright against a locally-booted dev server.
- `spec-judge` *(reviewer, LLM-as-judge)* — compares `git diff` to the work-order's acceptance-criteria checklist.
- `regression-judge` *(reviewer, LLM-as-judge)* — checks the diff for unintended breakage outside the changed lines.
- `security-judge` *(reviewer, LLM-as-judge)* — OWASP-class issues in the diff.
- `quality-judge` *(reviewer, LLM-as-judge)* — structural + textual maintainability of the diff.

Each reviewer skill runs in a fresh Claude Code context with a scoped prompt — it sees only the artifacts it needs to review plus the path to its communication file. Reviewers in the upstream loops (requirements, blueprint) are spawned with `--disallowedTools Bash,NotebookEdit`; `Write` and `Edit` are allowed so the reviewer can append its review to its own communication file, but a `PreToolUse` path-guard hook (§7.5) blocks any path other than that file. Reviewers in the coding-loop's per-WO execution stack run with the original `--disallowedTools Write,Edit,NotebookEdit,Bash` since they don't use the communication-folder mechanism. In all cases, the orchestrator greps the trailing `VERDICT:` line from the reviewer's stdout, archives the full review (from the communication file for upstream loops, from stdout for coding-loop execution), and aggregates.

**Not skills** (and why):

- State-file rotation, attempt counter, PR comment mirror, `execution.pr_*` refresh, status column transitions, questions-file presence detection, communication-folder lifecycle (ensure / snapshot — never wipe) — all deterministic, all orchestrator code.
- Verdict aggregation — orchestrator parses the trailing `VERDICT:` line from each reviewer subprocess's stdout. The full review prose lives in the communication file (upstream loops) or stdout (coding-loop execution); the orchestrator does not parse that body for control flow.

### 7.5 Hooks and agents

Hooks enforce output contracts: a `Stop` hook on generators validates the stdout summary ends with a recognised `VERDICT:` line; a `Stop` hook on reviewers validates the final chat message ends with a `VERDICT: pass|fail` line (in-session enforcement layer); a `PreToolUse` path-guard hook on upstream-loop reviewers (requirements, blueprint) blocks any `Write`/`Edit` call whose target path is not exactly the reviewer's own `<loop>_communication/<reviewer-name>.md` file — required because those reviewers run with `Write`/`Edit` allowed (so they can append to their own communication file) but must not be able to mutate the artifact tree, the operator's questions file, or any other reviewer's communication file.

Hooks are the verdict-format enforcement layer. The reviewer's `Stop` hook blocks the model from ending its turn until the trailing `VERDICT:` line is present and well-formed; on a malformed turn it exits non-zero with a stderr nudge, which Claude Code surfaces back to the model so the turn continues with the corrective instruction. The hook self-caps at `max_agent_retries` blocks per subprocess (per-spawn counter file): once the cap is reached the hook stops blocking and lets the turn end, so a stubbornly-malformed model can't ping-pong with the hook indefinitely. If a subprocess does exit with malformed stdout (cap reached, hook bypass, subprocess crash, truncated output), the orchestrator records that reviewer's verdict as `fail` (or, for the generator, lets the attempt continue as fail). There is no post-exit recovery layer — the loop never wedges on a parser failure, and rare malformed cases are treated as soft fails rather than recovered.

A separate **rate-limit retry** layer handles transient Anthropic API throttling, which is a different failure mode (the model never ran). When a `claude -p` subprocess exits with a recognised rate-limit error, the orchestrator pauses with a doubling backoff (30s, 60s, 120s, …) and re-spawns. It retries up to `max_agent_retries` times before giving up; on giving up, it records the incident and exits the loop with `exhausted`. Rate-limit retries don't consume the loop-level attempt budget — they're recovery from infrastructure, not from anything the model said.

Both retry layers share the same `max_agent_retries` budget (default 3, configurable in `config.yaml`) but are independent counters per subprocess. The cap exists to bound wall-clock exposure during sustained outages and to prevent the Stop hook from looping forever.

Agents are role-specialised prompts — one generator per loop (lead PM for requirements, lead engineer for blueprints, lead tech lead for sequence generation, IC for per-work-order execution) plus a reviewer subprocess per rubric.

## 8. Verification Stacks

Each autonomous loop has its own verification stack. The loop mechanic is identical (orchestrator spawns each reviewer as a subprocess after the generator exits; reviewers in the upstream loops read and append to their communication file in `<loop>_communication/`; reviewers in the coding-loop execution stack emit their review as their final chat message; in all cases the reviewer's stdout ends with a `VERDICT:` line that the orchestrator parses; orchestrator aggregates, re-spawns generator on any fail, commits on all-pass); the gates differ.

Each reviewer subagent runs in a fresh Claude Code context — judges do not cross-contaminate and the generator's session context doesn't balloon with reviewer transcripts.

Gate kinds:
- **Execution gates** — deterministic; the subagent runs a command and reports exit code. Only present in the coding loop's per-work-order execution (`tests`, `playwright`).
- **LLM-as-judge gates** — the subagent reads the artifact (FRDs, blueprints, work orders, diff) and emits a verdict based on a focused prompt. All other reviewers.

### 8.1 Requirements loop (4 gates + dual completion condition)

Reviewer subagents (all LLM-as-judge):

- **`req-spec-judge`** — each FRD matches structural expectations. Sections present; requirements have REQ-IDs + user stories + acceptance criteria in testable form; acceptance criteria use `shall/should/may` phrasing. Fanned out per-FRD so failures are attributable.
- **`req-cross-doc-judge`** — whole-tree consistency. Contradictions between FRDs; terminology drift (same concept, different names); duplication that should be consolidated or cross-referenced.
- **`req-coverage-judge`** — union of FRDs covers the PRD's scope without gaps or overlaps. Reads `requirements/overview/` and `requirements/features/`. This is the load-bearing check.
- **`req-scoping-judge`** — each FRD individually passes the feature-unit definition (§6.2). Also validates parent/child correctness — parent delivers value alone; child meaningless without parent.

All gates `fail`-blocking. Orchestrator spawns every reviewer as its own subprocess concurrently — each reviewer writes only to its own communication file and captures its own stdout, so parallel fan-out is contention-free.

**Dual completion condition.** Full `pass` requires both all four reviewers pass AND `requirements/_questions-pending.md` has no open questions blocking the review. If reviewers pass on the concrete parts but open questions remain, the loop exits `awaiting_clarification` (not `fail`) — the tree is committed, the operator resolves the questions by editing `PRD.md`, and a subsequent run continues.

### 8.2 Blueprint loop (4 gates + dual completion condition)

Reviewer subagents (all LLM-as-judge):

- **`bp-spec-judge`** — each blueprint matches the per-type structural shape (`BLUEPRINT.md §11`): correct section order, required sections present, fenced ` ```component ` and ` ```model ` blocks well-formed (required keys, tab-indented bullets), ADR entries follow `### ADR-NNN: Title` + Context / Decision / Consequences. Fanned out per-blueprint so failures are attributable.
- **`bp-coverage-judge`** — three checks: (a) every approved FRD has a feature blueprint with matching slug (`requirements/features/<slug>.md` ↔ `blueprints/features/<slug>.md`); (b) every `#Component` mention resolves to a `component` block defined somewhere in the tree, every `` `Element` `` mention has a definition (model block or schema reference), every `@Blueprint` mention resolves; (c) no orphan blueprints, and no high-impact architectural choice is left unresolved without a matching open block in `blueprints/_questions-pending.md`.
- **`bp-consistency-judge`** — three checks: (a) cross-blueprint contracts align (if a feature blueprint composes component X assuming behavior Y, component blueprint X actually exposes Y); (b) **no-redefinition rule** — feature blueprints reference shared components rather than restating them; (c) **boundary-first rule** — container blueprints don't drift into internal wiring (which belongs in component blueprints).
- **`bp-decision-judge`** — verifies no high-impact architectural decision (DB choice, framework, auth provider, hosting model, ORM) was silently made by the generator without writing a question block to `blueprints/_questions-pending.md`. Pairs with `bp-coverage-judge`'s open-question check.

**Dual completion condition.** Same shape as the requirements loop: `pass` requires both all four reviewers pass AND `blueprints/_questions-pending.md` has zero unanswered questions. If reviewers pass but questions remain, the loop exits `awaiting_clarification` (not `fail`) — artifact is committed, state is saved, operator answers and re-triggers. One mechanism, one verdict, two file locations (`requirements/_questions-pending.md` for the requirements loop, `blueprints/_questions-pending.md` for the blueprint loop).

### 8.3 Coding loop — sequence generation (3 gates)

Runs at the start of a `coding-loop` invocation when work orders need to be (re)generated. Reviewer subagents (all LLM-as-judge):

- **`wo-scoping-judge`** — each work order is atomic (one logical change), has observable outcome, doesn't bundle. Feature-unit definition applied to implementation-sized slices.
- **`wo-coverage-judge`** — union of work orders covers every blueprint's delivery surface. Reads blueprints + work-order tree. No gaps, no overlaps.
- **`wo-dependency-judge`** — `blocked_by[]` graph acyclic; no work order references an interface produced by a not-yet-defined work order; `sort_order` consistent with dependencies.

### 8.4 Coding loop — per-work-order execution (6 gates)

Two execution gates + four LLM-as-judge gates.

- **Gate 1 — Tests** *(execution)*. Existing and newly-added test suites pass via `make test`. Non-zero exit = fail.
- **Gate 2 — Playwright** *(execution)*. Running app behaves per ticket. Playwright exit code + screenshots. Blocking if the work order has any UI-visible criterion; skipped otherwise. Uses the `run-playwright-check` skill, which wraps booting the local dev server, running the Playwright suite against it, and tearing down.
- **Gate 3 — `spec-judge`** *(LLM)*. `git diff` vs acceptance-criteria checklist. Per-criterion reasoning in the subagent's return value.
- **Gate 4 — `regression-judge`** *(LLM)*. Diff breaking code outside changed lines: shared utilities, sibling call sites, existing tests now exercising changed paths, implicit contracts (types, docstrings, README claims).
- **Gate 5 — `security-judge`** *(LLM)*. Injection, auth/authz gaps, secret handling, input validation at boundaries, crypto misuse, unsafe deserialization, SSRF, OWASP Top 10 patterns.
- **Gate 6 — `quality-judge`** *(LLM)*. Structural maintainability (module boundaries, layering, coupling, abstraction level) + textual (naming, duplication, dead code, over-abstraction, test quality, API shape, nearby convention adherence). Explicitly does *not* re-verify correctness.

Fastest-first ordering for short-circuit: tests → playwright → spec → regression → security → quality. Orchestrator can run reviewers in parallel once serial bottlenecks show up; v0.1 is serial.

### 8.5 On pass (universal)

- Generator's `VERDICT:` trailer has every gate = `pass` (or `not_run` for gates that don't apply — e.g. `playwright` for pure-library work orders).
- **Requirements / blueprint / sequence-generation passes**: orchestrator commits the artifact changes, writes a loop-level history entry, exits.
- **`awaiting_clarification`** (either upstream loop): orchestrator commits current progress (partial tree + updated questions doc), writes a history entry, prints an operator-facing summary of the open questions, leaves the live communication folder in place for operator inspection, exits with code 2. Not a failure state — operator answers in the relevant `_questions-pending.md` (or, for requirements-loop questions, edits `PRD.md`), then re-runs.
- **Per-work-order-execution pass** (existing): the PR already exists. Orchestrator posts a final pass-comment summarizing the verdict; notifies the operator. Status stays `in_progress` until merge. On merge, the next `coding-loop` invocation detects the merged PR (by branch `task/<task_id>`) and updates `.work-order.meta.yaml` to `done`.
- Merge is always operator-driven. The harness never auto-merges. Committing requirements/blueprint/work-order artifacts is orchestrator-driven (no PR for upstream loops — the artifacts *are* the PR-review surface for the next loop).

## 9. Deferred / Open Questions

- ~~**Blueprint artifact shape.**~~ Resolved. Three blueprint types pinned: container, component, feature. Per-type document shape (sections, mention syntax, fenced `component`/`model` blocks, ADRs) adopted from the SF blueprints module's seeded category presets. On-disk layout (`blueprints/{containers,components,features}/<slug>.md` + `.<slug>.<kind>.meta.yaml` + `.<slug>.requirements.meta.yaml`) mirrors `requirements/`. Full contract in `BLUEPRINT.md §11`.
- **Work-order artifact shape.** Same problem a level down. SF work orders are human-consumed and phase-grouped; ours are Claude-Code-consumed and flat-sequence. Ours need: tighter scope, more explicit acceptance criteria, machine-readable dependency graph, explicit verification-gate hooks per work order. Will surface at the start of v0.3.
- **Sequence-regeneration trigger.** Coding loop regenerates the sequence when blueprints change. The `.sequence.meta.yaml` hash is the check, but *which* blueprint changes trigger full vs incremental re-gen is TBD. Start simple: any blueprint hash change → full re-gen; optimize later if wasteful.
- **`prd-to-frds` naming.** The skill name is misleading now that it also produces overview docs. Candidate renames: `prd-decomposer`, `prd-to-requirements-tree`, `decompose-prd`. Rename in v0.2 or v1.0.
- **Concurrent loop runs.** v1 runs one loop at a time. Can coding-loop execution drain in parallel with a blueprint-loop re-run (for a different area)? Plausible — different artifact trees, no conflict — but deferred.
- **Software Factory mirror.** Outbound sync to SF deferred until SF ships an upload API. Local layout already mirrors SF's entity model so integration is mechanical.
- **GitHub Projects mirror.** Optional read-mostly kanban for off-laptop visibility. Deferred.
- **Distribution mechanism.** Copy-per-project initially. Reconsider as Claude Code plugin, Python package, or git submodule after the second project.
- **Failure-recovery heuristics.** When should the orchestrator respawn a loop generator vs give up? Start with wall-clock cap + manual operator triage; refine based on observed failure modes.
- **Multiple concurrent work orders.** v1 runs one work order at a time during execution. Worktree-based parallelism plausible but deferred.
- **Status model.** Omitted `in_review` (PR review) and `blocked` as distinct statuses. Dependencies encoded in `.work-order.meta.yaml.blocked_by[]` and respected by the local planner's next-ready selection. Add if friction appears.
- **Non-web task shapes.** Playwright gate is web-shaped. Library/CLI work orders need a different behavioral surface (pure `pytest` sometimes suffices; TBD).
- **Inbound mirror sync.** All mirrors are push-only in v1. Pulling external edits back to local is deferred.
- **Ad-hoc review skills for blueprints / work orders / code.** For the PRD, the `prd-authoring` skill handles critique conversationally (see §6.1). Blueprint and work-order review currently only happen inside their respective autonomous loops; if the operator wants to critique mid-iteration or on a draft-before-loop basis, standalone overlay skills would be useful. Deferred until we see whether the loops' built-in reviewers are sufficient.
- **Reviewer-name prefixing consistency.** Coding-loop execution reviewers are unprefixed (`spec-judge`, `quality-judge`, …); other loops use `req-*` / `bp-*` / `wo-*` prefixes. Normalise to `code-*` for the execution reviewers in v1.0.

## 10. Milestones

Ship order mirrors the operator's actual workflow — author the PRD, then iterate on the next loop. Each milestone gets a real project run-through before the next starts.

### v0.1 — PRD authoring + Requirements Loop

- `prd-authoring` skill fully fleshed out (monolithic PRD drafting with senior-PM posture and critique on demand).
- `requirements-loop` orchestrator subcommand.
- `prd-to-frds` generator skill (autonomous, iterative).
- All four requirements-loop reviewer skills: `req-spec-judge`, `req-cross-doc-judge`, `req-coverage-judge`, `req-scoping-judge`.
- Loop-level state file + verdict parsing.
- `requirements/_questions-pending.md` mechanism and `awaiting_clarification` verdict wired up (dual completion condition: reviewers pass + zero open questions).
- `requirements_communication/` folder lifecycle wired up: orchestrator never wipes the folder, snapshots into `harness/state/reviews/requirements-loop/attempt-<N>/` at attempt boundaries for audit; the live folder accumulates the project's full conversation across all runs.
- Hooks: `Stop` on reviewer subprocesses validates the single-trailing-line `VERDICT: pass|fail` format; `PreToolUse` path-guard on reviewers blocks `Write`/`Edit` on any path other than the reviewer's own communication file.
- Per-subprocess retry budget (`max_agent_retries`, configurable, default 3): caps both (a) rate-limit re-spawns with doubling backoff (30s/60s/120s) and (b) Stop-hook in-session retries. Rate-limit retries exhaust the loop with `exhausted`; Stop-hook retries cap at the same number to prevent infinite hook ↔ model ping-pong, then fall through as a soft fail (verdict recorded as `fail`, loop continues). Independent of the loop-level attempt budget.
- No mirrors. Local only.

**Exit criteria**: I author a PRD in a new project repo, run `requirements-loop`, and end up with a reviewed FRD tree I'm willing to blueprint against.

### v0.2 — Blueprint Loop + non-blocking clarifications

- Blueprint artifact shape already pinned (three types: container / component / feature; full contract in `BLUEPRINT.md §11`). `blueprints/{containers,components,features}/` on-disk layout + meta files materialise per requirements-loop conventions.
- `blueprint-loop` orchestrator subcommand.
- `frd-to-blueprint` generator skill — single skill that writes all three blueprint types itself; appends question blocks to `blueprints/_questions-pending.md` (bare or with-options, options only when there's a genuine choice).
- `blueprint-authoring` interactive skill — operator-invoked for post-loop blueprint editing; not orchestrator-spawned.
- `blueprints_communication/` folder lifecycle wired up (same shape as requirements-loop).
- Orchestrator handles `awaiting_clarification` for the blueprint loop (same verdict and mechanism as requirements loop) + dual completion condition (all reviewers pass AND zero open questions = full pass).
- All four blueprint-loop reviewers: `bp-spec-judge`, `bp-coverage-judge`, `bp-consistency-judge`, `bp-decision-judge`.

**Exit criteria**: blueprint loop produces reviewed blueprints for the v0.1 project, with at least one real clarification cycle (loop stops with open questions → I answer → loop runs again and completes).

### v0.3 — Coding Loop sequence generation

- Pin the work-order artifact shape based on blueprint-loop learnings.
- `coding-loop` orchestrator subcommand with sequence generation only (execution deferred).
- `blueprint-to-tasks` + `scope-task` generator skills.
- All three sequence-gen reviewers: `wo-scoping-judge`, `wo-coverage-judge`, `wo-dependency-judge`.
- Flat `work-orders/wo-NNN/` layout; `.sequence.meta.yaml` for blueprint-change detection.

**Exit criteria**: reviewed, ready work-order sequence for the v0.2 project.

### v0.4 — Coding Loop execution (tests gate)

- Per-work-order execution subprocess wired into `coding-loop`.
- Tests gate only; no LLM reviewers yet.
- Generator opens PR on first pass.
- State file per work order; PR comment mirroring.
- One work order at a time; queue drain respects `blocked_by[]` + `sort_order`.

**Exit criteria**: first work order merged to `main` of the v0.3 project from an autonomous coding-loop run.

### v0.5 — Coding Loop LLM reviewers

- `spec-judge`, `regression-judge`, `security-judge`, `quality-judge` gates.
- Playwright gate for UI-touching work orders (`run-playwright-check`).
- Status transitions fully automated end-to-end across all three loops.

### v1.0 — Polish

- Software Factory mirror (when SF ships an upload API).
- Operator documentation: README, runbook, failure-mode catalog from first 20 real work orders.
- Skill/reviewer-name consistency pass (coding-loop execution reviewers rename to `code-*`).
- Ad-hoc operator-invokable review skills for each artifact type (blueprint, work-order, code).
- `index-updater` agent and `harness/index.md`.

---

*Version: 0.2-draft · Last updated: 2026-04-21*
