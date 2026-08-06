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

## 6. The review surface

Written from scratch, replacing Lavish entirely. Lavish's own code, the local patch,
the patch applier and its setup check all go once this works.

**No held connection.** This is the whole architectural change. Lavish has the agent
block in a foreground poll waiting for the captain; that connection dies and gets
restarted, and every restart feeds an idle worker a turn — the interruption storm, and
a direct B7 violation. Here nothing waits:

```
  review session   writes its page, opens it, and STOPS
  captain          decides in the browser, hits send
  page             POSTs the decisions to the server
  server           writes decisions.json beside the page
                   injects one line into that session's pane
  session          wakes, reads decisions.json, acts, STOPS
```

A worker is woken exactly when the captain sends something, and never otherwise. One
turn per captain action, which is the only turn there should be.

**One server, many pages, started on demand.** It serves review pages from disk by
path. No per-load token handshake, so opening a page twice, reloading it, or coming
back to a tab from yesterday all work — the blank-page failure cannot occur because
there is no negotiated state to go stale.

**The decision form is generated, never hand-written.** One implementation, used by
every review. The two reviews that posted the wrong thing did so because each wrote its
own form and each got it wrong differently; generating it makes that class of bug
impossible rather than merely documented.

**Submit fails loudly.** Empty or partial payloads are refused and shown on the page.
Nothing is ever silently dropped, and nothing is posted that the captain did not see.

**The look stays as it is.** Keeping the current styling, including the Tailwind
browser runtime, because the case for changing it did not survive measurement: one
review page costs 75MB in Chrome, and eight open at once are 4% of a Chrome already
holding 13.5GB across the captain's own 64 tabs, which average 216MB each. Page weight
is not the problem and rewriting the styling would buy nothing. The one thing worth
revisiting later is the CDN dependency, which means a page needs network to render —
that matters for reopening an old tab and on a machine without connectivity, and it is
a correctness question rather than a resource one.

**Content is not this component's contract.** What a review page says — findings as
plain-English consequence, no code, per-finding controls, editable comment text,
batched nits, the verdict — is owned by `skills/coding/full-review.md`. This component
renders and collects; it does not decide what goes on the page. Two real pages are kept
in `surface/reference/` as the concrete target.

## 7. Migration

Build alongside v1. Cut over one PR review end to end. Delete v1 subsystems only after
that works.

Reviews keep their depth throughout: the judge fan-out stays, at full effort.

**Nothing survives that is not used at the end.** When the cutover is done, v1's
subsystems, its tests, its docs, Lavish, the tracked Lavish patch, the patch applier and
its setup check are all deleted. The repo holds one harness, not two, and no dormant
code kept in case it is wanted later — the whole point of this exercise is that the
unused surface is the cost.
