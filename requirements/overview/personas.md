# Personas

The harness serves one persona: the **single operator** running Claude Code on their own projects. Technical enough to diagnose a failed autonomous run and fix it — edit a prompt, tweak a skill, adjust config — but not interested in building a team-scale product or shipping the harness to others as-is. Comfortable with the command line, git, and reading JSON state files. Values wall-clock throughput over process rigor.

Product decisions follow from this persona. Polish is scoped to what one operator needs for long-term reuse on their own projects. There is no second persona to accommodate — no team lead, no reviewer, no downstream consumer. The operator authors the PRD, supervises bubble-ups, reviews and merges PRs, and maintains the harness itself.
