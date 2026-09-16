# Firstmate in the fm terminal panel

Use this procedure only with a nonempty `FM2_PANEL` or `FM2_TASK`. The native
Codex app procedure is a separate mode; do not create sidebar tasks to replace
the terminal sessions the user is managing here.

If `FM2_TASK` begins with `controller:`, you are the controller; that ID remains
stable across panel switches. The controller rules also apply with `FM2_PANEL`
and no `FM2_TASK`. Any other nonempty `FM2_TASK` makes you the named worker or
reviewer even when `FM2_PANEL` is inherited. Follow that task's brief and report
to its controller.

## Delegate and follow work

The controller is the user's point of contact. Put project work on a worker and
supervise it through `fm`. Start every report wake with `fm read`; use `fm status`
when the user asks what is happening. A worker stop supplies its report, so do
not build a poller or ask workers for updates by sending them prompts.

| Need | Command |
| --- | --- |
| Implement a new assignment | `fm ship <id> --spec <text|@file> --project <dir>` |
| Investigate without shipping | `fm ship <id> --spec <text|@file> --project <dir> --investigate` |
| Review a PR in a fresh session | `fm review <pr> --project <dir>` |
| Continue an existing worktree | `fm attach <worktree>`; use `--resume` for its recorded conversation |
| Pass the user's instruction | `fm tell <id> <message>` |
| Hand completed implementation to review | `fm handoff <id>`; follow its stage options for a cold review |
| User takes over a worker | `fm quiet <id>`; `--off` restores reporting |
| Close completed work | `fm close <id>` |

Use `--agent codex` or `--agent claude` when the user chooses the worker's
provider. Otherwise workers inherit the current panel's provider; outside a
panel, the default remains Claude.
Use `fm caps` to establish optional forge, tracker, and Slack capabilities.
Preserve existing task identity and worktrees instead of creating duplicates.

Send worker messages for the user's instruction, an authorized handoff, or the
user's answer to a worker's question. Do not supply an answer on the user's
behalf. Carry forward decisions already made instead of asking again.

## Switch the whole panel

When the user asks to move this whole terminal session between providers, use:

```sh
fm panel-switch --agent codex
fm panel-switch --agent claude
```

This starts a background handoff of the controller and its saved worker/reviewer
sessions. The handoff preserves saved transcripts, worktrees, task state, and
window splits, and quiesces the old provider before its replacement continues.
Follow the command's returned handoff status; verify completion before reporting
that the panel has switched. Do not manually relaunch the controller, run
`/import`, recreate splits, or switch workers one by one to imitate this command.
For a request affecting only one worker, use `fm switch <id> --agent <provider>`.

**Run `./install --check` before the first switch on a machine, and fix what it
reports.** Three things decide whether a Codex session can work at all, and each
one fails as a session that looks alive and does nothing: the CLI and its helper
binaries have to be on PATH (`codex` resolves them next to itself, and without
`codex-code-mode-host` a session has no shell); the repository has to be trusted
by Codex, which is what lets the reporting hooks load at all; and the first
session with a changed hook set asks once — take *Trust all*, never *continue
without trusting*, which yields a worker that runs, stops, and silently never
reports. `codex/README.md` has the detail and the approval-policy choice.

Saved transcripts provide recorded context, not hidden state or native chat
conversion. Do not claim an unwritten interrupted response was transferred.

## Review and completion

Keep judge depth intact. A finished implementation can review itself, then a
fresh reviewer session provides the cold review. Use the full-review CLI
procedure for the `surface` page; findings and user decisions belong there.
Do not reproduce the findings in the controller chat. Report the outcome and
name the task holding the details in two or three lines.

Honor the user's specific posting and fixing decisions. Verify pushes, reviews,
and merges on the forge before announcing success. Use `fm announce` only when
an external announcement is authorized. If a merge and tracker completion are
part of the requested workflow, complete and verify both, then close the task.
Keep reviews open while changes or decisions are outstanding. Do not force a
close that reports uncommitted or unpublished work without explicit permission.
