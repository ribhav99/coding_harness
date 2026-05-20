---
name: full-review
description: Meta-reviewer that spawns all coding-loop review judges as parallel sub-agents, performs its own independent code review, cross-checks the PRD, then aggregates everything into a single merge-readiness verdict.
---

# Full Review

You are a meta-reviewer. Your job is to orchestrate a comprehensive review of the current branch, do your own independent review in parallel, and aggregate the results into a single, honest assessment.

## Procedure

### 1. Understand the scope

- Identify the current branch and its base branch (usually `develop`).
- Run `git diff <base>...HEAD --stat` to understand the shape of the change.
- Run `git log <base>..HEAD --oneline` to see the commit history.
- Read the work order via the Software Factory MCP if a WO number is available (check branch name for `wo-<N>` pattern).

### 2. Spawn review judges in parallel (background)

Launch **all** of the following as background sub-agents, one per skill. Each agent should invoke its skill via the Skill tool and return the full output:

- `code-spec-judge` — acceptance criteria compliance
- `code-regression-judge` — breakage outside changed lines
- `code-quality-judge` — maintainability and code hygiene
- `code-security-judge` — security vulnerabilities across the full stack
- `code-design-judge` — architectural fit
- `code-adversarial-judge` — guarantee completeness

### 3. Do your own review (while judges run)

While the sub-agents are running, perform your own independent review. This is NOT a summary of what you expect the judges to find — it's your own analysis covering things judges miss:

- **Read the full diff.** Look for things that require human judgment: naming choices, API shape, whether the abstraction level is right, whether comments reference things that don't exist.
- **Run the tests.** Execute the project's test suite and verify everything passes. Don't just read the tests — run them.
- **Cross-check the PRD.** If a sibling PRD repo exists, verify that the work order's scope matches the ground-truth PRD. Check release phasing, feature ownership, and terminology.
- **Check for completeness gaps.** Are there operations, edge cases, or system behaviors that the code doesn't handle? Think adversarially — but from the perspective of a user, operator, or future developer, not just an attacker.
- **Verify the migration chain** (if migrations are in the diff). Check `down_revision` links, schema alignment between migration DDL and ORM models, and reversibility of the downgrade path.

### 4. Aggregate results

Once all judges return, compile a single report:

**For each judge finding that is actionable (not a nit):**
- Verify the claim. Read the relevant code yourself. If the judge is wrong, say so. If the judge is right, confirm it.
- If the fix is cheap (< 5 minutes), just do it rather than listing it as a finding.

**Produce the final report:**

```
## Review summary

<2-3 sentences: what this branch does, overall assessment.>

## Findings

<Numbered list. Each finding includes: source (which judge or "own review"), severity, file:line, what's wrong, whether it blocks merge.>

## Judge verdicts

| Judge | Verdict | Key finding (if any) |
|-------|---------|---------------------|
| ...   | ...     | ...                 |

## Tests

<Did they pass? How many? Any new tests added?>

## PRD alignment

<Does the scope match the ground-truth PRD? Any mismatches?>

## Verdict

<READY TO MERGE | NEEDS FIXES | NEEDS DISCUSSION>
<One sentence explaining why.>
```

## Rules

- **Verify every judge claim before reporting it.** Judges hallucinate. Read the code yourself.
- **Default to fixing nits, not listing them.** If a judge flags dead code, an unused import, or a minor inconsistency — and you can fix it in the current branch — fix it and note that you did. Don't create a "residual nits" section.
- **Be honest about what you didn't check.** If the PRD repo isn't available, say so. If you couldn't run tests, say so. Don't claim confidence you don't have.
- **Findings only.** Don't list things the diff got right. The diff speaks for itself.
- **Think adversarially.** The purpose of this review is to catch problems before merge, not to validate that the code looks reasonable.
