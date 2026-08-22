# Backlog

Local, gitignored. Hand-edited (`config/backlog-backend=manual`).
Sections and item shape match the tasks-axi markdown format.

## In flight

- auto-review-flow - Make automatic post-PR full-review a standing part of the
  firstmate task lifecycle
  project: coding_harness | kind: ship | mode: direct-PR | dispatched 2026-08-01
  branch: fm/auto-review-flow
  Encodes the hand-verified behaviour: when a ship task's PR is recorded, launch a
  session in the reviews window, in that task's own worktree, whose only instruction
  is `/full-review this pr`. Must land the mechanics in bin/, the rule in AGENTS.md
  section 7, and a numbered local delta in FORK-NOTES.md, plus teardown safety so a
  worktree with a live review in it is not cleaned up underneath it.

## Queued

<!-- none -->

## Done

<!-- none -->
