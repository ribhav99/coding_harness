# Full review in an fm Codex terminal worker

Read [the CLI runtime](cli-runtime.md), then the full
[shared review procedure](source.md). Keep its six judge lenses, independent
review, verification, PRD checks, per-finding decisions, and `surface` JSON
format. The following adapts invocation to Codex and the current fm task.

- Use available Codex subagent tools for the judges, with fresh context and the
  raw repository scope. Read each installed judge skill directly; the source's
  Claude `Task` and `Skill` tool names are not literal requirements. Run all six
  lenses in available-capacity waves. Inherit the configured model and effort.
- Establish the actual head, base, local-change scope, and user authorization.
  A formal work order is optional when the request and documented behavior
  define the change. Missing test evidence is unknown; a stale passing log
  cannot prove the current tree. Unchanged tests may prove a criterion when
  their coverage and current results do so.
- Use the spec and report paths from the worker brief. Keep review scaffolding
  out of the project worktree. Open the completed review with `surface open
  <spec>`, then stop the turn. Read submitted decisions with `surface read
  <spec>` when the surface wakes the worker. Do not poll, and do not replace the
  page with the app's review panel or sidebar task tools.
- Honor authorization already given. User-approved fixes belong on the PR's
  own branch when publication is authorized; preserve its history and use
  ordinary pushes. Code-fix permission and review-verdict permission are
  separate. Publish only the chosen findings, wording, and review event.
- Keep mechanical cleanup and behavior fixes reviewable without manufacturing
  empty commits. Never apply unrelated edits, blindly stage the whole tree, or
  force-push merely to satisfy a source example.
- Write the outcome where the brief requires and finish with the result, PR URL,
  and outstanding decisions. Let the controller handle authorized announcements
  and task closure after verifying remote state.
