---
name: blueprint-to-tasks
description: Breaks a feature blueprint (produced by `frd-to-blueprint`) into a set of discrete work-order stubs the operator can turn into work-order directories under `projects/{slug}/work-orders/{phase}/{wo-n}/`. Reads the corresponding FRD as secondary context. Use when the operator has an approved blueprint and needs it decomposed into actionable units of work.
---

# Blueprint to Tasks

Take a blueprint and return a list of tasks that, together, deliver it. The operator will review your list, edit it with you, and create the actual tasks on the planning backend.

## Input

The operator gives you:
- A feature blueprint (typically the output of `frd-to-blueprint`), and the corresponding FRD as secondary context.
- Optionally, anything the blueprint doesn't already cover (tech stack, existing repo state).

Read the repo if relevant to understand what already exists — tasks that duplicate existing capability are waste.

## Output

A numbered list of task stubs, one per line. Each stub has:

```markdown
1. **<Title>** — <One-line goal>. <Optional: key interface produced / key dependency.>
2. **<Title>** — <One-line goal>.
...
```

Nothing more. These are stubs — the operator will then flesh them out.

After the list, include two short sections:

```markdown
### Rationale
Two or three sentences on how these tasks compose to deliver the blueprint. Name the dependency chain.

### Open questions
Things the blueprint leaves undefined that should be resolved by updating the blueprint before scoping.
```

## Decomposition discipline

A good task:
- **Has a tight scope** — what is in and out of scope is obvious from the title and one-line goal. Ambiguity here is what causes agents to drift mid-execution.
- **Is spec-atomic** — one logical change, not a bundle. If you'd describe it with "and," it's probably two tasks.
- **Has an observable outcome** — something you can point at and verify (a passing test, a working endpoint, a renamed symbol everywhere). If you can't name what changes about the system when it's done, the task isn't real.
- **Names its dependencies** — the bounded set of earlier tasks it builds on.

A bad task:
- Spans multiple subsystems with no clear connective tissue ("implement the backend").
- Has no observable outcome ("refactor for future scalability", "improve code quality").
- Overlaps with another task on the list.
- Requires the agent to make a product or architectural decision that wasn't made upstream.

## Ordering and dependencies

Order the tasks roughly in the sequence they should be executed. When a task depends on an earlier one, mention it in the one-line goal:

```markdown
3. **Build /login endpoint** — POST handler that validates credentials and returns a token. Depends on #1 (user model).
```

Only flag dependencies. Do not call out independence — its absence is the signal.

## What this skill does not do

- Does not create tasks on the backend. The operator reviews the list and creates tasks manually (or pastes into a bulk-create tool).
- Does not produce full scoped bodies. That is `scope-task`, invoked per-task after this list is approved.
- Does not prioritize. The operator sets priorities by ordering in the project board.
