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

## Review

Walked the tree after the three changes (operator-action carve-out, `_inbox/` → `_backlog/` rename, dropped backlog-check from `wo-overlap-judge`). The rename and the overlap-judge change are clean. The carve-out is internally consistent inside `requirements/features/work-orders-loop.md` (AC-WO-002.1, .7, .8, .10) and the work-orders judge skills, but the PRD and `project-lifecycle.md` describe the canonical scoped-task shape as universal, without acknowledging the operator-action exception. Five fact-level mismatches.

### CONFLICT — PRD §6.4 work-order document shape claims universal canonical shape

**Files:** `PRD.md:194`, `requirements/features/work-orders-loop.md` AC-WO-002.1 / .7 / .8 / .10.
**Mismatch:** PRD.md:194 says "Every work order's `wo-<slug>.md` follows a single canonical shape" and lists `## Acceptance criteria` as "each `- [ ] AC-WO-<slug>.M (via tests|playwright|code-spec) — Outcome` with the bare gate key" plus `## Gates` (fenced YAML…) as required components. The work-orders-loop FRD AC-WO-002.7 carves out the `(via <gate>)` tag for operator-action work orders (rows omit the tag), and AC-WO-002.8 says the `## Gates` section is omitted entirely for operator-action. PRD §6.4 currently overstates universality.
**Fix:** PRD.md:194 — note the operator-action carve-out (e.g. add a sentence: "Operator-action work orders use the same shape minus `## Gates`, and AC rows omit the `(via <gate>)` tag — see work-orders-loop FRD REQ-WO-002 for the exception").

### CONFLICT — PRD §9 resolved-bullet describes universal AC/Gates shape

**Files:** `PRD.md:478`, `requirements/features/work-orders-loop.md` AC-WO-002.7 / .8.
**Mismatch:** PRD.md:478 (the "~~Work-order artifact shape.~~ Resolved" bullet) describes the per-work-order document shape as universal — `## Acceptance criteria` rows match `- [ ] AC-WO-<slug>.M (via tests|playwright|code-spec) — Outcome` and `## Gates` is a required fenced YAML section — without acknowledging the operator-action carve-out.
**Fix:** PRD.md:478 — note the carve-out, or qualify the shape description as "agent-executable shape; operator-action work orders carve out per AC-WO-002.7 / .8 / .10."

### CONFLICT — PRD §8.3 wo-spec-judge rubric overstates AC-format universality

**Files:** `PRD.md:447`, `skills/work-orders/wo-spec-judge.md`, `requirements/features/work-orders-loop.md` AC-WO-002.7.
**Mismatch:** PRD.md:447 describes `wo-spec-judge` as checking that "AC rows match `AC-WO-<slug>.M (via <gate>) — <outcome>` format" — universally. The `wo-spec-judge` skill itself carves out operator-action ACs as `- [ ] AC-WO-<slug>.M — <verifiable outcome>` (no `(via <gate>)` tag), and AC-WO-002.7 backs it. The PRD prose summary diverges from the skill's actual rubric.
**Fix:** PRD.md:447 — either qualify ("for agent-executable work orders, AC rows match …") or trim the AC-format detail and reference the skill/FRD.

### CONFLICT — PRD §8.3 wo-coverage-judge rubric overstates AC-gate universality

**Files:** `PRD.md:448`, `skills/work-orders/wo-coverage-judge.md`, `requirements/features/work-orders-loop.md` AC-WO-002.7 / .8 / .10.
**Mismatch:** PRD.md:448 lists `wo-coverage-judge` check (c) as "every acceptance criterion declares an observation gate (`tests`, `playwright`, or `code-spec`) that the gate set in `## Gates` actually declares `required`." The coverage-judge skill itself carves out operator-action work orders (their AC rows omit the `(via <gate>)` tag and they have no `## Gates` block). PRD prose claims universality.
**Fix:** PRD.md:448 — qualify check (c) as applying to agent-executable work orders only, or reference the skill's carve-out.

### AMBIGUOUS — project-lifecycle.md §Stage 4 prose describes canonical shape without carve-out

**Files:** `requirements/overview/project-lifecycle.md:11`, `requirements/features/work-orders-loop.md` AC-WO-002.7 / .8 / .10.
**Mismatch:** project-lifecycle.md:11 (Stage 4 prose) describes the canonical scoped-task shape with "Acceptance criteria (each row carrying an ID, observation gate, and binary outcome), Gates (fenced YAML declaring which execution and LLM-as-judge gates apply)" — without acknowledging that operator-action work orders omit the observation-gate tag and the Gates section. The same paragraph mentions operator-action work orders later but only in the context of being skipped on drain, not in terms of their differing AC/Gates shape.
**Fix:** project-lifecycle.md:11 — when describing the canonical AC/Gates shape, note the operator-action carve-out (e.g. one trailing clause: "Operator-action work orders use the same shape minus the `## Gates` section, and their AC rows omit the `(via <gate>)` tag because the operator manually verifies").

Other spot-verifications agree across the tree:

- **`_inbox/` → `_backlog/` rename** is clean: PRD §6.5.1 + §7.2 tree, on-disk-layout.md AC-LAYOUT-005.8, coding-loop.md Terminology + AC-CL-007.1 + AC-CL-007.2 + Feature Behavior, technical-requirements.md, and the four wo-* judge skills all reference `_backlog/`. No remaining `_inbox` references in the requirements tree.
- **`wo-overlap-judge` backlog-check** drop is consistent with the skill itself; no other doc described an inbox/backlog-check expectation, so no cross-doc fix needed.
- **`## Type` marker** (optional, immediately after the title; values `feature` | `refactor` | `bug-fix` | `infra` | `operator-action`) consistent between work-orders-loop.md AC-WO-002.10, on-disk-layout.md AC-LAYOUT-005.3, blueprint-to-work-orders skill, and wo-spec-judge skill.
- **Operator-action shape** (Gates omitted; AC rows omit `(via <gate>)` tag) consistent between work-orders-loop.md AC-WO-002.7 / .8, blueprint-to-work-orders skill (concrete example), wo-spec-judge skill, and wo-coverage-judge skill.

## Review

Walked the tree after the five previously-flagged drifts were addressed (PRD §6.4 §9 §8.3, project-lifecycle.md Stage 4 prose). Verified each.

Verified the prior fixes:

- `PRD.md:194` (§6.4 work-order document shape) — now describes the operator-action carve-out: AC rows omit `(via <gate>)` tag, `## Gates` section is omitted entirely. Clean.
- `PRD.md:478` (§9 "Resolved" appendix bullet) — same carve-out language now present. Clean.
- `PRD.md:447` (§8.3 wo-spec-judge rubric) — splits agent-executable and operator-action shapes. Clean.
- `PRD.md:448` (§8.3 wo-coverage-judge check (c)) — scopes the AC-gate check to agent-executable WOs; explicitly notes operator-action skip. Clean.
- `project-lifecycle.md:11` (Stage 4 prose) — now mentions the carve-out (operator-action AC rows omit `(via <gate>)` tag, Gates block omitted). Clean.

But the broader sweep surfaces two new fact-level mismatches **within `requirements/features/work-orders-loop.md` itself**: REQ-WO-006 ACs (which describe what each judge spawned by the orchestrator must check) overstate universality and contradict REQ-WO-002's carve-out.

### CONFLICT — REQ-WO-006.1 wo-spec-judge rubric overstates AC-format universality (within-FRD)

**Files:** `requirements/features/work-orders-loop.md` AC-WO-006.1 vs AC-WO-002.7.
**Mismatch:** AC-WO-006.1 binds the orchestrator to spawn `wo-spec-judge` to verify (among other things) "AC rows match `AC-WO-<slug>.M (via <gate>) — <outcome>` format" — universally. AC-WO-002.7 in the same FRD carves out operator-action work orders, whose AC rows omit the `(via <gate>)` tag. A reviewer following AC-WO-006.1 literally would (wrongly) flag every operator-action AC row as a structural violation. The carve-out language now present in PRD §8.3 (line 447) and the wo-spec-judge skill itself agrees with AC-WO-002.7; only AC-WO-006.1 still overstates.
**Fix:** AC-WO-006.1 — qualify the AC-format clause as "for agent-executable work orders, AC rows match …; for operator-action work orders, AC rows omit the `(via <gate>)` tag (per AC-WO-002.7)" — or trim the format detail and reference AC-WO-002.7.

### CONFLICT — REQ-WO-006.2(c) wo-coverage-judge rubric overstates AC-gate universality (within-FRD)

**Files:** `requirements/features/work-orders-loop.md` AC-WO-006.2(c) vs AC-WO-002.7 / AC-WO-002.8 / AC-WO-002.10.
**Mismatch:** AC-WO-006.2(c) binds the orchestrator to spawn `wo-coverage-judge` to verify "every acceptance criterion declares an observation gate (`tests`, `playwright`, or `code-spec`) that the gate set in `## Gates` actually declares `required`." Operator-action work orders' AC rows omit the gate tag and have no `## Gates` block (per AC-WO-002.7 / .8 / .10), so this universal check is unsatisfiable for them. The wo-coverage-judge skill and PRD §8.3 (line 448) both qualify check (c) to agent-executable work orders; only AC-WO-006.2(c) still claims universality.
**Fix:** AC-WO-006.2(c) — scope to agent-executable work orders ("for agent-executable work orders, every acceptance criterion declares an observation gate …"), with explicit note that operator-action work orders skip this check.

### AMBIGUOUS — Feature Behavior prose in work-orders-loop.md describes universal Gates structure

**Files:** `requirements/features/work-orders-loop.md` (Feature Behavior, ~line 125 and ~line 135) vs AC-WO-002.8 / .10.
**Mismatch:** The Feature Behavior section says "The seven structural elements — Goal, Blueprints, In/Out scope, Produces, Depends on, Acceptance criteria, Gates — are what the work-orders-loop reviewers check …" (universal seven-element claim) and later "The four LLM-as-judge gates (`code-spec`, `code-regression`, `code-security`, `code-quality`) are always `required` …" (universal). Operator-action work orders carry six structural elements (no `## Gates`) and don't declare any gates at all. Soft drift; not as load-bearing as the AC findings above, but should be qualified for consistency.
**Fix:** Add a short clause acknowledging the operator-action shape ("operator-action work orders carry the same shape minus `## Gates`; the four LLM-as-judge gates are always `required` for agent-executable work orders only").

Other spot-verifications agree across the tree:

- The five previously-flagged drifts (PRD §6.4, §9, §8.3 ×2, project-lifecycle.md Stage 4) are clean, as listed at the top.
- `_inbox/` → `_backlog/` rename clean across PRD §6.5.1 + §7.2 tree, on-disk-layout.md AC-LAYOUT-005.8, coding-loop.md Terminology + REQ-CL-007 + Feature Behavior, technical-requirements.md, and the four wo-* judge skills.
- `wo-overlap-judge` backlog-check drop has no cross-doc impact.
- `## Type` marker semantics (optional, after title, values `feature` | `refactor` | `bug-fix` | `infra` | `operator-action`) consistent between work-orders-loop.md AC-WO-002.10 + AC-WO-003.5, on-disk-layout.md AC-LAYOUT-005.3, blueprint-to-work-orders skill, wo-spec-judge skill, and PRD §6.4.
- Operator-action shape (Gates omitted; AC rows omit `(via <gate>)` tag) consistent between AC-WO-002.7 / .8 / .10, the blueprint-to-work-orders skill's concrete example, wo-spec-judge skill, wo-coverage-judge skill, PRD §6.4 + §8.3 + §9, and project-lifecycle.md Stage 4 prose. The only outliers are AC-WO-006.1 / .2(c) flagged above.
- Subcommand list, four-loop framing, communication-folder never-wipe semantics, branch naming `task/<wo-slug>`, AC ID format `AC-WO-<slug>.M`, mention syntax `@wo-<slug>`, and reviewer name set (`wo-spec`, `wo-coverage`, `wo-overlap`, `wo-sequencing`) all agree across the tree.

