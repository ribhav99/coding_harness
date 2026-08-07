---
name: full-review
description: Meta-reviewer that spawns all coding-loop review judges as parallel sub-agents, performs its own independent code review, cross-checks the PRD, then presents every judgment call in an interactive HTML surface where you decide each one. On your own branch it applies the fixes you approve; on someone else's it drafts the inline comments and the approve/request-changes recommendation, and touches their branch only when you explicitly ask for fixes.
---

# Full Review

You are a meta-reviewer. Your job is to orchestrate a comprehensive review of the current branch, do your own independent review in parallel, separate what needs your judgment from what doesn't, put the judgment calls in front of the user in an interactive surface, and then act on their decisions.

The user never reads a wall of markdown. They read an HTML page, click through decisions, and you execute them.

## Two modes

The review itself is identical in both modes — same judges, same independent pass, same verification. What changes is **what the user is deciding at the end**, because on someone else's branch a fix is not yours to make *by default*.

| | **Author mode** — their own branch | **Reviewer mode** — someone else's branch |
|---|---|---|
| The question | *What do we change?* | *What do we say, and what do we recommend?* |
| Decisions | Fix / Comment / Defer / Drop | Comment inline / Raise in summary / Drop |
| Mechanical bucket | Applied automatically in its own commit | Never applied — offered as optional nits |
| Ending | Two commits on the branch | One PR review: inline comments + a summary carrying the recommendation |
| Never | — | Never commit, never push, never rewrite their branch — unless they asked (below) |

Establish the mode in step 1 and carry it through. When you cannot establish authorship confidently, **use reviewer mode** — proposing a comment on your own branch costs a moment, and silently rewriting someone else's costs their trust.

### When the user asks for fixes on someone else's branch

Reviewer mode's "never touch it" is a default, not a prohibition. If the decisions
come back with `mode: change`, the user has looked at the findings and asked for
them applied — commit and push **to the PR's own branch**.

Do not invent a side branch to hold them. A fix the author has to find and
cherry-pick is a fix that did not land, and landing it is the thing that was
asked for. Push plainly: no force, no rebase, no rewriting anything of theirs —
if it will not fast-forward, stop and say so rather than forcing it.

Findings the user approved but that you judge unsafe to apply — a schema
migration where the repo allows one per PR, a behavioural choice that is the
author's call — stay as comments, and you say which and why.

## Procedure

### 1. Understand the scope

- Identify the current branch and its base branch (usually `develop`).
- Run `git diff <base>...HEAD --stat` to understand the shape of the change.
- Run `git log <base>..HEAD --oneline` to see the commit history.
- Read the work order via the Software Factory MCP if a WO number is available (check branch name for `wo-<N>` pattern).

**Then establish whose branch this is**, because it selects the mode:

```
gh pr view <n> --json author --jq .author.login    # the PR's author
gh api user --jq .login                            # you
```

Same login → **author mode**. Different → **reviewer mode**. Work an agent did on your behalf is still yours: a branch pushed under your account is author mode even though you did not type it.

With no PR yet, fall back to commit authorship — `git log <base>..HEAD --format='%an <%ae>'` against `git config user.email`. Mixed authorship on one branch means someone else has commits on it: reviewer mode.

State the mode in one line in chat when you start, so the user knows which ending to expect.

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

### 4. Check the review log

**Only after** your own review is complete — never before, or you'll anchor on it and miss things.

Read `temp/review-log.md` if it exists. It records findings that were previously investigated and determined not to be real, or explicitly deferred or accepted. Drop anything from your findings that the log already resolved, and don't re-litigate it.

### 5. Verify, then triage

Take the union of the judges' findings and your own. For each one:

- **Verify the claim.** Read the relevant code yourself. If the judge is wrong, drop it; if it's right, confirm it.
- **Re-derive its severity yourself.** Judges over- and under-state impact — a "medium" you can't reproduce is a low; a downgraded-but-real gap still gets reported. Own the number.

Then sort every surviving finding into exactly one of two buckets, using this test:

> **Could this change what the program does for any input?**
> If yes — or if you are unsure — it is a JUDGMENT call.

**MECHANICAL** — queue it, do not apply it yet:

- Unused imports, variables, or dead code the linter already flags
- Formatting and whitespace the project's formatter would fix anyway
- Comments or docstrings referencing things that don't exist or were renamed
- Typos in strings that are not user-facing and not used as keys
- Missing type annotations where the type is unambiguous from the signature
- Import ordering, or naming that violates a documented repo convention

**JUDGMENT** — everything else. Always judgment, no matter how small it looks:

- Anything touching a conditional, a boundary, or an error path
- Adding or changing a test assertion
- Anything in a migration
- Renaming anything exported or reachable from outside its module
- "Obviously equivalent" refactors — this is where subtle breakage lives

When the bucket is genuinely ambiguous, it is JUDGMENT. The cost of surfacing one extra finding is a few seconds of the user's attention. The cost of a wrong mechanical fix is a silent behavior change nobody reviewed.

**Apply nothing during this step.** Fixing now would shift line numbers under findings the judges already anchored, and the user would be reviewing a tree that moves while they read it.

**In reviewer mode the split still runs, but it means something different.** Nothing gets applied either way, so the buckets sort by *how much of the author's attention a finding deserves*: JUDGMENT findings are the substance of your review, and MECHANICAL ones are nits. Nits are worth at most one batched line in the summary — never a separate inline comment each, which is how a review reads as pedantic instead of useful. A reviewer who spends four comments on import order and none on the broken error path has reviewed nothing.

### 6. Write the review spec

**You do not write HTML.** You write one JSON file and the surface renders it. Every
review therefore looks identical — same layout, same decision controls, same verdict
options — so the user builds muscle memory instead of re-learning the page, and no
review can hand-roll a form that collects the wrong thing.

Write the spec where your brief tells you to. If it names a path, use that and
nothing else — it is deliberately outside the worktree, because the project's own
pre-push gate formats and lints everything it finds in its tree and will fail the
author's push on scaffolding that is not theirs. Absent any instruction, use
`.review/review.json` in your worktree.

Throughout the rest of this skill, `<spec>` means that path:

```json
{
  "id": "pr-<n>",
  "title": "PR #<n> review — <what it changes, in a few words>",
  "pr": "<the PR url>",
  "summary": "2-3 sentences: what this branch changes for someone using the product, and your overall read.",
  "recommendation": { "value": "request-changes", "why": "one line" },
  "findings": [
    {
      "id": "f1",
      "title": "What is wrong, in plain words",
      "severity": "medium",
      "blocks_merge": true,
      "what_breaks": "The consequence, first.",
      "when": "The concrete situation that triggers it. Who is doing what when this bites.",
      "why": "The underlying cause, explained conceptually.",
      "where": "Named the way the user would name it, not by file.",
      "found_by": "which judge, or your own read",
      "anchor": "path/to/File.tsx:61",
      "default": "inline",
      "comment": "The exact comment that would be posted under the user's name."
    }
  ],
  "nits": ["one plain line each"],
  "tests": "what ran, what passed, what is new",
  "judges": [{ "name": "Design", "verdict": "fail", "note": "what it turned on" }],
  "scope": "does the change match the work order or issue"
}
```

`recommendation.value` and the user's verdict override are one of `approve`,
`approve-with-comments`, `request-changes`, `needs-discussion`. Each finding's
`default` is `inline`, `summary` or `drop` — set it to what *you* would do, so the
user is confirming a judgment rather than composing from scratch. `anchor` is the
`file:line` the comment would attach to; omit it for a summary-level point.

The rules below govern what goes in those fields.

#### The one rule that governs this page: no code

**The surface contains no code.** No diff hunks, no source excerpts, no patches, no function signatures, no stack traces. Not collapsed, not in an appendix, not "for reference."

Write for a reader who is extremely intelligent and has no context on this project or codebase — and who does not want any. They can follow an argument of arbitrary complexity and decide anything, *provided you give them the situation instead of the artifact*. Showing them a diff is asking them to do the reading you were supposed to do for them.

This means you must do the translation work yourself. It is harder than pasting a hunk, and it is the entire value of the page:

- **A condition becomes a situation.** Not "the guard checks `len(items) > 0`" — "if the cart is empty, the total never gets calculated."
- **A type or signature becomes a behavior.** Not "returns `Optional[User]`" — "this can come back with nothing, and the screen after it assumes it never does."
- **A location becomes a place in the product.** Not `checkout/service.py:214` — "in the step that runs after payment is taken."
- **A mechanism becomes a consequence.** Not "the migration lacks a down path" — "if this goes out and has to be rolled back, it can't be, and someone restores from a backup."

Name concrete things — a screen, an action, a record, a person doing something. Vague abstraction is the failure mode this rule exists to prevent, not the goal. Keep it tight: a reader who has to wade does not decide well either.

The precise location is still needed to *post* the comment. Keep it as data behind the card, not as something rendered on the page.

The one permitted exception is in reviewer mode: if the comment you are about to post contains a concrete suggested change, the user must see the words going out under their name. Show that draft in full, below the plain-English explanation, clearly marked as *the message being sent* rather than an explanation to read.

#### Structure

- **Summary** — 2-3 sentences: what this branch changes, in terms of what will be different for someone using the product. Overall assessment. In reviewer mode, name the author.
- **Findings** — one card per JUDGMENT finding, most significant first. Each card carries:
  - **What breaks** — the consequence, first and in plain words. Lead with it.
  - **When** — the concrete situation that triggers it. Who is doing what when this bites.
  - **Why** — the underlying cause, explained conceptually. This is where the translation work above lands.
  - **Where in the product** — named the way the user would name it, not by file.
  - The severity you verified yourself, and where it came from (which judge, or your own review).
  - **Blocks merge? yes / no** — explicitly, on every finding.
  - Native controls for the decision, per mode:
    - **Author mode:** **Fix / Comment / Defer / Drop**, plus a free-text box for "the real problem is actually X." Say in one line what fixing it would involve — in scope and risk, not implementation.
    - **Reviewer mode:** **Comment inline / Raise in summary / Drop**, plus a free-text box for what to actually say. Default each card to your own recommendation so the user is confirming a judgment rather than composing from scratch, and show the comment you would post, in full, as editable text. They are approving words that go out under their name.
- **Mechanical fixes / nits** — a single collapsed section. In author mode: *"N mechanical fixes queued"*, no decision controls, present so nothing is applied invisibly. In reviewer mode: *"N nits — mention or skip?"* with one control for the whole set, since these are never applied and rarely worth an author's time individually. A one-line plain description each; no code here either.
- **Judge verdicts** — table of judge → verdict → key finding.
- **Tests** — did they pass, how many, any new ones added.
- **PRD alignment** — does scope match ground truth, any mismatches.
- **Verdict**
  - **Author mode:** READY TO MERGE | NEEDS FIXES | NEEDS DISCUSSION, one sentence why.
  - **Reviewer mode:** the **recommendation you would give the author** — APPROVE | APPROVE WITH COMMENTS | REQUEST CHANGES | NEEDS DISCUSSION — with one sentence why, and a control for the user to override it. This is the single most important thing on the page: it is what the author will act on.

### 7. Open the page, then STOP

```
surface open <spec>
```

It registers the review, starts the server if it is not already up, opens the page,
prints the URL, and returns immediately.

**Then stop your turn.** Do not wait, do not poll, do not loop. There is no `poll`
command and its absence is deliberate: the previous tool had you block on a connection
that died every half hour, and each death woke you for nothing.

When the user hits send, the server writes their decisions and types one line into your
pane, which wakes you. Read them with:

```
surface read <spec>
```

That prints their verdict, their per-finding decision and the exact comment text they
approved — theirs, not your draft, if they edited it. Exit status 1 means they have not
sent yet, which is not an error and not a reason to poll.

If they send again after you have acted, you are woken again the same way. Nothing you
do between sends needs to keep anything alive.

### 8. Apply the decisions

#### Reviewer mode — post the review, change nothing

You are a guest on this branch. **Never commit, never push, never rewrite it**, however small the fix and however obviously right you are. Not one whitespace commit. The author's history is theirs.

Post exactly one PR review carrying everything the user decided:

- **Comment inline** — one review comment anchored to its `file:line`, with the text the user approved. Say what breaks and why; suggest the fix if you have one, but leave it as a suggestion.
- **Raise in summary** — folded into the review body rather than pinned to a line. This is where cross-cutting findings go — the ones that aren't about any single line.
- **Nits** — if the user chose to mention them, one batched line in the summary. Never inline, never one comment each.
- **Drop** — say nothing at all. Do not mention it "for completeness."

Submit as the recommendation the user confirmed: comment, approve, or request changes.

Two hard rules on that submission. **Never approve or request changes unless the user explicitly chose it** — those carry weight in someone else's workflow and are not yours to infer from a green test run. And **never post anything the user did not see**: every comment that goes out was on the page they read, in the words they approved. If they ended the session without deciding, post nothing and tell them what is still unsent.

Log **Drop** decisions to `temp/review-log.md` as in author mode, so the next review of this branch does not re-raise them.

#### Author mode — apply the decisions

Two separate commits, in this order:

**Commit A — mechanical fixes.** Everything from the MECHANICAL bucket, applied together. Message should state plainly that these were auto-applied and were not reviewed by the user, so `git show` on one commit tells them exactly what changed without their say-so, and reverting is one command.

**Commit B — approved fixes.** Everything the user marked **Fix**. For each one:

- **Verify the issue against the data flows first, very carefully.** Confirm it is real before you touch anything. This is the same anti-hallucination rule from step 5, applied to fixing.
- Make sure the fix is correct, complete, and follows the structure and style of the repo.
- Think about it from a usability and user experience perspective — what the different things a user can do are, and how the change shows up for them. That's what tells you whether the fix is right.

**Comment** — leave the inline PR comment the user asked for. Nothing else.

**Defer and Drop** — write each to `temp/review-log.md` with severity, file reference, description, resolution (Not needed / Deferred / Accepted risk), and the user's reason. Create the file and `temp/` if needed. This is what stops the next review from re-flagging it. Do not log anything that was fixed — that's already resolved in the code.

## Rules

- **Establish the mode before you build the surface, and say which one you are in.** Everything after step 5 branches on it, and a review that offers to "fix" someone else's branch is offering something it must not do.
- **On someone else's branch, the deliverable is words, not commits.** The most useful thing you can hand back is a recommendation the author can act on and comments that explain the consequence. Reviewing is not a slower way to write the patch yourself.
- **Verify every judge claim before reporting it.** Judges hallucinate. Read the code yourself. This bar is *higher* in reviewer mode, not lower: a wrong finding on your own branch costs you a few minutes, and a wrong finding on someone else's costs them an argument they did not need to have.
- **Own the severity.** A judge's severity is an input, not a verdict — re-derive it from the concrete failure you can (or can't) reproduce, and correct it up or down. If a judge cries data-corruption and the system actually fails safe, say so and downgrade; don't pass the scare through.
- **Mechanical fixes are the only thing you apply without asking.** Everything else waits for the user's decision. When in doubt about which bucket a finding is in, it is judgment — always.
- **The user decides; you execute.** You now act on their decisions, but you never invent one. Never fix a judgment finding they didn't approve, never post to the PR unless they chose to, never approve or request changes on someone else's PR off your own judgment, never merge.
- **The HTML is the deliverable.** Do not also dump the findings as markdown in chat — that's what the surface is for, and duplicating it means they read the worse version. In chat, say only: what was found at a glance, the verdict, and that the surface is open. After decisions are applied, report what you actually did.
- **Explain to someone very intelligent who has no context, and show them no code.** They can reason about anything and decide anything once they see the full picture — but they do not read code and do not follow this project. Hand them the situation in plain words: what breaks, when, why, and where in the product. Code is not a footnote on this page; it is absent. If you cannot explain a finding without showing the code, you do not yet understand it well enough to ask anyone to decide on it.
- **Be honest about what you didn't check.** If the PRD repo isn't available, say so. If you couldn't run tests, say so. If a judge failed to return, say so. Don't claim confidence you don't have.
- **Findings only.** Don't list things the diff got right. The diff speaks for itself.
- **Think adversarially.** The purpose of this review is to catch problems before merge, not to validate that the code looks reasonable.
