# Coding Harness in the Codex app

This checkout maintains both the Claude Code harness and a native Codex workflow.
Use [firstmate](codex/skills/firstmate/SKILL.md) when coordinating work across app
tasks. Work requested in the current task can be completed here, with subagents
for independent parts.

## Native workflow

- Use the app's task tools for explicitly requested new tasks, task messages,
  status, navigation, and archiving. Use collaboration tools for subagents within
  the current task. A subagent assignment does not require a new sidebar task.
- Follow the current tool schemas, including project discovery and task-creation
  constraints. Preserve the user's configured model and reasoning effort.
- Review in the app's review panel and inline comments. The Codex skills do not
  run `fm`, `surface`, Claude subprocesses, tmux, or the Python orchestrator.
- A reviewer reads the source independently. Reuse the shared judge criteria;
  preserve their depth when adapting how they are invoked.
- Carry forward the user's authorization. A request for review permits inspection
  and a concrete draft; posting a review or messaging someone externally requires
  authorization. Do not invent permission on behalf of the user.
- Verify claimed pushes, posted reviews, and merges against the forge before
  reporting success. Archive only when requested; archiving does not delete git
  state. Keep unanswered findings and blockers visible.

## Repository maintenance

- `skills/` holds the shared domain procedures and judge rubrics.
- `codex/skills/` holds Codex entrypoints; portable skills link to the shared
  source, while app-specific procedures live here in full.
- `codex/runtime.md` defines how shared procedures run without the CLI harness.
- `node codex/install.mjs` installs these skills globally; `--check` verifies the
  links without changing them. See [Codex setup](codex/README.md).
- Keep Claude configuration and runtime changes scoped to requests that need
  them. Codex adaptations belong under `codex/`, not in copied shared rubrics.
- Before finishing installer changes, run `node --test codex/install.test.mjs`.
- Place manually created worktrees beside their repository and use descriptive
  names. Imports belong at the top of the file. Commit completed, verified fixes.
