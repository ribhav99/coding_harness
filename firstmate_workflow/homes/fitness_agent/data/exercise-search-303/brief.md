You are a crewmate: an autonomous worker agent managed by firstmate. Work on your own; do not wait for a human.

# Task
Implement GitHub issue #303 "exercise search is bad - make it actually good"
(https://github.com/ribhav99/fitness_agent/issues/303).

**Goal.** Users cannot reliably find an exercise they know exists. Make exercise search actually
work.

## What is there today
All under `mobile/FitnessApp/`. I checked before writing this brief: there are **three separate
exercise-search implementations**, all plain substring matching, none ranked.

1. `src/services/exerciseDataService.ts` -> `searchExercises(query)`
   substring on `name` only.
2. `src/services/exerciseDataService.ts` -> `searchAndFilter(query, bodyPart)`
   substring on `name`, plus an exact `body_part` filter. Used by
   `src/features/exercises/screens/ExercisesScreen.tsx` (the exercises tab).
3. `src/components/ExerciseSelectionModal.tsx` -> `filterExercises()`
   its own inline copy: substring on `name` OR `body_part`. **This is the highest-traffic
   surface** - it is the picker used when adding exercises to a workout or template.

All three run over the full 5,733-exercise array from `src/data/exercise_instructions.json` and
return results in source-file order, so there is no ranking of any kind. Each exercise carries
`{name, measurement_type, body_part, primary_muscles, secondary_muscles}`, and `body_part` is one
of 15 values (back, biceps, calves, cardio, chest, core, forearms, full body, glutes, hamstrings,
neck, other, quads, shoulders, triceps).

Read all three before designing anything.

## Scope
**Consolidate onto one search implementation** and use it from every surface, including the
selection modal. Three divergent copies of the same broken logic is a large part of why this is
bad, and leaving the modal on its own copy would mean the most-used search stays unfixed.

What the unified search needs:

- **Ranking.** Best match first - exact, then prefix, then word-boundary, then substring. Right
  now the winner is whatever appears earliest in the data file.
- **Typo and fuzzy tolerance.** "benchpress", "romainian deadlift", "tricep pushdwn" should find
  the right thing.
- **Synonyms and gym slang.** "bench" -> barbell bench press, "rdl" -> romanian deadlift, "ohp" ->
  overhead press, "pulldown" vs "lat pulldown". A small curated map is fine and probably better
  than anything clever; keep it data, not code.
- **Match beyond the name.** Body part, primary/secondary muscles, and equipment where the name
  implies it.
- **Personalisation.** Exercises the user actually logs should outrank ones they have never
  touched. History is available through the repository layer
  (`src/database/repositories/WorkoutRepository.ts`).
- **Fast.** It must feel instant on-device across the full list while typing. Precompute an index
  once rather than re-scanning 5,733 rows per keystroke, and debounce sensibly.

## Acceptance criteria
1. One search implementation, used by the exercises tab and the exercise selection modal. The
   duplicate inline copy in `ExerciseSelectionModal.tsx` is gone.
2. Ranked results, with the ranking rules stated in a comment block so they are reviewable.
3. Typo tolerance, synonyms, and matching on muscles/body part all work and are unit-tested.
4. Recently and frequently logged exercises rank above never-used ones, and this degrades cleanly
   for a brand-new user with no history.
5. Search stays responsive while typing on the full list. Say in the PR how you measured it.
6. Existing behaviour that users rely on does not regress: the body-part filter on the exercises
   tab, and multi-select plus selection ordering in the modal.
7. A table of real queries and their expected top result, as unit tests. **Build this list first
   from queries that currently fail**, and use it as the acceptance bar rather than judging by
   feel. Include the failing cases named in the issue.

## Constraints
- Keep it on-device. No backend calls, no new search service, no network dependency.
- Prefer no new dependency. If a fuzzy-matching library genuinely earns its place, it must be
  small, maintained and RN 0.80 compatible, and justified in the PR.
- Do not change the shape of `exercise_instructions.json`. Deriving an index from it at runtime
  or build time is fine.
- Match existing service and component conventions rather than introducing new architecture.
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

1. First action: create your branch: `git checkout -b fm/exercise-search-303`

# Rules
1. Never push to the default branch (push only your `fm/exercise-search-303` branch). Never merge a PR.
2. Stay inside this worktree; modify nothing outside it.
3. Use plain `gh` for GitHub operations. `gh-axi` and `chrome-devtools-axi` are NOT installed in
   this fleet - do not try to use them, and do not install them.
4. Report status by appending one line:
   `echo "{state}: {one short line}" >> '/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/firstmate_workflow/homes/fitness_agent/state/exercise-search-303.status'`
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
When it is implemented and committed, push your branch and open a PR with `gh` (link issue #303 in the PR body), then append `done: PR {url}` to the status file and stop.
Do NOT run /no-mistakes. The configured merge authority decides whether to merge the PR; firstmate relays the outcome.
