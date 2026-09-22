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

## Convert this panel to the other provider

When the user asks to move this whole terminal session between providers, that
is `fm reload`. It replaces each session in the pane it already occupies,
carrying that session's own conversation, and creates no window, split, or panel.

```sh
fm reload --agent claude                     every worker and reviewer, in place
fm reload --agent claude --controller-only     ... and then this pane, last
```

Run the workers first and the controller last, because the controller reload
replaces the session issuing it. Name the agent every time; a defaulted agent
once converted a whole panel back to the provider it started on. Add `--fresh`
when a session's exact identity is not recorded — after an interrupted switch, or
a panel closed out from under its sessions — and it starts from the conversation
preserved on disk rather than handing the running one over.

`fm panel-switch` is a different operation: it BUILDS A SECOND PANEL and leaves
the original for recovery. That is right when a switch might fail and wrong when
the panel is the one the user is looking at — it opens another set of iTerm2
windows, and closing those kills the sessions just moved into them. Use it only
when a separate panel is what was asked for.

Do not manually relaunch the controller, run `/import`, or recreate splits to
imitate either command. For a request affecting only one worker, use
`fm switch <id> --agent <provider>`.

## Dynamic effort

Managed sessions start at `high`. When work becomes materially harder or
easier, choose the lowest sufficient level, run `fm effort <level>`, and end the
turn immediately. The Stop hook restarts the exact session and continues it;
this intermediate stop is not task completion. Claude accepts
`low|medium|high|xhigh|max`; Codex additionally accepts `ultra`. Never change the
model during this transition.

**Run `./install --check` on a new machine first, and fix what it reports.** Two
things decide whether a Codex session can work at all, and both fail as a session
that looks alive and does nothing. The CLI and its helper binaries have to be on
PATH — `codex` resolves them next to itself, and without `codex-code-mode-host` a
session has no shell and will try to finish its task through a document viewer.
Codex trust is handled for you: the repository has to be trusted before its
hooks will load at all, and an untrusted worker runs, stops, and silently never
reports — so every Codex launch records that grant for the repository root
first, which covers every worktree beside it. `codex/README.md` has the detail.

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
