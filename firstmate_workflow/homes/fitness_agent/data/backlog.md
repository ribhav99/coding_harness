# Backlog

Local, gitignored. Hand-edited (`config/backlog-backend=manual`).
Sections and item shape match the tasks-axi markdown format: `## In flight`,
`## Queued`, `## Done`. Item continuation lines use two leading spaces.

## In flight

- timer-notif-292 - Live ongoing rest-timer notification (Android), issue #292
  project: fitness_agent | kind: ship | mode: direct-PR | dispatched 2026-08-01
  branch: fm/timer-notif-292
  Brief scoped this Android-only with iOS deferred. Ribhav overrode that directly
  in the worker's pane on 2026-08-01: iOS is now primary - ActivityKit Live Activity
  plus a new widget-extension target (worker edits the Xcode project file), with the
  Android chronometer secondary. That decision is settled; do not re-raise it.

- volume-score-135 - Profile-view weekly volume-per-body-part charts + normalized
  volume score, issue #135
  project: fitness_agent | kind: ship | mode: direct-PR | dispatched 2026-08-01
  branch: fm/volume-score-135
  Scoring formula is the worker's design call; scope capped at the weekly
  body-part chart plus at most one complementary chart.

- delete-workout-301 - Delete a logged workout from the workout log, issue #301
  project: fitness_agent | kind: ship | mode: direct-PR | dispatched 2026-08-01
  branch: fm/delete-workout-301
  Full-stack: the server has no delete route for completed workouts, so the task
  adds one alongside the mobile UI and sync wiring. Soft vs hard delete is the
  worker's call, with every history read path required to honour it.

- exercise-search-303 - Rebuild exercise search, issue #303
  project: fitness_agent | kind: ship | mode: direct-PR | dispatched 2026-08-01
  branch: fm/exercise-search-303
  Three duplicate substring-search implementations exist today; the task
  consolidates them onto one ranked search, including the high-traffic exercise
  selection modal.

## Queued

<!-- none -->

## Done

<!-- none -->
