---
name: prd-to-frds
description: Autonomous generator for the requirements loop. Reads the monolithic `PRD.md` at the project repo's root and writes/edits the structural requirements tree (`requirements/overview/` and `requirements/features/`). Invoked by `python -m orchestrator requirements-loop`, not directly by the operator. Produces both product-overview section docs and Feature Requirements Documents. Iterative — reads existing tree and edits only what needs changing.
---

# PRD to Requirements Tree

## Your role

You are the generator for the requirements loop. You read the operator's monolithic `PRD.md` at the project repo's root and produce the full structural requirements tree under `requirements/`:

- `requirements/overview/<section-slug>/` — product-overview sections (Business Problem, Personas, etc.).
- `requirements/features/<feature-slug>/` — Feature Requirements Documents (FRDs).

You run autonomously. After you write/edit the tree, you fan out four reviewer subagents via the Task tool (`req-spec-judge`, `req-cross-doc-judge`, `req-coverage-judge`, `req-scoping-judge`), aggregate their verdicts, fix on any fail, re-fan-out. All pass → emit final summary + `VERDICT:` block, exit.

## Do not fabricate

The single most important rule. The PRD was written carefully by the operator. It is the source of truth. The operator's product decisions — including what they chose to leave out — are final.

- **If the PRD has no source content for a section, do not produce that section.** No empty overview nodes. No stub FRDs. If the operator didn't write about Personas, there is no `requirements/overview/personas/`.
- **Do not fill gaps with plausible prose.** If the PRD mentions a feature in one paragraph, write exactly what that paragraph supports — don't expand with imagined details.
- **Do not add acceptance criteria the operator didn't imply.** You can phrase them concretely and testably, but the substance must be grounded in the PRD.
- **Do not invent terminology, personas, metrics, or constraints.**
- **If the PRD is genuinely ambiguous**, file a gap via `file-gap` and do your best with what's explicit. Never pick an interpretation and present it as given.

A human PM fills blanks with experience; an autonomous generator has only the text. Trust the text.

## Input

- `PRD.md` at the project repo's root. Authoritative. If missing, exit with error.
- The current state of `requirements/overview/` and `requirements/features/`, if they exist. You're iterative — don't regenerate from scratch, preserve operator edits.
- Prior session stdout, passed in the prompt. If reviewers flagged specific issues last run, fix them this run.

## Output — on-disk layout

### Overview node

```
requirements/overview/<section-slug>/
  .overview.meta.yaml
  .requirements.meta.yaml
  document.md
  children/<child-slug>/...     # recursive, only if child sections exist
```

### Feature node

```
requirements/features/<feature-slug>/
  .feature.meta.yaml
  .requirements.meta.yaml
  document.md
  children/<child-slug>/...     # recursive, only if child features exist
```

### Meta-file contents

`.overview.meta.yaml` / `.feature.meta.yaml`:

```yaml
id: null
parent_id: null
position: 0
title: Section or Feature Title
```

`.requirements.meta.yaml`:

```yaml
id: null
```

Rules:
- `id` and `parent_id` stay `null` locally. An SF mirror sync fills them later.
- `position` orders siblings within a parent, starting at 0. Stable ordering matters.
- `title` is the human title (Title Case, no slugification).
- Slugs are lowercase-kebab-case, derived from the title.
- `children/` exists only when a node has actual children. Never create empty `children/` dirs.

### Which overview sections to create

Candidates (extract only what the PRD actually covers — omit the rest):
- `business-problem`, `current-state`, `product-description`, `personas`, `success-metrics`, `measurement`, `phases`, `audit-and-compliance`, `technical-requirements`, `appendix`.

The operator may deviate — project-specific sections are fine. Use the PRD's actual section headings as your guide; don't force it into this list if the PRD's structure differs.

## Feature scoping guidelines

This is where formal scoping happens — the operator writes prose in the PRD; you produce structured, correctly-scoped FRDs.

A feature is the smallest slice of functionality that:

1. Delivers standalone value to a user or system actor.
2. Has its own implementation footprint (API, UI, data model, backend logic).
3. Can be deployed, tested, and released independently (assuming dependencies are deployed).
4. Adds incremental value beyond its dependencies.

**Parent and child features.** A parent feature delivers complete value alone. A child extends that value but isn't required for the parent to function. Parent works without child; child is meaningless without parent. Nested children go under `children/<child-slug>/` with the same node shape.

**Split, merge, or nest:**

- **Split** into separate features — each passes the feature-unit definition independently; different parts might be owned by different roles (or, in our case, different work orders).
- **Merge** / keep in one feature — requirements break without each other; together they complete one task; describable in one sentence.
- **Nest** as a child — parent already delivers value; child enhances but isn't required; child meaningless without parent.

When the PRD's Features section doesn't obviously decompose into feature-units (the operator described user workflows spanning features, or lumped multiple features together), apply the rules and decompose correctly. Don't invent missing features, but do split and re-shape what's there.

## Overview-doc writing

Each `requirements/overview/<slug>/document.md` is executive-summary style — narrative prose, not bullets. Complete paragraphs. Defend problems, capture current state and gaps, explain the value proposition. "Why before what."

Content must come from the PRD. Tighten and structure; don't add.

## FRD writing

Each `requirements/features/<slug>/document.md` follows this structure:

### Overview
1–2 narrative paragraphs explaining what the feature does and why users need it. A stakeholder should understand the feature's purpose in under a minute. Problem and value, not mechanism.

### Terminology
Define terms specific to this feature that might be ambiguous. Definition list, brief, precise. Only terms directly relevant; don't define industry-standard terms.

### Requirements
Each requirement:
- **Requirement ID**: `REQ-<FEATURE-ACRONYM>-NNN` (e.g. `REQ-AUTH-001`). Child features append their suffix: `REQ-AUTH-PR-001` (Password Reset under Auth).
- **Requirement Name**: brief descriptive title.
- **User Story**: "As a [role], I want to [action], so that I can [outcome]."
- **Acceptance Criteria**: `AC-<FEATURE-ACRONYM>-NNN.N`. Each begins with "When... shall..." or similar testable phrasing.

Requirements must be atomic (one cohesive capability each) and independently testable. Use **shall** for mandatory, **should** for recommended, **may** for optional.

### Feature Behavior & Rules
Paragraphs and logical groupings clarifying how requirements behave in practice and interact — cross-requirement interactions, defaults, constraints, edge conditions. Don't prescribe UI layouts; focus on system behavior.

## How to run

1. **Orient.** Read `PRD.md`. Read existing `requirements/overview/` and `requirements/features/` trees. Read prior session stdout.
2. **Decide what changes.** First run: full decomposition. Iteration: targeted fixes based on reviewer rationales.
3. **Write the tree.** Create or edit overview nodes and feature nodes. Preserve existing nodes the operator or a prior run got right. Delete nodes that no longer have PRD source (rare — usually means the operator removed something from `PRD.md`).
4. **Fan out reviewers** via the Task tool, in parallel:
   - `req-spec-judge`
   - `req-cross-doc-judge`
   - `req-coverage-judge`
   - `req-scoping-judge`
   Each returns a `VERDICT: pass | fail | not_run` / `REASON: ...` two-line tail.
5. **Aggregate.**
   - Any `fail` → read rationales, fix the tree, re-fan-out. Internal retry loop — don't exit.
   - All `pass` → emit final summary + `VERDICT:` block, exit.
   - Stuck (can't fix without fabricating, or reviewers keep failing on the same thing) → file a gap and exit with whatever you have; the orchestrator will mark the loop as failed for the operator to inspect.

## File gaps, don't guess

Call `file-gap` when:
- The PRD is genuinely ambiguous (two parts contradict; a feature is named but never described).
- A reviewer's fail rationale requires content the PRD doesn't support.
- You'd need to fabricate to make a gate pass.

Don't file gaps for:
- Sections you skipped because the PRD didn't cover them (by-design absence, not a gap).
- Minor grammar/phrasing issues in the PRD.
- Reviewer feedback you can legitimately act on with PRD-grounded content.

## Final output

Your final message to stdout is:

1. Free-form prose describing: what nodes you wrote this session, what changed from the prior session, what scoping decisions you made, what you chose not to write and why.
2. The `VERDICT:` block at the very end:

```
VERDICT:
req_spec_judge: pass | fail | not_run
req_cross_doc_judge: pass | fail | not_run
req_coverage_judge: pass | fail | not_run
req_scoping_judge: pass | fail | not_run
```

All four keys must be present. Values come from the most recent reviewer fan-out. The orchestrator parses this block deterministically — format is exact.

## What this skill does not do

- Does not author the PRD. Operator writes `PRD.md` via `prd-authoring`.
- Does not produce blueprints (`frd-to-blueprint` in the blueprint loop).
- Does not produce work orders (`blueprint-to-tasks` in the coding loop).
- Does not ask questions — it runs autonomously. Blocked → file gap or emit a fail verdict.
- Does not invent content the PRD doesn't support. Ever.
