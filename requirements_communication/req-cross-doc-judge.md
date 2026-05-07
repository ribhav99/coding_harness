# req-cross-doc-judge

## Review

Walked the full `requirements/` tree (7 feature FRDs + 11 overview docs). All six previously-flagged CONFLICTs and the residual `code-spec-judge` Terminology mismatch in `work-orders-loop.md` are resolved.

Spot-verified:

- `requirements/features/on-disk-layout.md:87` AC-LAYOUT-008.1 lists `requirements-loop.json`, `blueprint-loop.json`, `work-orders-loop.json` (no more `coding-loop-seq-gen.json`).
- `requirements/features/on-disk-layout.md:88` AC-LAYOUT-008.2 names upstream loops as `(requirements, blueprint, work-orders)`.
- `requirements/features/python-orchestrator.md:7` Overview prose says "four autonomous loops".
- `requirements/features/work-orders-loop.md:17` Terminology entry for "Acceptance criterion" lists the gate token as bare `code-spec` (matching AC-WO-002.7, AC-WO-006.2(c), and the `## Gates` block).
- Subcommand list `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, `status` agrees across `python-orchestrator.md` (AC-ORCH-001.2) and `technical-requirements.md`.
- Reviewer counts are consistent: 4 for requirements, 4 for blueprint, 3 for work-orders, 6 for coding execution.
- Generator skill names (`prd-to-frds`, `frd-to-blueprint`, `blueprint-to-work-orders`) and judge names (`req-*`, `bp-*`, `wo-*`, `code-*`) agree across FRDs and overview docs.
- No remaining `blueprint-to-tasks` / `scope-task` / unprefixed `spec-judge`/`regression-judge`/`security-judge`/`quality-judge` references.

No fact-level mismatches, terminology drift, or broken cross-references found across the tree.

## Review — attempt 1

Walked the full tree (7 feature FRDs + 11 overview docs). No critical cross-doc issues found. The previously-flagged CONFLICTs around the work-orders split, communication-folder lifecycle, gate-key bareness in `code-spec`, and overview-prose loop counts remain resolved.

Spot-verified key cross-doc facts:

- **Subcommand list** agrees across `python-orchestrator.md` AC-ORCH-001.2, `technical-requirements.md`, `project-lifecycle.md`, and the per-loop FRDs: `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, `status`.
- **Loop count of "four autonomous loops"** agrees across `product-description.md`, `project-lifecycle.md`, `python-orchestrator.md` Overview, `design-principles.md`, and `architecture.md`.
- **Reviewer counts and names** are internally consistent: requirements (4: `req-spec-judge`, `req-cross-doc-judge`, `req-coverage-judge`, `req-scoping-judge`), blueprint (4: `bp-spec-judge`, `bp-coverage-judge`, `bp-consistency-judge`, `bp-decision-judge`), work-orders (3: `wo-scoping-judge`, `wo-coverage-judge`, `wo-dependency-judge`), coding (6: `tests`, `playwright`, `code-spec-judge`, `code-regression-judge`, `code-security-judge`, `code-quality-judge`). FRDs, overview docs, and `appendix.md`'s reviewer-prefixing entry all agree.
- **Generator skill names** (`prd-to-frds`, `frd-to-blueprint`, `blueprint-to-work-orders`, plus per-work-order coding-loop generator) agree across FRDs and `python-orchestrator.md`.
- **State-file names** (`requirements-loop.json`, `blueprint-loop.json`, `work-orders-loop.json`, plus per-`<task_id>.json`) agree across `on-disk-layout.md` AC-LAYOUT-008.1, the per-loop FRDs (`AC-RL-009.3`, `AC-BL-009.3`, `AC-WO-010.3`), and `python-orchestrator.md`.
- **Gate-key set in `## Gates`** — six required keys `tests`, `playwright`, `code-spec`, `code-regression`, `code-security`, `code-quality`, with the four LLM gates always `required` — agrees verbatim between `work-orders-loop.md` AC-WO-002.8 and `coding-loop.md` AC-CL-004.8.
- **Acceptance-criterion gate token** is the bare gate key (`tests` / `playwright` / `code-spec`) in both `work-orders-loop.md` AC-WO-002.7 (Terminology + AC) and `coding-loop.md` Feature Behavior & Rules; no remaining bare-vs-`-judge` mismatch.
- **Communication-folder semantics** ("never wiped; accumulates forever; snapshotted to `harness/state/reviews/<loop>/attempt-<N>/`") agree across `on-disk-layout.md` REQ-LAYOUT-012, `python-orchestrator.md` REQ-ORCH-012, the three upstream-loop FRDs, `architecture.md`, `technical-requirements.md`, and `measurement.md`.
- **Coding-loop has no communication folder** — consistent in `coding-loop.md` Overview/§FB&R, `python-orchestrator.md` AC-ORCH-012.6, `on-disk-layout.md` AC-LAYOUT-012.7, `architecture.md`, `technical-requirements.md`, and `product-description.md`.
- **Per-type meta-file shape** (two dotted-hidden meta files per node; four fields in the kind-specific meta, one field in the requirements meta) agrees between `on-disk-layout.md` REQ-LAYOUT-002/003/006 and `requirements-loop.md` REQ-RL-003.
- **Blueprint subdirectory layout** (`blueprints/{containers,components,features}/`) and slug-1:1 match (`blueprints/features/<slug>.md` ↔ `requirements/features/<slug>.md`) agree across `blueprint-loop.md` AC-BL-002.3 / AC-BL-005.2(a), `on-disk-layout.md` REQ-LAYOUT-006, `appendix.md`, and `technical-requirements.md`.
- **PRD-authoring rubric** (CONFLICT, MISSING, AMBIGUOUS, DUPLICATION, STALE — five categories) agrees between `prd-authoring.md` REQ-PRDA-004 and `project-lifecycle.md` Stage 1.
- **Cross-references** all resolve: `requirements/features/work-orders-loop.md` REQ-WO-002 (referenced from `on-disk-layout.md` AC-LAYOUT-005.4 and `appendix.md`); `REQ-ORCH-013` (referenced from per-loop FRDs); `REQ-LAYOUT-006` (referenced from `appendix.md`); the project's blueprint document-shape contract (referenced from `on-disk-layout.md` AC-LAYOUT-006.5, `blueprint-loop.md` AC-BL-002.6, and `appendix.md`) — the contract reference is intentionally external and clearly labeled.

No fact-level mismatches, no terminology drift, no significant duplication that should consolidate, and no broken cross-references found across the tree.

## Review

Walked the full tree (7 feature FRDs + 11 overview docs) plus PRD.md and BLUEPRINT.md after the work-orders-loop restructure. Three critical fact-level mismatches found between PRD.md and the FRDs/skills.

### CONFLICT — AC ID format in PRD §7.4 skill description

**Files:** `PRD.md:385`, `requirements/features/work-orders-loop.md` AC-WO-002.7, `skills/work-orders/blueprint-to-work-orders.md`, `skills/coding/code-spec-judge.md`.
**Mismatch:** PRD.md:385 describes `code-spec-judge` as walking "each `AC-WO-NNN.M (via code-spec)` row." The pinned AC ID format in `work-orders-loop.md` AC-WO-002.7 and the skills (both the generator and `code-spec-judge`) is `AC-WO-<slug>.M`. The PRD's `NNN` form is the pre-restructure numeric ID; it should match the post-restructure slug-based ID.
**Fix:** PRD.md:385 — replace `AC-WO-NNN.M` with `AC-WO-<slug>.M`.

### CONFLICT — AC ID format in PRD §9 resolved-questions entry

**Files:** `PRD.md:478`, `requirements/features/work-orders-loop.md` AC-WO-002.7.
**Mismatch:** PRD.md:478 (the "Work-order artifact shape — Resolved" appendix-style bullet) lists the AC row format as `- [ ] AC-WO-NNN.M (via tests|playwright|code-spec) — Outcome`. Same drift as above; should be `AC-WO-<slug>.M`.
**Fix:** PRD.md:478 — replace `AC-WO-NNN.M` with `AC-WO-<slug>.M`.

### CONFLICT — work-orders-loop reviewer count in BLUEPRINT.md component map

**Files:** `BLUEPRINT.md:27`, `PRD.md:443`, `requirements/features/work-orders-loop.md` REQ-WO-006, `requirements/overview/project-lifecycle.md`.
**Mismatch:** `BLUEPRINT.md:27` labels the work-orders loop in the §0.1 component-map mermaid as "generator + 3 reviewers". Every other doc (PRD.md §8.3 "4 gates + dual completion condition", `work-orders-loop.md` REQ-WO-006 spawning four named reviewers, `project-lifecycle.md` "four reviewer subprocesses") agrees on four. The `3 reviewers` label is stale from the pre-restructure three-judge set (`wo-scoping`, `wo-coverage`, `wo-dependency`).
**Fix:** `BLUEPRINT.md:27` — change `generator + 3 reviewers` to `generator + 4 reviewers`.

Other spot-verifications agree across the tree: subcommand list, four-loop count, generator skill names, four post-restructure judge names (`wo-spec-judge`, `wo-coverage-judge`, `wo-overlap-judge`, `wo-sequencing-judge`) with no leftover `wo-scoping-judge`/`wo-dependency-judge` references, mention syntax `@wo-<slug>` (not `@wo-NNN`), branch naming `task/<wo-slug>` (no remaining `task/<task_id>`), `_sequence.md` and `_external-blockers.md` referenced consistently across `on-disk-layout.md`, `work-orders-loop.md`, `coding-loop.md`, `python-orchestrator.md`, PRD, BLUEPRINT, and the overview docs, communication-folder never-wipe semantics consistent, status set including `blocked_external` and type set including `operator-action` consistent, gate-key set in `## Gates` consistent between `work-orders-loop.md` and `coding-loop.md`. The only remaining drift is the three CONFLICTs above.

## Review

Walked the full tree (PRD.md + BLUEPRINT.md + 7 feature FRDs + 11 overview docs + the work-orders + coding skill files) after the three previously-flagged CONFLICTs were addressed.

Verified the prior fixes:

- `PRD.md:385` — `code-spec-judge` skill description now reads `AC-WO-<slug>.M`. Clean.
- `PRD.md:478` — appendix "Work-order artifact shape — Resolved" bullet now reads `AC-WO-<slug>.M`. Clean.
- `BLUEPRINT.md:27` — work-orders loop label in the §0.1 component-map mermaid now reads `generator + 4 reviewers`. Clean.

Cross-doc consistency sweep across the tree:

- **Reviewer counts and names**: requirements (4: `req-*`), blueprint (4: `bp-*`), work-orders (4: `wo-spec-judge`, `wo-coverage-judge`, `wo-overlap-judge`, `wo-sequencing-judge`), coding execution (6: `tests`, `playwright`, `code-spec-judge`, `code-regression-judge`, `code-security-judge`, `code-quality-judge`). PRD §8, BLUEPRINT §0.1 / §3.3 / §10.2, work-orders-loop.md REQ-WO-006, project-lifecycle.md, and the comm-file naming in AC-WO-005.2 all agree. No leftover `wo-scoping-judge` / `wo-dependency-judge` references.
- **AC ID format**: `AC-WO-<slug>.M` consistent across PRD.md (§7.4 + §9 appendix), work-orders-loop.md AC-WO-002.7 + Terminology, blueprint-to-work-orders skill, code-spec-judge skill, wo-spec-judge skill. No remaining `AC-WO-NNN.M`.
- **Mention syntax**: `@wo-<slug>` consistent in PRD §6.4, work-orders-loop.md Terminology, appendix.md, blueprint-to-work-orders skill (Mention syntax + Concrete example). No remaining `@wo-NNN`.
- **Branch naming**: `task/<wo-slug>` consistent in PRD §6.5, BLUEPRINT §3.3 / §7, coding-loop.md Overview + REQ-CL-002/003/006, python-orchestrator.md AC-ORCH-006.1, project-lifecycle.md. No remaining `task/<task_id>`.
- **WO file naming**: `wo-<slug>.md` + `.wo-<slug>.meta.yaml` (flat, no per-WO directories) consistent across PRD §6.4 + §7.2 tree, BLUEPRINT §3.3 + §7.2 example, work-orders-loop.md Terminology + ACs, on-disk-layout.md REQ-LAYOUT-005, coding-loop.md, technical-requirements.md, project-lifecycle.md. No remaining `wo-NNN/` or `description.md` references for WOs.
- **`_sequence.md` and `_external-blockers.md`**: referenced consistently in PRD, BLUEPRINT, work-orders-loop FRD, coding-loop FRD, on-disk-layout FRD, python-orchestrator FRD, and overview docs.
- **Status set** `backlog | ready | in_progress | done | blocked_external` and **type set** `feature | refactor | bug-fix | infra | operator-action` agree between BLUEPRINT.md WorkOrder TypedDict (§4) and on-disk-layout.md AC-LAYOUT-005.3.
- **Gate-key set** (six bare keys; four code-* always `required`) agrees between work-orders-loop.md AC-WO-002.8 and coding-loop.md AC-CL-004.8.
- **Subcommand list** `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, `status` consistent across PRD §7.1, BLUEPRINT §3.1 + §7.4, python-orchestrator.md AC-ORCH-001.2 + Terminology, technical-requirements.md.
- **Five-stages / four-autonomous-loops framing** consistent across PRD §1, project-lifecycle.md, product-description.md, architecture.md, design-principles.md, BLUEPRINT §0.2.
- **Communication-folder never-wipe semantics** consistent across on-disk-layout.md REQ-LAYOUT-012, python-orchestrator.md REQ-ORCH-012, the three upstream-loop FRDs, BLUEPRINT §1.8 + §7.6, technical-requirements.md, and measurement.md.
- **Coding loop has no communication folder** consistent across coding-loop.md, python-orchestrator.md AC-ORCH-012.7, on-disk-layout.md AC-LAYOUT-012.7, architecture.md, technical-requirements.md, product-description.md, BLUEPRINT §0.1.
- **Cross-references** all resolve: REQ-WO-002 (referenced from on-disk-layout.md AC-LAYOUT-005.4 and appendix.md); REQ-ORCH-013 (referenced from per-loop FRDs); the project's blueprint document-shape contract (referenced from on-disk-layout.md AC-LAYOUT-006.5, blueprint-loop.md AC-BL-002.6, appendix.md, and BLUEPRINT.md §11).

No fact-level mismatches, no terminology drift, no significant duplication, no broken cross-references found across the tree.
