## Review — attempt 1

The `blueprints/` tree does not exist on disk at all (no `containers/`, `components/`, `features/`, or `_questions-pending.md`). With no blueprints written, there are no architectural choices for me to audit, so decision hygiene cannot be evaluated and there are no silent decisions to flag. The missing tree itself is a coverage problem owned by `bp-coverage-judge`, not by me.

For the next attempt: as the generator produces container/component/feature blueprints from the `requirements/features/` tree, every high-impact architectural choice (database/data store, major framework, auth provider/model, hosting model, ORM/data-access layer, major architectural pattern) must either (a) be grounded in an FRD or `PRD.md` passage, (b) be filed as an open block in `blueprints/_questions-pending.md` with a `<!-- pending: <question-title> -->` marker at the affected blueprint location, or (c) reflect a resolved answer from that file. I'll flag any choice that lands in a blueprint without one of those three groundings.

No `SILENT_DECISION` issues this attempt — vacuously clean because nothing has been written.

## Generator response — attempt 1

The full blueprints tree is now in place. Per your guidance, I have grounded every high-impact architectural choice in the operator's `BLUEPRINT.md` (which is explicitly the operator's pinned architectural starting input — see @Feature(blueprint-loop) AC-BL-002.9) and the FRD set in `requirements/features/`, rather than fabricating choices and silently embedding them in blueprints. No `blueprints/_questions-pending.md` was created because no high-impact decision in the tree is silent.

Map of every high-impact decision in the tree to its grounding:

| Decision | Grounding |
|---|---|
| Python with stdlib-only for the orchestrator | BLUEPRINT.md §3 ("≤ 800 lines of Python"); reflected in @Blueprint(python-orchestrator) ADR-001. |
| `claude -p` subprocess as the only model channel; no direct Anthropic API | BLUEPRINT.md §3.4, BLUEPRINT.md design principle "Claude Code is the runtime"; @Blueprint(claude-code-subprocess) ADR-003. |
| `gh` CLI rather than direct GitHub REST/GraphQL | BLUEPRINT.md §6 ("thin GitHub CLI layer"); @Blueprint(github) ADR-001 and @Blueprint(git-integration) ADR-001. |
| JSON state files, never deleted, committed to git | BLUEPRINT.md §7.1; @Blueprint(state-store) ADR-003 and @Blueprint(project-repo) ADR-004. |
| File-system as canonical source of truth; mirrors outbound-only | BLUEPRINT.md §5.3, design principle "Local files are the source of truth"; @Blueprint(project-repo) ADR-001 and @Blueprint(mirror-adapter) ADR-001. |
| Communication folder pattern (sibling of artifact tree, never wiped) | BLUEPRINT.md §1.8; @Feature(requirements-loop) REQ-RL-011, @Feature(blueprint-loop) REQ-BL-004, @Feature(work-orders-loop) REQ-WO-005; @Blueprint(communication-folder) ADRs 001/002/003. |
| Two question shapes (bare and with-options); blueprint loop only uses with-options | BLUEPRINT.md §1.5, design principle "Clarification questions are first-class, and non-blocking"; @Blueprint(questions-pending) ADR-002. |
| Strictly sequential gen↔reviewer per attempt; reviewer fan-out via ThreadPoolExecutor | BLUEPRINT.md §1.1; @Blueprint(loop-driver) ADR-002. |
| Stop hook for in-session verdict enforcement; PreToolUse path-guard hook for reviewer write isolation | BLUEPRINT.md §9; @Blueprint(subprocess-runtime) ADRs 002/003 and 004. |
| Two recovery layers (rate-limit doubling backoff, protocol-retry for malformed verdicts) | BLUEPRINT.md §1.9 and @Feature(python-orchestrator) REQ-ORCH-013/REQ-ORCH-014; @Blueprint(subprocess-runtime) ADR-001. |
| Single concrete `LocalPlanner` class, no Protocol abstraction | BLUEPRINT.md §4; @Blueprint(local-planner) ADR-001. |
| Mirror Software Factory's entity model in the on-disk layout | BLUEPRINT.md §5, @Feature(on-disk-layout) overview; @Feature(on-disk-layout) ADR-001. |
| One PR comment per work order (final summary only) | BLUEPRINT.md §3.3 (coding-loop section); @Blueprint(github) ADR-002 and @Blueprint(git-integration) ADR-003. |
| Operator-driven merge; no auto-merge | BLUEPRINT.md §3.4; @Feature(coding-loop) ADR-004 and @Blueprint(github) ADR-003. |
| Coding loop has no communication folder; per-WO execution uses stdout + PR comments | BLUEPRINT.md §1.8; @Feature(coding-loop) ADR-001. |
| Six-reviewer execution stack with gate-declaration toggles for `tests` and `playwright` | @Feature(work-orders-loop) REQ-WO-002 (six required gate keys); @Feature(coding-loop) ADR-003. |
| Sequence generation lives in work-orders loop, not coding loop | @Feature(work-orders-loop) REQ-WO-001.4 and @Feature(coding-loop) REQ-CL-001.3; @Feature(python-orchestrator) ADR-003 and @Feature(coding-loop) cross-references. |
| Single skill per generator (no sub-skill co-invocation) | @Feature(blueprint-loop) AC-BL-002.1, @Feature(work-orders-loop) AC-WO-003.1; @Blueprint(agents-and-skills) ADR-003. |
| `.sequence.meta.yaml` blueprint-tree-hash short-circuit | @Feature(work-orders-loop) AC-WO-003.6; @Feature(work-orders-loop) ADR-002. |

Lower-stakes implementation choices (PyYAML vs hand-parsed YAML, log format, internal helper module names, exact backoff multiplier values within the 30s/60s/120s pattern) are not surfaced as questions per the skill guidance.

Should you flag any decision in the tree as silent on next review, I will file a question block in `blueprints/_questions-pending.md` rather than push back, since the right resolution for a silent-decision finding is operator judgment.

## Changes since previous attempt

(See bp-spec-judge.md for the full enumerated change list — same list applies here. Summary: 4 container blueprints, 9 component blueprints, 7 feature blueprints all newly added. Each ADR in each blueprint anchors its decision to either `BLUEPRINT.md` or an FRD passage; no architectural decision in the tree lacks grounding.)

## Review — attempt 2

Decision hygiene across the blueprints tree is clean. I walked every container, component, and feature blueprint and cross-referenced each high-impact architectural choice (database/data store, framework, auth provider/model, hosting model, ORM/data-access layer, major architectural pattern) against `BLUEPRINT.md` (the operator's pinned architectural input, grounded as such by `requirements/features/blueprint-loop.md` AC-BL-002.9) and the FRD set under `requirements/features/`. Every choice traces to either an explicit `BLUEPRINT.md` section or a specific REQ-/AC- citation; nothing is asserted by fiat. No `blueprints/_questions-pending.md` exists, which is consistent with a tree that has no silent decisions to surface.

Spot-check of the load-bearing categories:

- **Stack / framework — Python 3 with stdlib-only.** `blueprints/containers/python-orchestrator.md` ADR-001. Grounded by `BLUEPRINT.md` §3, §3.4 ("≤ 800 lines of Python", "No direct LLM calls").
- **Model channel — `claude -p` subprocess, no Anthropic SDK.** `blueprints/containers/claude-code-subprocess.md` ADR-003. Grounded by `BLUEPRINT.md` §3.4 and the design principle "Claude Code is the runtime" pattern.
- **GitHub channel — `gh` CLI, no REST/GraphQL.** `blueprints/containers/github.md` ADR-001 and `blueprints/components/git-integration.md` ADR-001. Grounded by `BLUEPRINT.md` §6.
- **Persistence model — JSON state + YAML meta files + markdown artifacts, all committed to git.** `blueprints/components/state-store.md` ADR-003 and `blueprints/containers/project-repo.md` ADR-004. Grounded by `BLUEPRINT.md` §7.1.
- **Hosting / deployment — operator-local CLI, one subcommand per invocation, no daemon.** `blueprints/containers/python-orchestrator.md` ADR-002. Grounded by `BLUEPRINT.md` §3.1.
- **Auth — operator's own `claude auth login` / `gh auth login`; harness handles no credentials.** `blueprints/containers/github.md` Integration Contracts and `blueprints/containers/claude-code-subprocess.md` Infrastructure. Grounded by `BLUEPRINT.md` §6.
- **Data-access pattern — single concrete `LocalPlanner` class, no Protocol abstraction.** `blueprints/components/local-planner.md` ADR-001. Grounded by `BLUEPRINT.md` §4 ("Single concrete class — no Protocol — because there is only one queue").
- **Major architectural patterns** — subprocess-per-spawn (claude-code-subprocess ADR-001 ↔ `BLUEPRINT.md` §1.1), strictly sequential gen↔reviewer with `ThreadPoolExecutor` reviewer fan-out (loop-driver ADR-002 ↔ `BLUEPRINT.md` §1.1), communication-folder durable channel (python-orchestrator ADR-004, communication-folder ADRs 001/002/003 ↔ `BLUEPRINT.md` §1.8), two independent recovery layers (subprocess-runtime ADR-001 ↔ `BLUEPRINT.md` §1.9 + FRD REQ-ORCH-013/REQ-ORCH-014), Stop-hook + PreToolUse path-guard (subprocess-runtime ADRs 002/003 ↔ `BLUEPRINT.md` §9), outbound-only mirrors (mirror-adapter ADR-001 ↔ `BLUEPRINT.md` §5.3), operator-driven merge / one-shot PR comment (github ADRs 002/003 ↔ `BLUEPRINT.md` §3.3-§3.4), coding loop is execution-only with no comm folder (coding-loop ADR-001 ↔ `BLUEPRINT.md` §3.3, §1.8), one generator skill per loop with no sub-skill co-invocation (agents-and-skills ADR-003 ↔ FRD AC-BL-002.1 / AC-WO-003.1), `.sequence.meta.yaml` blueprint-tree-hash short-circuit (work-orders-loop ADR-002 ↔ FRD AC-WO-003.6), and mirroring SF's entity model on disk (on-disk-layout ADR-001 ↔ `BLUEPRINT.md` §5). All grounded.

I also looked for the obvious silent-decision traps: no covert pick of Postgres/Redis/Dynamo for a state-store component (storage explicitly punted to filesystem-as-source-of-truth), no smuggled web framework or message broker, no auth provider chosen, no hosting platform locked in. The `model` blocks under `state-store.md` and `local-planner.md` declare `store: Filesystem (project repo, …)` rather than introducing a new datastore; this is consistent with `BLUEPRINT.md` §5.3.

Lower-stakes choices the generator made on its own (`PyYAML` vs hand-parsed YAML, `concurrent.futures.ThreadPoolExecutor` vs `asyncio`, two-space JSON indent, fastest-first reviewer ordering, env-var names like `HARNESS_REVIEWER_NAME`) are correctly outside my rubric and I do not flag them.

No `SILENT_DECISION` issues this attempt.
