---
name: implement-work-order
description: Implement one identified work order in the current Codex task, verify its acceptance criteria with the repository's gates, prepare its PR, and address review feedback. Use for work-order implementation; it does not select or drain a backlog.
---

# Implement Work Order

If `FM2_TASK` or `FM2_PANEL` is nonempty, read [the fm CLI runtime](cli-runtime.md)
first. Its session, tool, and reporting rules take precedence over app-specific
instructions below. Otherwise, follow this procedure in the current Codex app
task. An ordinary terminal alone does not select the fm workflow.

Implement the identified work order to a reviewable result in the current task.
Use collaboration subagents for bounded independent work when useful. Create
another user-facing task only when the user explicitly requests one. This
workflow requires no harness environment variables, status files, or CLI loop.

## Establish the contract

Read the target repository's instructions and applicable path-scoped rules
before working on its files. Follow its architectural sources, tooling, test
layers, branch naming, migration limits, and PR evidence requirements.

Resolve the work order from the user's supplied path, URL, identifier, prompt,
or an unambiguous branch reference. Use the connected tracker when appropriate;
read the full body, not a generated summary. If there are multiple plausible
work orders and the request does not identify one, ask for the missing identity
while doing independent repository inspection. Do not choose the next backlog
item yourself.

Read its goal, in/out scope, produced and consumed interfaces, dependencies,
acceptance criteria, and required gates in full. Verify its premises against
the existing code and authoritative project documentation. A work order
captures intent, not ground truth: call out a stale signature, nonexistent
dependency, or mis-scoped plan and follow the goal and repository's correction
process. Do not knowingly ship a broken contract because the document says so.

Inspect git status, the current branch, upstream, base branch, and existing PR.
Do not assume a clean tree or a particular branch name. Reuse the task's suitable
branch and preserve unrelated edits. If a branch or isolation is needed, follow
project conventions; put new worktrees beside the repository. Do not reset an
existing branch, work directly on the base branch without explicit direction,
or move someone else's uncommitted changes to make setup convenient.

## Implement and verify

Deliver the cohesive behavior in scope, including downstream interface
compatibility and error handling. A missing in-scope case is work to complete;
an unrelated improvement is a gap to report rather than an excuse to expand
the change. Make routine implementation choices yourself. Surface an ambiguity
only when it materially affects the intended outcome and cannot be resolved
from the available sources; continue independent work while awaiting an answer.

Map each acceptance criterion to concrete evidence at the test layer that can
meaningfully prove it. Apply the repository's test-routing skill when required:

- Exercise public contracts and observable behavior, not private implementation
  details or framework guarantees.
- Give tests outcome-specific names and use the repository's spec tags or
  ledger so acceptance-criterion coverage is discoverable.
- Exercise invalid input, permission boundaries, and error paths when promised
  by the criterion, with specific expected results.
- Avoid assertions that also pass when the behavior is missing. A passing suite
  is not evidence for an acceptance criterion no test exercises.
- For UI journeys, assert real visible state, navigation, and interaction
  outcomes. Follow the existing spec locations, server lifecycle, base URL, and
  package manager; do not impose a new directory layout or port.

Do not add tests for changes that cannot justify them merely to populate a
checklist. If the work order prescribes a test at the wrong layer, correct the
plan under repository rules and explain how the chosen evidence proves the
behavior. Update the product test plan and visual PR evidence when required.

Run the relevant checks and every required repository preflight gate before
presenting the change as ready. Use `tests-runner` or `playwright-runner` for
independent execution when useful; assign a single owner to commands sharing a
server, database, or build output. Preserve failures as evidence, fix problems
within scope, and rerun only after a change or investigation justifies it. A
missing dependency, skipped gate, or unavailable environment is not a pass.

If the project has no test infrastructure and the work order requires adding
it, build only the necessary infrastructure within the authorized scope. Do
not replace an existing setup with the harness's example Playwright wrapper.

## Prepare the PR and review

When the task includes delivering a PR, load `open-task-pr` after the change and
required checks are complete. Stage explicit in-scope paths, inspect the staged
diff, commit using project conventions and hooks, and use ordinary pushes.
Honor an explicit instruction to keep the work local or stop before publishing.
Do not create a duplicate PR for later iterations of the same branch.

Review your own final diff for accidental scope, dead code, incomplete behavior,
and missing evidence. When an independent review is requested or required by
the project, give fresh review subagents the raw scope, work order, and code;
do not seed them with your conclusions. Use the `full-review` workflow when its
depth is requested or required. Do not create a separate app task to obtain a
cold review unless the user explicitly requested that task.

On review feedback, read the full findings and any referenced evidence. For
each finding, fix it, push back with verified code evidence, or identify the
unresolved product decision. Apply authorized fixes on the same branch and
rerun the affected checks. Do not treat a reviewer's claim as fact or defer an
in-scope defect into the backlog. Preserve an existing append-only review
conversation when the repository uses one; otherwise track dispositions in
this task instead of manufacturing harness communication files.

## Blockers and completion

For missing credentials, third-party setup, required sample data, or another
external dependency, report exactly what is missing and which behavior it
blocks. Continue independent safe work. Do not fabricate credentials, substitute
a production stub, or present dependent code as complete. Record a blocker or
out-of-scope gap through the project's established mechanism when authorized;
otherwise report it in the task. Do not require a new backlog directory or
change unrelated tracker items.

Finish with the delivered behavior, acceptance-criterion evidence, actual
validation, outstanding gaps or blockers, and the PR URL or local diff location.
Use ordinary task responses; no `VERDICT` trailer or Stop-hook protocol is
required. Do not claim ready-for-review while a required gate is unresolved.
Do not auto-merge, close a work order, archive this task, or send messages to
others as a consequence of finishing implementation. Those actions need their
own authorization, which may already be present in the user's request.
