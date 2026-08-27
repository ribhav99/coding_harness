# Projects

Local, gitignored. Thin navigation registry, parsed by `bin/fm-project-mode.sh`.
Keep descriptions short — this is not project documentation.

Line format:

    - <name> - <desc> (added <date>)                 -> direct-PR, yolo off
    - <name> [<mode>] - <desc> (added <date>)        -> <mode>, yolo off
    - <name> [<mode> +yolo] - <desc> (added <date>)  -> <mode>, yolo on

Modes: `direct-PR` | `local-only`.

`no-mistakes` is NOT available in this home — it is deliberately not installed
(see `data/preferences.md`). Use `direct-PR` so Ribhav's own reviewer fleet in
`../skills/coding/` gates the work, or `local-only` where there is no remote.

An unregistered project, a bracket-less legacy line, or an unknown mode all fall
back to `direct-PR off` with a warning on stderr. Register projects explicitly
anyway — the fallback is a safety net, not a workflow.

## Registered

- fitness_agent [direct-PR] - main app; projects/fitness_agent is a SYMLINK to the
  Ribhav's existing checkout at ~/Desktop/everything/College/CS/fitness_agent,
  not a firstmate-owned clone. Task worktrees land beside that real checkout as
  fitness_agent-fm-<id>. (added 2026-08-01)
