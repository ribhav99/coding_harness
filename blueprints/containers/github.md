# GitHub

## Container Summary

GitHub is the external system the harness uses to surface coding-loop output to the operator: pull requests, PR comments, and merge events. The @Blueprint(python-orchestrator) and the per-work-order coding-loop generator interact with GitHub exclusively through the `gh` CLI; there are no direct REST or GraphQL calls from the harness. Push and PR open are write operations from the harness; merge is operator-driven.

## Infrastructure

GitHub is a managed external service. The harness reaches it via the `gh` CLI, authenticated against the operator's GitHub account. The project repo's git remote is the GitHub repository for the project; pushes from the harness target `task/<wo-slug>` branches on that remote.

Key platform dependencies:
- The `gh` CLI installed and authenticated locally.
- A GitHub repository hosting the project's code (project repos that are not GitHub-hosted are not in scope).
- Network access to `github.com` (or the configured GitHub Enterprise instance).

Deployment model: nothing to deploy on the harness side. The operator configures `gh auth login` once. Each subprocess that talks to GitHub does so through the same CLI.

## Entry Points and Boundaries

GitHub interactions are confined to the coding loop and the harness's optional outbound mirroring. There are four entry-point classes:

- **Push** — the per-work-order coding-loop generator (`coding-generator`) pushes its `task/<wo-slug>` branch via `git push`. The orchestrator does not push directly; only the per-WO generator does, as part of its internal flow.
- **PR open** — the per-work-order coding-loop generator opens the PR on its first internal pass via the `open-task-pr` skill, which wraps `gh pr create`. Idempotent; safe to call again if the PR exists.
- **PR comment post** — the orchestrator posts the final pass-summary as a PR comment via `gh pr comment` after the per-WO reviewer stack reports all-pass. Owned by #PRCommentMirror inside @Blueprint(python-orchestrator).
- **Merge detection** — the orchestrator polls merged-PR state at the start of each `coding-loop` invocation by running `gh pr list --head task/<wo-slug> --state merged`. Owned by #MergeDetector inside @Blueprint(python-orchestrator).

Optional outbound mirrors (Software Factory, GitHub Projects) push status and comments to GitHub Projects or other platforms; this is a separate flow described in @Blueprint(mirror-adapter). The harness never reads from mirrors.

## System Contracts

### Key Contracts

- **Operator-driven merge.** The harness never auto-merges. The operator reviews the PR (with the orchestrator-posted summary comment for context) and merges via GitHub's UI or `gh pr merge` themselves.
- **One PR per work order.** Branch name `task/<wo-slug>` is the link key. The orchestrator and the per-WO generator both use this convention.
- **Idempotent PR open.** `open-task-pr` is safe to call multiple times; if a PR already exists for the branch it is a no-op. Required because the per-WO generator may run multiple internal attempts before its first orchestrator-visible exit.
- **PR comment is the operator-facing summary.** The orchestrator posts exactly one summary comment per pass, after all required gates have passed. The PR page is the operator's single review surface for a work order.
- **`gh` CLI as the integration layer.** No direct REST/GraphQL calls from the harness. New `gh` features (e.g. better rate-limit handling, new flags) are inherited automatically.
- **Failures are non-blocking for non-critical paths.** A failed PR comment post is logged and the loop continues; a failed `gh pr list` during merge detection logs and treats the work order as still in progress (next invocation re-checks).

### Integration Contracts

- **PR creation.** `gh pr create --head task/<wo-slug> --base <main-branch> --title "<work-order-title>" --body "<body>"`. Body shape is owned by the `open-task-pr` skill.
- **PR comment.** `gh pr comment <pr-number> --body "<final-summary>"`. The body is the per-WO pass-summary the orchestrator composes from the verification block.
- **PR list and view.** `gh pr list --head task/<wo-slug> --state {open|merged}` and `gh pr view <pr-number> --json state,mergedAt`. Used to populate `execution.pr_*` fields in the per-WO state file.
- **Merge detection.** Pre-drain polling: any `in_progress` work order whose `task/<wo-slug>` branch shows a merged PR transitions to `done` and its state file rolls.
- **Authentication.** Inherited from the operator's `gh auth login` token. The harness never handles credentials directly.

### Integration Boundaries

- **GitHub vs orchestrator.** The orchestrator owns PR comment posting and merge detection (read-only PR queries). The orchestrator does not own PR creation — that is the per-WO generator's job, run inside its subprocess.
- **GitHub vs per-work-order generator.** The per-WO generator owns commit + push + PR open. It runs inside a Claude Code subprocess with `gh` and `git` available via Bash tool calls.
- **GitHub vs project-repo.** The git remote is the project's GitHub repo. Local commits are pushed to `task/<wo-slug>` branches. The local working tree never reads back from the remote during a loop run; merge detection is the only read.
- **GitHub vs operator.** The operator reviews PRs, reads comments, and merges. They do not invoke `gh` against the harness's branches directly during normal flow (though they can; the harness has no exclusive lock on its branches).

## Architecture Decision Records

### ADR-001: `gh` CLI rather than direct REST/GraphQL

**Context.** Direct API calls would give finer control (custom mutations, batched queries, graceful rate-limit retries via SDK). But every API call comes with a maintained-by-us auth flow, version-bump risk, and another dependency.

**Decision.** All GitHub interactions go through `gh` CLI. The harness never imports `octokit`, `pygithub`, or similar SDKs. Authentication flows through `gh auth login`.

**Consequences.** New `gh` features (rate-limit handling improvements, new flags, better error messages) flow in for free. The operator's existing `gh` setup works without harness-specific configuration. Trade-off: surfaces are limited by what `gh` exposes; uncommon operations (e.g. cross-repo issue linking) are not available without falling back to direct API calls.

### ADR-002: PR comment is one-shot summary, not running log

**Context.** The orchestrator could post a comment on every attempt, every retry, every reviewer fail. That would give the operator a running view inside the PR but pollute the comment thread with every micro-event during multi-attempt convergence.

**Decision.** One PR comment per work order: the final pass-summary, posted only when all required gates have passed. The orchestrator never posts intermediate attempt updates to the PR.

**Consequences.** The PR comment thread stays signal-rich; the operator does not have to filter through retries to find the final state. Trade-off: in-progress visibility lives in `harness/state/<wo-slug>.json` and the snapshotted reviewer files, not on GitHub.

### ADR-003: Operator merges; harness never auto-merges

**Context.** Auto-merge on all-gates-pass would close the loop entirely autonomously. But the harness's safety posture is to keep the operator as the last line of defence before shipping.

**Decision.** Merge is always operator-driven. The harness pushes the diff to a state where all gates pass, posts the summary, then stops. Merge happens on GitHub; the orchestrator only detects it post-facto.

**Consequences.** The operator decides when to ship and what to bundle. Wrong-turn diffs do not auto-merge. Merge detection at the start of each `coding-loop` invocation is the bridge from operator action back into harness state. Trade-off: the operator must merge manually; acceptable for the single-operator persona.
