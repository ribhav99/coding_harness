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
