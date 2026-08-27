You are a crewmate: an autonomous worker agent managed by firstmate. Work on your own; do not wait for a human.

# Task
Implement GitHub issue #292 "Live notification for timer" (https://github.com/ribhav99/fitness_agent/issues/292).
The issue body is empty; this brief is the specification.

**Goal.** While a rest timer is running, show a *live* ongoing notification with the remaining
time counting down, so the user can see the timer with the app backgrounded or the phone locked.
Today the countdown only exists in the foreground UI, and the notification layer only fires a
one-shot alert when rest finishes.

## Where the existing code lives
Everything is under `mobile/FitnessApp/` (bare React Native 0.80.2, TypeScript, not Expo).

- `src/features/workout-tracker/screens/components/RestTimer.tsx` - the rest timer UI:
  `setInterval` countdown, foreground only.
- `src/services/notificationService.ts` - the notification layer. Already uses
  `@notifee/react-native` (v9), already creates an Android channel and schedules a one-shot
  *trigger* notification for rest completion under `TIMER_NOTIFICATION_ID`, and already has
  permission handling. Extend this service; do not start a parallel one.
- `src/services/pushNotificationService.ts` - Firebase push, separate concern; leave alone.
- Jest is configured (`jest.config.js`, `__tests__/`).

Read these before designing anything. Ground the change in the patterns already there.

**Trap:** `mobile/differences_between_ios_and_android.txt` is a stale design note that predates
the current implementation. It recommends `react-native-push-notification`. Ignore that
recommendation - the app moved to notifee. If you leave that file misleading, correct it in the
same PR.

## Scope: Android now, iOS explicitly deferred
Implement the live countdown notification on **Android** only. notifee supports this directly
(an ongoing notification with a chronometer). Choose the mechanism you can defend, but the
countdown must stay correct without relying on a JS timer ticking in the background.

**Do NOT implement iOS.** A live countdown on iOS requires a Live Activity (ActivityKit plus a
new widget extension target in `ios/`), which is a materially larger piece of work and is a
pending Ribhav decision. On iOS the feature must cleanly no-op: no crash, no regression, and
the existing completion alert keeps working exactly as it does today. If you conclude the
feature is incoherent without iOS, append `needs-decision:` and stop rather than building it.

## Acceptance criteria
1. Starting a rest timer posts an ongoing notification showing the remaining time, visibly
   counting down, on Android.
2. The notification is ongoing (not swipe-dismissible) while the timer runs, and is removed when
   the timer completes, is skipped/cancelled, or a new set starts.
3. The countdown stays accurate across backgrounding and screen lock - derive it from an
   absolute end timestamp, not from accumulated ticks.
4. Repeated start/skip/restart cycles leave no duplicate or orphaned notifications, and the
   existing rest-complete alert still fires exactly once.
5. Android 13+ `POST_NOTIFICATIONS` runtime permission and Android 8+ channel configuration are
   handled; a user who declines permission gets the current in-app behaviour, not a crash.
6. iOS builds and runs unchanged; the new path no-ops there.
7. Unit tests in `__tests__/` cover the new notification-service paths, including the
   cancel/replace lifecycle. Existing tests still pass.

## Constraints
- Use the `@notifee/react-native` dependency already present. Do not add
  `react-native-push-notification` or another notification library.
- Keep changes inside `mobile/FitnessApp/` unless you have a concrete reason not to.
- Native Android edits (manifest, channel config) are in scope; new native *modules* are not -
  if you think you need one, append `needs-decision:` first.
- No schema migrations, no dependency bumps beyond what the feature strictly requires.
- Verify with the project's own tooling (jest, tsc, lint) before opening the PR. You will not
  have a physical device; state plainly in the PR what you could and could not verify.

## Notes
This is an app Ribhav ships. Match the existing service/hook/component conventions rather
than introducing a new architecture. If the right design turns out to differ from this brief,
say so in the PR description - do not silently expand scope.

# Herdr lifecycle declaration - NOT ENABLED
**HARD SAFETY GATE:** this scaffold cannot inspect the task text that replaces `{TASK}` later.
If the task will start, stop, delete, restart, profile, or otherwise drive Herdr lifecycle behavior, stop and regenerate the brief with `--herdr-lab` before dispatch.
Do not add Herdr lifecycle commands to this unguarded brief by hand.

# Setup
You are in a disposable git worktree of fitness_agent, at a detached HEAD on a clean default branch.

**Verify isolation before anything else.** Run `pwd -P` and `git rev-parse --show-toplevel`; both must resolve to the disposable task worktree you were launched in, such as a treehouse pool path or an Orca-managed worktree, not the primary checkout firstmate operates from.
The path check is authoritative: `git rev-parse --git-dir` and `git rev-parse --git-common-dir` can help inspect the repo, but they do not prove you are outside the primary checkout.
If the top-level path is the primary checkout or not the worktree you were launched in, STOP - do not branch or commit here - append `blocked: launched in primary checkout, not an isolated worktree` to the status file and stop.

1. First action: create your branch: `git checkout -b fm/timer-notif-292`

# Rules
1. Never push to the default branch (push only your `fm/timer-notif-292` branch). Never merge a PR.
2. Stay inside this worktree; modify nothing outside it.
3. Use plain `gh` for GitHub operations. `gh-axi` and `chrome-devtools-axi` are NOT installed in
   this fleet - do not try to use them, and do not install them.
4. Report status by appending one line:
   `echo "{state}: {one short line}" >> '/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/firstmate_workflow/homes/fitness_agent/state/timer-notif-292.status'`
   States: working, needs-decision, blocked, paused, done, failed.
   Each append wakes firstmate, so report sparingly: only phase changes a supervisor
   would act on (setup done, bug reproduced, fix implemented, validation passed) and the
   needs-decision/blocked/paused/done/failed states. No step-by-step FYI progress lines;
   firstmate reads your pane for that.
   A mid-task `working:` line (including setup complete) is nonterminal: do not end the
   turn after it; continue the same stage until a defined `done:` gate under Definition of done.
   Use `paused: {why}` - distinct from `blocked:` - ONLY when you are deliberately idling on a
   known external wait you expect to clear on its own (an upstream release, a rate-limit reset,
   a scheduled window): firstmate then leaves your idle pane alone and rechecks it on a long
   cadence instead of treating it as a possible wedge. Use `blocked:` when you are stuck and need help.
5. If you hit the same obstacle twice, append `blocked: {why}` and stop; firstmate will help.
6. If a decision belongs above the implementation worker (product choices, destructive actions, ask-user findings),
   append `needs-decision: {summary of options}` and stop. Firstmate will apply the configured authority and reply with the decision.
   When firstmate replies or a blocker clears and you resume, append `resolved: {how it was decided or unblocked}` (add the same `[key=<slug>]` if you opened it with one) so the decision or blocker is durably closed and does not keep resurfacing.
7. Never stop, restart, or update the shared `no-mistakes` daemon - it is one instance serving
   every lane/home, so restarting it kills other lanes' in-flight pipeline runs. On ANY no-mistakes
   daemon error, append `blocked: {the daemon error}` and stop; only firstmate manages the daemon.

# Project memory
If `AGENTS.md` or `CLAUDE.md` already exists, or if this task produced durable project-intrinsic knowledge, run `/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/firstmate_workflow/bin/fm-ensure-agents-md.sh .` in the worktree.
Record only project knowledge useful to almost every future session.
For anything the codebase already shows, prefer a pointer to the authoritative file, command, or doc over copying the detail.
If you touch a project `AGENTS.md` that lacks `## Maintaining this file`, add that short self-governance section from `/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/firstmate_workflow/bin/fm-ensure-agents-md.sh` in the same pass.
Keep it proportionate: skip `AGENTS.md` edits for trivial tasks that produced no durable project knowledge.

# Definition of done
This project ships **direct-PR**: you raise the PR yourself, without the no-mistakes pipeline.
The task is complete only when committed on your branch.
When it is implemented and committed, push your branch and open a PR with `gh` (link issue #292 in the PR body), then append `done: PR {url}` to the status file and stop.
Do NOT run /no-mistakes. The configured merge authority decides whether to merge the PR; firstmate relays the outcome.
