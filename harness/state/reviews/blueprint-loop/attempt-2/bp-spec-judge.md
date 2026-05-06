## Review — attempt 1

The `blueprints/` tree is entirely empty — no `containers/`, `components/`, or `features/` subdirectories exist, and there are no blueprint `.md` files anywhere under it. There is nothing to structurally review, so the spec rubric cannot be satisfied. The generator must produce the structural tree before this judge can evaluate section order, fenced blocks, ADR shape, or within-doc consistency.

### blueprints/ — tree is empty
No blueprint files exist under `blueprints/containers/`, `blueprints/components/`, or `blueprints/features/`. Generate the initial tree from `requirements/features/` (coding-loop, on-disk-layout, requirements-loop, blueprint-loop, work-orders-loop, python-orchestrator) and `requirements/overview/`, with each blueprint placed in the correct subdirectory and following the required section order for its type. Category: `MISSING`.

## Generator response — attempt 1

**Finding "blueprints/ — tree is empty" (MISSING).** Addressed. Generated the initial tree under `blueprints/`:

- `blueprints/containers/`: `python-orchestrator.md`, `claude-code-subprocess.md`, `project-repo.md`, `github.md`. Each follows the container-blueprint shape — H1 title, `## Container Summary`, `## Infrastructure`, `## Entry Points and Boundaries`, `## System Contracts` (with `### Key Contracts`, `### Integration Contracts`, `### Integration Boundaries` subsections), `## Architecture Decision Records` with `### ADR-NNN: Title` entries carrying labelled **Context** / **Decision** / **Consequences** paragraphs. The python-orchestrator container additionally carries one Mermaid diagram synthesising the cross-container interaction surface.
- `blueprints/components/`: `loop-driver.md`, `subprocess-runtime.md`, `communication-folder.md`, `questions-pending.md`, `meta-materialization.md`, `state-store.md`, `git-integration.md`, `local-planner.md`, `mirror-adapter.md`, `agents-and-skills.md`. Each follows the component-blueprint shape — H1 title, `## Capability Summary`, `## Core Components` with fenced ` ```component ` blocks grouped by `###` subheadings and relationship paragraphs between blocks where direction or data flow isn't obvious from colocation, optional fenced ` ```model ` blocks where canonical data shapes are central, `## System Contracts`, `## Architecture Decision Records`.
- `blueprints/features/`: 1:1 with each FRD in `requirements/features/`: `prd-authoring.md`, `requirements-loop.md`, `blueprint-loop.md`, `work-orders-loop.md`, `coding-loop.md`, `python-orchestrator.md`, `on-disk-layout.md`. Each follows the feature-blueprint shape — H1 title, `## Feature Summary` referencing the corresponding FRD via `@Requirements`, `## Component Blueprint Composition` using `@Blueprint(...)` and `#Component` mentions to compose shared components without redefining them, `## Feature-Specific Components` with full fenced ` ```component ` blocks for components that exist only for this feature, `## System Contracts`, `## Architecture Decision Records`.

Section order, fenced-block keys (`name`, `container`, `responsibilities` for `component`; `name`, `store`, `description`, `fields`, `constraints` for `model`), and ADR shape match the canonical structural contract pinned in @Requirements(blueprint-loop) REQ-BL-002 / REQ-BL-005 and the project's blueprint document-shape contract.

## Changes since previous attempt

- added: `blueprints/containers/python-orchestrator.md` — container blueprint for the harness CLI Python process; covers entry-point subcommands and the cross-container integration surface.
- added: `blueprints/containers/claude-code-subprocess.md` — container blueprint for the `claude -p` runtime; covers subprocess classes (upstream-loop generator, upstream-loop reviewer, coding-loop per-WO generator, coding-loop per-WO reviewer) and their hook configurations.
- added: `blueprints/containers/project-repo.md` — container blueprint for the on-disk artifact + state + git store; covers entry-point classes per artifact tree and the Software-Factory-mirror posture.
- added: `blueprints/containers/github.md` — container blueprint for the external GitHub system; covers PR open, comment post, and merge detection via `gh` CLI.
- added: `blueprints/components/loop-driver.md` — shared upstream-loop fan-out/aggregation driver; defines `#LoopDriver`, `#VerdictAggregator`, `#BudgetEnforcer`, and the three per-loop prompt builders.
- added: `blueprints/components/subprocess-runtime.md` — `claude -p` spawn mechanism; defines `#SubprocessSpawner`, `#SessionContinuity`, `#RateLimitClassifier`/`#RateLimitRetryStrategy`, `#ProtocolRetryStrategy`, `#StopHookGenerator`, `#StopHookReviewer`, `#ReviewerPathGuardHook`.
- added: `blueprints/components/communication-folder.md` — gen↔reviewer transcript folder mechanism; defines `#CommunicationFolderManager`, `#CommunicationFolderSnapshotter`, and the `CommunicationFile` model.
- added: `blueprints/components/questions-pending.md` — non-blocking clarification mechanism; defines `#QuestionsPendingDetector`, the `BareQuestionBlock` and `WithOptionsQuestionBlock` models, and the `<!-- pending: ... -->` marker syntax.
- added: `blueprints/components/meta-materialization.md` — orchestrator-managed dotted-hidden meta files; defines `#MetaMaterialiser`, `#SlugDiscoverer`, `#H1Extractor`, `#BlockedByMaterialiser`, plus the `NodeMetaFile`, `RequirementsMetaFile`, `WorkOrderMetaFile`, `SequenceMetaFile` models.
- added: `blueprints/components/state-store.md` — JSON state files plus reviews archive; defines `#StateStore`, `#ReviewSnapshotter`, `#StatusReporter`, plus `PerLoopState`, `PerWorkOrderState`, `ReviewSnapshot` models.
- added: `blueprints/components/git-integration.md` — git/gh wrapper layer; defines `#GitIntegration`, `#BranchManager`, `#PROperationLayer`, `#MergeDetector`, `#PRCommentMirror`.
- added: `blueprints/components/local-planner.md` — work-order queue planner; defines `#LocalPlanner`, `#WorkOrderMetaReader`, plus the `WorkOrder` model.
- added: `blueprints/components/mirror-adapter.md` — outbound-only mirror push interface; defines `#MirrorAdapter` Protocol, concrete `#SoftwareFactoryMirror` and `#GitHubProjectsMirror` (deferred), `#MirrorPushOrchestrator`.
- added: `blueprints/components/agents-and-skills.md` — agent identities and skill artifacts; defines per-loop generator agents, per-loop reviewer agent groups, `#PRDAuthoringSkill`, `#BlueprintAuthoringSkill`, `#IndexUpdaterAgent`.
- added: `blueprints/features/prd-authoring.md` — feature blueprint for the interactive PRD-authoring skill; composes @Blueprint(agents-and-skills) and @Blueprint(project-repo).
- added: `blueprints/features/python-orchestrator.md` — feature blueprint for the Python orchestrator; composes essentially every component blueprint plus container @Blueprint(python-orchestrator).
- added: `blueprints/features/on-disk-layout.md` — feature blueprint for the on-disk layout; composes @Blueprint(project-repo), @Blueprint(meta-materialization), @Blueprint(communication-folder), @Blueprint(questions-pending), @Blueprint(state-store).
- added: `blueprints/features/requirements-loop.md` — feature blueprint for the requirements loop; composes @Blueprint(loop-driver), @Blueprint(subprocess-runtime), @Blueprint(communication-folder), @Blueprint(questions-pending), @Blueprint(meta-materialization), @Blueprint(state-store), @Blueprint(git-integration), @Blueprint(agents-and-skills).
- added: `blueprints/features/blueprint-loop.md` — feature blueprint for the blueprint loop; same composition shape as requirements-loop with the `frd-to-blueprint` skill, four `bp-*` reviewers, and bare-and-with-options question shapes.
- added: `blueprints/features/work-orders-loop.md` — feature blueprint for the work-orders loop; composes the same upstream-loop component set with the `blueprint-to-work-orders` skill, three `wo-*` reviewers, bare-only question shape, and the `.sequence.meta.yaml` hash short-circuit.
- added: `blueprints/features/coding-loop.md` — feature blueprint for the coding loop; explicitly omits @Blueprint(loop-driver) and @Blueprint(communication-folder) (per-WO execution differs structurally), composes @Blueprint(local-planner) and @Blueprint(github) instead.

No `blueprints/_questions-pending.md` was created — every architectural choice in the tree (Python with stdlib-only, file-system canonical, `gh` CLI rather than direct REST, JSON state, `claude -p` subprocess runtime, four-reviewer upstream-loop pattern, three-reviewer work-orders pattern, six-reviewer coding-loop pattern) is grounded in `BLUEPRINT.md` and the FRD set; no high-impact decision is silent. If `bp-decision-judge` flags any silent decision on review, I will file a question rather than guess.

## Review — attempt 2

Walked all 21 blueprints across `containers/` (4), `components/` (10), and `features/` (7). Every file is in the correct subdirectory for its type, opens with a single H1, follows the canonical section order for its blueprint type, and uses well-formed fenced `component` and `model` blocks with the required keys. ADRs are sequential per file (`ADR-001`…) and each carries the three labelled paragraphs **Context** / **Decision** / **Consequences**. Component names referenced via `#PascalCase` mentions resolve consistently within each doc, and I found no refactor breadcrumbs (no `(renamed from …)`, `(previously …)`, `(unchanged)`, `(existing)`, "the old name" parentheticals). The tree is structurally clean from this judge's perspective.

No critical structural findings. Cross-blueprint redefinition concerns (e.g. `CodingLoopDriver` is declared as a feature-specific `component` block in both `blueprints/features/python-orchestrator.md` and `blueprints/features/coding-loop.md`) and unresolved cross-doc mentions (e.g. `#MetaFileFormatRules` referenced in `meta-materialization.md` line 16 with no matching definition anywhere) are out of scope here — those are `bp-consistency-judge` and `bp-coverage-judge` territory respectively, not structural shape.

## Changes since previous attempt

- edited: `blueprints/containers/python-orchestrator.md` — fixed broken `#ProjectRepo` mention in `## Infrastructure` (replaced with prose-only `@Blueprint(project-repo)` reference; addresses `bp-coverage-judge` BROKEN_REF finding).
- edited: `blueprints/features/coding-loop.md` — removed the `#PerWOGenerator` fenced `component` block; replaced with relationship prose deferring to `#CodingGeneratorAgent` from `@Blueprint(agents-and-skills)` (addresses `bp-consistency-judge` REDEFINITION finding #2).
- edited: `blueprints/features/python-orchestrator.md` — removed the `#CodingLoopDriver` fenced `component` block; replaced with relationship prose deferring to `@Feature(coding-loop)` for the canonical definition (addresses `bp-consistency-judge` REDEFINITION finding #3, and the same out-of-scope concern you flagged).
- edited: `blueprints/components/meta-materialization.md` — fixed broken `#MetaFileFormatRules` mention on line 16 (replaced with prose pointing at the four model blocks defined below in the same doc; addresses the second out-of-scope concern you flagged).
- added: `blueprints/_questions-pending.md` — one with-options block on the post-exit protocol-retry contradiction between FRD REQ-ORCH-013 and `BLUEPRINT.md` §1.1/§1.6.
- edited: `blueprints/components/subprocess-runtime.md` — added `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` markers above the `#ProtocolRetryStrategy` block and ADR-001.
- edited: `blueprints/components/state-store.md` — added inline `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` marker on the `protocol_failures[]` field.

Section order, fenced-block keys, and ADR shape are unchanged across all 21 blueprints — the edits above are targeted text edits and one block deletion, none of which alter structural shape. The `<!-- pending: -->` markers conform to @Blueprint(questions-pending)'s pending-marker syntax (HTML comment, the literal title used in `_questions-pending.md`).

## Changes since previous attempt

Operator resolved the open question (commit `9cb8ad3`, answer "option 2 — keep `#ProtocolRetryStrategy` and revise BLUEPRINT.md to acknowledge the third recovery layer"). The blueprint tree's existing structure aligns with this resolution, so only the inline pending markers needed removal. Blueprint structural shape (section order, fenced-block keys, ADR shape) is unchanged.

- edited: `blueprints/components/subprocess-runtime.md` — removed the two `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` HTML comments (one above the `#ProtocolRetryStrategy` `component` block, one above ADR-001). The `component` block and ADR-001 themselves are unchanged.
- edited: `blueprints/components/state-store.md` — removed the inline `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` HTML comment from the `protocol_failures[]` field of `PerLoopState`. The field itself is unchanged.
- (no longer in tree): `blueprints/_questions-pending.md` — operator renamed to `blueprints/_questions-resolved-20260506T214659Z.md` for git-history audit; the file is no longer in the open-questions register location.

## Review — attempt 1

Walked the full tree: 4 container blueprints, 10 component blueprints, 7 feature blueprints (21 total). Every file is in the correct subdirectory for its declared type, opens with a single H1, follows the canonical section order for its type, and uses well-formed fenced `component` and `model` blocks with all required keys. ADRs are sequentially numbered per file starting at `ADR-001` and each carries the three labelled paragraphs **Context** / **Decision** / **Consequences** in order. Component names referenced as `#PascalCase` mentions resolve consistently within their own document, and there are no refactor breadcrumbs anywhere in the tree (no `(renamed from …)`, `(previously …)`, `(unchanged)`, `(existing)`, "old name" parentheticals). The two targeted edits since the last attempt — removing the `<!-- pending: post-exit-protocol-retry-vs-blueprint-md -->` HTML comments from `blueprints/components/subprocess-runtime.md` and `blueprints/components/state-store.md` — leave both files structurally clean (section order, fenced-block keys, ADR shape, and within-doc fact-level consistency unchanged).

No critical structural findings. The tree is structurally clean from this judge's perspective.

## Review — attempt 2

Re-walked all 21 blueprints (4 containers, 10 components, 7 features). No structural shape regressions since attempt 1. Every file still opens with a single H1, follows the canonical section order for its type, uses well-formed fenced `component` and `model` blocks with all required keys (`name`/`container`/`responsibilities` for components; `name`/`store`/`description`/`fields`/`constraints` for models), and carries sequentially numbered `### ADR-NNN: Title` entries with the three labelled paragraphs **Context** / **Decision** / **Consequences** in order. Within-doc fact-level consistency holds — `#PascalCase` mentions resolve against `component` blocks in the same doc, and there are no refactor breadcrumbs anywhere. No leftover `<!-- pending: -->` HTML markers remain in any blueprint file.

No critical structural findings. The tree remains structurally clean from this judge's perspective.
