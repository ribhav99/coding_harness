---
name: open-task-pr
description: Opens the pull request for the current task using the harness's standard branch naming and PR body format. Use once per task, on the first internal pass when you have something worth pushing. Idempotent — safe to call again if a PR already exists on the branch.
---

# Open Task PR

Creates the PR for the current task: branch, commit, push, `gh pr create` with a standard title and body.

## When to use

Call this the first time in a generator session that you have committed work worth reviewing. Once a PR exists for the branch, subsequent commits to the same branch automatically show up in it — no need to call this again.

## Inputs

The following must be available in the session context or environment:
- **Task ID** — e.g. `gh-42`. The orchestrator sets this in `HARNESS_TASK_ID` and mentions it in the injected prompt.
- **Ticket URL / number** — the planning-backend reference for this task. In the injected prompt.
- **Ticket title** — used as the PR title.

## Procedure

1. **Check for an existing PR on the branch.** Skip everything else if one exists.

   ```bash
   gh pr list --head "task/$HARNESS_TASK_ID" --json number,url --jq '.[0]'
   ```

   If output is non-empty, a PR exists. Print its URL and exit (idempotent no-op).

2. **Ensure you are on the correct branch.**

   ```bash
   git checkout -B "task/$HARNESS_TASK_ID"
   ```

   (`-B` creates or resets the branch to the current HEAD.)

3. **Ensure your changes are committed.** If `git status` shows uncommitted changes, commit them with a short message describing what this pass did:

   ```bash
   git add -A
   git commit -m "<one-line summary of this pass>"
   ```

4. **Push.**

   ```bash
   git push -u origin "task/$HARNESS_TASK_ID"
   ```

5. **Open the PR** with the standard body:

   ```bash
   gh pr create \
     --title "<ticket title>" \
     --body "$(cat <<EOF
   <One paragraph: what this PR delivers, in your own words.>

   Closes #<ticket number>
   EOF
   )"
   ```

   Use the exact ticket title as the PR title. The `Closes #N` footer links the PR to the ticket so merge auto-closes it (GitHub).

6. **Record the PR URL** in your session output so the orchestrator can pick it up on post-processing.

## On failure

- **`gh pr create` fails because no commits on branch:** you haven't committed yet. Go back to step 3.
- **`gh pr create` fails because branch has no upstream:** push first. Go back to step 4.
- **`gh` not authenticated:** this is a blocker. Document it in your final output and stop. The operator needs to run `gh auth login`.

## What this skill does not do

- Does not decide *when* your work is ready to push. That's your judgment.
- Does not add reviewers, labels, or milestones. The operator handles those on merge.
- Does not draft PRs. We create real PRs so CI triggers and the reviewer subagents can verify a real merge target.
- Does not force-push over history. Subsequent commits are normal pushes; the PR updates naturally.
