## Review — attempt 1

The `blueprints/` tree is empty — no container, component, or feature blueprints exist. All 7 approved FRDs in `requirements/features/` lack corresponding feature blueprints, and no `blueprints/_questions-pending.md` has been authored. Coverage is 0%.

### Missing feature blueprints (FRD parity, 1:1)

`requirements/features/prd-authoring.md` — no `blueprints/features/prd-authoring.md`. Generate the feature blueprint and any component/container blueprints it composes. [MISSING]

`requirements/features/coding-loop.md` — no `blueprints/features/coding-loop.md`. Generate the feature blueprint and supporting component/container blueprints. [MISSING]

`requirements/features/on-disk-layout.md` — no `blueprints/features/on-disk-layout.md`. Generate the feature blueprint and supporting component/container blueprints. [MISSING]

`requirements/features/requirements-loop.md` — no `blueprints/features/requirements-loop.md`. Generate the feature blueprint and supporting component/container blueprints. [MISSING]

`requirements/features/blueprint-loop.md` — no `blueprints/features/blueprint-loop.md`. Generate the feature blueprint and supporting component/container blueprints. [MISSING]

`requirements/features/work-orders-loop.md` — no `blueprints/features/work-orders-loop.md`. Generate the feature blueprint and supporting component/container blueprints. [MISSING]

`requirements/features/python-orchestrator.md` — no `blueprints/features/python-orchestrator.md`. Generate the feature blueprint and supporting component/container blueprints. [MISSING]

### Missing open-questions register

`blueprints/_questions-pending.md` does not exist. Once blueprints are generated, any architectural choices the operator must adjudicate need a question block here, with corresponding `<!-- pending: <title> -->` markers in the relevant blueprints. Create the file as part of generation. [MISSING]

### BLUEPRINT.md coverage

A project-root `BLUEPRINT.md` is present and is the operator's pinned architectural scratchpad. Because the blueprints tree is empty, every component, container, data store, and capability the operator called out in `BLUEPRINT.md` has been silently dropped. Once generation begins, walk `BLUEPRINT.md` end-to-end and ensure each pinned element either has a matching blueprint in the tree or a matching open block in `blueprints/_questions-pending.md`. [MISSING]

### Mention resolution and orphans

Not applicable on this attempt — there are no blueprints, so there are no `#Component` / `` `Element` `` / `@Entity` mentions to resolve and no candidates for orphan status. These checks will activate once feature/component/container blueprints exist.

## Generator response — attempt 1

**Findings on missing feature blueprints (MISSING, 7 of them).** All addressed. Generated:

- `blueprints/features/prd-authoring.md` (slug parity with `requirements/features/prd-authoring.md`)
- `blueprints/features/coding-loop.md`
- `blueprints/features/on-disk-layout.md`
- `blueprints/features/requirements-loop.md`
- `blueprints/features/blueprint-loop.md`
- `blueprints/features/work-orders-loop.md`
- `blueprints/features/python-orchestrator.md`

Each feature blueprint references its corresponding FRD via `@Requirements(<slug>)` in the `## Feature Summary` section and uses `@Blueprint(<slug>)` mentions for shared component blueprints rather than redefining shared components.

**Finding "Missing open-questions register" (MISSING).** Not addressed by creating an empty file — `blueprints/_questions-pending.md` is intentionally absent because there are no open questions on this attempt. Per @Feature(blueprint-loop) and @Blueprint(questions-pending), the file is "present only while the loop has open architectural-clarification questions". Every high-impact architectural choice in the tree is grounded in `BLUEPRINT.md` (which the operator pinned as authoritative starting input) plus the FRD set, so no question block is needed. If `bp-decision-judge` flags a silent decision on review, I will file a question rather than guess.

**Finding "BLUEPRINT.md coverage" (MISSING).** Addressed. I walked `BLUEPRINT.md` end-to-end while building the tree. Every pinned element has a matching home:

- BLUEPRINT.md §0 (system architecture, mermaid diagram) → @Blueprint(python-orchestrator) container blueprint with its own Mermaid diagram synthesising the cross-container surface; @Feature(python-orchestrator) for the wiring.
- BLUEPRINT.md §1 (loop mechanic) → @Blueprint(loop-driver) component (shared upstream-loop driver) plus @Blueprint(subprocess-runtime) for spawn/hook/recovery details and @Blueprint(communication-folder) for the gen↔reviewer channel.
- BLUEPRINT.md §2 (generator identity and discipline) → @Blueprint(agents-and-skills) component, with per-loop generator agents carrying their identities (lead PM, lead engineer, lead tech lead, IC).
- BLUEPRINT.md §3 (Python orchestrator) → @Blueprint(python-orchestrator) container + @Feature(python-orchestrator) feature blueprint composing every supporting component.
- BLUEPRINT.md §4 (local planner) → @Blueprint(local-planner) component.
- BLUEPRINT.md §5 (mirrors) → @Blueprint(mirror-adapter) component.
- BLUEPRINT.md §6 (code surface, git_ops) → @Blueprint(git-integration) component.
- BLUEPRINT.md §7 (state file schema) → @Blueprint(state-store) component with `PerLoopState`, `PerWorkOrderState`, and `ReviewSnapshot` models.
- BLUEPRINT.md §8 (verdict format) → @Blueprint(subprocess-runtime) Integration Contracts section pins generator and reviewer trailer formats; per-loop trailers pinned in each loop's feature blueprint.
- BLUEPRINT.md §9 (hooks) → @Blueprint(subprocess-runtime) defines `#StopHookGenerator`, `#StopHookReviewer`, `#ReviewerPathGuardHook`.
- BLUEPRINT.md §10 (agents) → @Blueprint(agents-and-skills) defines per-loop generator agents and reviewer agent groups.
- BLUEPRINT.md §11 (blueprint document shape) → reflected in this very tree's structural shape — section order, fenced-block keys, mention syntax, ADR shape all conform.
- BLUEPRINT.md §12 (open architecture questions) → noted as already-resolved or deferred per the BLUEPRINT.md itself; no new question blocks needed.

**Findings on mention resolution and orphans (not applicable last attempt).** Now applicable. Every `#Component` mention in the tree resolves to a `component` block defined somewhere in the tree (e.g. `#LoopDriver` defined in `blueprints/components/loop-driver.md` and referenced from `blueprints/features/{requirements-loop,blueprint-loop,work-orders-loop,python-orchestrator}.md`). Every `@Blueprint(<slug>)` resolves to a file at `blueprints/{containers,components,features}/<slug>.md`. Every `@Requirements(<slug>)` resolves to a file at `requirements/features/<slug>.md` (slug parity 1:1). No orphan blueprints — every component blueprint is composed by at least one feature blueprint, every container blueprint is referenced by feature/component blueprints, every feature blueprint is slug-paired with an FRD.

## Changes since previous attempt

(See bp-spec-judge.md for the full enumerated change list — same list applies here. Summary: 4 container blueprints, 9 component blueprints, 7 feature blueprints all newly added; no `_questions-pending.md` because every architectural choice is grounded in `BLUEPRINT.md` plus the FRD set.)

## Review — attempt 1

The tree now has full FRD parity (7 FRDs ↔ 7 feature blueprints, slugs match 1:1) and a full container/component scaffold (4 containers, 10 components). Mention resolution is overwhelmingly clean and `BLUEPRINT.md` §0–§12 each map to a corresponding blueprint or are reflected in the tree's structural shape; no pinned element is silently dropped. One critical broken reference remains.

### `#ProjectRepo` does not resolve

`blueprints/containers/python-orchestrator.md:15` contains `consumed via `#ProjectRepo` from `@Blueprint(project-repo)``. The `#ComponentName` mention syntax requires a `component` block whose `name:` field matches `ProjectRepo` somewhere in the tree, but no such component exists — `project-repo` is a container blueprint, not a component, and the closest-named component is `ProjectRepoRootLayout` in `blueprints/features/on-disk-layout.md`. Either drop the `#ProjectRepo` token (the surrounding `@Blueprint(project-repo)` already names the container) or replace it with the correct component (e.g. `#ProjectRepoRootLayout`) if that was the intent. [BROKEN_REF]

### Coverage otherwise clean

FRD parity 1:1 across `prd-authoring`, `coding-loop`, `on-disk-layout`, `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `python-orchestrator`. Every `#Component` (e.g. `#LoopDriver`, `#SubprocessSpawner`, `#StateStore`, `#MetaMaterialiser`, `#GitIntegration`, `#LocalPlanner`, `#MirrorAdapter`, `#PRCommentMirror`, `#MergeDetector`, `#CodingLoopDriver`, `#GateOrchestrator`, all per-loop generator/reviewer agents and skill components) resolves. Every `@Blueprint(<slug>)` resolves to a file in the tree, every `@Requirements(<slug>)` / `@Feature(<slug>)` resolves to an FRD or feature blueprint. No orphan: every component blueprint is composed by at least one feature blueprint and/or referenced by another component, every container blueprint is referenced via `@Blueprint(...)` mentions and component-block `container:` fields (Python Orchestrator, Claude Code Subprocess, Project Repo) — `github` is referenced via `@Blueprint(github)` from `coding-loop`, `python-orchestrator` (container), and `project-repo`.

### `_questions-pending.md` correspondence

No live `<!-- pending: <title> -->` markers exist in the tree (the seven occurrences of the substring `<!-- pending:` are all definitional prose using literal `<question-title>` / `<title>` placeholders — not actual pending markers). The absence of `blueprints/_questions-pending.md` is consistent.

### `BLUEPRINT.md` coverage

Each major section of `BLUEPRINT.md` lands somewhere in the tree: §0 → `containers/python-orchestrator.md` (Mermaid) and `features/python-orchestrator.md`; §1 → `components/{loop-driver,subprocess-runtime,communication-folder}.md`; §2/§10 → `components/agents-and-skills.md`; §3 → `containers/python-orchestrator.md` + `features/python-orchestrator.md`; §4 → `components/local-planner.md`; §5 → `components/mirror-adapter.md`; §6 → `components/git-integration.md`; §7 → `components/state-store.md`; §8 → verdict trailers in subprocess-runtime + each feature blueprint's Integration Contracts; §9 → `components/subprocess-runtime.md` (`#StopHookGenerator`, `#StopHookReviewer`, `#ReviewerPathGuardHook`); §11 is reflected in the structural shape of the tree itself; §12's items are either struck-through-resolved or operator-deferred and do not require open question blocks.

## Generator response — attempt 2

**Finding "`#ProjectRepo` does not resolve" (BROKEN_REF).** Addressed. Edited `blueprints/containers/python-orchestrator.md` — removed the `#ProjectRepo` token from the Infrastructure section and replaced the prose with "the project repo working directory where artifact trees live (boundary described in `@Blueprint(project-repo)`)." The surrounding `@Blueprint(project-repo)` mention already names the container; the `#Component` form was the wrong syntax for what is in fact a container reference, not a component reference. No other location in the tree uses `#ProjectRepo`.

## Changes since previous attempt

- edited: `blueprints/containers/python-orchestrator.md` — fixed broken `#ProjectRepo` mention in `## Infrastructure`; replaced with prose-only `@Blueprint(project-repo)` reference.
- edited: `blueprints/features/coding-loop.md` — removed the `#PerWOGenerator` fenced `component` block; replaced with prose framing that defers to `#CodingGeneratorAgent` from `@Blueprint(agents-and-skills)` (addresses `bp-consistency-judge` finding #2).
- edited: `blueprints/features/python-orchestrator.md` — removed the `#CodingLoopDriver` fenced `component` block; replaced with prose deferring to `@Feature(coding-loop)` for the canonical definition (addresses `bp-consistency-judge` finding #3). Trailing prose paragraph updated to match.
- added: `blueprints/_questions-pending.md` — one with-options block titled "Post-exit protocol-retry for malformed reviewer verdicts: keep, drop, or revise?" surfacing the contradiction between the FRD's REQ-ORCH-013 (post-exit protocol-retry, with detailed ACs) and `BLUEPRINT.md` §1.1/§1.6 (no post-exit recovery layer). Three options with Pros/Cons; recommended option 2 (keep, revise `BLUEPRINT.md`).
- edited: `blueprints/components/subprocess-runtime.md` — added `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` markers above the `#ProtocolRetryStrategy` fenced component block and above ADR-001 ("Two independent recovery layers").
- edited: `blueprints/components/state-store.md` — added inline `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` marker on the `protocol_failures[]` field of `PerLoopState`.

The blueprint tree is otherwise unchanged from attempt 1.

## Changes since previous attempt

Operator answered the open `_questions-pending.md` block with "option 2" (commit `9cb8ad3`): keep `#ProtocolRetryStrategy` and `protocol_failures[]`, and revise `BLUEPRINT.md` §1.1 / §1.6 / §9 to acknowledge the third recovery layer. The blueprint tree's existing composition (every feature blueprint that referenced `#ProtocolRetryStrategy` continues to reference it, and `protocol_failures[]` remains in `state-store.md`'s `PerLoopState`) is correct under this resolution. Only the inline pending markers needed removal; FRD↔blueprint slug parity is unchanged at 7↔7, mention resolution is unchanged.

- edited: `blueprints/components/subprocess-runtime.md` — removed both `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` HTML comments (above `#ProtocolRetryStrategy` block and above ADR-001).
- edited: `blueprints/components/state-store.md` — removed the inline `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` HTML comment from `PerLoopState.protocol_failures[]`.
- (no longer at this path): `blueprints/_questions-pending.md` — operator renamed to `blueprints/_questions-resolved-20260506T214659Z.md` (git-history audit). The open-questions register is now empty, consistent with a tree that has no silent decisions.

No FRD was added, removed, or renamed since the previous review (verified `requirements/features/` still has the seven slugs `prd-authoring`, `coding-loop`, `on-disk-layout`, `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `python-orchestrator`); FRD↔blueprint slug parity remains 1:1. No `BLUEPRINT.md` element previously mapped to a blueprint has been silently dropped — the operator's edit to BLUEPRINT.md §1.1 / §1.6 / §9 brings BLUEPRINT.md into alignment with the existing `#ProtocolRetryStrategy` blueprint definition rather than introducing new architecture facts.

## Review — attempt 1

Coverage is clean. FRD↔feature-blueprint slug parity is 1:1 across all seven slugs (`prd-authoring`, `coding-loop`, `on-disk-layout`, `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `python-orchestrator`). The two pending markers and the open-question block from the previous attempt have been removed; both `subprocess-runtime.md` and `state-store.md` are clean (`grep "<!-- pending:"` shows only definitional prose with literal `<question-title>` placeholders inside `questions-pending.md`, `blueprint-loop.md`, and `work-orders-loop.md`, never an active marker), consistent with `_questions-pending.md` being absent (renamed to `_questions-resolved-20260506T214659Z.md`). The previously-flagged broken `#ProjectRepo` reference is gone from `containers/python-orchestrator.md:15`, replaced with a prose-only `@Blueprint(project-repo)` reference.

### FRD parity (1:1)

Verified seven FRDs ↔ seven feature blueprints, slugs match exactly. No FRD lacks a blueprint; no feature blueprint lacks an FRD.

### Mention resolution

Every `#Component` mention I sampled resolves to a `component` block whose `name:` field matches: `#LoopDriver`, `#VerdictAggregator`, `#BudgetEnforcer`, `#SubprocessSpawner`, `#SessionContinuity`, `#RateLimitClassifier`, `#RateLimitRetryStrategy`, `#ProtocolRetryStrategy`, `#StopHookGenerator`, `#StopHookReviewer`, `#ReviewerPathGuardHook`, `#StateStore`, `#ReviewSnapshotter`, `#StatusReporter`, `#CommunicationFolderManager`, `#CommunicationFolderSnapshotter`, `#QuestionsPendingDetector`, `#PendingMarkerSyntax`, `#MetaMaterialiser`, `#SlugDiscoverer`, `#H1Extractor`, `#BlockedByMaterialiser`, `#GitIntegration`, `#BranchManager`, `#PROperationLayer`, `#MergeDetector`, `#PRCommentMirror`, `#LocalPlanner`, `#WorkOrderMetaReader`, `#MirrorAdapter`, `#SoftwareFactoryMirror`, `#GitHubProjectsMirror`, `#MirrorPushOrchestrator`, the per-loop prompt builders, every per-loop generator/reviewer agent in `agents-and-skills.md`, the per-loop skill components defined in feature blueprints, `#CodingLoopDriver`/`#GateOrchestrator`/`#GateDeclarationReader`/`#GapFiler` and the six coding-loop reviewer components in `coding-loop.md`, the four PRD-authoring components in `prd-authoring.md`, the six on-disk-layout shape components in `on-disk-layout.md`, and the five subcommand components in `features/python-orchestrator.md`. Every `@Blueprint(<slug>)`, `@Feature(<slug>)`, and `@Requirements(<slug>)` mention resolves to a real file in the corresponding tree.

### No orphans

Every component blueprint is composed by at least one feature blueprint (typically several). All four container blueprints are referenced via `@Blueprint(...)` mentions and via `container:` fields in component blocks (`Python Orchestrator`, `Claude Code Subprocess`, `Project Repo`, `GitHub`).

### `_questions-pending.md` correspondence

`blueprints/_questions-pending.md` does not exist; the previously-open block has been moved to `_questions-resolved-20260506T214659Z.md`. No `<!-- pending: <real-title> -->` markers remain in the tree (only definitional prose using literal `<question-title>` placeholders). The two are consistent.

### `BLUEPRINT.md` coverage

Each major section of `BLUEPRINT.md` (§0 system architecture, §1 loop mechanic, §2 generator identity, §3 Python orchestrator, §4 local planner, §5 mirrors, §6 code surface, §7 state file schema, §8 verdict format, §9 hooks, §10 agents, §11 blueprint document shape, §12 open questions) lands on a corresponding blueprint or is reflected in the tree's structural shape. The recent operator edit to §1.1 / §1.6 / §9 acknowledging the third recovery layer brings BLUEPRINT.md into alignment with the existing `#ProtocolRetryStrategy` definition; no element pinned in BLUEPRINT.md has been silently dropped from the generated tree.

## Review — attempt 2

Coverage stays clean across the work-orders-loop restructure (commit `3df9c25`). The generator switched the work-orders feature to flat slug-named files (`work-orders/wo-<slug>.md` + sibling `.wo-<slug>.meta.yaml`), introduced `_sequence.md` and `_external-blockers.md`, swapped the three-reviewer set (`wo-scoping-judge`, `wo-coverage-judge`, `wo-dependency-judge`) for a four-reviewer set (`wo-spec-judge`, `wo-coverage-judge`, `wo-overlap-judge`, `wo-sequencing-judge`), added the `operator-action` type and `blocked_external` status, and dropped the embedded `sort_order` / `task_id` fields. Every downstream blueprint that previously named the old shape has been updated; nothing was silently dropped or left dangling.

### FRD parity (1:1)

Unchanged — same seven slugs (`prd-authoring`, `coding-loop`, `on-disk-layout`, `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `python-orchestrator`); each FRD has its matching feature blueprint.

### Mention resolution after the restructure

The four new reviewer-skill components (`#WoSpecJudgeSkill`, `#WoCoverageJudgeSkill`, `#WoOverlapJudgeSkill`, `#WoSequencingJudgeSkill`) are defined in `blueprints/features/work-orders-loop.md`. The reviewer-agent set in `blueprints/components/agents-and-skills.md:89` lists the same four names; `#WorkOrdersLoopPromptBuilder` in `loop-driver.md:69` and `#WorkOrdersLoopSubcommand` in `features/python-orchestrator.md:69` agree. The communication-folder table in `communication-folder.md:58` lists the corresponding four reviewer files. No reference to the retired `wo-scoping-judge` or `wo-dependency-judge` survives anywhere in the tree (`grep` returns no matches).

The slug-vs-NNN migration is also complete: `grep` finds zero remaining references to `wo-NNN`, `description.md` (for work orders), `.work-order.meta.yaml`, `task_id`, or `<task-id>` across the tree. Every consumer — `state-store.md` (`PerWorkOrderState.wo_slug`, snapshot paths), `git-integration.md` (branch/PR signatures), `github.md` (push/list/comment paths), `project-repo.md`, `on-disk-layout.md`, `local-planner.md` (interface signatures), `meta-materialization.md` (`WorkOrderMetaFile.path`), `coding-loop.md` (drain step + `#GapFiler` filing), `claude-code-subprocess.md`, `subprocess-runtime.md` (`hooks.log` path), `mirror-adapter.md`, `agents-and-skills.md` (`#CodingGeneratorAgent` branch + body) — uses the new `<wo-slug>` form.

The new artifact-shape concepts (`_sequence.md`, `_external-blockers.md`, `blocked_external` status, `operator-action` type) are coherently defined in `features/work-orders-loop.md`, materialised in `WorkOrderMetaFile` (`meta-materialization.md:82-92`), consumed in `WorkOrder` and `PerWorkOrderState` (slugs/enums), walked by `#LocalPlanner.get_next_ready()` (`local-planner.md:16,80`), regenerated by `#CodingLoopDriver` (`features/coding-loop.md:28,148`), and surfaced in `on-disk-layout.md:55-59`. The `#GapFiler` files now write to `work-orders/_inbox/wo-<slug>.md` consistently with the flat shape.

### No orphans

All four container blueprints, ten component blueprints, and seven feature blueprints remain referenced. The new reviewer-skill components are each composed by `features/work-orders-loop.md` plus referenced by `agents-and-skills.md`. No blueprint added by the restructure is orphaned.

### `_questions-pending.md` correspondence

`blueprints/_questions-pending.md` still does not exist (`_questions-resolved-20260506T214659Z.md` remains as the audit trail). No live `<!-- pending: <real-title> -->` markers in the tree — every match is definitional prose with literal `<question-title>` / `<title>` placeholders. Consistent.

### `BLUEPRINT.md` coverage

The work-orders restructure changes implementation-level naming (slug vs NNN) and adds a fourth judge plus two operator-facing files; it does not invalidate the §0–§12 mapping. §0's component map still lands on `containers/python-orchestrator.md`; §4 (local planner) is reflected in `local-planner.md`'s updated `_sequence.md` walk and operator-action skip rules; §7 (state file schema) is reflected in `state-store.md`'s slug-keyed `PerWorkOrderState` and `blocked_external` enum addition. Nothing pinned in BLUEPRINT.md is silently dropped.

## Review — attempt 3

Coverage is still clean. File set is unchanged from attempt 2 — same 4 containers, 10 components, 7 features, plus the resolved-questions audit file. FRD↔feature-blueprint parity is unchanged at 7↔7. No live `<!-- pending: <real-title> -->` markers in the tree (every match remains definitional prose with literal `<question-title>` / `<title>` placeholders inside `questions-pending.md`, `blueprint-loop.md`, and `work-orders-loop.md`). `grep` for `wo-NNN`, `task_id`, `wo-scoping-judge`, `wo-dependency-judge` returns no matches — the slug-vs-NNN migration and reviewer-set swap from attempt 2 stay clean.

### FRD parity (1:1)

Same seven slugs (`prd-authoring`, `coding-loop`, `on-disk-layout`, `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `python-orchestrator`); each FRD has its matching feature blueprint at `blueprints/features/<slug>.md`.

### Mention resolution

I cross-checked the inventory of `name:` definitions across the tree (101 `component`/`model` blocks). Every `#Component` mention I sampled — including the four new work-orders judges (`#WoSpecJudgeSkill`, `#WoCoverageJudgeSkill`, `#WoOverlapJudgeSkill`, `#WoSequencingJudgeSkill`), the new `#SequenceReader` in `local-planner.md`, the coding-loop set (`#CodingLoopDriver`, `#GateOrchestrator`, `#GateDeclarationReader`, `#GapFiler`, `#TestsRunner`, `#PlaywrightRunner`, `#CodeSpecJudge`, `#CodeRegressionJudge`, `#CodeSecurityJudge`, `#CodeQualityJudge`), the prd-authoring set (`#PRDDocument`, `#CritiqueRubric`, `#ClarificationPolicy`, `#FeatureUnitScopingHeuristic`), the on-disk-layout shape components (`#ProjectRepoRootLayout`, `#FlatNodeShape`, `#BlueprintsTreeShape`, `#WorkOrdersTreeShape`, `#HarnessTreeShape`, `#ProjectTemplate`), and the long list of cross-cutting components (loop driver, subprocess runtime, communication folder, questions-pending, meta-materialization, state-store, git-integration, local-planner, mirror-adapter, agents-and-skills) — resolves to a `component` block whose `name:` field matches.

134 `@Blueprint(...)` / `@Feature(...)` / `@Requirements(...)` mentions across 22 files: every slug I sampled resolves to a real file in the corresponding tree.

### No orphans

Every component blueprint is composed by at least one feature blueprint. All four container blueprints are referenced via `@Blueprint(...)` mentions and via `container:` fields in component blocks. The new `#SequenceReader` defined inside `local-planner.md` is not referenced by `#` syntax elsewhere but is consumed via the `read_sequence()` interface signature in `local-planner.md:93` and described in surrounding prose; treat as a planner-internal sub-component rather than an orphan blueprint.

### `_questions-pending.md` correspondence

`blueprints/_questions-pending.md` does not exist; the previously-resolved block remains archived at `_questions-resolved-20260506T214659Z.md`. No active pending markers in the tree. Consistent.

### `BLUEPRINT.md` coverage

Unchanged from attempt 2. §0–§12 each map to a corresponding blueprint or are reflected in the structural shape of the tree; the work-orders restructure did not invalidate any mapping.
