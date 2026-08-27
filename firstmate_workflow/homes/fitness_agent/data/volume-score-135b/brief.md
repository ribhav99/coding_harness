You are a crewmate: an autonomous worker agent managed by firstmate. Work on your own; do not wait for a human.

# Task
Implement GitHub issue #135 (https://github.com/ribhav99/fitness_agent/issues/135):

> in profile view, create cool charts. one for weekly volume per body part over time. It must be
> smart in some way since volume for different exercises are not equal. So create a clever volume
> score

The issue body is empty; the title above is the whole ask, and this brief is the specification.

**This is a fresh start.** An earlier attempt shipped as PR #305 and Ribhav closed it
unmerged. Do not look at that branch, do not resurrect its commits, and do not treat it as a
starting point - you are solving the problem from scratch. If you happen across it, ignore it.

**Goal.** Add charting to the profile view, centred on *weekly training volume per body part over
time*, driven by a normalised "volume score" that makes different exercises comparable. Raw
sets x reps x weight is explicitly not good enough - that is the point of the issue.

## Where the existing code lives
Everything is under `mobile/FitnessApp/` (bare React Native 0.80.2, TypeScript, not Expo).

- `src/screens/ProfileScreen.tsx` (~1100 lines) - the profile view this lands in.
  `src/navigation/ProfileStackNavigator.tsx` and `src/components/UserProfile.tsx` are adjacent.
- `src/screens/StatsScreen.tsx` - a 64-line near-stub with no charts today. Decide deliberately
  whether the charts belong here behind a profile entry point or inline in ProfileScreen, and
  justify the choice in the PR. The issue says profile view; do not silently relocate the feature.
- `src/database/repositories/WorkoutRepository.ts` (and `BaseRepository`, `ExerciseRepository`) -
  workout history. `src/database/types.ts` and `src/database/migrations/` define the schema.
- `src/data/exercise_instructions.json` - 5,733 exercises, each with
  `{name, measurement_type, body_part, primary_muscles, secondary_muscles}`.
  `measurement_type` is `reps` (5023), `time` (694) or `distance` (16).
  `body_part` is one of 15 values: back, biceps, calves, cardio, chest, core, forearms,
  full body, glutes, hamstrings, neck, other, quads, shoulders, triceps.
  `src/services/exerciseDataService.ts` reads this.
- Charting: **no chart library is installed**, but `react-native-svg` ^15.14.0 is already a
  dependency. Prefer building on it. If you add a chart library instead, it must be maintained,
  RN 0.80 / New Architecture compatible, and justified in the PR.
- `src/theme/` - charts must work in both themes. Jest is configured (`jest.config.js`, `__tests__/`).

Read these before designing anything.

## The volume score
This is the substance of the issue, and the design is yours to make - but it must be defensible:

- Deterministic and pure: same history in, same numbers out.
- Explainable to a user in one sentence, and that explanation must appear somewhere in the UI.
- Handles all three `measurement_type` values, plus bodyweight and unweighted exercises, without
  producing `NaN`, `Infinity`, or silently dropping the set.
- Attributes work to body parts using the existing metadata, with `secondary_muscles`
  contributing less than `primary_muscles`. Decide and document a policy for the awkward
  buckets - `cardio`, `full body`, `other` - and for exercises missing metadata entirely.
- Documented in code (a comment block stating the formula and why) and in the PR description.

Do not over-engineer this into a model or a service call. It is a scoring function over data the
app already has.

## Acceptance criteria
1. The profile view shows a weekly volume-per-body-part chart over time. Body parts are visually
   distinguishable, the time range is selectable or scrollable, and the chart is legible on a
   phone-width screen.
2. The volume score lives in its own pure module with unit tests covering: weighted reps,
   bodyweight/unweighted, `time` and `distance` exercises, secondary-muscle attribution, and
   missing/unknown exercise metadata.
3. Sensible empty and thin-data states: a user with no history, and a user with exactly one
   workout or one data point, both render without crashing.
4. Reads existing workout history through the repository layer. **No schema migration** - if you
   become convinced one is required, append `needs-decision:` and stop before writing it.
5. Performance is acceptable on a long history: no recomputation of the full history on every
   render. Say in the PR what history size you exercised it against.
6. Renders correctly in both light and dark theme.
7. Jest tests pass, including a render smoke test for the chart component. Existing tests still pass.

## Scope discipline
The issue says "charts" plural but names exactly one. Deliver the weekly volume-per-body-part
chart properly, plus at most one complementary chart if it genuinely earns its place. Anything
beyond that - a stats redesign, new navigation surfaces, new data collection - is out of scope:
append `needs-decision:` rather than building it.

## Constraints
- Keep changes inside `mobile/FitnessApp/` unless you have a concrete reason not to.
- Match existing component, hook and repository conventions rather than introducing a new
  architecture.
- No backend changes.
- Verify with the project's own tooling (jest, tsc, lint) before opening the PR. You will not have
  a physical device; state plainly in the PR what you could and could not verify.

# Herdr lifecycle declaration - NOT ENABLED
**HARD SAFETY GATE:** this scaffold cannot inspect the task text that replaces `{TASK}` later.
If the task will start, stop, delete, restart, profile, or otherwise drive Herdr lifecycle behavior, stop and regenerate the brief with `--herdr-lab` before dispatch.
Do not add Herdr lifecycle commands to this unguarded brief by hand.

# Setup
You are in a disposable git worktree of fitness_agent, at a detached HEAD on a clean default branch.

**Verify isolation before anything else.** Run `pwd -P` and `git rev-parse --show-toplevel`; both must resolve to the disposable task worktree you were launched in, such as a treehouse pool path or an Orca-managed worktree, not the primary checkout firstmate operates from.
The path check is authoritative: `git rev-parse --git-dir` and `git rev-parse --git-common-dir` can help inspect the repo, but they do not prove you are outside the primary checkout.
If the top-level path is the primary checkout or not the worktree you were launched in, STOP - do not branch or commit here - append `blocked: launched in primary checkout, not an isolated worktree` to the status file and stop.

1. First action: create your branch: `git checkout -b fm/volume-score-135b`

# Rules
1. Never push to the default branch (push only your `fm/volume-score-135b` branch). Never merge a PR.
2. Stay inside this worktree; modify nothing outside it.
3. Use plain `gh` for GitHub operations. `gh-axi` and `chrome-devtools-axi` are NOT installed in
   this fleet - do not try to use them, and do not install them.
4. Report status by appending one line:
   `echo "{state}: {one short line}" >> '/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/firstmate_workflow/homes/fitness_agent/state/volume-score-135b.status'`
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
When it is implemented and committed, push your branch and open a PR with `gh` (link issue #135 in the PR body), then append `done: PR {url}` to the status file and stop.
Do NOT run /no-mistakes. The configured merge authority decides whether to merge the PR; firstmate relays the outcome.
