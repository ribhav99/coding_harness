# Agents and Skills

## Capability Summary

Agents and skills are the LLM-side surface of the harness — role-specialised prompts under `.claude/agents/` and short `SKILL.md` files under `.claude/skills/`. Agents define identity (lead PM for requirements, lead engineer for blueprints, lead tech lead for work-orders, IC for per-work-order execution); skills define how-to (generator skills for autonomous tree generation; reviewer skills as LLM-as-judge rubrics; interactive skills like `prd-authoring` and `blueprint-authoring` for operator-driven sessions). Every loop's generator and reviewer subprocesses load one of these; deterministic mechanics live in the orchestrator, not in skills.

## Core Components

### Generator agents

```component
name: RequirementsGeneratorAgent
container: Claude Code Subprocess
responsibilities:
	- Identity: lead product manager
	- Loads `prd-to-frds` skill
	- Writes `requirements/overview/` and `requirements/features/` trees from `PRD.md`; may append to `requirements/_questions-pending.md` for PRD ambiguities
	- Reads/writes `requirements_communication/` per @Blueprint(communication-folder)
	- Emits `VERDICT: ready_for_review` or `VERDICT: awaiting_clarification`
```

```component
name: BlueprintGeneratorAgent
container: Claude Code Subprocess
responsibilities:
	- Identity: lead engineer
	- Loads `frd-to-blueprint` skill (single skill, no sub-skill co-invocation)
	- Writes the full `blueprints/` tree (containers, components, features); may append to `blueprints/_questions-pending.md` for architectural decisions requiring operator judgment
	- Reads/writes `blueprints_communication/` per @Blueprint(communication-folder)
	- Reads optional root `BLUEPRINT.md` if present and uses it as a high-level architectural starting input
	- Emits `VERDICT: ready_for_review` or `VERDICT: awaiting_clarification`
```

```component
name: WorkOrdersGeneratorAgent
container: Claude Code Subprocess
responsibilities:
	- Identity: lead tech lead
	- Loads `blueprint-to-work-orders` skill (single skill, no sub-skill co-invocation)
	- Writes `work-orders/wo-NNN/description.md` files in the canonical scoped-task body shape pinned in the work-orders-loop FRD
	- May append to `work-orders/_questions-pending.md` for decomposition ambiguities (bare-question shape only)
	- Reads/writes `work-orders_communication/` per @Blueprint(communication-folder)
	- Short-circuits when blueprint-tree hash matches the recorded hash and no failing reviews to address
	- Emits `VERDICT: ready_for_review` or `VERDICT: awaiting_clarification`
```

```component
name: CodingGeneratorAgent
container: Claude Code Subprocess
responsibilities:
	- Identity: individual contributor
	- Loads `open-task-pr` plus coding-specific capabilities
	- Works on branch `task/<task_id>` with the scoped-task body injected inline as context
	- Writes code on the task branch; commits, pushes, and opens the PR via `open-task-pr` skill (idempotent)
	- Files gaps to `work-orders/_inbox/wo-NNN/` when out-of-scope work is discovered
	- Emits a per-gate `VERDICT:` trailer with each gate's result
```

Each generator carries its own autonomy posture (no clarifying questions mid-loop, decide and proceed) baked into its skill prompt. Identity matters because reviewers push back, and a senior professional decides when a push-back is grounded.

---

### Reviewer agents

```component
name: RequirementsReviewerAgents
container: Claude Code Subprocess
responsibilities:
	- Four reviewer subagents: `req-spec-judge`, `req-cross-doc-judge`, `req-coverage-judge`, `req-scoping-judge`
	- Each loads its skill, reads its communication file plus the artifacts it judges, appends a `## Review — attempt N` block ending with `VERDICT: pass|fail`, exits
	- Run with `--disallowedTools Bash,NotebookEdit`; `Write`/`Edit` allowed but #ReviewerPathGuardHook from @Blueprint(subprocess-runtime) blocks any path other than the reviewer's own communication file
```

```component
name: BlueprintReviewerAgents
container: Claude Code Subprocess
responsibilities:
	- Four reviewer subagents: `bp-spec-judge`, `bp-coverage-judge`, `bp-consistency-judge`, `bp-decision-judge`
	- Same shape as #RequirementsReviewerAgents — read communication file, append review, emit VERDICT, exit
```

```component
name: WorkOrdersReviewerAgents
container: Claude Code Subprocess
responsibilities:
	- Three reviewer subagents: `wo-scoping-judge`, `wo-coverage-judge`, `wo-dependency-judge`
	- Same shape as the other upstream-loop reviewer agent groups
```

```component
name: CodingReviewerAgents
container: Claude Code Subprocess
responsibilities:
	- Six per-WO execution reviewers: `tests-runner`, `playwright-runner`, `code-spec-judge`, `code-regression-judge`, `code-security-judge`, `code-quality-judge`
	- Run with `--disallowedTools Write,Edit,NotebookEdit,Bash` (no communication-folder mechanism for per-WO execution); emit full review as stdout captured by orchestrator
	- Per-WO execution does not use the communication-folder pattern; review content lives in stdout and is archived directly
```

---

### Interactive skills

```component
name: PRDAuthoringSkill
container: Claude Code Subprocess
responsibilities:
	- Interactive Claude Code skill (not orchestrator-spawned)
	- Identity: senior product manager
	- Reads any existing `PRD.md` and offers to continue or revise; uses Read/Write/Edit to author the PRD directly
	- Critiques on demand via the five-category rubric (CONFLICT, MISSING, AMBIGUOUS, DUPLICATION, STALE) filtered to critical-only
	- Applies clarification policy: ambiguous → ask and wait; specific → act; middle → propose plus up to two questions
	- Never writes outside `PRD.md`
```

```component
name: BlueprintAuthoringSkill
container: Claude Code Subprocess
responsibilities:
	- Interactive Claude Code skill for blueprint refinement after the loop has run; not orchestrator-spawned
	- Knows the three blueprint types, per-type structural shape, mention syntax, fenced `component`/`model` blocks, boundary-first / no-redefinition writing principles
	- Same posture as #PRDAuthoringSkill for the PRD — operator-driven session, never autonomous
```

The two interactive skills are explicitly out of the autonomous-loop subprocess set. The operator opens an interactive Claude Code session and invokes them; the orchestrator never spawns them.

---

### Utility agents

```component
name: IndexUpdaterAgent
container: Claude Code Subprocess
responsibilities:
	- Regenerates `harness/index.md` from planner state
	- Invoked on a schedule or after status transitions (utility — not part of any loop's gen/review cycle)
```

## System Contracts

### Key Contracts

- **Skills are LLM-driven.** Deterministic mechanics (state-file rotation, iteration counting, history appending, PR comment posting) live in the orchestrator, not in skills. Skills produce verdicts, prose, or artifact files.
- **Two skill shapes.** Tool-wrappers (reusable "here is how to do X" instructions plus a thin CLI recipe) and LLM-as-judge (pure prompting skills that produce a verdict). Most generator skills are the first; all reviewer skills are the second.
- **Each skill carries autonomy posture.** Generator skills explicitly say "no clarifying questions mid-loop, decide and proceed." Operator-input questions go to `_questions-pending.md`; nothing pauses interactively.
- **One generator per loop.** Single skill per generator subprocess — no sub-skill co-invocation. The blueprint generator runs `frd-to-blueprint`; it does not co-load `blueprint-authoring`.
- **Reviewer write isolation.** Upstream-loop reviewers append to their own communication file only; the path-guard hook (in @Blueprint(subprocess-runtime)) enforces it.
- **Identity is real, not decorative.** Generators wear professional identities (lead PM, lead engineer, lead tech lead, IC) in their skill prompts because reviewers push back, and the right response to a push-back depends on judgment a tool would not exercise.

### Integration Contracts

- **Skill location.** `.claude/skills/<skill-name>/SKILL.md` shipped with the kit and copied (or referenced) into the project repo's `.claude/`.
- **Agent location.** `.claude/agents/<agent-name>.md` shipped with the kit.
- **Skill loading.** Each subprocess passes `--append-system-prompt <skill-body>` on session-1 spawns; the skill body is the agent's identity + the skill instructions.
- **Generator output.** Stdout summary ending with `VERDICT: ready_for_review` (normal) or `VERDICT: awaiting_clarification` (with `open_questions: <N>` and `questions_file: <path>`). Per-WO coding generator additionally lists per-gate results.
- **Reviewer output.** Stdout: short acknowledgement ending with `VERDICT: pass` or `VERDICT: fail`. Communication file (upstream loops): `## Review — attempt N` block with prose and the same `VERDICT:` trailer.

## Architecture Decision Records

### ADR-001: Skills are LLM-only; deterministic mechanics in the orchestrator

**Context.** Mechanics like attempt counting, state rotation, PR comment posting could live inside skills (the agent could "remember" attempt count via system prompt). But that puts deterministic logic in a non-deterministic surface — the model sometimes miscounts, drops state, or contradicts itself.

**Decision.** Skills do LLM-driven work only (read inputs, produce outputs, judge artifacts). The orchestrator handles every deterministic detail: spawning, counting, rotating state files, posting comments, detecting merges.

**Consequences.** The orchestrator is testable Python; the skills are testable prompts. Each side has the right tool for its job. Trade-off: skills cannot self-rotate state or self-monitor budget; that is exactly the point.

### ADR-002: Identity-bearing agents

**Context.** Every generator could be a stripped-down "you are an AI assistant" prompt. But generators face reviewer push-back and have to decide whether to fix, push back, or surface to operator. A neutral prompt produces "yes boss" responses; a senior-professional prompt produces decisions.

**Decision.** Each generator wears a professional identity (lead PM, lead engineer, lead tech lead, IC) in its skill prompt. The identity is referenced when push-back arrives ("a senior engineer would push back on this finding because…").

**Consequences.** Push-backs are grounded in judgment, not just compliance. The identity persists across attempts via session continuity. Trade-off: the prompts are slightly longer, and identity coherence requires careful skill-prompt authoring.

### ADR-003: One generator skill per loop, no sub-skill co-invocation

**Context.** A multi-skill generator (e.g. blueprint generator that loads both `frd-to-blueprint` and `blueprint-authoring`) would let the autonomous loop reuse interactive-skill expertise. But mixing autonomous and interactive postures inside one subprocess is a recipe for the agent stalling for input that never comes.

**Decision.** Each generator loads exactly one skill. Interactive skills (`prd-authoring`, `blueprint-authoring`) are exclusively operator-invoked, never orchestrator-spawned. The autonomous loop's generator does not have an interactive escape valve at runtime — its escape valve is `_questions-pending.md`.

**Consequences.** Autonomy posture is unambiguous per subprocess. Trade-off: the generator skill must carry every responsibility for that loop in one prompt; that is fine because the per-loop scope is deliberately narrow.
