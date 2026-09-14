# Codex app setup

The app holds the tasks, messages, review discussion, and progress. These skills
reuse the harness's domain procedures and judge rubrics without launching `fm`,
tmux, `surface`, or the Python orchestrator.

Install from this checkout with Node.js:

```sh
node codex/install.mjs
node codex/install.mjs --check
node --test codex/install.test.mjs
```

The installer links whole skill folders into `~/.agents/skills`. Each has a real
`SKILL.md`; shared rubrics remain linked to `skills/`. Empty imported folders are
repaired. Conflicting custom content stops the install before any changes. Other
skills, Claude configuration, credentials, permissions, and models are untouched.
Use `--skills-dir /path/to/skills` for an isolated installation.

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

The five coding workflow overrides and `firstmate` are native procedures. The
remaining entrypoints load [runtime.md](runtime.md) and their shared source so
review depth and document conventions have one maintained home.
