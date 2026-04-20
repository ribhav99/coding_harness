---
name: scope-task
description: Expands a raw ticket idea into the standard scoped-task format the generator can execute against without asking questions. Use when the operator has a rough ticket and wants it fleshed out into the canonical structure.
---

# Scope Task

Take a raw ticket (title + rough description, or a one-line idea) and produce a fully-scoped ticket body in the format below. The generator will read this body directly and build against it, so the scope boundary must be explicit.

## Input

The operator gives you one of:
- A rough ticket: title + a few sentences of what they want.
- A link to an existing issue that needs scoping.
- A short idea ("add login with GitHub OAuth").

Also available: the repo itself. Read relevant files to understand existing code, conventions, and what integrates with what.

## Output

A single markdown block in this exact structure. Post it as a comment on the ticket (or emit it if invoked in a standalone session so the operator can paste it).

```markdown
## Goal
One sentence describing what this ticket delivers. Concrete. Observable.

## In scope
- Bullet list of what is included.
- Each bullet should be small enough that a reasonable reader agrees it belongs here.

## Out of scope
- Explicit list of what this ticket does NOT cover.
- Especially things a reasonable reader might assume are included.
- Especially adjacent refactors, unrelated cleanups, or bigger redesigns the generator might be tempted to pull in.

## Depends on
- #<other-ticket> — one line explaining what this task needs from it.
(Leave "None." if no dependencies.)

## Produces
- Interfaces, modules, functions, artifacts, or contracts this ticket makes available for downstream tasks.
- Answers the question: what can other tickets assume exists after this is done?

## Acceptance criteria
- [ ] Observable outcome, verifiable by the reviewer's gates.
- [ ] Each criterion is something the spec-judge can evaluate against the diff.
- [ ] Keep them binary: either the diff satisfies it or it doesn't.

## Implementation notes (non-binding)
Optional. Pointers about files likely involved, library choices the repo already uses, or constraints worth flagging. Never prescriptive — the generator owns implementation.
```

## Scoping discipline

The load-bearing fields are **In scope**, **Out of scope**, and **Produces**. These compose across tickets to form the whole project. Sloppy scoping creates two failure modes:

1. **Gaps** — nothing covers area X. The project has a hole.
2. **Overlap** — two tickets both produce X differently. Incoherent code.

Before finalizing, check:
- Could a reasonable reader pull in something you intended to exclude? If yes, move it explicitly to **Out of scope**.
- Is there anything in **In scope** that another ticket already owns? If yes, remove it here and note the dependency.
- Does **Produces** name the concrete interfaces downstream tickets will import? Vague "produces: working login flow" is worse than "produces: `POST /login` endpoint accepting `{email, password}`, returning `{token}` on 200".

## Acceptance-criteria quality

Each criterion must be:
- **Observable in the diff or the running app** — something spec-judge, tests, or Playwright can check.
- **Binary** — pass or fail, not a rubric score.
- **Specific** — avoid "the login flow works". Prefer "clicking Sign In with valid credentials navigates to /dashboard".

Bad: `- [ ] The code is high quality.`
Good: `- [ ] No function in the new auth module exceeds 30 lines.`

Bad: `- [ ] Error handling is in place.`
Good: `- [ ] Invalid password returns HTTP 401 with body `{"error": "invalid_credentials"}`.`

## When context is thin

If the operator's input is very thin ("add comments to posts"), make reasonable decisions and encode them in the ticket:
- Pick concrete field names.
- Pick reasonable endpoint paths.
- Pick a reasonable data model.

Surface the assumptions you made in a short note at the bottom of the ticket body (under a `### Assumptions` header) so the operator can review and correct before moving the ticket to Ready.

## What this skill does not do

- Does not create the ticket on the backend. Output is a markdown block the operator pastes.
- Does not decompose a PRD into multiple tickets. That is `prd-to-tasks`.
- Does not move the ticket to Ready. Operator does that manually after reviewing your scope.
