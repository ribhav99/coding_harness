# Git Integration

## Capability Summary

Git integration is the orchestrator's thin wrapper around `git` and `gh` CLIs for the operations every loop needs: commit artifact-tree changes, create task branches, open PRs, post PR comments, and detect merged PRs. Concentrating these calls in one component keeps the loop driver and the per-WO drain free of CLI-string concerns; new GitHub features arrive transparently when `gh` updates.

## Core Components

### Local git operations

```component
name: GitIntegration
container: Python Orchestrator
responsibilities:
	- Wraps `git` shell-outs for `git add <paths>`, `git commit -m <message>`, `git status --porcelain`, `git diff --name-only`
	- Owns commit messages: `<loop-name>: attempt <N> passed`, `<loop-name>: attempt <N> — awaiting_clarification`
	- Stages only the loop's artifact paths plus `harness/` (for state files); never `git add -A` or `.`
	- Returns success/failure to the loop driver; on commit failure, logs and surfaces (non-recoverable for the loop run)
	- Detects no-git-repo state and falls back to no-op commit (allows the kit to run against non-git project directories during testing)
```

```component
name: BranchManager
container: Python Orchestrator
responsibilities:
	- Used by the coding loop only
	- Before spawning the per-WO generator, ensures the `task/<wo-slug>` branch exists (creates from main if not, no-op if already exists)
	- Sets `execution.branch = "task/<wo-slug>"` in the per-WO state file via #StateStore from @Blueprint(state-store)
	- Does not push — push is owned by the per-WO generator inside its subprocess
```

The #GitIntegration is invoked once per loop attempt (commit on pass, commit on `awaiting_clarification`) by the upstream loop driver; #BranchManager is invoked once per work-order drain by #CodingLoopDriver.

---

### GitHub CLI operations

```component
name: PROperationLayer
container: Python Orchestrator
responsibilities:
	- Wraps `gh pr list --head task/<wo-slug> --state {open|merged}` for #MergeDetector pre-drain polling and post-exit PR-state population
	- Wraps `gh pr comment <pr-number> --body <body>` for #PRCommentMirror final-summary posting
	- Wraps `gh pr view <pr-number> --json state,mergedAt,url,number` for `execution.pr_*` field population
	- Does not wrap `gh pr create` — PR creation is owned by the per-WO generator's `open-task-pr` skill, run inside its subprocess
	- On `gh` failure (network, auth, rate limit), logs and returns a sentinel; the caller decides whether to abort or continue
```

```component
name: MergeDetector
container: Python Orchestrator
responsibilities:
	- At the start of every `coding-loop` invocation, iterates every `in_progress` work order
	- For each, runs `gh pr list --head task/<wo-slug> --state merged --json number,mergedAt`
	- On a hit, transitions the work order's `.wo-<slug>.meta.yaml.status` from `in_progress` to `done` via #LocalPlanner from @Blueprint(local-planner) and rolls the per-WO state file to its final history entry
	- Never auto-merges; only detects post-facto merges
```

```component
name: PRCommentMirror
container: Python Orchestrator
responsibilities:
	- After the coding-loop per-WO reviewer stack reports all-pass, composes the final pass-summary from the per-WO state file's `verification.*` block and the latest generator summary
	- Posts the summary to the open PR via #PROperationLayer
	- Tracks last-posted-session in the per-WO state's `mirror.last_posted_session`; never double-posts the same summary
	- Failures are logged and non-blocking — the loop continues to the next work order
```

#MergeDetector and #PRCommentMirror are the two coding-loop-specific consumers of the GitHub CLI layer; the upstream loops do not interact with GitHub at all (their commits are local-only).

## System Contracts

### Key Contracts

- **`gh` CLI as the only GitHub channel.** No direct REST/GraphQL calls from the harness. Authentication flows through the operator's `gh auth login`.
- **Local commits before pushes.** The orchestrator commits artifact trees locally; pushes happen only when a per-WO generator pushes its own task branch as part of the `open-task-pr` skill flow.
- **Single commit per loop pass.** Within a loop invocation, attempts do not commit. The orchestrator commits only on `pass` or `awaiting_clarification`. Keeps git history clean.
- **No auto-merge.** The harness never merges a PR. Merge detection is read-only.
- **No-op fallback when not in a git repo.** Allows the kit to run in test environments without requiring a real git initialisation.
- **Failures are non-blocking for non-critical paths.** PR comment post failure logs and continues; merge detection failure logs and treats the WO as still in progress; commit failure aborts the loop.

### Integration Contracts

- **Commit signature.** `git_integration.commit(paths: list[Path], message: str) -> bool`. Stages only the listed paths plus `harness/`; runs `git commit -m <message>`; returns success.
- **Branch creation signature.** `branch_manager.ensure_task_branch(wo_slug: str, base: str = "main") -> str`. Returns the branch name (`task/<wo-slug>`); idempotent.
- **PR list signature.** `pr_ops.list_prs_for_branch(branch: str, state: Literal["open", "merged"]) -> list[PRSummary]`.
- **PR comment signature.** `pr_ops.post_comment(pr_number: int, body: str) -> bool`.
- **Commit message format.** `<loop-name>: attempt <N> passed` on pass; `<loop-name>: attempt <N> — awaiting_clarification` on awaiting; per-WO commits owned by the generator follow its own convention.

## Architecture Decision Records

### ADR-001: `gh` CLI rather than direct REST

**Context.** Direct API calls would give finer control. But every API call comes with auth flow maintenance, version-bump risk, and another dependency.

**Decision.** All GitHub interactions go through `gh` CLI. The harness never imports `octokit`, `pygithub`, or similar SDKs.

**Consequences.** New `gh` features inherit for free. Operators' existing `gh` setup works without harness-specific configuration. Trade-off: surface limited to what `gh` exposes.

### ADR-002: Single commit per loop pass

**Context.** The orchestrator could commit per-attempt to make multi-attempt convergence visible in git log. But that produces N commits for N attempts of a single loop run, polluting history with intermediate state.

**Decision.** Commits happen only on `pass` or `awaiting_clarification`. Within an invocation, attempts do not commit; files remain as working-tree changes; the next attempt's generator sees them. Per-WO execution is an exception (PR-flow commits as part of generator's internal flow).

**Consequences.** Git history reads as one commit per loop run. Mid-run state inspection works via `git diff` rather than `git log`. Trade-off: a long multi-attempt run has no per-attempt commit milestones; mitigated by per-attempt state-file updates.

### ADR-003: PR comment is one-shot summary

**Context.** Per-attempt PR comments would give a running view of the per-WO loop's progress on the PR. But that pollutes the comment thread with intermediate retries.

**Decision.** One PR comment per work order: the final pass-summary. No intermediate comments. In-progress visibility lives in `harness/state/<wo-slug>.json` and `harness/state/reviews/coding-loop/<wo-slug>/`.

**Consequences.** PR comment thread stays signal-rich. Operator reviewing the PR sees one orchestrator-posted summary plus their own merge action. Trade-off: in-progress visibility is local-only; acceptable for the single-operator persona.
