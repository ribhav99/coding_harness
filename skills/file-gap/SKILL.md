---
name: file-gap
description: Files a new Backlog ticket on the planning backend when you discover missing work that is out of scope for the current task. Use when you find a prerequisite, latent bug, or needed abstraction that shouldn't be handled inline. Never auto-promotes — operator triages.
---

# File Gap

Creates a new ticket in the `Backlog` column with the `gap` label and a back-reference to the task you're currently working on. The operator will triage it on their own cadence; it never enters the execution queue automatically.

## When to use

You're working on a ticket and you discover something important that is **out of scope** for that ticket. Examples:

- A shared utility doesn't exist yet and multiple endpoints will need it.
- A latent bug in code adjacent to what you're changing.
- A refactor that would materially help this or future tickets.
- A security or performance issue you noticed but isn't what this ticket is about.
- A missing test for code you didn't touch but which covers what you did touch.

**Do not use this when:**
- The work is plausibly in scope — just do it. The scoped-task body defines the boundary; consult `In scope` / `Out of scope` first.
- The work is tiny and directly blocks your current ticket. Just handle it inline with a short note in your output.
- You already filed a gap for the same thing in this session.

**When ambiguous, file it.** Filing is cheap and reversible. The operator can close duplicates in seconds.

## Inputs

- **`title`** — short, specific title for the new ticket. Write it like you'd write any ticket title: a verb phrase naming the outcome. Examples: "Extract shared request-validation helper", "Fix race condition in token refresh".
- **`body`** — one to three short paragraphs:
  1. What you observed.
  2. Why it matters (or why you think it does).
  3. Where you saw it — file paths, function names, line numbers.
- **`category`** *(optional)* — one of `refactor`, `bug`, `security`, `infra`, `docs`, `test`. Helps the operator triage.

## Procedure

1. **Check for a duplicate** (best-effort, not required). Look at recent Backlog tickets with the `gap` label; if an obvious match exists, skip filing and mention the existing ticket in your output instead.

   ```bash
   gh issue list --label gap --state open --limit 20
   ```

2. **Create the ticket.** For GitHub backend:

   ```bash
   gh issue create \
     --title "<title>" \
     --label "gap" \
     --label "gap:<category>" \
     --body "$(cat <<EOF
   <body paragraphs>

   ---
   Discovered while working on #<current ticket number>.
   EOF
   )"
   ```

   For Software Factory backend: use the adapter's `add_comment` / equivalent work-order creation call. (v1 deferred; GitHub first.)

3. **Add to the project board's Backlog column.**

   ```bash
   # After gh issue create, get the issue number from output, then:
   gh project item-add <project-number> --owner <owner> --url <issue-url>
   ```

   The item enters the default column, which is `Backlog`.

4. **Record the new ticket URL** in your session output. One line is enough:

   > Filed #<new-number> for <one-line summary>: <url>

## Do not

- Do not promote the new ticket to Ready. That is the operator's call after triage.
- Do not add yourself as an assignee, add reviewers, or set priorities.
- Do not spawn any work on the new ticket. Gap tickets do not cascade.
- Do not file more than a handful of gaps per session. If you find yourself wanting to file many, something is wrong with the scope of the current ticket — surface that in your output instead.

## Failure modes

- **`gh issue create` fails**: network, auth, rate limit. Document the failure in your final output with the intended title and body so the operator can file it manually. Keep working on the current ticket.
- **Project board add fails**: the issue still exists as a bare issue. Document the URL in your output. Operator manually adds to the board.
