---
name: open-task-pr
description: Open or update the PR for the current Codex task using the repository's branch, commit, validation, and PR conventions. Reuse an existing PR, preserve unrelated work, and publish only within the user's authorized scope.
---

# Open Task PR

Prepare and publish the current task's change when the user requested a PR or
the authorized workflow includes one. An explicit request to keep work local,
avoid commits, or wait before publishing takes precedence. Do not ask again for
publication already authorized in this task.

## Resolve the target

Read the repository's instructions and PR template. Identify the actual current
branch, base branch, remote repository, work order or issue if any, and intended
change from git and the task context. No task ID environment variable or fixed
`task/` branch prefix is required. Follow the project's branch naming; use a
descriptive `codex/` name if it has no convention and a new branch is needed.

Inspect git status and the diff before any mutation. Reuse a suitable existing
branch. Never reset it with `checkout -B`, force-push, rewrite published commits,
or stage unrelated files. If the current checkout is unsuitable, preserve its
work and establish the proper branch or sibling worktree according to the
repository's rules. Do not change branches blindly under uncommitted changes.

Query the forge for an open PR matching the actual head branch and head
repository, including fork ownership when applicable. An existing PR is the
publication target: return its URL if there is nothing new to publish, or update
it for the authorized final change. A closed or merged PR is not an open PR to
reuse. Do not create a duplicate based on a guessed task identifier.

## Prepare a reviewable change

Run the checks required by the repository and the change, or inspect reliable
results already produced for the same revision. Invoke the project's
test-routing skill when required. Report an unavailable gate accurately; do not
call the PR ready while it is unresolved. Respect an explicit draft request.

For uncommitted task changes, stage explicit file paths or the specific hunks
belonging to the task. Review the staged diff for scope and secrets before
committing with the repository's conventional message and normal hooks. Leave
unrelated staged or unstaged changes alone. If the index already contains other
work, use an isolated index or a selective commit procedure that preserves those
entries, then inspect the resulting commit. A plain commit of the entire index
would include that unrelated work. Do not create an empty commit merely because
the skill was invoked.

Write a PR title and body describing the final change, using the repository's
template. Lead with the concrete problem and resulting behavior; include the
validation and material limits a reviewer needs. Explain deliberate deviations
from the work order. For UI changes, include the required screenshots, journey
references, or evidence directives. Keep the title aligned with the final scope
rather than copying a stale ticket title.

Link the verified work order or issue. Use `Closes #N` only for the intended
GitHub issue in the correct repository when merge should close it; a Software
Factory work-order number is not a GitHub issue number. Do not invent a ticket
link when the task has none.

## Publish and confirm

Push normally to the verified head remote and branch, setting an upstream when
needed. If the push is rejected, inspect and report the cause; do not force it
or silently rewrite someone else's history. Create the PR against its verified
base, or update the existing PR title/body when the authorized scope changed.

Prefer structured tool arguments for multiline text. With `gh`, write the exact
body to a temporary file and pass `--body-file`; preserve real newlines and avoid
shell interpolation of user or ticket content. Before retrying an ambiguous
create response, query for the matching PR to avoid duplicate publication.

Read back the PR URL, head/base, title/body, and available check state from the
forge. State whether checks passed, failed, are pending, or could not run. Do not
treat successful creation as successful CI. Report the verified PR URL and any
remaining required work.

Do not merge, request reviewers, change labels or tracker state, post review
comments, or notify others unless the user's request or repository workflow
specifically authorizes that action. Where authorization is missing, finish the
concrete PR preparation first so any necessary permission request is the final
step. Explain its source and the exact action awaiting approval.
