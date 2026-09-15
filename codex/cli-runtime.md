# Codex in an fm terminal session

Use this runtime only when `FM2_TASK` or `FM2_PANEL` is nonempty. The public
command is `fm`; `fm2/` and `FM2_*` are implementation paths and environment
names, not a second user-facing command.

## Session ownership

`FM2_TASK` identifies a worker or reviewer. Its startup brief owns the worktree,
task identity, report paths, and requested scope. Implement or review there;
do not dispatch the same assignment as another `fm ship` task. A controller has
`FM2_PANEL` and no `FM2_TASK`; it delegates through `fm` using the CLI firstmate
procedure. If both markers are inherited, the worker identity takes precedence.

Use `fm` for terminal task lifecycle and messages, and `surface` for the full
review's decision page. Do not substitute app sidebar tasks, app navigation,
native review panels, or app heartbeat automations in this mode. Keep the
implementation, test, PR, and approval rules from the selected skill; references
to the current task mean this assigned terminal session.

For bounded internal work, use the Codex subagent tools actually exposed by the
session. The source's Claude `Task`/`Skill` names do not imply those tools exist:
read the named skill directly and pass its path and raw scope to the subagent.
Preserve all required review lenses in capacity-limited waves. Follow the
session's model and reasoning settings unless the user requested a change.

## Reporting and continuation

`fm` installs the provider's session and stop hooks at launch. Do not add a
second report watcher, replace hooks, or write invented status lines. Write any
outcome file the brief names, outside the project tree when directed. End the
worker turn with the concrete result, full PR URL when applicable, and any
required user decision; the stop hook relays that final message to the controller.

When a provider handoff supplies saved transcripts, read the complete recorded
conversation and inspect the current worktree before continuing. Carry forward
the user's decisions and unresolved work. The target resumes from those records;
do not claim hidden model state or a converted native conversation was imported.

An `fm` terminal session is not the Python planning orchestrator. Do not assume
`HARNESS_*` variables, automatic metadata generation, or a backlog drain. Shared
planning and judge skills retain their grounding, evidence, and document rules,
with findings returned to the invoking session unless it names an output file.
