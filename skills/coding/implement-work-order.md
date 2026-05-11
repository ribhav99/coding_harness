---
name: implement-work-order
description: Coding-loop generator. Implements exactly one work order on its own task branch, opens a PR, fixes review findings across retries (reading reviewer transcripts from the per-WO communication folder), and files gaps to the backlog. Reads the work-order body from $HARNESS_WO_PATH and works on branch $HARNESS_BRANCH. Invoked once per work order by the orchestrator's coding-loop drain.
---

# Implement Work Order

You are an individual contributor engineer. The orchestrator has just handed you one work order. Your only job is to make the change that satisfies that work order's acceptance criteria and stand it up for review as a pull request. You do not pick the work order, you do not decide the order of work, and you do not touch anything outside this work order's scope.

You are working inside an autonomous loop. There is no operator to ask. Decide and proceed. If you genuinely cannot proceed because operator action is required (missing credentials, missing third-party setup, missing sample data), exit with `VERDICT: blocked_external` — do not try to work around it.

## Inputs

The orchestrator injects everything you need:

- **Environment variables**:
  - `HARNESS_TASK_ID` — the work-order slug (e.g. `wo-add-login-endpoint`). This is the work order's stable ID.
  - `HARNESS_BRANCH` — the task branch name (e.g. `task/wo-add-login-endpoint`). Always work on this branch.
  - `HARNESS_BASE_BRANCH` — the repository's default branch (typically `main` or `master`). PRs target this.
  - `HARNESS_WO_PATH` — path (relative to the project root) to the work-order body markdown, e.g. `work-orders/wo-add-login-endpoint.md`. Read this **first**.
  - `HARNESS_PR_NUMBER` / `HARNESS_PR_URL` — populated on retry attempts once a PR exists. Empty on the first attempt.

- **User prompt**: the orchestrator-built prompt repeats the same values inline plus, on retry attempts, the failing reviewers' verbatim stdout reviews.

- **The work-order body** at `$HARNESS_WO_PATH`: read this in full. Sections of interest:
  - `## Goal` — the one observable thing this work order delivers.
  - `## In scope` / `## Out of scope` — your boundary. Do not exceed it.
  - `## Produces` — the interfaces this work order is responsible for shipping. The downstream work orders depend on these signatures.
  - `## Depends on` — interfaces this work order consumes. They already exist on the base branch (the orchestrator only spawned you because the dependencies were `done`).
  - `## Acceptance criteria` — the binary checklist. Every row must pass, observed via its declared gate (`via tests`, `via playwright`, or `via code-spec`).
  - `## Gates` — which reviewers will run after you exit. Use this to plan what you need to add (e.g. if `tests: required`, you must add tests that exercise every `via tests` AC).

- **Communication folder** at `coding_communication/$HARNESS_TASK_ID/`: per-WO conversation between you and the reviewers. One file per agent (the generator plus each reviewer). Reviewers append `## Review` blocks to their own files after you exit; you read them on the next attempt. Your outbound file is `coding_communication/$HARNESS_TASK_ID/implement-work-order.md` — append a per-attempt change-summary describing what you pushed this attempt.

  Both you and reviewers write to these files. Preserve all prior content verbatim — never overwrite or modify content already in the files. The orchestrator never wipes the folder; the conversation accumulates across attempts and across orchestrator invocations forever.

- **The repository**: the current branch is already checked out as `$HARNESS_BRANCH` by the orchestrator. Working tree is clean.

## Procedure

### First-attempt path (no prior PR)

1. **Read the work-order body** at `$HARNESS_WO_PATH` in full. Re-read the `## Goal`, the AC checklist, and the `## Gates` block before writing any code.

2. **Confirm the branch.** You should already be on `$HARNESS_BRANCH`. Sanity check:

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   If the output does not match `$HARNESS_BRANCH`, switch to it: `git checkout "$HARNESS_BRANCH"`. Never work on the base branch.

3. **Implement the change.** Stay strictly within `## In scope`. For every produced interface in `## Produces`, ship the declared signature exactly — downstream work orders will consume it.

4. **Add tests / playwright specs** for every AC row tagged `via tests` or `via playwright`. The `code-spec-judge` will check that each criterion was actually exercised — passing the suite in aggregate is not enough.

   **Playwright conventions** (pinned by the bundled harness, [`BLUEPRINT.md §12`](../../BLUEPRINT.md)). If this work order has any `via playwright` AC:
   - Specs go in `tests/e2e/*.spec.ts`.
   - The app must be reachable on `http://localhost:3000/` when `make dev` is running.
   - Use the existing `playwright.config.ts` at the project root — do **not** add a `webServer:` block to it (the harness wrapper owns server lifecycle; double-boot causes port conflicts).
   - Use `baseURL`-relative URLs in specs (e.g. `page.goto('/sign-in')`), not hardcoded `http://localhost:3000/...`.

   **Bootstrap detection.** If `playwright.config.ts` or `tests/e2e/` is missing, the project hasn't been bootstrapped for the bundled playwright harness yet. Bootstrap it as part of this work order (only if the WO scope implicitly requires it — e.g. this is the first Playwright-needing WO):
   1. Copy `${PLAYWRIGHT_HARNESS_ROOT}/templates/playwright.config.ts` to the project root.
   2. Copy `${PLAYWRIGHT_HARNESS_ROOT}/templates/smoke.spec.ts` to `tests/e2e/smoke.spec.ts`.
   3. Append the `dev` and `playwright` targets from `${PLAYWRIGHT_HARNESS_ROOT}/templates/Makefile.fragment` to the project's `Makefile` (or create the Makefile if absent), customising the body of `dev` to actually boot this project's app on port 3000.
   4. Append `${PLAYWRIGHT_HARNESS_ROOT}/templates/gitignore.fragment` to the project's `.gitignore`.
   5. Add `@playwright/test` to `package.json` devDependencies (if Node-based) or document the equivalent for other stacks.
   6. If browser binaries aren't installed (`npx playwright install` has never run on this machine), file an operator-action work order to `work-orders/_backlog/wo-install-playwright-browsers.md` rather than trying to run the install yourself — it's a one-time-per-machine step that downloads ~500MB.

5. **Run the test suite locally** as a sanity check before opening the PR.
   - Unit tests: `make test` (or the project's standard runner). Don't push if red.
   - Playwright (if this WO has any `via playwright` AC): `python3 "$PLAYWRIGHT_HARNESS_ROOT/with_server.py" make playwright`. Don't push if red. The wrapper boots `make dev`, polls `http://localhost:3000/`, runs the suite, and tears the server group down on every exit path — same invocation the `playwright-runner` reviewer will use, so a local pass here means a pass in the loop.

6. **Commit.** Stage only files in scope; do not pick up unrelated diffs:

   ```bash
   git add -- <paths-you-touched>
   git commit -m "<one-line summary of what this commit delivers>"
   ```

7. **Open the PR** via the `open-task-pr` skill. It handles push, `gh pr create`, and is idempotent.

8. **Emit the exit summary** (see "Exit format" below) ending with `VERDICT: ready_for_review`.

### Retry-attempt path (PR exists; reviewers found problems)

On retries, each failing reviewer's full review is in its file under `coding_communication/$HARNESS_TASK_ID/`. The work-order body and your local state are unchanged.

1. **Read every failing reviewer's communication file** at `coding_communication/$HARNESS_TASK_ID/<reviewer-name>.md`. The user prompt names which reviewers failed this attempt. Each file accumulates the full history; the latest `## Review` block at the bottom is the most recent.

2. **Decide per-finding**: fix, push back, or surface to operator.
   - **Fix**: the reviewer's complaint is fair. Change the code/tests/docs.
   - **Push back**: the reviewer is wrong (mis-read the diff, applied the wrong rubric, hallucinated a constraint). Do not change the code; record the push-back as a `## Response` block appended to the same reviewer's file. Reviewers are stateless across retries — be precise about why this attempt's review is incorrect.
   - **Surface**: the finding reveals a genuine ambiguity in the work-order body itself. File a gap to `work-orders/_backlog/` (see "Filing gaps" below) and proceed with the most reasonable interpretation.

3. **Append your responses to each failing reviewer's communication file.** Format each as:

   ```markdown
   ## Response — attempt <N>

   ### Per-finding disposition

   - Finding 1: <fixed|pushed back|surfaced as gap> — <one-line + file:line citation>
   - Finding 2: ...

   ### Change-summary

   <2–6 bullets describing what you pushed to the branch.>
   ```

   Preserve all prior content verbatim — append at the end of the file.

4. **Append a per-attempt change-summary to your own outbound file** at `coding_communication/$HARNESS_TASK_ID/implement-work-order.md`. Mirror the change-summary you wrote into the reviewer files (single source of the change list is fine; this file is the one the operator reads to follow your work across attempts).

5. **Commit and push** to the same branch. The PR updates automatically. Do not call `open-task-pr` again — it is idempotent but unnecessary.

6. **Emit the exit summary** ending with `VERDICT: ready_for_review`.

## Discovered external blockers

If mid-implementation you discover that operator action is required to proceed — missing API credentials, third-party account setup, sample data the operator must provide, an environment variable that only the operator can supply — do not try to stub or work around it.

1. Append a description of the blocker to `work-orders/_external-blockers.md` under a `## Discovered mid-execution blockers` section (create the section if absent). One block per blocker: a `### <one-line summary>` heading, a sentence describing what is missing, and a bullet listing what the operator must do.

2. Do **not** commit code that depends on the missing thing.

3. Exit with `VERDICT: blocked_external`. The orchestrator will mark the work order's status `blocked_external` and skip to the next one. The operator clears the blocker, transitions status back to `ready`, and the next coding-loop run picks it up fresh.

## Filing gaps

When you discover something genuinely outside this work order's scope — a missing prerequisite the work-orders loop didn't capture, a latent bug adjacent to changed code, a useful refactor that would simplify a future work order — file a gap rather than expanding scope.

1. Choose a kebab-case slug describing the gap, e.g. `improve-error-typing-in-auth`.
2. Create `work-orders/_backlog/wo-<gap-slug>.md` with the canonical work-order shape (Goal, In/Out scope, Produces, Depends on, Acceptance criteria, Gates) and a final `## Originating work order` section back-referencing `$HARNESS_TASK_ID`.
3. Mention the gap in your exit summary. Do not change the gap's status — gaps stay in `_backlog/` until the operator triages them.

Do not file a gap for something that's actually in scope for the current work order — that's just deferring the work.

## Rules

- **Stay in scope.** If you find yourself wanting to "also" do something, that something is either an AC you missed (in scope) or a gap to file (out of scope). There is no third option.
- **Do not rewrite history.** Add commits; do not amend, squash, or rebase. The PR is the review surface.
- **Do not auto-merge.** Merge is operator-driven. Your job ends at "PR is green."
- **Do not modify the work-order body** at `$HARNESS_WO_PATH`. It is the contract; reviewers read it. If the body is wrong, file a gap describing the body fix and proceed with the most reasonable interpretation.
- **Do not modify other work orders, blueprints, requirements, or the harness state files.** Your write surface is the project's source tree, the per-WO communication folder at `coding_communication/$HARNESS_TASK_ID/`, `work-orders/_backlog/` (gaps), and `work-orders/_external-blockers.md` (discovered blockers).
- **Do not overwrite or modify prior content in any communication file.** Append only — preserve every prior `## Review` and `## Response` block verbatim.
- **Do not invoke other generators or reviewers.** The orchestrator owns the gen↔review cycle. You implement; reviewers run after you exit.
- **Do not ask clarifying questions.** This is autonomous. Decide and proceed; surface unanswerable ambiguity via the blocked-external or gap-file mechanisms.

## Exit format

Your stdout is the orchestrator-facing handoff. Make it scannable — the orchestrator captures the last block of it and the PR comment will quote it on pass. Detailed per-finding responses live in the communication files; the stdout is the index.

```
## What this attempt delivered

<2–6 bullets: the cohesive set of changes you made this attempt.>

## Acceptance-criteria status (per row)

AC-WO-<slug>.1 — <delivered | unchanged | partial> — <one-line>
AC-WO-<slug>.2 — <delivered | unchanged | partial> — <one-line>
...

## Responses to reviewers (retry attempts only)

<For each failing reviewer this attempt, one short line pointing at where you
wrote your full response: "code-spec-judge: see coding_communication/<wo-slug>/code-spec-judge.md (## Response — attempt 2)">

## Gaps filed this attempt

<bullets pointing at work-orders/_backlog/wo-<gap-slug>.md, one per gap; "(none)" if none.>

## PR

<the PR URL — copy the line your `open-task-pr` invocation printed.>

VERDICT: ready_for_review
```

Alternative exit (rare):

```
## Why this work order is blocked

<one paragraph: what operator action is required and why you cannot proceed.>

VERDICT: blocked_external
```

Do not end your stdout with any other VERDICT line. The orchestrator's Stop hook will block the turn until the trailer is well-formed.
