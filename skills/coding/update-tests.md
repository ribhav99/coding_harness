---
name: update-tests
description: Routes a finished change to the right test layer and writes, updates, or deletes tests accordingly. Run once when the code for a PR is done, before opening it. Decides which layer owns each change — contract, unit, integration, component, or e2e — and refuses to write a test at a layer that cannot meaningfully hold it. "No test needed" is a valid outcome.
---

# Update Tests

The code is written. This decides what tests it needs, at which layer, and writes them.

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

Layers are named by kind, not by command, so this skill does not rot when a target is renamed. Resolve each kind to this project's actual command before writing anything. Look in `Makefile`, `package.json`, `pyproject.toml`, and the CI workflow.

| Kind | What it is | Typical home |
|---|---|---|
| **contract** | Generated client / schema check — a mismatch is a *compile* error | codegen target, `test:contract` |
| **unit** | Pure logic, no I/O | co-located `*.test.*`, `tests/` |
| **integration** | Real database, real queue, real service | backend test suite (usually needs Docker) |
| **component** | A rendered component in its states | Storybook, story tests |
| **e2e** | Real browser, real backend, whole journey | Playwright specs |
| **infra** | Synthesized infrastructure assertions | CDK/Terraform test dir |

If a kind has no command in this project, say so in the output rather than inventing one or silently routing its work elsewhere.

Note existing **coverage gates** too — scripts that already enforce "a source file has a test" or "a component has a story." Where one exists, it is the authority on whether a file needs a test; do not restate its rules, just satisfy it.

## Step 2 — route each hunk

Read down. **First matching row wins.** Route each hunk to exactly one layer.

| The change is | Layer | Why not higher |
|---|---|---|
| An API request/response shape | **contract** | A rename should fail at build time in seconds, not in a browser in minutes |
| Pure logic — a calculation, a transform, a validation rule, a reducer | **unit** | No I/O to exercise |
| A SQL query, migration, or anything relying on real database semantics (`ON CONFLICT`, enum casts, constraints, bulk paths, transactions) | **integration** | Mocks reproduce your belief about the database, not the database |
| A queue, worker, retry, timeout, or visibility/redelivery behavior | **integration** | Timing seams do not exist in a mock |
| An external-service call (payment, mail, AI provider) | **unit** with the client faked at its boundary — **plus** one integration test if the wire format is the risk | Full stack for one call is waste |
| A component's visual states — empty, loading, error, disabled, overflow | **component** | A browser journey is a slow way to see one component |
| Permission or role-gated *rendering* | **component** or **unit** | The gate is a prop, not a journey |
| Permission or role-gated *access to data* | **integration** | The gate is server-side; assert the server |
| Browser-runtime behavior — drag past an activation threshold, touch gestures, file chooser, download, clipboard, second tab, viewport geometry | **e2e** | jsdom has no layout engine; this is the one thing only a real browser can do |
| A journey crossing frontend, backend, and infrastructure together (upload → storage → queue → worker → result → render) | **e2e** | Every hop passes in isolation while the chain is broken |
| A top user journey, end to end | **e2e** | Cap this at a small standing set — see the budget below |
| Infrastructure definition — roles, policies, queues, routes | **infra** | |
| A refactor with no behavior change | **none** | Existing tests are the safety net; that is what they are for |
| Formatting, comments, copy, dependency bumps | **none** | |

### The e2e budget

End-to-end specs are the scarce resource. Adding one is a standing cost paid on every run forever.

Before writing one, answer: **which other layer could hold this, and why can't it?** If the answer is "it could, but e2e is more thorough," route it down. Valid answers are only:

- it needs real browser geometry or a real browser API
- it crosses three or more services and the seam is the risk
- it is one of the project's handful of top journeys

Sorting, filtering, pagination, search, and validation are **never** e2e. An assertion like "every row is sorted A–Z" against a pre-sorted fixture is worse than no assertion — it passes forever and proves nothing.

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

If the project keeps a test-plan or coverage document, update it in the same commit:

- new e2e spec → add its section, and tag spec and section with the same stable id so coverage is mechanically checkable rather than a matter of opinion
- removed spec → remove its section

A plan claiming coverage the specs do not have is worse than no plan, because it is believed.

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
verified
  make test-backend  ✅  142 passed
```

Flag anything you routed to a layer that does not exist in this project yet. That is a gap in the project's test setup, and it is worth more than the test you would have written around it.
