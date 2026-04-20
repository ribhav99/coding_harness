---
name: prd-to-tasks
description: Breaks a product-level document (PRD, feature brief, or prose spec) into a set of discrete ticket stubs the operator can turn into backend tickets. Use when the operator has a project spec and needs it decomposed into actionable units of work.
---

# PRD to Tasks

Take a product-level document and return a list of ticket stubs that, together, deliver the whole thing. The operator will review your list, edit it, and create the actual tickets on the planning backend.

## Input

The operator gives you:
- A PRD, feature brief, or prose spec (as a file path, a link, or pasted into the conversation).
- Optionally, constraints (tech stack, team composition, deadline pressure, existing repo state).

Read the repo if relevant to understand what already exists — tickets that duplicate existing capability are waste.

## Output

A numbered list of ticket stubs, one per line. Each stub has:

```markdown
1. **<Title>** — <One-line goal>. <Optional: key interface produced / key dependency.>
2. **<Title>** — <One-line goal>.
...
```

Nothing more. These are stubs — the operator will either paste them directly into backend tickets or run `scope-task` on each one to flesh them out.

After the list, include two short sections:

```markdown
### Rationale
Two or three sentences on how these tickets compose to deliver the PRD. Name the dependency chain if it matters.

### Open questions
Things the PRD leaves ambiguous that the operator should resolve before scoping. Usually 0–3 items.
```

## Decomposition discipline

A good ticket:
- Is **small enough** that a single autonomous session can complete it (hours, not days).
- Is **large enough** that it delivers visible value (not "add a import statement").
- Has **a clear boundary** — what it does and does not include is obvious from the title.
- **Depends on a bounded set** of earlier tickets, with those dependencies named.

A bad ticket:
- Spans multiple subsystems with no clear connective tissue ("implement the backend").
- Has no observable output ("refactor for future scalability").
- Overlaps with another ticket on the list.

## Ordering and dependencies

Order the tickets roughly in the sequence they should be executed. When a ticket depends on an earlier one, mention it in the one-line goal:

```markdown
3. **Build /login endpoint** — POST handler that validates credentials and returns a token. Depends on #1 (user model).
```

If tickets are genuinely independent and could run in parallel, say so:

```markdown
4. **Add password reset flow** — Depends on #1 (user model) and #3 (email service). Independent of #5.
```

## Sizing heuristics

When in doubt about ticket size:
- If a ticket would clearly span more than one day of focused work for a human, **split it**.
- If a ticket's acceptance criteria would be fewer than 2 observable outcomes, **merge it** with an adjacent ticket.
- If you can't name what the ticket produces in a single phrase, the scope is wrong.

## What this skill does not do

- Does not create tickets on the backend. The operator reviews the list and creates tickets manually (or pastes into a bulk-create tool).
- Does not produce full scoped bodies. That is `scope-task`, invoked per-ticket after this list is approved.
- Does not prioritize. The operator sets priorities by ordering in the project board.
