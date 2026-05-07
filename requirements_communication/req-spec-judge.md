## Review

Walked the full requirements/ tree. All seven feature FRDs (`blueprint-loop.md`, `coding-loop.md`, `on-disk-layout.md`, `prd-authoring.md`, `python-orchestrator.md`, `requirements-loop.md`, `work-orders-loop.md`) carry the four canonical sections in order (Overview → Terminology → Requirements → Feature Behavior & Rules), open with an H1, and have well-formed REQ-IDs (`REQ-<ACRONYM>-NNN`) plus AC-IDs (`AC-<ACRONYM>-NNN.M`) using "shall" phrasing. Overview docs (`business-problem.md`, `personas.md`, etc.) are narrative prose, not bullet lists.

The previously-flagged inconsistency in `work-orders-loop.md:17` is fixed — the Terminology entry for "Acceptance criterion" now lists the observation gate token as bare `code-spec`, matching `AC-WO-002.7`, `AC-WO-002.8`, and `AC-WO-006.2`. No remaining within-doc fact-level mismatches found.

No refactor breadcrumbs. The one literal match for "renamed from" in `prd-authoring.md:30` is inside `AC-PRDA-002.5` describing the breadcrumbs rule itself; that is content, not residue.

Tree is structurally clean.

## Review — attempt 1

Re-walked the full `requirements/` tree on this fresh attempt. All seven FRDs (`blueprint-loop.md`, `coding-loop.md`, `on-disk-layout.md`, `prd-authoring.md`, `python-orchestrator.md`, `requirements-loop.md`, `work-orders-loop.md`) hold the four canonical sections in order, open with the correct H1, and use well-formed `REQ-<ACRONYM>-NNN` + `AC-<ACRONYM>-NNN.M` IDs with consistent "shall" phrasing. Every requirement carries a User Story in the canonical "As a [role], I want to [action], so that I can [outcome]" form, and acceptance criteria use "When… shall…" or equivalent testable phrasing. Overview docs (`business-problem.md`, `current-state.md`, `personas.md`, `success-metrics.md`, `product-description.md`, `architecture.md`, `design-principles.md`, `measurement.md`, `project-lifecycle.md`, `technical-requirements.md`, `appendix.md`) are narrative prose, each with a correct H1.

Within-doc fact-level consistency holds. In `work-orders-loop.md`, the gate-key trio `tests | playwright | code-spec` is referenced identically across the Terminology entry (line 17), `AC-WO-002.7`, `AC-WO-002.8`, and `AC-WO-006.2`(c); the six-key Gates block in `AC-WO-002.8` agrees with `AC-CL-004.8` in the coding-loop FRD. In `on-disk-layout.md`, the meta-file shape (four fields in `.<slug>.<kind>.meta.yaml`, one field in `.<slug>.requirements.meta.yaml`) is stated consistently across `REQ-LAYOUT-003` and `REQ-LAYOUT-006`. The communication-folder enumeration (`requirements_communication/`, `blueprints_communication/`, `work-orders_communication/`) is consistent across `on-disk-layout.md`, `requirements-loop.md`, `blueprint-loop.md`, `work-orders-loop.md`, and `python-orchestrator.md`.

No refactor breadcrumbs found in any FRD. The strikethrough `~~Resolved.~~` markers in `requirements/overview/appendix.md` are intentional appendix content tracking deferred-vs-resolved decisions; the doc's own opening paragraph defines this pattern, so they read as documentation of the appendix's purpose rather than residue.

Tree is structurally clean.

## Review

Re-walked the requirements tree after the work-orders-loop restructure (flat slug-named WOs, four reviewers, `_sequence.md`, `_external-blockers.md`, `type: operator-action`, `status: blocked_external`, AC IDs `AC-WO-<slug>.M`, mention syntax `@wo-<slug>`).

All seven FRDs hold the four canonical sections in order (Overview → Terminology → Requirements → Feature Behavior & Rules), open with the correct H1, and the new content in `work-orders-loop.md`, `coding-loop.md`, `on-disk-layout.md`, and `python-orchestrator.md` follows the same shape. `work-orders-loop.md` carries 11 well-formed `REQ-WO-NNN` requirements (REQ-WO-001 through REQ-WO-011), each with a canonical User Story and `AC-WO-NNN.M` acceptance criteria using "shall" phrasing. `coding-loop.md` carries seven REQs (REQ-CL-001 through REQ-CL-007) in the same shape.

Within-doc fact-level consistency holds across the substantially-changed FRDs:

- The four work-orders-loop reviewers — `wo-spec-judge`, `wo-coverage-judge`, `wo-overlap-judge`, `wo-sequencing-judge` — are named identically in `AC-WO-005.2`, `AC-WO-006.1`–`AC-WO-006.4`, `AC-LAYOUT-012.2`, and the prose Feature Behavior section. No leftover references to the old `wo-scoping-judge` or `wo-dependency-judge` names anywhere in the requirements tree.
- The flat slug-based WO file shape (`wo-<slug>.md` + `.wo-<slug>.meta.yaml`) is stated identically across `AC-LAYOUT-005.1`–`AC-LAYOUT-005.3`, `AC-WO-002.1`, `AC-WO-003.3`, `AC-WO-005.2`, and the coding-loop's `AC-CL-002.1`–`AC-CL-003.1`. No leftover `wo-NNN/` directory or `description.md` references.
- The status set `backlog | ready | in_progress | done | blocked_external` (AC-LAYOUT-005.3) and the type set `feature | refactor | bug-fix | infra | operator-action` (AC-LAYOUT-005.3) match references in `AC-WO-010.4`, `AC-WO-011.1`, `AC-CL-002.1`, `AC-CL-003.5`, and the Terminology sections of both FRDs.
- The branch-naming convention `task/<wo-slug>` is consistent across `AC-CL-002.2`, `AC-CL-002.4`, `AC-CL-003.2`, `AC-CL-006.1`, and `AC-ORCH-006.1`.
- AC ID format `AC-WO-<slug>.M` is consistent across `AC-WO-002.7`, the work-orders-loop Terminology entry, `AC-CL-004.4`, and the §8.4 verification stack in PRD.md.

No refactor breadcrumbs. The "renamed from" match in `prd-authoring.md:30` is inside `AC-PRDA-002.5` defining the breadcrumbs rule (content, not residue). The `~~Resolved.~~` strikethrough markers in `requirements/overview/appendix.md` are intentional documentation of the appendix's deferred-vs-resolved tracking pattern.

Tree is structurally clean.
