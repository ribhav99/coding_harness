# Appendix

This section collects deferred work and open questions the PRD explicitly acknowledges but does not resolve. Each item is either scheduled to a later milestone or left as an operational question to be settled based on real usage.

**Blueprint artifact shape.** Software Factory blueprints are authored for human teams; the harness's blueprints are consumed by an autonomous coding loop. The harness's blueprints likely need tighter contracts — explicit interfaces, listed invariants, machine-readable dependency graphs — and less discursive prose. The on-disk layout under `blueprints/` and the fields of `.blueprint.meta.yaml` are not yet pinned. This lands at the start of v0.2; the requirements loop can ship without it.

**Work-order artifact shape.** The same problem a level down. Software Factory work orders are human-consumed and phase-grouped; the harness's are Claude-Code-consumed and flat-sequence. The harness's work orders need tighter scope, more explicit acceptance criteria, a machine-readable dependency graph, and explicit verification-gate hooks per work order. This lands at the start of v0.3.

**Sequence-regeneration trigger.** The coding loop regenerates the work-order sequence when blueprints change. The `.sequence.meta.yaml` hash is the change-detection mechanism, but which blueprint changes trigger full vs incremental re-generation is not yet decided. Start simple — any blueprint hash change triggers full re-gen — and optimize later if the regeneration cost becomes wasteful.

**`prd-to-frds` naming.** The skill name is misleading now that it also produces overview docs. Candidate renames: `prd-decomposer`, `prd-to-requirements-tree`, `decompose-prd`. Rename in v0.2 or v1.0.

**Concurrent loop runs.** v1 runs one loop at a time. Whether coding-loop execution can drain in parallel with a blueprint-loop re-run (for a different area of the project) is plausible — different artifact trees, no obvious conflict — but deferred.

**Software Factory mirror.** Outbound sync to SF is deferred until SF ships an upload API. The local layout already mirrors SF's entity model so integration will be mechanical.

**GitHub Projects mirror.** An optional read-mostly kanban view for off-laptop visibility is deferred.

**Distribution mechanism.** The harness starts as copy-per-project. Reconsider as a Claude Code plugin, a Python package, or a git submodule after the second project.

**Failure-recovery heuristics.** When the orchestrator should respawn a loop generator versus give up is an open question. Start with a wall-clock cap plus manual operator triage; refine based on observed failure modes.

**Multiple concurrent work orders.** v1 runs one work order at a time during execution. Worktree-based parallelism is plausible but deferred.

**Status model.** The status set omits `in_review` (PR review) and `blocked` as distinct statuses. Dependencies are encoded in `.work-order.meta.yaml.blocked_by[]` and respected by the local planner's next-ready selection. Additional statuses get added only if friction appears.

**Non-web task shapes.** The Playwright gate is web-shaped. Library and CLI work orders need a different behavioral surface — pure `pytest` sometimes suffices, but the full answer is to be determined.

**Inbound mirror sync.** All mirrors are push-only in v1. Pulling external edits back to local is deferred.

**Ad-hoc review skills for blueprints, work orders, and code.** For the PRD, the `prd-authoring` skill handles critique conversationally in-session. Blueprint and work-order review currently only happen inside their respective autonomous loops. If the operator wants to critique mid-iteration or on a draft-before-loop basis, standalone overlay skills would help. Deferred until we see whether the loops' built-in reviewers are sufficient.

**Reviewer-name prefixing consistency.** Coding-loop execution reviewers are unprefixed (`spec-judge`, `quality-judge`, and so on); other loops use `req-*`, `bp-*`, and `wo-*` prefixes. Normalise the execution reviewers to `code-*` in v1.0.
