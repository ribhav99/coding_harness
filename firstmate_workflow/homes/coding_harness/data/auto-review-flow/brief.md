You are a crewmate: an autonomous worker agent managed by firstmate. Work on your own; do not wait for a human.

# Task
**Load the `firstmate-coding-guidelines` skill before editing anything.** This task changes
firstmate's shared, tracked material, and that skill is the authority on how to do it.

Everything below lives under `firstmate_workflow/` inside this repo.

**Goal.** Make automatic post-PR review a standing part of the firstmate task lifecycle, so it
happens every time rather than because a session remembered to do it.

## The behaviour to encode

**The full sequence, in order.** A ship task that opens a PR now runs through four stages, not
two:

1. **Implementation finishes.** The task reports `done: PR <url>` and firstmate records the PR
   with `bin/fm-pr-check.sh`, exactly as it does today.
2. **Self-review.** firstmate sends a follow-up to the *same implementing agent*, in its own
   session, telling it to review its own work and confirm the change is ready to ship. The agent
   stays alive for this; it is not a new session and not a new worktree.
3. **Review flow.** Once that self-review finishes, firstmate starts the review session described
   below.
4. **Retire the implementer.** At the moment the review session starts, the implementing agent's
   session is killed and its pane closed. Its worktree must survive untouched, because the review
   session runs inside it.

Stages 2 and 3 are ordered and must not overlap: the review session must not start while the
implementing agent may still be committing.

The review session itself:

- It launches in the **`reviews`** window, not `workers`. `config/pane-routes` already maps
  `scout: reviews`; reuse that routing rather than hardcoding a window name.
- Its working directory is **the finished task's own recorded worktree** (`worktree=` in
  `state/<id>.meta`). The review reads the branch under review, so it cannot run anywhere else,
  and it must not allocate a new worktree.
- Its **only** instruction is the single line `/full-review this pr`. Nothing else - no brief, no
  preamble, no extra context. The skill discovers the branch, base and PR itself. Pass it as the
  harness's initial prompt argument, the same way `bin/fm-spawn.sh` passes a brief.
- It launches on the same harness and standing flags as any other worker in the home
  (`config/crew-harness`, `config/crew-effort`). Do not add `-c`; that was a one-off.

This has been verified working by hand before this task was written: launching
`claude --dangerously-skip-permissions --effort max '/full-review this pr'` in the task worktree
from the `reviews` window correctly invokes the skill and starts the review. Reproduce that
behaviour, do not redesign it.

## Requirements
1. The mechanics belong in a **script under `bin/`**, not in prose. `AGENTS.md` should state the
   lifecycle rule and point at the script, matching how the rest of the file delegates exact
   commands and flags to its scripts.
2. `AGENTS.md` section 7, under "PR ready, landing, and teardown", is where the rule belongs -
   next to the existing `fm-pr-check.sh` step. Keep the addition short; that file is
   always-loaded and its size discipline matters.
3. **Teardown safety.** A task's worktree currently gets cleaned up once its PR lands. A review
   session running in that worktree must not have the ground pulled out from under it. Work out
   the right interaction and implement it - at minimum teardown must not silently destroy a
   worktree with a live review in it. `bin/fm-teardown.sh` owns the landed-work test; extend it
   in the same spirit rather than working around it.
4. **Idempotence.** Re-running the trigger for a task that already has a live review session must
   not start a second one, and must not re-send the self-review follow-up to an agent that has
   already had it.
4b. **Killing the implementer is the one destructive step here.** It must close that agent's
   session and pane and nothing else. It must never touch the worktree, the branch, or any
   uncommitted work, and it must not run before the review session has actually started - a
   failed review launch must leave the implementing agent alive. `bin/fm-teardown.sh` remains the
   only thing that removes a worktree, and its landed-work test still governs that.
5. Failing to launch the review must not lose the PR record or break the task's own lifecycle.
   `fm-pr-check.sh` recording the PR is the load-bearing step; the review launch is additive.
6. **Document it in `FORK-NOTES.md`** as a numbered local delta, in the style of the existing
   entries. That file is the contract that keeps `git subtree pull` survivable, and an
   undocumented change to `AGENTS.md` or `bin/` will be lost or conflict on the next upstream
   sync.
7. Shell scripts must be shellcheck-clean, consistent with the rest of `bin/`.

## Decisions that are yours
- Whether the review session is a tracked task with its own metadata, or a plain session like the
  hand-launched one. Consider that it has no brief, runs in an existing worktree that
  `bin/fm-spawn.sh` would refuse to reuse, and is not itself a deliverable. Justify the choice in
  the PR.
- Whether the launch is triggered inside `fm-pr-check.sh` or as a separate step firstmate calls
  next to it. Say why.

## Out of scope
- Do not change what `full-review` itself does. The skill lives at
  `.claude/skills/full-review/` in this repo and is not yours to edit here.
- Do not add review automation for scout tasks, or for PRs firstmate did not open.
- Do not touch anything under `homes/` - that is private per-project state.

## Constraints
- This repo is self-hosting: a first mate is running from this same checkout right now. Your
  changes only take effect after merge and pull, so nothing you do here can disturb the live
  session - but it also means you cannot test by restarting the live first mate. Test your script
  directly instead, and say in the PR exactly what you exercised and what you could not.
- Preserve every existing safety boundary in `AGENTS.md`. If your change would weaken or
  complicate one, append `needs-decision:` and stop.

# Herdr lifecycle declaration - NOT ENABLED
**HARD SAFETY GATE:** this scaffold cannot inspect the task text that replaces `{TASK}` later.
If the task will start, stop, delete, restart, profile, or otherwise drive Herdr lifecycle behavior, stop and regenerate the brief with `--herdr-lab` before dispatch.
Do not add Herdr lifecycle commands to this unguarded brief by hand.

# Setup
You are in a disposable git worktree of coding_harness, at a detached HEAD on a clean default branch.

**Verify isolation before anything else.** Run `pwd -P` and `git rev-parse --show-toplevel`; both must resolve to the disposable task worktree you were launched in, such as a treehouse pool path or an Orca-managed worktree, not the primary checkout firstmate operates from.
The path check is authoritative: `git rev-parse --git-dir` and `git rev-parse --git-common-dir` can help inspect the repo, but they do not prove you are outside the primary checkout.
If the top-level path is the primary checkout or not the worktree you were launched in, STOP - do not branch or commit here - append `blocked: launched in primary checkout, not an isolated worktree` to the status file and stop.

1. First action: create your branch: `git checkout -b fm/auto-review-flow`

# Rules
1. Never push to the default branch (push only your `fm/auto-review-flow` branch). Never merge a PR.
2. Stay inside this worktree; modify nothing outside it.
3. Use plain `gh` for GitHub operations. `gh-axi` and `chrome-devtools-axi` are NOT installed in
   this fleet - do not try to use them, and do not install them.
4. Report status by appending one line:
   `echo "{state}: {one short line}" >> '/Users/ribhavkapur/Desktop/everything/College/CS/coding_harness/firstmate_workflow/homes/coding_harness/state/auto-review-flow.status'`
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
When it is implemented and committed, push your branch and open a PR with `gh`, then append `done: PR {url}` to the status file and stop.
Do NOT run /no-mistakes. The configured merge authority decides whether to merge the PR; firstmate relays the outcome.
