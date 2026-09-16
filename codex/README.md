# Codex skill setup

The same installed skills support the Codex app and the `fm` terminal panel.
With no `FM2_TASK` or `FM2_PANEL` marker, the app holds tasks, messages, reviews,
and progress through its native tools. A marked terminal session uses `fm` for
its controller and workers and `surface` for review decisions. Neither mode
assumes the Python planning orchestrator is running.

Install from this checkout with Node.js:

```sh
node codex/install.mjs
node codex/install.mjs --check
node --test codex/install.test.mjs
```

The installer links whole skill folders into `~/.agents/skills`. Each has a real
`SKILL.md`; shared rubrics remain linked to `skills/`. Empty imported folders are
repaired. A legacy directory containing only a link to this checkout's shared
`SKILL.md` source is migrated to the native folder. Conflicting custom content
stops the install before any changes. Other skills, Claude configuration,
credentials, permissions, and models are untouched.
Use `--skills-dir /path/to/skills` for an isolated installation. Codex launches
through `fm` use this same installer; they do not overwrite files through folder
links. Claude launches retain their existing shared-skill installation.

Keep this checkout at its installed path and rerun the installer after adding,
removing, or renaming a skill. `--check` fails for missing entries, broken rubric
links, or shared skills lacking a Codex entrypoint. Existing rubric edits appear
immediately through the links. After a setup change, start a new app task if its
skill list has not refreshed.

Automatic Claude import can replace native instructions and reintroduce the
tmux hooks. Once adopting this workflow, turn off automatic updates in the app's
Import settings. Manual imports remain available; review them before accepting
replacement instructions. The installer does not change the app setting.

Examples:

- “Implement WO-354 here.” Work continues in the current task, using subagents
  where useful.
- “Create a new PackPilot task to implement WO-354.” The app creates a task the
  user can open and continue directly.
- “Use full-review on this PR.” Independent judges review it, then the task
  presents findings in the app for decisions.
- “Tell the pricing task to use the revised rounding rule.” The follow-up goes
  to the existing task.
- “Keep watching that task and tell me when it needs me.” A native heartbeat
  continues monitoring after the coordinating turn ends.

In a terminal controller, “switch this whole session to Codex” routes to
`fm panel-switch --agent codex`; `--agent claude` switches back. The command
hands off saved conversations and existing task worktrees in the background.
It does not convert hidden model state or require manually importing chats.

`firstmate` and `full-review` have separate app and CLI procedures. The other
entrypoints retain the same implementation, evidence, and document rules while
[runtime.md](runtime.md) and [cli-runtime.md](cli-runtime.md) select the session's
tools and reporting mechanism. Merely opening a terminal does not change modes.
