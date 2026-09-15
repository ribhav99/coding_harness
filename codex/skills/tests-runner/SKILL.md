---
name: tests-runner
description: Execute the repository's requested test suite and report its command, exit code, and pass/fail/not_run result. Use for an execution-only verification pass, including a delegated Codex subagent.
---

# Tests Runner

If `FM2_TASK` or `FM2_PANEL` is nonempty, read [the fm CLI runtime](cli-runtime.md)
first. Its session, tool, and reporting rules take precedence over app-specific
instructions below. Otherwise, follow this procedure in the current Codex app
task. An ordinary terminal alone does not select the fm workflow.

Run the agreed test scope and report observed results. This is an execution gate,
not a correctness review or permission to fix the code. The caller can use the
skill directly or assign it through a collaboration subagent; no separate app
task or harness environment is required.

Read the repository's instructions and applicable rules first. Resolve the
working directory, revision, and requested test scope from the task. Prefer the
repository's documented command and package manager. Inspect its Makefile or
package configuration when needed; use `make test` if that is its actual suite,
not merely because the target exists. Do not substitute a different scope or
toolchain without saying so. If no runnable command can be established, return
`not_run` with the missing information.

Check that another worker is not already running a conflicting suite against
the same server, database, or shared output. Run the selected command once and
capture stdout, stderr, exit code, and visible counts. Inspect failure output
and link useful existing artifacts without dumping full logs or secrets.

Do not edit application code, tests, configuration, or lockfiles. Normal output
and fixtures created by the repository's test command are allowed. Do not install
dependencies, manually migrate a database, or build ad hoc fixtures to get the
gate running. Report missing setup to the implementation task. Do not rerun a
failure hoping for a pass; after a fix or concrete environment change, a new
requested verification is a new run. Never skip or weaken failing assertions.

Return a brief summary with the exact command, directory or revision where
material, exit code, visible counts, and the most informative failure lines.
For delegated execution, finish with:

```text
VERDICT: pass | fail | not_run
REASON: one concrete sentence
```

- `pass`: the selected test runner completed successfully. If it reports zero
  selected tests, use `not_run`; an empty run proves no test coverage.
- `fail`: the runner executed and returned nonzero, including a setup failure
  inside the scripted test command. Identify that cause separately from failed
  test assertions.
- `not_run`: the command could not be established or launched, its prerequisites
  are unavailable, no tests were selected, or the requested scope is explicitly
  inapplicable. Name the missing setup or reason; this is not a passing gate.

Do not publish results to the forge, edit tracker state, or message others. Return
the result to the current task or parent agent.
