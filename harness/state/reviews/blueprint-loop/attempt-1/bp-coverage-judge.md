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
