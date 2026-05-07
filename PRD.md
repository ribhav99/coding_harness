---
cssclasses:
  - wide-mermaid
---

# Coding Harness

## 1. Overview

A reusable harness for running long-horizon software engineering work through Claude Code autonomously, with verification as the primary correctness gate. The project goes through five stages — one manual, four autonomous (three upstream-loop and one execution):

1. **Manual PRD authoring.** Operator writes a single `PRD.md` at the project repo's root with the `prd-authoring` skill (interactive, Claude-assisted). One monolithic prose document.
2. **Requirements Loop** (upstream, autonomous, with non-blocking clarification questions). Reads the root `PRD.md` and decomposes it into the full structural tree: product-overview sections (business problem, personas, product description, success metrics, etc. — the `requirements/overview/` tree) *and* Feature Requirements Documents (`requirements/features/` tree). Reviews against four rubrics (spec structure, cross-doc consistency, PRD-coverage, feature scoping) and iterates until all pass. When the PRD itself is ambiguous or contradictory, the generator logs questions to `requirements/_questions-pending.md` and keeps working on everything else; the operator resolves by editing `PRD.md`.
3. **Blueprint Loop** (upstream, autonomous, with non-blocking clarification questions). Produces technical blueprints from approved FRDs across three blueprint types (container, component, feature). When the generator hits an architectural choice that requires operator judgment (tech stack, framework, hosting model, ORM, auth provider), it logs a question to `blueprints/_questions-pending.md` and keeps generating everything else. Questions can be bare ("what does X mean?") or carry 2–4 pre-researched options with pros/cons and a recommended default when the choice is genuine. The loop exits either when all reviewers pass and there are no open questions (full pass), or when it has done as much as it can and can't make further progress without operator input (`awaiting_clarification` — same exit verdict as the requirements loop). The operator answers in the file and re-triggers the loop. Cycle continues until all questions are resolved and all reviewers pass.
4. **Work-Orders Loop** (upstream, autonomous, with non-blocking clarification questions). Decomposes approved blueprints into a flat tree of slug-named work orders under `work-orders/` (one `wo-<slug>.md` plus `.wo-<slug>.meta.yaml` per work order, no per-WO directories), plus a separate `_sequence.md` recording the execution order. The work order's `Depends on` block plus the `_sequence.md` order encode the dependency graph. Reviews against four rubrics (structural conformance + content quality, blueprint coverage, no-overlap of produced surface, sequencing correctness — both structural and semantic). When the generator hits a decomposition ambiguity (overlapping responsibilities between blueprints, an unclear capability boundary), it logs a bare question to `work-orders/_questions-pending.md` and keeps decomposing the rest. Same `awaiting_clarification` exit mechanism as the requirements and blueprint loops. The operator clarifies the source artifact (typically a blueprint) and re-triggers.
5. **Coding Loop** (execution, autonomous). Drains the ready work-order queue produced by the work-orders loop, executing each work order in dependency order on `task/<id>` branches with its own reviewer stack and PR-per-work-order flow. The work-order document shape (atomicity rule, structured `Produces`/`Depends on`/`Gates` blocks, acceptance-criteria schema) is what makes per-work-order execution mechanically verifiable rather than guesswork. The coding loop does not generate work orders; that is the work-orders loop's job.

Each autonomous loop has the same shape: orchestrator spawns a generator → orchestrator spawns each reviewer → orchestrator aggregates verdicts → if any fail, orchestrator re-spawns the generator with the aggregated feedback → if all pass, artifact is committed. The orchestrator owns the loop; generators and reviewers are single-purpose subprocesses. The three upstream loops (requirements, blueprint, work-orders) share identical plumbing — communication folders, dual completion condition, `awaiting_clarification` exit verdict, no PR for output. The coding loop is execution-only — per-work-order subprocesses, PR-per-work-order, no communication folder; reviewer content lives in stdout and on the PR.

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
- Keep the orchestration surface small: thin Python loop + rich in-session hooks/skills/agents. The same upstream-loop driver runs all three upstream autonomous loops, parameterized by which generator + reviewers to spawn; the coding loop reuses the same subprocess plumbing for its per-work-order execution stack.
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
8. **Clarification questions are first-class, and non-blocking.** All three upstream autonomous loops surface operator-required input via the same mechanism: an append-only `_questions-pending.md` file alongside the artifact tree (`requirements/_questions-pending.md` for the requirements loop, `blueprints/_questions-pending.md` for the blueprint loop, `work-orders/_questions-pending.md` for the work-orders loop). The block shape differs by loop because the response shape differs: requirements-loop questions are always bare ("what does X mean?", "did you intend Y or Z?") since the answer is "clarify the PRD" — there's nothing for the generator to pre-research; blueprint-loop questions are bare *or* carry 2–4 pre-researched options with pros, cons, and a recommended default when the choice is genuine (e.g. "Postgres vs DynamoDB"); work-orders-loop questions are always bare since the answer is "clarify the relevant blueprint (or seed work order)" — there's nothing for the generator to pre-research. In all three loops, the generator keeps producing everything that doesn't depend on the blocked input, and the loop only terminates as incomplete when it has done as much as it can. The operator resolves asynchronously; subsequent loop runs consume the answers and continue. All three loops exit with the same `awaiting_clarification` verdict — one mechanism, one verdict, three file locations.

## 5. Architecture

The project lives in a single git repo containing the operator's `PRD.md` at the root plus generated trees for `requirements/`, `blueprints/`, `work-orders/`, `artifacts/`, and `harness/` state. A reusable kit — the coding harness itself — hosts the orchestrator, skills, and agents that drive the four autonomous loops. External mirrors (Software Factory, GitHub Projects) are optional outbound sync targets.

### 5.1 Layers of responsibility

| Concern | Owner |
|---|---|
| PRD / Product Overview authoring | Operator + `prd-authoring` skill (manual, interactive) |
| FRD decomposition + review + iteration | Requirements loop (§6.2) |
| Blueprint synthesis + review + iteration, clarification questions | Blueprint loop (§6.3) |
| Work-order generation + scoping + dependency graph | Work-orders loop (§6.4) |
| Per-work-order code execution | Coding loop (§6.5) |
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

One project, end to end. Five stages: a manual PRD-authoring stage followed by four autonomous loops. The first three autonomous loops (requirements, blueprint, work-orders) are *upstream* loops — they each use the same mechanic: orchestrator spawns a generator, then spawns each reviewer; the generator and reviewers communicate bidirectionally through files in a per-loop communication folder (`<loop>_communication/<reviewer-name>.md`); the orchestrator aggregates `VERDICT:` lines from reviewer stdouts, re-spawns the generator on any fail, commits on all-pass. The three upstream loops share state-file plumbing, communication-folder plumbing, reviewer review snapshots, dual completion condition (all reviewers pass AND `_questions-pending.md` empty), and budget enforcement. They differ in generator skill, reviewer set, and target artifact tree.

The fourth autonomous loop (coding) is *execution-only* — per-work-order subprocess, PR-per-work-order flow, reviewer content in stdout and on the PR. No communication folder; the artifact under review is a `git diff` rather than a prose document.

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

**Session continuity within an invocation.** By default the generator and each reviewer run as a single Claude Code session that persists across attempts within one orchestrator invocation: attempt 1 spawns fresh with `--session-id <uuid>`; attempts 2+ re-use the same id via `--resume <uuid>` and receive a short follow-up message naming the failing reviewers and listing the working-tree changes since the previous attempt (or "made updates" if a diff isn't readily available). This preserves the agent's reasoning and pushes-back across attempts without re-paying the cost of re-reading every file from scratch. New invocations always start fresh — session ids are per-invocation, never persisted across `python -m orchestrator …` runs. The `--memoryless` CLI flag overrides the default and forces every spawn to be a fresh session, falling back on the communication folder as the only memory channel — useful when the operator has edited the PRD or the artifact tree between attempts and wants the agents to re-derive without prior bias. Full re-review still applies (all reviewers run every attempt) regardless of session mode.

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

### 6.4 Stage 4 — Work-Orders Loop (autonomous, non-blocking clarification questions)

**Trigger.** `python -m orchestrator work-orders-loop`.

**Generator.** A single `claude -p` subprocess running with the `blueprint-to-work-orders` skill. It reads `blueprints/` and produces a flat tree of slug-named work orders under `work-orders/`, plus a separate `_sequence.md` recording the execution order. No phase groupings, no per-WO directories, no `wo-NNN` numbering — work orders live as flat `wo-<slug>.md` + `.wo-<slug>.meta.yaml` pairs. Existing work orders are read first so partial regeneration works; on every invocation the generator compares the current blueprint-tree hash against the hash recorded in `work-orders/.sequence.meta.yaml` and short-circuits if blueprints are unchanged and there are no failing reviews to address.

**Work-order document shape.** Pinned. Each work order's `wo-<slug>.md` follows the canonical shape: `# Title`, optional `## Type` (right after the title; values are `feature` | `refactor` | `bug-fix` | `infra` | `operator-action`), `## Goal`, `## Blueprints`, `## In scope`, `## Out of scope`, `## Produces` (fenced YAML listing produced interfaces with `kind`/`name`/`contract` fields), `## Depends on` (fenced YAML with `work_orders` and `interfaces` lists), `## Acceptance criteria`, `## Gates` (omitted for operator-action work orders), and an optional `## Implementation notes (non-binding)`. For agent-executable work orders (any `Type` other than `operator-action`), AC rows take the format `- [ ] AC-WO-<slug>.M (via tests|playwright|code-spec) — Outcome` with the bare gate key, and `## Gates` is a fenced YAML block declaring `tests`/`playwright`/`code-spec`/`code-regression`/`code-security`/`code-quality` as `required` or `not_applicable`. **For operator-action work orders, AC rows omit the `(via <gate>)` tag** (the operator manually verifies — `- [ ] AC-WO-<slug>.M — Outcome the operator can confirm`) and the `## Gates` section is omitted entirely (the agent never runs them). Full contract in `requirements/features/work-orders-loop.md` REQ-WO-002. The structured fenced blocks turn what would otherwise be human prose into a machine-readable dependency graph and gate declaration; `wo-sequencing-judge` resolves every `interfaces` entry to a concrete `Produces` entry mechanically; the orchestrator materialises `.wo-<slug>.meta.yaml.blocked_by[]` from `Depends on.work_orders`.

**Mention syntax.** Two cross-artifact link types: `#<blueprint-slug>` for references to a blueprint (resolves to `blueprints/{containers,components,features}/<slug>.md`); `@wo-<slug>` for references to another work order by ID.

**Sequence file.** `work-orders/_sequence.md` lists every work order's slug in execution order, top to bottom, as a numbered markdown list with each entry as a backticked `wo-<slug>` ID. The sequence is mutable; the operator may re-order it before re-running the loop. The orchestrator's `pick_next` walks `_sequence.md` top to bottom and selects the first work order whose `status: ready`, whose `blocked_by[]` are all `done`, and whose `type` is not `operator-action`.

**Operator-action work orders.** Some work orders represent work the operator must do themselves (set up OAuth credentials, obtain sample data, configure a third-party service). These are flagged at authoring time with `type: operator-action` in the meta. The orchestrator's coding-loop drain skips them; they appear in `work-orders/_external-blockers.md` (a single operator-readable file aggregating both anticipated operator-action work orders and discovered mid-execution blockers — see §6.5).

**Non-blocking clarification questions.** When the generator hits a decomposition ambiguity (overlapping responsibilities between blueprints, an unclear capability boundary), it appends a bare-question block to `work-orders/_questions-pending.md` and keeps decomposing. Same mechanism as the requirements loop — bare questions only (no with-options shape), since the resolution is the operator clarifying a source artifact (typically a blueprint), not picking between alternatives. The operator answers by editing the source, deletes resolved blocks, and re-triggers the loop.

**Reviewer ↔ generator communication folder.** Live conversation between the generator and the four reviewers happens in `work-orders_communication/` at the project root (sibling to `work-orders/`). One file per agent (`blueprint-to-work-orders.md` for the generator, plus `wo-spec-judge.md`, `wo-coverage-judge.md`, `wo-overlap-judge.md`, `wo-sequencing-judge.md` for the reviewers). Append-only conversation transcripts; both sides read and write. Same lifecycle as the requirements and blueprint loops: orchestrator ensures the folder exists, snapshots to `harness/state/reviews/work-orders-loop/attempt-<N>/` at attempt boundaries, and never wipes — the folder accumulates the full conversation across attempts and across invocations forever, so a re-run after any exit verdict sees the prior conversation as context.

**Reviewers.** Orchestrator spawns four: `wo-spec-judge` (structural conformance + content quality — sections, fenced YAML, AC format, observable Goal, atomicity, content not vague, no breadcrumbs), `wo-coverage-judge` (every blueprint's delivery surface mapped to at least one work order; mention resolution; AC↔gate consistency), `wo-overlap-judge` (no two work orders' `Produces` lists collide on `kind`+`name`), `wo-sequencing-judge` (dependency graph acyclic, references resolve, `_sequence.md` is a valid topological sort, plus the **semantic** check that each declared dependency reflects a real consumption and no required dependencies are missing). See §8.3 for rubric detail.

**Output.** Approved `work-orders/` tree on full pass, with all agent-executable work orders at `status: ready` and operator-action work orders at `status: ready` (ready *for the operator*). The orchestrator commits the tree (every `wo-<slug>.md`, every `.wo-<slug>.meta.yaml`, `_sequence.md`, `_external-blockers.md` if present, and `.sequence.meta.yaml`). No PR — git history is the audit trail.

### 6.5 Stage 5 — Coding Loop (autonomous, execution-only)

**Trigger.** `python -m orchestrator coding-loop`.

The coding loop is execution-only. It reads the work-orders tree produced by the work-orders loop and drains the ready queue in dependency order, one work order per orchestrator subprocess. Sequence generation is not part of this loop; if blueprints have changed and the work-orders sequence needs refreshing, the operator runs `python -m orchestrator work-orders-loop` first.

**Sequence execution** (drains the ready queue in dependency order):

1. At the start of an invocation, the orchestrator checks each `in_progress` work order for a merged PR matching its branch name `task/<wo-slug>` and transitions any matched work order to `done`. The orchestrator never auto-merges; merge is always operator-driven. The orchestrator also regenerates `work-orders/_external-blockers.md` from current meta state (aggregating operator-action work orders and `blocked_external` work orders).
2. Orchestrator's `pick_next` walks `work-orders/_sequence.md` top to bottom, returning the first work order whose `status: ready`, whose `blocked_by[]` are all `done`, and whose `type` is not `operator-action`. Moves it to `in_progress`, initializes `harness/state/<wo-slug>.json`, sets `execution.branch = "task/<wo-slug>"`.
3. Orchestrator spawns one generator subprocess — `claude -p "<prompt>"` with the scoped-task body (`work-orders/wo-<slug>.md`) injected inline. A single subprocess per work order; the generator handles its gen/review cycle internally.
4. Generator works on branch `task/<wo-slug>`. First pass commits, pushes, opens a PR via the `open-task-pr` skill (idempotent).
5. Generator exits with a summary ending in a `VERDICT:` trailer carrying each gate's result. Orchestrator reads the work order's `## Gates` block and spawns the gates declared `required`: tests, Playwright (if `playwright: required`), `code-spec-judge`, `code-regression-judge`, `code-security-judge`, `code-quality-judge`. Run in fastest-first order. See §8.4 for rubric detail.
6. Orchestrator aggregates.
   - Any fail → re-spawn generator with aggregated reviews; generator fixes, pushes back, or files gaps.
   - All pass → post final summary as a PR comment; PR is ready for operator merge.
   - Budget: wall-clock cap per subprocess, attempt cap per invocation.
7. Operator reviews and merges when satisfied.

**Discovered external blockers.** When a per-work-order generator discovers mid-execution that it cannot proceed without operator action (missing credentials, missing external data, missing third-party setup), it transitions the work order's `.wo-<slug>.meta.yaml.status` to `blocked_external`, appends a description of the blocker to `work-orders/_external-blockers.md`, and exits cleanly. The orchestrator records the verdict and moves on without retrying. The operator clears the blocker (does the external thing) and transitions the work order's `status` back to `ready`; the next coding-loop run picks it up.

**Queue drain.** By default, a single `coding-loop` invocation drains all work orders whose dependencies are ready, in order. A `--one` flag runs one work order and exits.

**No communication folder.** The coding loop does not use the communication-folder mechanism. Per-work-order execution review content lives in stdout (captured by the orchestrator) and on the PR (commits + posted summary comment). The artifact under review — a `git diff` — already lives on disk and in git, so the prose-conversation transcript pattern that the upstream loops use is not the right fit here.

#### 6.5.1 Gap filing

When the per-work-order generator discovers a missing prerequisite, a latent bug adjacent to changed code, or a useful refactor outside the current work order's scope, it creates a `backlog` work order under `work-orders/_backlog/wo-<slug>.md` (the slug chosen by the agent, descriptive and kebab-case) with a back-reference to the originating work order. The operator triages on their own cadence; gaps never auto-promote to `ready`. After triage, accepted gaps move into the main `work-orders/` tree (typically by re-running the work-orders loop with the gap as seed input).

The upstream loops do not file gaps — they log clarification questions to `_questions-pending.md` in their artifact tree (§6.2, §6.3, §6.4). Different mechanisms because the response shape differs (clarify the source artifact vs. queue new code work).

## 7. Components

### 7.1 Python orchestrator

Entry point: `python -m orchestrator <subcommand>`. Subcommands: `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, `status`. The operator runs one subcommand at a time; loops are not daemons. Each subcommand drives one autonomous loop, spawning generator and reviewer subprocesses per §6 and committing artifacts on pass.

The orchestrator's full responsibilities: detect merged PRs and transition work orders to `done`, spawn generator and reviewer subprocesses with composed prompts, aggregate reviewer `VERDICT:` lines from stdout and decide retry vs pass vs exhaust, manage the per-loop communication folder for each upstream loop (ensure it exists, snapshot to `harness/state/reviews/<loop>/attempt-<N>/` at attempt boundaries; never wipe — it accumulates the full project conversation), materialise `.work-order.meta.yaml.blocked_by[]` from the work order's `Depends on` block on work-orders-loop pass, commit artifact changes on pass when a git repo is present, post PR comments on coding-loop execution, handle the upstream-loop `awaiting_clarification` exit (same verdict across all three upstream loops).

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
  work-orders/                         # generated in Stage 4 (flat, slug-named files)
    _questions-pending.md              # only present while decomposition-clarification questions are open (§6.4)
    _questions-resolved-*.md           # optional audit-log of resolved questions
    _sequence.md                       # ordered list of wo-<slug> IDs; mutable; defines drain order
    _external-blockers.md              # operator-action WOs + discovered blockers; present only when blockers exist
    .sequence.meta.yaml                # blueprints hash + generation timestamp (for change detection)
    wo-<slug>.md                       # one per work order; scoped-task body (per work-orders-loop FRD REQ-WO-002)
    .wo-<slug>.meta.yaml               # id (= slug), status, priority, type, parent_id, blocked_by[], blueprint_ids[]
    _backlog/                            # gaps filed by the coding loop (§6.5.1); flat wo-<slug>.md files; operator triages
  work-orders_communication/           # bidirectional gen↔reviewer channel for the work-orders loop (§6.4)
    blueprint-to-work-orders.md        # generator's outbound
    wo-spec-judge.md                   # one file per reviewer
    wo-coverage-judge.md
    wo-overlap-judge.md
    wo-sequencing-judge.md
  artifacts/{folder-slug}/...          # Artifact folder tree
  harness/
    state/<wo-slug>.json               # per-work-order state (§7.3)
    state/requirements-loop.json       # loop-level state
    state/blueprint-loop.json          # loop-level state
    state/work-orders-loop.json        # loop-level state for the work-orders loop
    state/reviews/<loop>/[<wo-slug>/]attempt-<N>/<reviewer>.md   # snapshots from communication folders (upstream loops) or stdout (coding execution)
    logs/<wo-slug>/...                 # hook/session logs
```

**Key shape facts:**
- **`PRD.md` at root.** The operator-authored monolithic PRD (Stage 1). Input to the requirements loop; never edited by any autonomous loop.
- **`requirements/` is generated.** Nodes are flat at each level: a `<slug>.md` visible content file plus two dotted-hidden meta files (`.<slug>.<overview|feature>.meta.yaml` and `.<slug>.requirements.meta.yaml`) as siblings. If a node has children, a sibling directory `<slug>_children/` holds them with the same flat shape, recursively. The `_children` suffix is reserved — kebab-case slugs never contain underscores.
- **Meta files are orchestrator-managed.** Generators write only the visible `<slug>.md` content file. The orchestrator materialises the two dotted-hidden meta files per node after the generator exits, deriving titles from each doc's first H1 and setting IDs to `null` for later mirror sync to populate.
- **`work-orders/` is flat** (no per-WO directories, no phase groupings). Work orders are slug-named flat files (`wo-<slug>.md` + `.wo-<slug>.meta.yaml`). Drain order lives in `_sequence.md` (a mutable numbered list of work-order slugs); `blocked_by[]` in each meta provides dependency constraints. Together these encode everything SF used phase groupings for, and slugs being stable means re-ordering `_sequence.md` doesn't break any cross-references.
- **`.sequence.meta.yaml`** at the work-orders dir level records the hash of the blueprint tree at the time the sequence was generated. On each `coding-loop` run, the orchestrator compares the current blueprint hash to this; if changed, it triggers a regeneration before draining.

A reference skeleton lives at `project-template/` inside this kit repo. Clone it into a new project repo to start.

**`blueprints/` subtree** has the same per-node shape as `requirements/` (visible `<slug>.md` plus two dotted-hidden meta files), divided into three subdirectories — `containers/`, `components/`, `features/` — corresponding to the three blueprint types. Feature-blueprint slugs are 1:1 with `requirements/features/<slug>.md` (enforced by `bp-coverage-judge`). Per-type document shape (sections, mention syntax, fenced blocks, ADRs) is pinned in `BLUEPRINT.md §11`.

**Communication folders** (`requirements_communication/`, `blueprints_communication/`, `work-orders_communication/`) sit at the project root, sibling to the artifact trees. Each holds one markdown file per agent in the loop (one for the generator, one per reviewer) — append-only conversation transcripts. Both the generator and the named reviewer read and write the file; the orchestrator never wipes the folder — it accumulates the project's full reviewer-generator conversation across attempts and across invocations forever. The orchestrator snapshots it to `harness/state/reviews/<loop>/attempt-<N>/` at attempt boundaries for audit. Lifecycle and race-condition argument live in `BLUEPRINT.md §1.8`.

**Work-order document shape** is pinned in `requirements/features/work-orders-loop.md` REQ-WO-002 (sections, structured fenced YAML blocks for `Produces`/`Depends on`/`Gates`, acceptance-criteria schema, mention syntax).

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

**Work-orders-loop skills** (autonomous):

- `blueprint-to-work-orders` *(generator, LLM work)* — sole loop generator. Reads `blueprints/`, the existing `work-orders/` tree (every `wo-<slug>.md` and `_sequence.md`), `work-orders/_questions-pending.md`, and `work-orders/.sequence.meta.yaml`. Produces the full work-order tree as flat slug-named files plus a `_sequence.md` recording execution order, writing each `wo-<slug>.md` directly in the canonical document shape (§6.4 / `requirements/features/work-orders-loop.md` REQ-WO-002). Marks operator-action work orders with `type: operator-action` in their meta when the work is something the operator must do themselves. No separate "stub then expand" step. Reads each reviewer's communication file in `work-orders_communication/` and appends per-finding responses (fix / push back / surface to operator) plus a change-summary on retries. Files bare-question blocks to `work-orders/_questions-pending.md` for decomposition ambiguities.
- `wo-spec-judge`, `wo-coverage-judge`, `wo-overlap-judge`, `wo-sequencing-judge` *(reviewers, LLM-as-judge)* — per §6.4 / §8.3. Each reads its own communication file in `work-orders_communication/<reviewer-name>.md`, runs its review, and appends the review block to that same file.

**Coding-loop skills — execution** (autonomous, one subprocess per work order):

- `open-task-pr` *(tool-wrapper)* — how the generator opens a PR on its first internal pass: branch naming (`task/<wo-slug>`), commit, push, `gh pr create`. Idempotent.
- `run-playwright-check` *(tool-wrapper)* — how to run Playwright against a locally-booted dev server.
- `code-spec-judge` *(reviewer, LLM-as-judge)* — walks the work order's acceptance-criteria checklist mechanically; for each `AC-WO-<slug>.M (via code-spec)` row, verifies the diff or running app satisfies the declared expected outcome; for criteria tagged `via tests` or `via playwright`, verifies they were actually exercised by their respective gates.
- `code-regression-judge` *(reviewer, LLM-as-judge)* — checks the diff for unintended breakage outside the changed lines.
- `code-security-judge` *(reviewer, LLM-as-judge)* — OWASP-class issues in the diff.
- `code-quality-judge` *(reviewer, LLM-as-judge)* — structural + textual maintainability of the diff.

Each reviewer skill runs in a fresh Claude Code context with a scoped prompt — it sees only the artifacts it needs to review plus the path to its communication file. Reviewers in the upstream loops (requirements, blueprint, work-orders) are spawned with `--disallowedTools Bash,NotebookEdit`; `Write` and `Edit` are allowed so the reviewer can append its review to its own communication file, but a `PreToolUse` path-guard hook (§7.5) blocks any path other than that file. Reviewers in the coding-loop's per-WO execution stack run with the original `--disallowedTools Write,Edit,NotebookEdit,Bash` since they don't use the communication-folder mechanism. In all cases, the orchestrator greps the trailing `VERDICT:` line from the reviewer's stdout, archives the full review (from the communication file for upstream loops, from stdout for coding-loop execution), and aggregates.

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

**Dual completion condition.** Same shape as the requirements loop: `pass` requires both all four reviewers pass AND `blueprints/_questions-pending.md` has zero unanswered questions. If reviewers pass but questions remain, the loop exits `awaiting_clarification` (not `fail`) — artifact is committed, state is saved, operator answers and re-triggers. One mechanism, one verdict, three file locations across the three upstream loops (`requirements/_questions-pending.md`, `blueprints/_questions-pending.md`, `work-orders/_questions-pending.md`).

### 8.3 Work-orders loop (4 gates + dual completion condition)

Reviewer subagents (all LLM-as-judge):

- **`wo-spec-judge`** — structural conformance + content quality. Sections present in canonical order; `## Type` (when present) is right after the title with a valid value; fenced ` ```yaml ` blocks parse and have required keys; for agent-executable work orders, AC rows match `AC-WO-<slug>.M (via <gate>) — <outcome>` format and a six-key `## Gates` block is present; for operator-action work orders, AC rows omit the `(via <gate>)` tag and `## Gates` is absent; Goal is one observable, non-vague sentence; In/Out scope concrete and non-contradictory; produced interface contracts are detailed enough that a downstream work order could consume them; AC rows are concrete and binary, never vague; implementation notes useful or absent, never prescriptive; atomicity rule (one cohesive change per work order); no refactor breadcrumbs. Fanned out per-work-order so failures are attributable.
- **`wo-coverage-judge`** — three checks: (a) every approved blueprint's delivery surface (component blocks, model blocks, feature commitments) maps to at least one work order via a `#<blueprint-slug>` mention; (b) every `#<blueprint-slug>` mention resolves to an existing file in `blueprints/{containers,components,features}/<slug>.md`; (c) for agent-executable work orders, every acceptance criterion declares an observation gate (`tests`, `playwright`, or `code-spec`) that the gate set in `## Gates` actually declares `required`. Operator-action work orders skip check (c) — their AC rows are operator-verified prose without gate tags.
- **`wo-overlap-judge`** — single check: no two work orders' `## Produces` blocks list entries with the same `kind` + `name` pair. Exactly one work order owns a given interface; if two claim it, the implementing agent for the second one will conflict with the first's output.
- **`wo-sequencing-judge`** — both **structural** and **semantic** checks. Structural: (a) the dependency graph derived from each work order's `Depends on.work_orders` is acyclic; (b) every `Depends on.interfaces` entry resolves to a `Produces` entry of the named upstream work order; (c) `_sequence.md` is a valid topological sort (no work order appears before any of its declared dependencies). Semantic: (d) does each declared dependency reflect a real consumption (vs. an unnecessary or fabricated dependency); (e) are there missing dependencies (a work order needs another's output but didn't say so); (f) could the sequence be tightened (a work order positioned later than necessary).

**Dual completion condition.** Same shape as the requirements and blueprint loops: `pass` requires both all four reviewers pass AND `work-orders/_questions-pending.md` has zero unanswered questions. If reviewers pass but questions remain, the loop exits `awaiting_clarification` (not `fail`) — work-orders tree is committed, state is saved, operator clarifies the named source artifact and re-triggers. One mechanism, one verdict, three file locations now (one per upstream loop).

### 8.4 Coding loop — per-work-order execution (6 gates)

Two execution gates + four LLM-as-judge gates. The orchestrator reads each work order's `## Gates` block to decide which gates to spawn (`required` → run; `not_applicable` → skip).

- **Gate 1 — Tests** *(execution)*. Existing and newly-added test suites pass via `make test`. Non-zero exit = fail. Skipped if `tests: not_applicable` (rare; doc-only work orders).
- **Gate 2 — Playwright** *(execution)*. Running app behaves per ticket. Playwright exit code + screenshots. Skipped if `playwright: not_applicable` (the explicit signal for non-UI work orders such as pure-library work). Uses the `run-playwright-check` skill, which wraps booting the local dev server, running the Playwright suite against it, and tearing down.
- **Gate 3 — `code-spec-judge`** *(LLM)*. Walks the work order's acceptance-criteria checklist mechanically; for each `AC-WO-<slug>.M (via code-spec)` row, verifies the diff satisfies the declared expected outcome; for `via tests` and `via playwright` rows, verifies the relevant gate exercised the criterion. Always `required`.
- **Gate 4 — `code-regression-judge`** *(LLM)*. Diff breaking code outside changed lines: shared utilities, sibling call sites, existing tests now exercising changed paths, implicit contracts (types, docstrings, README claims). Always `required`.
- **Gate 5 — `code-security-judge`** *(LLM)*. Injection, auth/authz gaps, secret handling, input validation at boundaries, crypto misuse, unsafe deserialization, SSRF, OWASP Top 10 patterns. Always `required`.
- **Gate 6 — `code-quality-judge`** *(LLM)*. Structural maintainability (module boundaries, layering, coupling, abstraction level) + textual (naming, duplication, dead code, over-abstraction, test quality, API shape, nearby convention adherence). Explicitly does *not* re-verify correctness. Always `required`.

Fastest-first ordering for short-circuit: tests → playwright → code-spec → code-regression → code-security → code-quality. Orchestrator can run reviewers in parallel once serial bottlenecks show up; the initial implementation is serial.

### 8.5 On pass (universal)

- Generator's `VERDICT:` trailer has every gate = `pass` (or `not_run` for gates declared `not_applicable` in the work order's `## Gates` block).
- **Upstream-loop passes (requirements / blueprint / work-orders)**: orchestrator commits the artifact changes, writes a loop-level history entry, exits.
- **`awaiting_clarification`** (any upstream loop): orchestrator commits current progress (partial tree + updated questions doc), writes a history entry, prints an operator-facing summary of the open questions, leaves the live communication folder in place for operator inspection, exits with code 2. Not a failure state — operator clarifies the relevant source artifact (edits `PRD.md` for requirements-loop questions; fills in `Your answer:` for blueprint-loop with-options questions; clarifies the source artifact named in the question's `Where:` field for work-orders-loop questions), then re-runs.
- **Per-work-order-execution pass** (coding loop): the PR already exists. Orchestrator posts a final pass-comment summarizing the verdict; notifies the operator. Status stays `in_progress` until merge. On merge, the next `coding-loop` invocation detects the merged PR (by branch `task/<wo-slug>`) and updates `.wo-<slug>.meta.yaml` to `done`.
- Merge is always operator-driven. The harness never auto-merges. Committing upstream-loop artifacts (requirements, blueprint, work-orders) is orchestrator-driven (no PR for upstream loops — the artifacts *are* the PR-review surface for the next loop).

## 9. Deferred / Open Questions

- ~~**Blueprint artifact shape.**~~ Resolved. Three blueprint types pinned: container, component, feature. Per-type document shape (sections, mention syntax, fenced `component`/`model` blocks, ADRs) adopted from the SF blueprints module's seeded category presets. On-disk layout (`blueprints/{containers,components,features}/<slug>.md` + `.<slug>.<kind>.meta.yaml` + `.<slug>.requirements.meta.yaml`) mirrors `requirements/`. Full contract in `BLUEPRINT.md §11`.
- ~~**Work-order artifact shape.**~~ Resolved. Per-work-order document shape pinned: `# Title`, optional `## Type` (`feature` | `refactor` | `bug-fix` | `infra` | `operator-action`), `## Goal`, `## Blueprints`, `## In scope`, `## Out of scope`, `## Produces` (fenced YAML), `## Depends on` (fenced YAML), `## Acceptance criteria`, `## Gates` (omitted for operator-action), optional `## Implementation notes (non-binding)`. For agent-executable work orders, AC rows are `- [ ] AC-WO-<slug>.M (via tests|playwright|code-spec) — Outcome` and `## Gates` is a six-key fenced YAML block; for operator-action work orders, AC rows omit the `(via <gate>)` tag and `## Gates` is absent. Full contract in `requirements/features/work-orders-loop.md` REQ-WO-002.
- ~~**Sequence-regeneration trigger.**~~ Resolved. Any blueprint-tree hash change triggers a full work-orders-loop re-run; the work-orders-loop generator short-circuits when the hash matches and no failing reviews are pending. Optimisation deferred until wasteful re-gen is observed.
- ~~**Reviewer-name prefixing consistency.**~~ Resolved. Coding-loop execution reviewers are now `code-*`-prefixed (`code-spec-judge`, `code-regression-judge`, `code-security-judge`, `code-quality-judge`); naming is consistent across all loops (`req-*`, `bp-*`, `wo-*`, `code-*`).
- **`prd-to-frds` naming.** The skill name is misleading now that it also produces overview docs. Candidate renames: `prd-decomposer`, `prd-to-requirements-tree`, `decompose-prd`. Plan to rename.
- **Concurrent loop runs.** The harness runs one loop at a time. Can coding-loop execution drain in parallel with a blueprint-loop re-run (for a different area)? Plausible — different artifact trees, no conflict — but deferred.
- **Software Factory mirror.** Outbound sync to SF deferred until SF ships an upload API. Local layout already mirrors SF's entity model so integration is mechanical.
- **GitHub Projects mirror.** Optional read-mostly kanban for off-laptop visibility. Deferred.
- **Distribution mechanism.** Copy-per-project initially. Reconsider as Claude Code plugin, Python package, or git submodule after the second project.
- **Failure-recovery heuristics.** When should the orchestrator respawn a loop generator vs give up? Start with wall-clock cap + manual operator triage; refine based on observed failure modes.
- **Multiple concurrent work orders.** The harness runs one work order at a time during execution. Worktree-based parallelism plausible but deferred.
- **Status model.** Omitted `in_review` (PR review) and `blocked` as distinct statuses. Dependencies encoded in `.work-order.meta.yaml.blocked_by[]` and respected by the local planner's next-ready selection. Add if friction appears.
- **Non-web task shapes.** Playwright gate is web-shaped. Library/CLI work orders declare `playwright: not_applicable` in their `## Gates` block; a future iteration may add a behavioral surface for non-web work orders (pure `pytest` sometimes suffices).
- **Inbound mirror sync.** All mirrors are push-only. Pulling external edits back to local is deferred.
- **Ad-hoc review skills for blueprints / work orders / code.** For the PRD, the `prd-authoring` skill handles critique conversationally (see §6.1). Blueprint and work-order review currently only happen inside their respective autonomous loops; if the operator wants to critique mid-iteration or on a draft-before-loop basis, standalone overlay skills would be useful. Deferred until we see whether the loops' built-in reviewers are sufficient.

