# Harness v2 — PRD

Status: draft for review. Written 2026-08-06 after two days of running v1 in anger.

## 1. Why rewrite

v1 works, and most of it has never been used. Measured today:

| | v1 |
|---|---|
| shell scripts in `bin/` | 74 |
| lines of bash | 21,506 |
| always-loaded instructions | 500 lines |
| skills | 13 |
| tests | 57 files, 27,761 lines |
| docs | 16 |

Against that, the workflow actually exercised over two days was: spawn a cold review
per PR, present findings, post what the captain approved, announce it in Slack, close
the session. That is one workflow. Nearly everything else — the wake taxonomy, wedge
escalation ladders, busy-state trust tables, decision holds, delivery modes, the
validation pipeline, away mode and its daemon, fleet sync, startup memory budgets,
doc-audience classification — was either never triggered or triggered only by itself.

The cost of that unused surface is not CPU. It is that every rule has to be held in
mind at once, every change has to be reconciled against a dozen subsystems, and the
parts that *are* load-bearing get lost among the parts that are not.

### What was actually wrong (measured, not assumed)

Two complaints drove this rewrite. Both were investigated before designing around them.

**"My fans are on constantly."** Not the harness. A flakiness check inside the PR 292
review spawned eight infinite CPU loops to create contention, then failed to kill
them; they were orphaned to init and burned eight cores for 24 hours. Secondary: the
status line re-parses 666MB of transcripts every 30s per session, ~4s CPU per run,
racing across sessions. Measured Lavish cost at the same moment: server 0.0% CPU /
59MB, seven listeners 1.7% of one core combined.

**"Lavish isn't working."** True, but on reliability, not cost:

- Blank pages twice in two days, both times because tabs held tokens the server no
  longer recognised after a restart.
- The Send button silently discarded feedback whenever the artifact frame could not
  answer a `postMessage` — no error, no request, prompt left sitting in the queue.
  Patched locally; upstream 0.1.45 is the newest published version.
- Two reviews posted something other than what the captain chose, because each review
  hand-writes its own decision form and each got it wrong differently.

The lesson is not "servers are bad." It is that the review surface has too many moving
parts between a decision and its effect, and every one of them fails silently.

### Non-goals

- Reducing review depth. The judge fan-out earns its cost: it caught a "fixed"
  touch-drag regression that was only delayed by 80ms, test assertions that could not
  fail, and two false positives from its own judges. Reviews stay heavy.
- Rebuilding anything not listed in section 2.

## 2. Behaviours to preserve

These are the contract. v2 is correct if and only if it does these.

### B1 — This chat is orchestration, never content
Two or three lines per event: what it concluded, and whether it needs the captain.
Never reproduce a deliverable, a finding list, or a worker's report. Name the session
that holds the detail; the captain works it through there.

### B2 — Never message a worker unprompted
A message goes to a live worker in exactly three cases: the captain asked for this
specific message; it is the completion handoff (B3); or the worker asked a question
and cannot proceed. Never to silence an alarm, ask for status, or nudge an idle pane.

### B3 — Code is reviewed by a session that did not write it
This chain runs **automatically**, with no captain input at any step. The captain hears
about it once, at the end.

1. An implementation session finishes and reports its PR.
2. That report alone triggers the handoff — the harness instructs that session, once,
   to review its own work. This is cheap and catches the obvious before a cold reader
   spends context on it. It is one of only three messages a worker may ever receive
   (B2).
3. The session reports its self-review outcome and any fixes it pushed.
4. That session is closed and its worktree removed.
5. A fresh session opens on the PR, at the PR's head, and reads it cold.

Steps 4 and 5 are a single operation, so the swap cannot half-happen and leave the work
with no session at all. The session that wrote the code is the worst reviewer of it —
it is anchored on its own choices — which is the entire reason the review moves to a
session that never saw them.

### B4 — Reviews post nothing until the captain approves it, finding by finding
A review produces a verdict and per-finding draft comments. Nothing reaches the forge
until the captain has decided each one. If the captain leaves without deciding some,
those are reported as unsent, not quietly dropped.

### B5 — Announce the outcome where it was asked for
When comments actually land on the forge, reply to the message that requested the
review, tag its author, and say only the outcome: `comments up`, `approved with
comments`, or `approved`. Confirm the state on the forge first — never relay a
worker's claim. **Conditional on a Slack connection being configured**; with no Slack,
this step is skipped silently and the outcome is reported to the captain instead.

### B6 — An approved PR closes its review session
Nothing left to do. The report outlives the session.

### B7 — One trigger: a worker stopped
The captain's own words: *"you can't continuously get stop hooks when nothing is going
on just because it seemed idle"* and *"we should just have stop hooks. that's all.
nothing else."* A worker stopping is the only thing that reaches the captain. Not
idleness, not staleness, not a heartbeat, not a background process noticing something.
Nothing may poke an idle worker into taking a turn it did not need to take.

### B8 — Reproducible from the repo alone
A second machine clones and runs identically. Nothing load-bearing lives outside the
repo, and anything applied to a third-party tool is tracked and reapplied on setup.

### B9 — Correctable in flight
When behaviour is wrong, it can be fixed immediately and the fix is tracked.

## 3. What v2 does not have

Cut entirely, with the reason each was cut:

| Cut | Why |
|---|---|
| Wake taxonomy (`signal`/`stale`/`heartbeat`/`check`) | B7 reduces it to one trigger: a worker reported. |
| Wedge escalation, busy-state trust, pane-hash tracking | Existed to guess whether a quiet pane was faulted. Under B7 a quiet pane is simply quiet. |
| Away mode + sub-supervisor daemon | Never used. |
| Decision holds, structured backlog integration | Used only by the harness itself. The captain never asked for one. |
| Delivery modes, `yolo`, validation pipeline | One mode was ever used: push a branch, open a PR. |
| Fleet sync, project registry, startup memory budget, doc-audience classification | Machinery serving machinery. |
| Tool-patch subsystem | Exists only to prop up Lavish's send path. Its fate follows section 6. |

## 4. Architecture

### 4.1 Shape

Three things, and nothing else:

```
  a task           = a tmux pane + a worktree + a brief
  a notification   = a worker's Stop hook, carrying that worker's own last words
  a review surface = one page the captain reads and decides on   (section 6)
```

No watcher loop. No wake queue. No daemon. No polling. **No status files.**

### 4.2 Notification: stop hooks, and nothing else

There is one trigger in the whole system: **a worker stopped.**

A worker running autonomously does not end a turn until it has nothing left to do. So
its Stop hook firing already means the thing every other mechanism was trying to
infer — this worker finished a piece of work and is waiting. That is the signal. It
needs no file, no verb, and no cooperation from the worker.

```
  worker's Stop hook fires
      -> reads the last assistant message from its own transcript_path
         (Claude Code supplies transcript_path in the hook payload - verified)
      -> hands that text to the supervisor and wakes it
```

**Why this is better than the status file it replaces.** v1 required every worker to
remember to write `done: <summary>` at the right moment, and briefs had to nag about it
twice. Workers forgot. One review session ran to completion and wrote nothing, so its
cleanup was refused and it had to be asked for a report after the fact. Under v2 there
is nothing to forget: a worker that stops has reported, because stopping *is* the
report and its own final message is the content.

**Why this does not reproduce the noise storm.** The storm was manufactured, not
inherent. Review pages held a listener process that was reaped roughly every 30
minutes; each reap fed the session input, the session did one trivial thing and ended a
turn, and that turn-end was a wake. Hundreds of turn-ends, none of them work. Remove
the thing that pokes idle sessions and a Stop means what it says. This is a hard
constraint on section 6: **nothing may feed a worker input except the captain, the
handoff, and a worker's own tools.** Any design that pokes an idle session is
disqualified, because it re-manufactures the storm.

**State lives in the world, not in bookkeeping.** v1 maintained a status vocabulary,
a precedence order between verbs, and per-task surfaced-markers to reconstruct what was
already known. v2 keeps none of it. When the supervisor needs to know where something
stands it reads the thing itself: the forge for whether a PR is approved or a comment
landed, `report.md` for what a review concluded, the pane for what a session is doing.
Those are authoritative anyway — v1's own rule was to confirm the forge rather than
trust a worker's claim, which is an admission that the bookkeeping was never the truth.

Consequence accepted deliberately: a crashed worker is not detected automatically. A
crash is a session that stopped, which looks like a session that finished, and only
reading it tells them apart. It surfaces when the captain asks or notices a review
never arrived. This is the trade B7 asks for and the single largest source of removed
complexity.

### 4.3 Task lifecycles

Two lifecycles. They join at the handoff, and after that point there is only one path.

**Ship — implement a task and get it reviewed.** Every arrow is automatic; the captain
is not consulted between them and hears nothing until the review lands.

```
  ship <task>              worktree on a fresh branch, brief, pane
     |
     |  session implements, pushes, opens a PR, and stops
     v
  STOP                     its last message says what it built and where the PR is
     |
     |  handoff step 1: supervisor tells that session, once, to review its own work
     v
  STOP                     its last message is the self-review outcome
     |
     |  handoff step 2+3: close the session, remove its worktree, and open a
     |  fresh session at the PR head - ONE operation, cannot half-happen
     v
  [ becomes a review task, below ]
```

**Review — read a PR cold and land the captain's decisions.**

```
  review <pr-number>       fetch the PR head, worktree at it, brief, pane
     |
     |  session reads cold, writes report.md, and stops
     v
  STOP                     its last message is the verdict; captain hears 2-3 lines (B1)
     |
     |  captain decides, finding by finding, in the pane or on the review page
     |  session posts what was approved, and stops
     v
  STOP                     its last message says what went up and what was dropped
     |
     +--> read the forge to confirm what actually landed          (§4.4)
     +--> announce in the thread that requested it                (if Slack, §5)
     +--> record the outcome on the issue or work order           (if a tracker, §5)
     +--> if approved: close, after checking nothing unlanded      (B6, §4.4)
```

The only durable artifact either lifecycle writes is `report.md`, because it is a
deliverable the captain reads, not bookkeeping. Everything else is the pane, the
worktree, and the forge.

A review that requested changes stays open: the author's response comes back to the
session that already read the code.

**There is no status vocabulary.** v1 had five verbs — `done:`, `working:`, `paused:`,
`blocked:`, `needs-decision:` — plus a precedence order between them, a rule for which
verbs carried state, and per-task markers recording which had already been surfaced.
All of it existed to answer "what is this task doing", which v2 answers by looking at
the task. A worker needing the captain says so in its own words and stops; that is a
stop like any other, and the supervisor reads why.

### 4.4 Safety rails kept

These are kept because each one caught a real mistake in the last two days:

- **Never tear down unlanded work.** One owner runs the check; a refusal stops the
  operation and nothing is forced.
- **A review session must leave `report.md` before it can be discarded.** Caught a
  review yesterday that had run to completion and written nothing durable; without the
  refusal its findings would have gone with the worktree.
- **Confirm the forge before announcing or closing.** Caught a review that believed it
  had requested changes when a plain comment had landed, and it matters more in v2 than
  in v1: with the bookkeeping gone, the forge is not a cross-check, it *is* the record.
- **Isolation assertion on spawn.** A task never runs in the primary checkout.

### 4.5 Scale

| v1 | v2 target |
|---|---|
| 74 scripts, 21.5k lines | under 10 scripts, ~1.5k lines |
| 500 lines always loaded | under 120 |
| 13 skills | 2: review workflow, recovery |
| 57 test files, 27.7k lines | ~8 files covering the rails in 4.4 and the notify trigger |

## 5. Optional integrations: everything outside the repo is conditional

Nothing outside git and the forge may be assumed present. The captain runs this on a
work machine with Slack and a home machine without it, against projects that track work
three different ways. Every such dependency is resolved once into available or not, and
every step that uses one is skipped cleanly when it is not.

### Slack — only if a Slack connection exists

```
  if a Slack connection exists:
      announce the outcome in the thread that requested the review   (B5)
  otherwise:
      skip it silently and report the outcome to the captain instead
```

No code path other than B5 may touch Slack, and B5 is never a blocker: a review whose
outcome could not be announced is still a completed review. On a machine with no Slack
the captain should see no difference except that nothing is posted.

### The tracker differs per project

There is no single tracker. Each project declares which one it uses, and some use none:

```
  tracker = none | github-issues | work-orders
```

It matters in both directions, so it cannot be an afterthought bolted onto the end:

- **Inbound** — a brief points the worker at where the task is specified. A GitHub
  issue number for one project, a work-order id for another, and for `none` the brief
  carries the task itself.
- **Outbound** — when a PR closes out that item, the outcome is recorded where the work
  was specified, so the loop closes there. A comment and a status change on the work
  order; a comment and a close on the GitHub issue; nothing at all for `none`.

Resolution is per project, not per machine and not global, because the same captain
runs both kinds side by side.

This is called out because it failed in v1 for a mechanical reason worth designing
around. The Software Factory integration was configured for the project's own
directory, so worker sessions could read work orders while the supervisor could not
reach it at all — and the supervisor is the one that knows a PR just closed. Whatever
the tracker, the component that observes the outcome must be the component that can
write it, or the write has to be routed to a session that can.

### Capability detection is one place

Slack, the work-order tracker, and the forge are each resolved once at startup into a
simple available/unavailable answer, and every conditional step reads that answer. No
step probes for its own dependency at the moment it needs it, and no step fails midway
because something it assumed was present is not.

## 6. Open decision — the review surface

This is the one thing not settled, and it should be settled before implementation.

The captain wants **exactly the current review behaviour**: a rich page, per-finding
decisions, editable comment text, answers flowing back to the agent. The objection was
overhead. Overhead has now been measured at ~0, so the real objection is the three
silent-failure modes in section 1.

Three candidates:

**A. Keep Lavish, keep the patch.** Zero build cost. Retains the reliability problems
except the one already patched, and depends on an upstream at 0.1.45 with no fix.

**B. One local server, many pages, written here.** One long-lived process serving every
review page and holding one connection per waiting session. The parts that failed in
Lavish get designed out rather than patched: no per-load token handshake (so a stale
tab cannot blank), one canonical decision form generated by the harness rather than
hand-written per review (so the two form bugs are structurally impossible), and a
submit path that fails loudly. Highest build cost, best fit to the stated behaviour.

**C. Static page, decisions typed in the pane.** The page renders findings read-only;
the captain types their calls to the agent. No server, no forms, no send path — every
failure mode above disappears. Costs the clicking.

Recommendation: **B**, because the captain asked for the same behaviour and the cost
objection did not survive measurement — but B is most of the build effort in this PRD,
so it is worth confirming before starting. C is the honest fallback if the surface
turns out not to be worth its own subsystem.

## 7. Migration

1. Build v2 alongside v1 in the same repo; nothing is deleted until v2 runs a review
   end to end.
2. Cut over one workflow: a single PR review, start to finish.
3. Delete v1 subsystems in the order of section 3, each with its tests.
4. Keep the tracked tool patch only if section 6 resolves to A.

Existing sessions are unaffected by any of this: they are tmux panes and worktrees, and
v2 adopts the same shape.
