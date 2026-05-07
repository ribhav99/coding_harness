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


## Review

Walked the tree after the FRD-internal fixes (AC-WO-006.1, AC-WO-006.2, work-orders-loop.md Feature Behavior prose) targeting the operator-action carve-out drift the prior run flagged.

Verified the prior fixes:

- `requirements/features/work-orders-loop.md` AC-WO-006.1 — `wo-spec-judge` rubric now splits agent-executable vs operator-action shapes, qualifies the AC-format check (`for agent-executable work orders, AC rows match …; for operator-action work orders, AC rows omit the `(via <gate>)` tag and `## Gates` is omitted entirely`), validates `## Type` placement and value when present. Clean.
- `requirements/features/work-orders-loop.md` AC-WO-006.2(c) — `wo-coverage-judge` rubric now scopes the AC-gate check to agent-executable work orders explicitly; operator-action skip is named (`Operator-action work orders skip check (c) — their AC rows are operator-verified prose without gate tags`). Clean.
- `requirements/features/work-orders-loop.md` Feature Behavior — line 125 ("structural elements …") now lists "Type (optional)" and notes "(for agent-executable work orders) Gates"; explicitly says "Operator-action work orders carve out a different shape (no Gates block; AC rows omit the `(via <gate>)` tag) because the agent never runs them — the operator verifies them manually." Line 135 ("four LLM-as-judge gates …") now qualifies "for agent-executable work orders" and adds "Operator-action work orders omit `## Gates` entirely — the agent never runs them, so there are no gates to declare." Clean.

Cross-doc consistency sweep across the tree:

- **Operator-action shape** (no `## Gates`; AC rows omit `(via <gate>)` tag) consistent across `work-orders-loop.md` AC-WO-002.1 / .7 / .8 / .10 + AC-WO-006.1 / .2 + Feature Behavior, `on-disk-layout.md` AC-LAYOUT-005.3 (status/type sets), PRD.md §6.4 (line 194) + §8.3 (line 447–448) + §9 (line 478), `project-lifecycle.md:11` Stage 4 prose, `blueprint-to-work-orders.md` skill (Operator-action work orders section + concrete example), `wo-spec-judge.md` skill, `wo-coverage-judge.md` skill, BLUEPRINT.md §3.3 work-orders-loop subsection + §4 WorkOrder TypedDict + §10.1 generator-agents.
- **`## Type` marker** (optional; immediately after title; values `feature` | `refactor` | `bug-fix` | `infra` | `operator-action`) consistent across `work-orders-loop.md` AC-WO-002.10 + AC-WO-003.5, `on-disk-layout.md` AC-LAYOUT-005.3, blueprint-to-work-orders skill, `wo-spec-judge` skill, PRD §6.4.
- **`_inbox/` → `_backlog/` rename** clean: PRD §6.5.1 + §7.2 tree, `on-disk-layout.md` AC-LAYOUT-005.8, `coding-loop.md` Terminology + REQ-CL-007 + Feature Behavior, `technical-requirements.md`, and the four wo-* judge skills all reference `_backlog/`. No remaining `_inbox` references in the tree.
- **`wo-overlap-judge` backlog-check drop** consistent with the skill itself; the FRD AC-WO-006.3 doesn't reference inbox/backlog, so no cross-doc fix needed.
- **Reviewer counts and names**: 4 work-orders judges (`wo-spec`, `wo-coverage`, `wo-overlap`, `wo-sequencing`) consistent across PRD §8.3, BLUEPRINT §0.1 + §3.3 + §10.2, `work-orders-loop.md` AC-WO-005.2 + REQ-WO-006, `project-lifecycle.md`. No leftover `wo-scoping-judge`/`wo-dependency-judge` references.
- **AC ID format** `AC-WO-<slug>.M` consistent across PRD.md §6.4 + §7.4 + §8.3 + §9, `work-orders-loop.md` AC-WO-002.7 + Feature Behavior, blueprint-to-work-orders skill, code-spec-judge skill, wo-spec-judge skill, wo-coverage-judge skill. No remaining `AC-WO-NNN.M`.
- **Branch naming** `task/<wo-slug>` consistent in PRD §6.5, BLUEPRINT §3.3 + §7, coding-loop FRD, python-orchestrator AC-ORCH-006.1, project-lifecycle.md. No remaining `task/<task_id>`.
- **WO file naming** `wo-<slug>.md` + `.wo-<slug>.meta.yaml` (flat, no per-WO directories) consistent across PRD §6.4 + §7.2, BLUEPRINT §3.3 + §7.2, work-orders-loop.md, on-disk-layout.md REQ-LAYOUT-005, coding-loop.md, technical-requirements.md, project-lifecycle.md.
- **`_sequence.md` and `_external-blockers.md`** referenced consistently in PRD, BLUEPRINT, work-orders-loop FRD, coding-loop FRD, on-disk-layout FRD, python-orchestrator FRD, technical-requirements.md.
- **Status set** `backlog | ready | in_progress | done | blocked_external` and **type set** `feature | refactor | bug-fix | infra | operator-action` agree between BLUEPRINT.md WorkOrder TypedDict (§4) and on-disk-layout.md AC-LAYOUT-005.3.
- **Gate-key set** (six bare keys; four code-* always `required` for agent-executable WOs) agrees between work-orders-loop.md AC-WO-002.8 and coding-loop.md AC-CL-004.8.
- **Subcommand list** `requirements-loop`, `blueprint-loop`, `work-orders-loop`, `coding-loop`, `status` consistent across PRD §7.1, BLUEPRINT §3.1, python-orchestrator AC-ORCH-001.2 + Terminology, technical-requirements.md.
- **Five-stages / four-autonomous-loops framing** consistent across PRD §1, project-lifecycle.md, product-description.md, architecture.md, design-principles.md, BLUEPRINT §0.2.
- **Communication-folder never-wipe semantics** consistent across on-disk-layout.md REQ-LAYOUT-012, python-orchestrator.md REQ-ORCH-012, the three upstream-loop FRDs, BLUEPRINT §1.8 + §7.6, technical-requirements.md, measurement.md.
- **Coding loop has no communication folder** consistent across coding-loop.md, python-orchestrator.md AC-ORCH-012.7, on-disk-layout.md AC-LAYOUT-012.7, architecture.md, technical-requirements.md, product-description.md, BLUEPRINT §0.1.
- **Cross-references** all resolve (REQ-WO-002 from on-disk-layout AC-LAYOUT-005.4 and appendix; REQ-ORCH-013 from per-loop FRDs; blueprint document-shape contract from on-disk-layout AC-LAYOUT-006.5, blueprint-loop AC-BL-002.6, appendix.md, BLUEPRINT.md §11).

Two soft within-FRD prose observations (out of cross-doc-judge's strict scope — these are within a single document and would be `req-spec-judge`'s territory rather than mine — but worth flagging for the operator):

- `requirements/features/work-orders-loop.md:39` (User Story for REQ-WO-002) still reads "I want every work order to follow a single canonical shape", which understates the post-carve-out reality where REQ-WO-002.7 / .8 / .10 explicitly define a different shape for operator-action work orders. Within-doc; not a cross-doc fact-level mismatch.
- `requirements/features/coding-loop.md:87` Feature Behavior prose says "The four LLM-as-judge gates are always `required` because their failure modes apply to every diff regardless of work-order shape." Technically still true (operator-action WOs produce no diff and are skipped on drain per AC-CL-002.1), but the prose doesn't acknowledge the carve-out. Within-doc; not a cross-doc fact-level mismatch.

No fact-level mismatches across docs, no terminology drift, no significant duplication, no broken cross-references found across the tree.

## Review

Verified the codebase-awareness changes (AC-WO-003.2/.9/.10/.11 + AC-WO-006.2(a) in the FRD; new "Codebase awareness" section in `blueprint-to-work-orders.md`; updated rubric and "Where things live" in `wo-coverage-judge.md`) are consistent within the work-orders-loop FRD and the two skill files. Found **five fact-level mismatches between those new ACs/skills and downstream prose elsewhere** that still describes the pre-codebase-awareness behaviour.

### `requirements/features/work-orders-loop.md` ↔ `PRD.md` §6.4 — generator inputs (line 192)

`PRD.md:192` "Generator" subsection for §6.4 says the generator "reads `blueprints/` and produces a flat tree of slug-named work orders" — does not list the project's source code as an input. `requirements/features/work-orders-loop.md` AC-WO-003.2 (and AC-WO-003.9) now require the generator to read "the project's existing source code (everything outside the harness-managed trees ...)" before deciding what to produce. Same input-list contract; PRD §6.4 prose under-states.

**Fix:** PRD §6.4 "Generator" prose should mention the codebase scan in the input list (a phrase pointing at REQ-WO-003.9 / .10 is enough). `CONFLICT`.

### `requirements/features/work-orders-loop.md` ↔ `PRD.md` §7.4 skill bullet (line 378)

`PRD.md:378` `blueprint-to-work-orders` skill bullet enumerates the inputs as "`blueprints/`, the existing `work-orders/` tree (every `wo-<slug>.md` and `_sequence.md`), `work-orders/_questions-pending.md`, and `work-orders/.sequence.meta.yaml`." — explicitly does not include the project's source code. The skill file itself (`skills/work-orders/blueprint-to-work-orders.md` "## Input") and AC-WO-003.2 in the FRD do include source code. Same fact, two literal lists, the PRD's is missing one item.

**Fix:** add "the project's existing source code (the trees outside the harness-managed ones)" to the PRD §7.4 skill bullet's input enumeration. `CONFLICT`.

### `requirements/features/work-orders-loop.md` ↔ `PRD.md` §6.4 reviewer summary (line 206)

`PRD.md:206` "Reviewers" summary for §6.4 describes `wo-coverage-judge` as "every blueprint's delivery surface mapped to at least one work order; mention resolution; AC↔gate consistency". This is the single-source coverage criterion. The actual rubric per AC-WO-006.2(a) and the skill is the **dual-source** criterion: covered by **either** a work order **or** the project's existing code. Materially different — under the PRD's wording, fully-realized-in-code surface elements without a WO would (per the older rule) be `MISSING_COVERAGE`, but per the FRD/skill they pass.

**Fix:** PRD §6.4 reviewer summary should say "every blueprint's delivery surface covered by either a work order or existing code" for `wo-coverage-judge`. `CONFLICT`.

### `requirements/features/work-orders-loop.md` ↔ `PRD.md` §8.3 verification stack (line 448)

`PRD.md:448` §8.3 `wo-coverage-judge` rubric reads "(a) every approved blueprint's delivery surface (component blocks, model blocks, feature commitments) maps to at least one work order via a `#<blueprint-slug>` mention". Single-source criterion again, contradicting the dual-source criterion in AC-WO-006.2(a) and the skill rubric. `wo-coverage-judge` running per the PRD §8.3 description would fail any project where a blueprint surface is realized in code but not claimed by a WO.

**Fix:** PRD §8.3 `wo-coverage-judge` check (a) should accept "WO claims it OR code realizes it" and acknowledge that partial code coverage demands a gap-WO; the skill text in `wo-coverage-judge.md:12` is the canonical wording to mirror. `CONFLICT`.

### `requirements/features/work-orders-loop.md` ↔ `requirements/overview/project-lifecycle.md` Stage 4 prose (line 11)

`project-lifecycle.md:11` Stage 4 prose says the generator "reads `blueprints/` and produces a flat tree of slug-named work orders ... No phases — one continuous task sequence with `Depends on.work_orders` plus `_sequence.md` encoding dependencies" — does not list source code as an input. The four-reviewer summary at the end of the same paragraph describes `wo-coverage-judge` as "blueprint-to-work-order coverage" without acknowledging the dual-source criterion. Same drift as the PRD §6.4 prose, just less detailed.

**Fix:** add a clause to the Stage 4 paragraph that the generator scans existing code and skips work orders for fully-realized blueprint surface; update the `wo-coverage-judge` summary line to match the dual-source criterion. `AMBIGUOUS` (the prose is short enough that a reader could go either way; less material than the PRD §8.3 contradiction but worth aligning).

### What checks out

- Mention syntax (`#<blueprint-slug>`, `@wo-<slug>`), AC ID format `AC-WO-<slug>.M`, branch naming `task/<wo-slug>`, status set, type set, and gate set: consistent across PRD, BLUEPRINT, on-disk-layout, work-orders-loop, coding-loop, project-lifecycle, technical-requirements, blueprint-to-work-orders skill, and the four wo-* judge skills.
- The four-judge set (`wo-spec`, `wo-coverage`, `wo-overlap`, `wo-sequencing`) and their division of concerns: consistent across all referencing docs.
- Operator-action carve-out from the prior cross-doc-judge run still consistent across PRD §6.4 / §8.3 / §9, project-lifecycle Stage 4, work-orders-loop AC-WO-002.7/.8/.10, AC-WO-006.1/.2(c), wo-spec-judge skill, wo-coverage-judge skill, blueprint-to-work-orders skill.
- `_inbox/` → `_backlog/` rename clean across the tree.
- `wo-overlap-judge`'s no-backlog-check rule consistent.
- Communication-folder never-wipe semantics, three-retry-layer architecture, dual completion condition, and `awaiting_clarification` exit verdict all consistent across the tree.

The five drifts above are the only critical issues. Three of them (PRD §6.4 generator inputs, §8.3 verification stack, §6.4 reviewer summary) describe the pre-codebase-awareness rubric as authoritative, which would cause a `wo-coverage-judge` running per the PRD §8.3 wording to produce findings the FRD/skill explicitly say should pass. PRD § 7.4 skill bullet is a missing-item fact-level mismatch. project-lifecycle.md is softer (prose, not contract) but worth aligning for consistency.

## Review

Verified the prior five drifts are clean (PRD §6.4 generator inputs at line 192 now lists the codebase scan; PRD §6.4 reviewer summary at line 206 now describes dual-source coverage; PRD §7.4 generator skill bullet at line 378 now includes "the project's existing source code"; PRD §8.3 wo-coverage-judge check (a) at line 448 now describes dual-source coverage with the codebase scan; project-lifecycle.md Stage 4 prose at line 11 now mentions the codebase scan and dual-source coverage). All five reflect the post-codebase-awareness rubric.

But the broader sweep surfaces **two new fact-level mismatches in `BLUEPRINT.md`** that escaped the prior round.

### CONFLICT — BLUEPRINT.md §3.3 work-orders-loop "Generator prompt inputs" missing source code

**Files:** `BLUEPRINT.md:548` vs `requirements/features/work-orders-loop.md` AC-WO-003.2 / .9.
**Mismatch:** BLUEPRINT.md:548 (the `**work-orders-loop.**` per-loop spec entry, "Generator prompt inputs:" line) reads: "`blueprints/` + current `work-orders/` (every `wo-<slug>.md`, `_sequence.md`, `.sequence.meta.yaml`) + current `work-orders/_questions-pending.md` + the path to `work-orders_communication/`. The generator short-circuits when the blueprint-tree hash matches the recorded hash and there are no failing reviews to address." — does not list the project's source code as a generator input. AC-WO-003.2 (and AC-WO-003.9) explicitly require the generator to read the project's source code. Same fact, two literal lists, BLUEPRINT.md's is missing the source-code item.
**Fix:** BLUEPRINT.md:548 — add "+ the project's existing source code (everything outside the harness-managed trees `requirements/`, `blueprints/`, `work-orders/`, `harness/`, `*_communication/`) for the targeted codebase scan" to the Generator prompt inputs list. `CONFLICT`.

### CONFLICT — BLUEPRINT.md §10.1 work-orders-generator agent description silent on codebase scan + decision rule

**Files:** `BLUEPRINT.md:839` vs `requirements/features/work-orders-loop.md` AC-WO-003.9 / .10 / .11 + the `blueprint-to-work-orders` skill's "Codebase awareness" section.
**Mismatch:** BLUEPRINT.md:839 describes the `work-orders-generator` agent as: "loads `blueprint-to-work-orders` (single skill, no sub-skill co-invocation). Identity: lead tech lead. Writes flat `work-orders/wo-<slug>.md` files with the canonical scoped-task body shape (work-orders-loop FRD REQ-WO-002), maintains `work-orders/_sequence.md`, marks operator-action work orders with `type: operator-action` in their meta, may append to `work-orders/_questions-pending.md` for decomposition ambiguities. Reads/writes `work-orders_communication/` per §1.8." — does not mention the codebase scan, the realised-vs-partial-vs-missing decision rule, or the material-divergence-as-clarification-question rule. The skill file and AC-WO-003.9 / .10 / .11 in the FRD do.
**Fix:** BLUEPRINT.md:839 — add a clause noting the agent scans the project's existing source code and applies the realised-vs-partial-vs-missing decision rule (with material divergence logged as a clarification question). E.g. append after "marks operator-action work orders ... in their meta": "scans the project's existing source code via a targeted walk and applies the realised → no-WO / partial → gap-WO / missing → full-WO decision rule (per AC-WO-003.9 / .10), logging material code-vs-blueprint divergence as a clarification question (AC-WO-003.11)". `CONFLICT`.

### What checks out

- All five previously-flagged drifts (PRD §6.4 / §7.4 / §8.3, project-lifecycle.md Stage 4) are clean and reflect the post-codebase-awareness rubric.
- The two skill files (`blueprint-to-work-orders.md`, `wo-coverage-judge.md`) and the FRD ACs (AC-WO-003.2/.9/.10/.11, AC-WO-006.2(a)) describe the same scan, the same decision rule, and the same dual-source coverage criterion. Internally consistent.
- The overview docs (architecture.md, technical-requirements.md, appendix.md) don't describe the work-orders generator at the input-list level of detail, so no drift there.
- Operator-action carve-out, `_backlog/` rename, four-judge set, branch naming, AC ID format, mention syntax, status set, type set, gate set, subcommand list, five-stages / four-autonomous-loops framing, communication-folder never-wipe semantics, coding-loop has no communication folder, three-retry-layer architecture, dual completion condition, `awaiting_clarification` exit verdict, REQ-WO-002 / REQ-ORCH-013 / blueprint document-shape contract cross-references — all consistent across the tree.

The two BLUEPRINT.md drifts are the only critical issues. Both are missing-clause / missing-item fact-level mismatches between BLUEPRINT.md prose and the post-codebase-awareness FRD ACs. Easy local fixes (one clause to BLUEPRINT.md:548; one clause to BLUEPRINT.md:839).

## Review

The two BLUEPRINT.md drifts flagged on the prior run are both fixed. Walking the tree from the start, no new cross-doc drift surfaced.

### Verified fixes

- **`BLUEPRINT.md:548`** — §3.3 work-orders-loop generator prompt inputs now lists "the project's existing source code (everything outside the harness-managed trees `requirements/`, `blueprints/`, `work-orders/`, `harness/`, `*_communication/`) for a targeted scan" and explicitly cites the decision rule (fully realised → no work order; partial → gap-scoped; unrealised → full). Matches AC-WO-003.2/.9/.10 in the FRD and the "Codebase awareness" section in `blueprint-to-work-orders.md`.
- **`BLUEPRINT.md:839`** — §10.1 `work-orders-generator` agent now describes "a targeted scan — top-level structure + config, entry-point files named in container blueprints, greps for blueprint-named symbols/models/routes; harness-managed trees skipped" and applies the realised-vs-partial-vs-unrealised decision rule. Matches the FRD ACs and the generator skill.

### Other invariants spot-checked

Across `PRD.md`, `BLUEPRINT.md`, `requirements/features/*.md`, `requirements/overview/*.md`, and `skills/work-orders/*.md`:

- **No stale judge names.** No `wo-scoping-judge` or `wo-dependency-judge` references anywhere; the four-judge set (`wo-spec-judge`, `wo-coverage-judge`, `wo-overlap-judge`, `wo-sequencing-judge`) is consistent.
- **No stale `_inbox/` references.** `_backlog/` is the canonical name (12 mentions across the tree).
- **No stale AC-WO-NNN references.** AC IDs use the slug form `AC-WO-<slug>.M` consistently.
- **No `task_id` or `wo-NNN` numbering remnants** outside the explicit "no `wo-NNN` numbering" disclaimer in on-disk-layout.md.
- **Operator-action carve-out propagated everywhere.** `## Type` marker, AC-format/Gates-omission carve-out, and operator-action skip in coding-loop drain are described consistently in PRD.md (§6.4, §7.4, §8.3, §9 appendix), BLUEPRINT.md (§3.3, §10.1), work-orders-loop.md (REQ-WO-002.1/.7/.8/.10, REQ-WO-006.1/.2, Feature Behavior), and the `wo-spec-judge` / `wo-coverage-judge` / `blueprint-to-work-orders` skills.
- **Five-stage / four-autonomous-loop framing** consistent.
- **`blocked_external` status, `_external-blockers.md`, `_sequence.md`** all referenced consistently.
- **Three-retry-layer architecture** (in-session Stop hook, post-spawn rate-limit, post-exit protocol-retry) consistent.
- **Dual completion condition** + `awaiting_clarification` exit verdict consistent for all three upstream loops.
- **Never-wipe communication-folder semantics** consistent.

### Remaining stylistic note (not blocking)

The single match for `(via code-spec-judge)` in `skills/work-orders/wo-coverage-judge.md:18` is intentional — it appears inside an explicit example of a *wrong* AC observation gate value (the `-judge` suffix is being called out as incorrect). Not a drift.

The tree is consistent end to end.
