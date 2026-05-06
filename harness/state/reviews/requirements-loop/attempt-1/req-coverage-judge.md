# req-coverage-judge

## Review

PRD↔tree mapping is clean after the four-stage→five-stage restructure. Every PRD-named overview topic has a corresponding `requirements/overview/<slug>.md`. Every feature in the PRD's components and project-lifecycle sections has a corresponding `requirements/features/<slug>.md`, including the new `work-orders-loop.md`. Spot-checked the new work-orders loop coverage: PRD §6.4 (trigger, generator skill `blueprint-to-work-orders`, document shape, hash short-circuit, bare-question mechanism, communication folder, three reviewers, dual completion / `awaiting_clarification`, no-PR commit) is fully covered by REQ-WO-001 through REQ-WO-010 in the new FRD. The slimmed coding-loop FRD covers PRD §6.5 (queue drain, per-WO generator subprocess, six gates with `## Gates`-driven dispatch, PR comment mirroring, merge detection, gap filing) via REQ-CL-001 through REQ-CL-007. No fabricated nodes detected; every overview and feature node traces to specific PRD content. No missing nodes detected (PRD §3 Goals & Non-Goals is intentionally folded into product-description / design-principles rather than getting its own overview node — consistent with prior structure).

## Review — attempt 1

PRD↔tree mapping remains clean. Walked the full requirements tree against the current `PRD.md` and verified every visible overview node and every feature node maps to specific PRD content; nothing in the tree is fabricated and every PRD-shaped topic has a home.

**Overview coverage** (PRD §1, §2.{Business Problem, Current State, Personas, Success Metrics, Measurement}, §4, §5, §6, §7 component-level synthesis, §9):

- `overview/product-description.md` ← §1 Overview (five-stage framing, loop mechanic, local-first posture, single-operator scope).
- `overview/business-problem.md` ← §2.Business Problem (verbatim ground for paragraphs).
- `overview/current-state.md` ← §2.Current State (Claude Code primitives, Software Factory framing).
- `overview/personas.md` ← §2.Personas (single-operator persona).
- `overview/success-metrics.md` ← §2.Success Metrics (four indicators).
- `overview/measurement.md` ← §2.Measurement (state files, snapshot location, ad-hoc inspection).
- `overview/design-principles.md` ← §4 (eight principles, all carried).
- `overview/architecture.md` ← §5 (responsibilities table prose, loop shape, Claude-Code-as-runtime).
- `overview/project-lifecycle.md` ← §6 (five stages summarised).
- `overview/technical-requirements.md` ← §7 component-level synthesis (orchestrator, on-disk layout, state files, skills, hooks/agents, local-planner, mirror adapter, GitHub CLI layer).
- `overview/appendix.md` ← §9 Deferred / Open Questions (all twelve items carried).

PRD §3 Goals & Non-Goals has no dedicated overview node; it is folded into `product-description.md` and `design-principles.md`. This is consistent with the prior reviewed state and is a defensible structural choice (the goals/non-goals are mostly principle-shaped). Not flagging as MISSING.

**Feature coverage** (PRD §6.1–§6.5, §7.1–§7.2):

- `features/prd-authoring.md` ← §6.1 (interactive skill, five-category critique, clarification policy, no-fabrication discipline).
- `features/requirements-loop.md` ← §6.2 (trigger, `prd-to-frds` generator, two output surfaces, four reviewers, communication folder, dual completion, no-PR commit).
- `features/blueprint-loop.md` ← §6.3 (trigger, `frd-to-blueprint`, three blueprint types, bare/with-options questions, four reviewers, communication folder, dual completion).
- `features/work-orders-loop.md` ← §6.4 (trigger, `blueprint-to-work-orders`, document shape pinned in REQ-WO-002, mention syntax, hash short-circuit, bare-only questions, three reviewers, communication folder, dual completion, status `ready` on pass).
- `features/coding-loop.md` ← §6.5 (queue drain, `--one`, per-WO subprocess, branch `task/<task_id>`, six gates with `## Gates` dispatch, PR comment mirroring, merge detection, gap filing).
- `features/python-orchestrator.md` ← §7.1 (CLI entry, five subcommands, subprocess spawn, verdict capture, retry/exhaustion, commit, merge detection, communication-folder lifecycle, protocol-retry, rate-limit handling, state files, status, local-planner/mirror).
- `features/on-disk-layout.md` ← §7.2 (project-root layout, flat node shape, meta materialisation, work-orders flat tree, blueprints subdirectories, questions files, communication folders, harness state, artifacts, no-versioning, project-template skeleton).

**No fabrication detected.** Every feature and overview node has clear PRD source. Spot-checked specific claims: REQ-ORCH-013 (protocol-retry) traces to PRD §7.5 ("the orchestrator records that reviewer's verdict as `fail`" — though the PRD's exact wording is softer than the FRD's 2-retry budget; the FRD's budget shape is a reasonable elaboration, not a fabrication, and this lives in the spec/cross-doc judges' lane). REQ-ORCH-014 (rate-limit handling) traces to PRD §7.5 ("rate-limit retry layer ... doubling backoff (30s, 60s, 120s, …) ... up to `max_agent_retries` times"). REQ-BL-002.9 (optional root `BLUEPRINT.md`) traces to PRD §7.4 (`frd-to-blueprint` "reads ... an **optional root `BLUEPRINT.md`** if the operator has authored one").

**No missing nodes detected.** All five lifecycle stages, both component-level features (orchestrator, layout), and all overview-shaped PRD topics are represented. PRD §8 Verification Stacks is correctly distributed across the per-loop FRDs rather than getting a standalone node — the reviewer rubrics live in the loop FRDs that own those reviewers, which is consistent with the prior structure.

Coverage is clean.

