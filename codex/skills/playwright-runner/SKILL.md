---
name: playwright-runner
description: Execute the repository's Playwright checks with its established server lifecycle and report pass/fail/not_run plus useful trace or screenshot artifacts. Use for browser-test verification, not implementing tests or changing app code.
---

# Playwright Runner

Execute the requested browser checks and report evidence to the current task or
parent agent. No harness variables, communication file, or separate app task is
required. The project's existing configuration owns the spec paths, port, base
URL, package manager, and server lifecycle.

## Establish the run

Read repository instructions and path-scoped rules, then inspect the documented
Playwright command and configuration. Resolve the requested suite, project, or
journey from the task and work-order criteria. Do not skip relevant UI checks
merely because a work order lacks a literal `via playwright` tag. Conversely, a
backend-only task with no requested browser gate can be `not_run` as inapplicable.

Use the project-owned runner, including its `webServer` configuration or wrapper
if present. Do not boot a second server or copy the harness's example config
over an existing one. If the repository explicitly uses the bundled
`playwright-harness/with_server.py`, resolve its path from the installed harness
checkout and first verify its expected `make dev`, `make playwright`, and
localhost:3000 contract. Those assumptions belong to that wrapper only.

Confirm no other worker is using the same server, database, port, or artifact
directory for a competing run. Use an existing service only when the project's
runner supports it and its revision and configuration match the test target.
If the environment or lifecycle cannot be established, report `not_run` and the
precise missing prerequisite. Do not guess by pointing tests at production.

## Execute and report

Run the selected command once. Capture stdout, stderr, exit code, visible test
counts, and the runner's server-start result. Let the repository's runner own
teardown. If the documented procedure requires separately starting a service,
track and stop only the processes this run created; leave unrelated services
alone.

On failures, inspect the reported screenshots, traces, and error context when
available. Identify the test, expected behavior, actual failure, and artifact
paths. Link useful artifacts using absolute paths; do not invent trace locations
or claim a visual inspection you did not perform. Summarize runner or startup
errors separately from a failed application assertion.

Do not edit app code, test assertions, Playwright configuration, or lockfiles.
Allow the test command's normal output and fixtures. Do not install dependencies
or browser binaries as part of this execution gate, skip failing tests, or retry
flakiness until it goes green. Return missing setup to the implementation task;
a later run after a concrete fix or environment change is a new verification.

Report the exact command and target, exit code, counts, concise failure evidence,
and links to useful artifacts. For delegated execution, finish with:

```text
VERDICT: pass | fail | not_run
REASON: one concrete sentence
```

- `pass`: the requested browser tests executed and completed successfully. Zero
  selected tests do not prove browser behavior; report that as `not_run`.
- `fail`: a test assertion failed, the runner crashed, or the scripted server
  startup failed. Identify which; do not call a startup failure an application
  regression without evidence.
- `not_run`: the gate is inapplicable, no tests were selected, or a prerequisite
  such as the command, dependencies, or browser binary is unavailable. State the
  exact blocker. An unavailable required gate is not a pass.

Return the result without publishing comments, changing tracker state, or
messaging others. Do not write a harness communication file unless the caller
explicitly supplied one; preserve prior content if an append-only log is used.
