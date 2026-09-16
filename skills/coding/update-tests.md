---
name: update-tests
description: Routes a finished change to the right test layer and writes, updates, or deletes tests accordingly. Run once when the code for a PR is done, before opening it. Decides which layer owns each change — contract, unit, integration, component, or e2e — and refuses to write a test at a layer that cannot meaningfully hold it. "No test needed" is a valid outcome.
---

# Update Tests

The code is written. This decides what tests it needs, at which layer, and writes them.

**If the repository carries its own copy of this skill** — `.claude/skills/update-tests/SKILL.md` — read and follow that one instead. A personal copy of a skill is loaded ahead of the project's, so without this line a project's own procedure, and whatever it has learned since, never runs.

The hard part is not writing tests — it is not writing the wrong ones. Left alone, an agent writes an end-to-end test for everything, because end-to-end feels thorough. It is the slowest, flakiest, most expensive layer, and for most changes it proves less than a five-line unit test would. This skill exists to route.

## When to use

Once per change, after the implementation is done and before the PR is opened. Not mid-work — a half-finished feature routes wrong.

## Input

The diff, never the description:

```bash
git diff $(git merge-base HEAD origin/<default-branch>)...HEAD
```

Descriptions say what someone intended. Diffs say what changed. Route on the diff.

## Step 1 — resolve the project's layers

Layers are named by kind, not by command, so this skill does not rot when a target is renamed. The kinds are **contract**, **unit**, **integration**, **component**, **e2e**, and **infra** — defined in Step 2. Resolve each to this project's actual command before writing anything: look in `Makefile`, `package.json`, `pyproject.toml`, and the CI workflow.

If a kind has no command in this project, say so in the output rather than inventing one or silently routing its work elsewhere.

Note existing **coverage gates** too — scripts that already enforce "a source file has a test" or "a component has a story." Where one exists, it is the authority on whether a file needs a test; do not restate its rules, just satisfy it.

## Step 2 — route each hunk

One rule decides everything:

> **Test at the cheapest layer that can actually observe the change.**

Not the layer that *could* cover it — almost anything can be covered from a browser. The cheapest one where the bug would still be visible.

So for each hunk, ask: **what would have to be real for this bug to appear?** That names the layer. The layers are ordered by what each one makes real that the one below it does not, and each step costs seconds and stability:

**contract** — makes real the *shape agreement between two codebases*. Nothing runs; a mismatch is a build error. Cheapest possible, because it fails in seconds without executing anything. Anything that is a disagreement about field names, types, or nullability belongs here and nowhere else.

**unit** — makes real *your logic, alone*. No I/O, no framework, no clock. If the change is a calculation, a transform, a rule, a reducer, a parser, the bug appears here. Most changes stop at this line.

**integration** — makes real the *dependencies you do not control*: the database, the queue, the filesystem, another service. Reach for it when the risk is not in your logic but in what the dependency actually does — `ON CONFLICT` semantics, enum casts, constraints, transaction boundaries, retry and redelivery behavior, timing between two services. A mock reproduces your belief about the dependency; that belief is the thing under suspicion, so mocking it tests nothing.

**component** — makes real *rendering*. A component in a state: empty, loading, error, disabled, overflowing. If the question is "does this look right in this state," this is the layer; a whole journey is a slow way to see one component.

**e2e** — makes real *the browser and the whole chain at once*. Two things live only here. First, browser-runtime behavior: geometry, pointer and touch input, file chooser, download, clipboard, a second tab. A test runner's fake DOM has no layout engine, so these are not merely awkward below this layer — they are unobservable. Second, a journey where **every step passes in isolation and the coupling between them is the risk**. Crossing services is the common shape of that, but not the requirement — a side effect one action has on another inside a single service qualifies, and is easier to miss precisely because nothing about it looks distributed.

**infra** — makes real the *synthesized infrastructure*: roles, policies, queues, routes.

**none** — nothing changed that any layer can observe. A refactor, a restyle, a copy tweak, a dependency bump. Existing tests are the safety net; that is what they are for. This is a normal, frequent, correct outcome.

### The trap

The failure mode this whole skill exists to prevent is reasoning *"e2e could catch this too, and it's more thorough."* That sentence is always available and always wrong. E2e is the slowest, flakiest, most expensive layer, and every spec is a cost paid on every run forever.

So when you land on e2e, say which cheaper layer you rejected and what it could not observe. If you cannot name something the cheaper layer would have missed, you are at the wrong layer.

The tell that you have drifted up: an assertion that would pass even if the feature were deleted and replaced with static markup. "Every row is sorted A–Z" against a pre-sorted fixture is worse than no assertion — it passes forever and proves nothing.

### The other trap: expensive setup is not a layer requirement

The subtler drift is routing by what the test needs *in place* rather than by what it *observes*. A check that wants thirty thousand seeded rows, or a populated queue, or a signed-in session with a particular role, feels like it belongs high up because that state is awkward to conjure — and the browser already has it.

It does not follow. "At least 629 pages of results" needs a large database, but what it observes is a count the query returns; that is integration, and it stays integration however tedious the fixture is. Ask what the assertion looks at, never what it had to stand up first. Setup cost is a reason to build a better fixture, not a reason to climb a layer.

### Reachability beats nature

The rule says the cheapest layer that can *actually observe* the change, and "actually" is load-bearing. Routing by what a thing **is** rather than what can **reach** it puts tests at layers that cannot hold them.

A boolean over four inputs is unit-shaped by nature. Written inline in a component's markup, or as a `useMemo` the component never exports, there is nothing to import and no unit test to write — the cheapest layer that can observe it is the one that renders it.

The tell is precise: you can name the inputs and state the rule exactly, and still have nothing to call. When that happens the honest options are to test it one layer up, or to lift the logic out and make the lower layer reachable. Both are fine; extracting is a source change and belongs to whoever writes the test, not to the routing decision. Say which you chose.

### Splitting — and the one thing it can destroy

A change often warrants more than one test at more than one layer, and splitting it is right: a hunk that adds a query and the panel that renders it is an integration test and a component test, not an argument about which. When one description resists a single layer, that is usually because it is describing more than one thing.

The exception is sharp. **Never split an assertion whose entire content is that two things are wired together.** Downloading a document also locks the record it describes; the download is browser behavior and the lock is a state transition, and each half passes on its own forever while the coupling — the part nobody designed and everybody would be hurt by — goes untested.

The diagnostic, after any split: *would every piece still pass if the thing I was worried about were broken?* If yes, the split dissolved the assertion rather than clarifying it. Put it back, keep it whole at the layer that can see both ends, and name the coupling as the reason it is there.

### Calibration

Same feature, four different changes, four different layers:

- A **discount formula** changes → unit. Nothing external is involved; the arithmetic is the risk.
- The **upsert that saves the discount** changes → integration. The risk is what Postgres does with `ON CONFLICT`, not what you meant.
- The **field name in the response** changes → contract. Frontend and backend now disagree; catch it at build time, not in a browser.
- **Dragging a component onto the pack** changes → e2e. Pointer geometry past an activation threshold does not exist without a real browser.

## Step 3 — write, following the project's conventions

Read the project's rules (`CLAUDE.md`, `.claude/rules/`) and match the surrounding tests. Do not restate conventions here that live there. Three rules are this skill's own, because they are the ones that get violated:

**Never assert against the diff.** You just wrote this code, so you know what it does — and asserting what it does is a tautology that passes forever and catches nothing. Every assertion needs an **external** source of truth: a spec document, a locale file, a schema, a ticket, a stated requirement. If you cannot name the source, do not write the assertion. Say in the output that the expected behavior is unstated and needs a human.

**Resolve user-facing copy from wherever the app resolves it.** If the project has locale files, assert through them. A hardcoded English string in a test is a future failure on a copy change that broke nothing.

**Address elements by role, label, or test id — never by CSS class or DOM structure.** This is the single biggest determinant of whether the suite survives a restyle.

## Step 4 — delete

Maintenance is bidirectional. A suite that only grows becomes a graveyard nobody trusts.

- A removed surface takes its tests with it, in this PR.
- A test skipped or quarantined for more than a couple of weeks gets deleted, not carried. If it mattered, fix it now; if it does not, stop pretending it is coverage.
- A test superseded by a lower layer goes when the replacement lands — do not keep the e2e version "just in case."

## Step 5 — keep the ledger honest

A plan claiming coverage the tests do not have is worse than no plan, because it is believed.

If the project keeps a plan describing product behaviour, updating it is part of the change — not follow-up work. Four moves, in the same commit:

- **New behaviour** → describe it in the plan, in the product's own words. What a person does, what the product does back. A behaviour nobody wrote down is a behaviour nobody agreed to.
- **New test** → claim the section it proves, with whatever stable-id marker the project uses, so coverage is mechanically checkable rather than a matter of opinion. Put the marker on the file that **actually proves** the behaviour, not the one whose name matches the section's title — those drift apart, and a claim on the wrong file reads as coverage while proving something else.
- **Changed behaviour** → correct the plan's claim and record the correction where the project keeps them. The plan is a document the product can disprove; that is normal, and hiding it is what makes a plan rot. When it is the product that is wrong, fix it in this change with a test that fails without the fix. When that fix is not this change's to make, write the step as what the product does today, mark it as a defect with the work order that fixes it — in whatever form the project's plan defines — and open that work order. A defect nobody tracks, written as a step, reads exactly like agreed behaviour.
- **Removed surface** → the section goes with its tests.

Then run the coverage gate, if the project has one. A marker you did not verify is a claim, not a fact — the gate is what turns it into one.

Where the project has **no** plan, say so in the output rather than inventing a document nobody asked for.

### Stale sentences live in the sections you did not open

Those four moves cover the sections you know you touched. The ones that go stale are the others: a change to one screen alters what other sections say about the same thing, and none of them carries the id you were editing. A discount that now applies before tax changes what the cart, the receipt and the refund sections say about totals — and the section you edited is the only one of those you would think to reread.

No gate can tell whether a sentence is still true. A coverage gate checks what a script can see — ids, markers, exact strings, at best whether what the plan names still exists — so a plan describing a product that no longer exists can pass every one. A green gate means the ledger is well-formed, not that it is current.

So search the plan for what the diff changed, not for the sections you edited:

- **Whatever the diff removed or reworded** — copy, a control's name, a route, an endpoint, a state. Grep the plan for the old words; every hit is a sentence to re-read.
- **Whatever the diff changed the behaviour of**, by the word a person would use for it — "total", "draft", "the cart" — across the whole plan, not only this screen's sections.
- **The sections claimed by every test file the diff touched**, edited as well as new. A test that had to change usually proves a behaviour that did.
- **Whatever shared part the diff changed** — a request client, a default, an error handler, a guard or a lock that many screens pass through. Search by what those screens do with it — their failure messages, their refreshes, the steps that come after the lock — because the plan describes the effect in product words and never names the part.

Where the project's coverage gate already does the mechanical half — naming what the plan still mentions that is gone, or listing the sections a touched test claims — start from its output. What it cannot do is read.

Read each hit against the code as it is now — steps, outcomes and notes, because a note explaining *why* is a claim too — and correct what no longer holds, recording each correction like any other. The search narrows where a stale sentence can hide; it does not prove there is none.

Then check from the other side: **every section you touched is still walked by a test that claims it.** A section can stay true while its test stops proving it. Add a step to a section and the test that walked the old flow still passes, still carries the tag, and proves nothing about the new step. Either that test walks the step, or the step gets its own situation and a test that does.

## Step 6 — verify

Run the gate for the layers you touched, not the whole suite. Report the command and the real result. If something fails, say so with the output — never report a suite as green without having seen it green.

## Output

Terse. One line per hunk, then what you did:

```
routed
  src/services/pricing.py:44      logic          → unit        (new: test_pricing.py::test_discount_floor)
  src/repositories/pack.py:210    ON CONFLICT    → integration (new: test_pack_repo.py::test_upsert_preserves_omitted)
  src/api/schemas/pack.py:12      response shape → contract    (regenerate client)
  frontend/.../Rail.tsx:88        restyle        → none
deleted
  e2e/legacy-cart.spec.ts         surface removed in this PR
unstated
  src/services/matching.py:120    new deviation threshold has no defined value — needs a decision before it can be asserted
plan
  CART-02                         corrected  the discount now applies before tax (changelog)
  RECEIPT-01                      walked     its only test never reached the new step — test added
  INVOICE-04                      defect     the total skips the second discount — marked, WO-412 opened
  REFUND-03                       re-read    still true
verified
  make test-backend  ✅  142 passed
```

Name every section the staleness search reached, the ones still true included. A section the output never mentions is indistinguishable from one nobody read. `corrected` means a sentence was false and the correction is recorded; `walked` means a step no claiming test reached now has one; `defect` means the product is wrong and the step is marked with the work order that fixes it; `re-read` means it still holds.

Flag anything you routed to a layer that does not exist in this project yet. That is a gap in the project's test setup, and it is worth more than the test you would have written around it.
