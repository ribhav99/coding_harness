# Captain preferences

Local, gitignored. Printed in the session-start digest.
Inspect and rewrite entries in place — do not append forever.

## Working style

- The captain drives task selection. Do not self-initiate surveys, audits, or
  "while I was in there" work. Wait to be told. (2026-08-01)
- The captain reads work directly in the agent's own pane rather than asking for
  a relayed summary. Treat direct intervention in a pane as authoritative and
  reconcile it at the next supervision pass. (2026-08-01)

## Branching (fitness_agent)

- **Always branch off the CURRENT RELEASE BRANCH, never master.** As of
  2026-08-02 that is `release/2.2.0`. Resolve the current one at dispatch time
  (`git branch -r --list 'origin/release/*'`) rather than hardcoding a version —
  it moves. Task worktrees and their PRs both use it. (2026-08-02)
- `master` only ever receives the release branch itself, via a release PR
  (#270 Release/2.1.4, #256 Release/2.1.3, ...). A feature PR must never target
  master. PR #297 (`release/2.2.0 -> master`) is the open release PR and is
  correct as-is. (2026-08-02)
- This was got wrong once: four task branches were cut from master tip and their
  PRs opened against master. Retargeted 2026-08-02. (2026-08-02)

## Fleet layout

- This home is nested inside the `coding_harness` repo, not a standalone clone.
  Several upstream guards assume the home is the git top level; the local fixes
  are listed in `FORK-NOTES.md`. Suspect that assumption first when a guard
  behaves oddly. (2026-08-01)
- Tasks land as tiled panes inside a named tab, not as separate tmux windows.
  Ship work goes to `workers`, review and scout work to `reviews`. (2026-08-01)

- Every crewmate and scout launches as `claude --dangerously-skip-permissions
  --effort max`. This is a standing captain instruction, enforced mechanically by
  `config/crew-harness` and `config/crew-effort` in each home, not by memory.
  AGENTS.md section 4's generic "never max without explicit captain preference"
  fallback is superseded by this. Do not lower it per task without being asked.
  (2026-08-01)

## Delivery

- Projects run in `direct-PR` mode. The captain's own reviewer fleet in
  `../skills/coding/` is the quality gate — `no-mistakes` is deliberately not
  installed and must not be reintroduced as a second pipeline. (2026-08-01)
- Never merge without the captain's explicit word. `yolo` stays off. (2026-08-01)

## Tooling

- The AXI suite is deliberately absent except where explicitly reintroduced.
  `bin/fm-pr-merge.sh` and `bin/fm-teardown.sh` use plain `gh`. Do not propose
  installing `quota-axi` or `chrome-devtools-axi`. (2026-08-01)
- `tasks-axi` IS installed (0.2.4). It backs durable captain decision holds
  (`bin/fm-decision-hold.sh`), which scout teardown verifies. The backlog itself
  stays hand-edited via `config/backlog-backend=manual`. (2026-08-01)
- Finishing a scout is a two-step gate, by design: write `data/<id>/report.md`,
  then attest the decision inventory with
  `bin/fm-decision-hold.sh complete <id> --none` (or list real decision keys).
  Teardown refuses until both hold. That refusal is the gate working — never
  reach for `--force` to get past it. (2026-08-01)
- `lavish-axi` IS used, but only by the captain's `full-review` skill, and only
  via the `lavish` shell function (node 22). It is not a firstmate
  dependency. (2026-08-01)
- Projects may be SYMLINKS under `projects/` pointing at a checkout the captain
  already had on disk, rather than firstmate-owned clones. `fitness_agent` is one.
  Never re-clone a project that is already symlinked, and never treat a
  `FLEET_SYNC: STUCK:` line for such a project as a problem to fix - the captain
  works on their own branch there and that is expected. (2026-08-01)
- Worktrees are plain `git worktree` siblings of the project checkout, named
  `<project>-fm-<id>`. No pool, no leases, no warm state, no setup hooks —
  cold starts are accepted. Do not propose treehouse. (2026-08-01)
