# Harness v2 — PRD

v1 is 74 scripts and 21,500 lines of bash, and the path actually used is one workflow:
spawn a session, get code reviewed by a session that did not write it, land the
captain's decisions, announce, close. v2 is that workflow and nothing else. This
document describes the end state, not the migration.

## 1. Behaviours

The contract. v2 is correct if and only if it does these.

**B1 — This chat is orchestration, never content.** Two or three lines per event: what
it concluded, and whether it needs the captain. Never reproduce a deliverable or a
findings list. Name the session that holds the detail.

**B2 — Never message a worker unprompted.** Three cases only: the captain asked for
this specific message, it is the handoff in B3, or the worker asked a question and
cannot proceed.

**B3 — Code is reviewed by a session that did not write it.** Automatic end to end, no
captain input: a session opens a PR and stops → it is told once to review its own work
→ it reports and stops → it is closed and its worktree removed → a fresh session opens
at the PR head and reads it cold. The close and reopen are one operation.

**B4 — Reviews post nothing until the captain approves it, finding by finding.**
Anything left undecided is reported as unsent, never quietly dropped.

**B5 — Announce where the review was asked for.** When comments land, reply in that
thread, tag the author, say only the outcome: `comments up`, `approved with comments`,
`approved`. Confirm the forge first. Conditional on Slack (§4).

**B6 — An approved PR closes its review session.** A review that requested changes
stays open; the author's response comes back to the session that read the code.

**B7 — One trigger: a worker stopped.** Nothing else reaches the captain — not
idleness, not staleness, not a heartbeat. Nothing may poke an idle worker into a turn
it did not need to take.

**B8 — Reproducible from the repo alone.** A second machine clones and runs
identically.

**B9 — Correctable in flight.** Wrong behaviour is fixed immediately and the fix is
tracked.

## 2. Shape

```
  a task           = a tmux pane + a worktree + a brief
  a notification   = a worker's Stop hook, carrying that worker's own last words
  a review surface = one page the captain reads and decides on        (§6)
```

No watcher. No wake queue. No daemon. No polling. No status files.

**The trigger.** A worker running autonomously does not end a turn until it has nothing
left to do, so its Stop hook firing is the signal. The hook reads the last assistant
message from the session's own `transcript_path`, which Claude Code supplies, and hands
that text to the supervisor. Workers write nothing and remember nothing.

**State is read, not recorded.** There is no status vocabulary. Where something stands
comes from the forge (is the PR approved, did the comment land), from `report.md` (what
a review concluded), or from the pane (what a session is doing). `report.md` is the
only durable artifact either lifecycle writes, because it is a deliverable.

**Crashes are not detected.** A crashed session looks like a finished one. It surfaces
when the captain asks, or when a review never arrives.

## 3. Lifecycles

**Ship.** Every arrow automatic; the captain hears nothing until the review lands.

```
  ship <task>        worktree on a fresh branch, brief, pane
     |               implements, pushes, opens a PR, stops
     v
  STOP               last message: what it built, where the PR is
     |               told once to review its own work
     v
  STOP               last message: self-review outcome and any fixes pushed
     |               close the session, remove the worktree, open a fresh
     |               session at the PR head — ONE operation
     v
  [ review, below ]
```

**Review.**

```
  review <pr>        fetch the PR head, worktree at it, brief, pane
     |               reads cold, writes report.md, stops
     v
  STOP               last message: the verdict — captain hears 2-3 lines
     |               captain decides finding by finding, in the pane or on the page
     |               session posts what was approved, stops
     v
  STOP               last message: what went up, what was dropped
     |
     +--> confirm on the forge what actually landed
     +--> announce in the thread that requested it        (if Slack, §4)
     +--> record the outcome on the issue or work order    (if a tracker, §4)
     +--> if approved: close, after the unlanded-work check
```

## 4. Optional integrations

Nothing outside git and the forge is assumed present. Each dependency resolves once at
startup to available or not; every step using one is skipped cleanly when it is not.

**Slack — only if a connection exists.** With it, B5 announces. Without it, the step is
skipped silently and the outcome goes to the captain instead. B5 never blocks: a review
whose outcome could not be announced is still complete. No other code path touches
Slack.

**Tracker — per project, not global.** `none | github-issues | work-orders`. It decides
both directions: inbound, where a brief points the worker for the spec; outbound, where
the outcome is recorded when a PR closes the item out. Whatever observes the outcome
must be able to write it.

## 5. Safety rails

- Never tear down unlanded work. One owner runs the check; a refusal stops the
  operation and nothing is forced.
- A review session must leave `report.md` before it can be discarded.
- Confirm the forge before announcing or closing. With no bookkeeping, the forge is not
  a cross-check — it is the record.
- A task never runs in the primary checkout.

## 6. Open decision — the review surface

The captain wants the current behaviour: a rich page, per-finding decisions, editable
comment text, answers reaching the agent. Hard constraint from B7: **the surface may
not poke an idle worker.** Lavish's listener was reaped every half hour and each reap
fed an idle session a pointless turn — that is what produced the interruption storm, and
any design that repeats it is disqualified.

| | Build cost | Trade |
|---|---|---|
| **A. Keep Lavish** | none | Keeps blank-page and silent-send failures; violates B7 unless the listener is replaced |
| **B. Own local server** | high | One process, many pages, one held connection per waiting session. No per-load token handshake, one harness-generated decision form, submit fails loudly |
| **C. Static page, decide in the pane** | low | Every failure mode disappears; costs the clicking |

Recommendation: **B**. It is most of the build effort, so worth confirming first. **C**
is the fallback if the surface is not worth its own subsystem.

## 7. Scale target

| | v1 | v2 |
|---|---|---|
| scripts | 74 | under 10 |
| lines of bash | 21,506 | ~1,500 |
| always-loaded instructions | 500 lines | under 120 |
| skills | 13 | 2 — review workflow, recovery |
| tests | 57 files, 27,761 lines | ~8 files, covering §5 and the trigger |

Reviews keep their depth: the judge fan-out stays, at full effort.

## 8. Migration

Build alongside v1. Cut over one PR review end to end. Delete v1 subsystems only after
that works.
