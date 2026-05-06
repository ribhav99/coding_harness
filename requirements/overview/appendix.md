# Appendix

This section collects deferred work and open questions the PRD explicitly acknowledges but does not resolve. Each item is either deferred until an external dependency lands, or left as an operational question to be settled based on real usage.

**Blueprint artifact shape.** ~~Resolved.~~ Three blueprint types are pinned (container, component, feature) with per-type document structure adopted from the Software Factory blueprints module's seeded category presets, simplified for the harness's autonomous loop. On-disk layout `blueprints/{containers,components,features}/<slug>.md` plus dotted-hidden `.<slug>.<kind>.meta.yaml` and `.<slug>.requirements.meta.yaml` mirrors the requirements tree. Full contract in REQ-LAYOUT-006 and the project's blueprint document-shape contract.

**Work-order artifact shape.** ~~Resolved.~~ Per-work-order document shape pinned in the work-orders-loop FRD (REQ-WO-002). Sections in canonical order — Goal, Blueprints, In scope, Out of scope, Produces (fenced YAML), Depends on (fenced YAML), Acceptance criteria (each row with ID, observation method, binary outcome), Gates (fenced YAML), optional Implementation notes. Mention syntax (`#<blueprint-slug>`, `@wo-NNN`), structured fenced blocks, and the atomicity rule are all defined there. The orchestrator materialises `.work-order.meta.yaml.blocked_by[]` from each work order's `Depends on.work_orders` block so the description is the single source of truth for dependencies.

**Sequence-regeneration trigger.** ~~Resolved.~~ Any blueprint-tree hash change triggers a full work-orders-loop re-run; the work-orders-loop generator short-circuits when the hash matches and no failing reviews are pending. Optimisation deferred until wasteful re-gen is observed.

**Reviewer-name prefixing consistency.** ~~Resolved.~~ Coding-loop execution reviewers are now `code-*`-prefixed (`code-spec-judge`, `code-regression-judge`, `code-security-judge`, `code-quality-judge`); naming is consistent across all loops (`req-*`, `bp-*`, `wo-*`, `code-*`).

**`prd-to-frds` naming.** The skill name is misleading now that it also produces overview docs. Candidate renames: `prd-decomposer`, `prd-to-requirements-tree`, `decompose-prd`. Plan to rename.

**Concurrent loop runs.** The harness runs one loop at a time. Whether coding-loop execution can drain in parallel with a blueprint-loop re-run (for a different area of the project) is plausible — different artifact trees, no obvious conflict — but deferred.

**Software Factory mirror.** Outbound sync to SF is deferred until SF ships an upload API. The local layout already mirrors SF's entity model so integration will be mechanical.

**GitHub Projects mirror.** An optional read-mostly kanban view for off-laptop visibility is deferred.

**Distribution mechanism.** The harness starts as copy-per-project. Reconsider as a Claude Code plugin, a Python package, or a git submodule after the second project.

**Failure-recovery heuristics.** When the orchestrator should respawn a loop generator versus give up is an open question. Start with a wall-clock cap plus manual operator triage; refine based on observed failure modes.

**Multiple concurrent work orders.** The harness runs one work order at a time during execution. Worktree-based parallelism is plausible but deferred.

**Status model.** The status set omits `in_review` (PR review) and `blocked` as distinct statuses. Dependencies are encoded in `.work-order.meta.yaml.blocked_by[]` and respected by the local planner's next-ready selection. Additional statuses get added only if friction appears.

**Non-web task shapes.** The Playwright gate is web-shaped. Library and CLI work orders declare `playwright: not_applicable` in their `## Gates` block; a future iteration may add a behavioural surface for non-web work orders (pure `pytest` sometimes suffices).

**Inbound mirror sync.** All mirrors are push-only. Pulling external edits back to local is deferred.

**Ad-hoc review skills for blueprints, work orders, and code.** For the PRD, the `prd-authoring` skill handles critique conversationally in-session. Blueprint and work-order review currently only happen inside their respective autonomous loops. If the operator wants to critique mid-iteration or on a draft-before-loop basis, standalone overlay skills would help. Deferred until we see whether the loops' built-in reviewers are sufficient.
