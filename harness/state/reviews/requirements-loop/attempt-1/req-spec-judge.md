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
