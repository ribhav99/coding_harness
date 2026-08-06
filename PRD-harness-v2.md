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

### B7 — Notify only on a real report
The captain's own words: *"you can't continuously get stop hooks when nothing is going
on just because it seemed idle."* A worker filing an outcome interrupts. Nothing else
does — not idleness, not a turn ending, not a poll restarting, not a heartbeat.

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
  a task           = a tmux pane + a worktree + a brief + one status file
  a notification   = the captain's session is woken when a status file gains a line
  a review surface = one page the captain reads and decides on   (section 6)
```

No watcher loop. No wake queue. No daemon. No polling of any kind.

### 4.2 Notification: replace polling with a file watch

v1 polls every 15s, classifies what changed, and decides whether to interrupt.
v2 does not poll. The single trigger is: **a task's status file gained a line.**

Implementation: one `fswatch`/`kqueue` watch on the state directory, filtered to
`*.status` writes. On a write, append the new line to a notify queue and wake the
captain's session through the existing Stop-hook mechanism, which the captain
confirmed is the right delivery path.

Everything v1 spent code on — is the pane busy, has it been idle too long, is this a
wedge, has this been surfaced before — disappears, because none of it is a trigger any
more. A worker that goes quiet is quiet. If the captain wants to know, they ask.

Consequence accepted deliberately: a crashed worker is not detected automatically. It
is detected when the captain asks, or when they notice the review never arrived. This
is the trade B7 asks for, and it is the single largest source of removed complexity.

### 4.3 Task lifecycles

Two lifecycles. They join at the handoff, and after that point there is only one path.

**Ship — implement a task and get it reviewed.** Every arrow is automatic; the captain
is not consulted between them and hears nothing until the review lands.

```
  ship <task>              worktree on a fresh branch, brief, pane, one meta file
     |
     |  session implements, pushes, opens a PR
     v
  `done: PR <url>`         the ONLY trigger in this lifecycle
     |
     |  handoff step 1: harness tells that session, once, to review its own work
     v
  `done: self-review <outcome>`
     |
     |  handoff step 2+3: close the session, remove its worktree, and open a
     |  fresh session at the PR head - ONE operation, cannot half-happen
     v
  [ becomes a review task, below ]
```

**Review — read a PR cold and land the captain's decisions.**

```
  review <pr-number>       fetch the PR head, worktree at it, brief, pane, meta
     |
     |  session reads cold, writes its report
     v
  `done: <verdict>`        captain hears 2-3 lines (B1)
     |
     |  captain decides, finding by finding, in the pane or on the review page
     v
  `done: POSTED - <outcome>, <what went up, what was dropped>`
     |
     +--> announce in the thread that requested it            (if Slack, B5)
     +--> record the outcome on the work order                (if a tracker, §5)
     +--> if approved: close, after checking nothing unlanded (B6, §4.4)
```

A review that requested changes stays open: the author's response comes back to the
session that already read the code.

One status vocabulary, three verbs, no more:

- `done:` — an outcome the captain should know about.
- `blocked:` — cannot proceed without the captain.
- everything else is not a status line and is not written.

`working:`, `paused:`, `resolved:`, `needs-decision:`, `pending-decision:` all go. v1
had five verbs and a precedence order between them to answer questions v2 no longer
asks.

### 4.4 Safety rails kept

These are kept because each one caught a real mistake in the last two days:

- **Never tear down unlanded work.** A single owner runs the check; a refusal stops
  the operation. Caught a review with no durable report yesterday.
- **A review session must leave a report before it can be discarded.** Same incident.
- **Confirm forge state before announcing.** Caught a review that reported
  request-changes when a plain comment had landed.
- **Isolation assertion on spawn.** A task never runs in the primary checkout.

### 4.5 Scale

| v1 | v2 target |
|---|---|
| 74 scripts, 21.5k lines | under 10 scripts, ~1.5k lines |
| 500 lines always loaded | under 120 |
| 13 skills | 2: review workflow, recovery |
| 57 test files, 27.7k lines | ~8 files covering the rails in 4.4 and the notify trigger |

## 5. Optional integrations: Slack, and the work-order tracker

Captain's constraint: this runs on a second machine with no Slack. Slack is a
capability check at startup, not a dependency:

```
  if a Slack connection is configured:
      announcements go to the thread that requested the review
  otherwise:
      the outcome is reported to the captain and nothing else changes
```

No code path other than B5 may require Slack. The same applies to any forge
integration beyond `gh`.

### Work-order traceability

When a PR closes out a work order — merged, or dropped deliberately — the outcome is
recorded on that work order so the loop is closed where the work was specified. Same
conditional shape as Slack: **if a work-order tracker is reachable**, comment and set
the status; otherwise skip silently and tell the captain instead.

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
