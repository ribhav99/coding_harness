# Coding Harness

Operator manual. For the design, see [`PRD.md`](PRD.md); for the architecture, see [`BLUEPRINT.md`](BLUEPRINT.md).

This kit drives a project from a PRD to merged code through four autonomous loops, each backed by Claude Code subprocesses with reviewer-style verification. You run the loops from your laptop; the orchestrator owns spawn/retry/state/git.

---

## What this is

The harness is a kit you check out once and point at as many projects as you like. A project is a separate git repo; the kit drives it from outside via `python -m orchestrator <subcommand> --project-root /path/to/project`.

```
Project lifecycle
─────────────────────────────────────────────────────────────────────
   PRD.md  ──►  requirements/  ──►  blueprints/  ──►  work-orders/  ──►  merged PRs
   (Stage 1)     (Stage 2)           (Stage 3)         (Stage 4)         (Stage 5)
   manual        requirements-loop   blueprint-loop    work-orders-loop  coding-loop
```

Each loop:
- reads what's on disk in the project,
- spawns a generator that writes a tree of markdown (or, for the coding loop, code),
- spawns a set of reviewers in parallel that judge it,
- iterates until every reviewer passes,
- commits the result (upstream loops) or opens a PR per work order (coding loop).

---

## Install

You need:
- **Python 3.10+** (uses `match`-statement-friendly typing, no extra deps).
- **Claude Code** installed and authenticated (`claude` on your PATH).
- **`gh` CLI** authenticated against the host you'll be opening PRs on (only needed for `coding-loop`).
- **`git`**.

Clone this repo somewhere stable; the orchestrator references its own scripts by path.

```bash
git clone https://github.com/ribhav99/coding_harness.git ~/code/coding_harness
cd ~/code/coding_harness
```

Edit [`config.yaml`](config.yaml) to set caps and the per-role model (Opus 4.7 for generators, Sonnet 4.6 for reviewers by default). One config, every project.

Make the harness skills available globally:

```bash
mkdir -p ~/.claude/skills
ln -s ~/code/coding_harness/skills/* ~/.claude/skills/
```

---

## Quick start (new project)

```bash
mkdir my-project && cd my-project
git init
# write your PRD
$EDITOR PRD.md

# decompose PRD → reviewed FRD tree
python -m orchestrator requirements-loop --project-root .

# decompose FRDs → reviewed blueprints
python -m orchestrator blueprint-loop --project-root .

# decompose blueprints → reviewed work-orders + drain order
python -m orchestrator work-orders-loop --project-root .

# drain work orders, one PR per work order
python -m orchestrator coding-loop --project-root .
```

You merge each PR when you're satisfied. The next `coding-loop` invocation detects the merge and moves on to the next ready work order.

---

## The four loops

All four share the same shape — orchestrator spawns generator and reviewers, parses the trailing `VERDICT:` line of each subprocess's stdout, retries on fail. The differences are which artifacts are read/written and what each reviewer judges.

### 1. requirements-loop (`PRD.md` → `requirements/` tree)

```bash
python -m orchestrator requirements-loop --project-root /path/to/project
```

Reads `PRD.md`, produces `requirements/overview/` (business problem, personas, success metrics, …) and `requirements/features/` (one FRD per feature). Five reviewers check structural shape, cross-doc consistency, PRD coverage, feature scoping, and PRD-to-tree fidelity.

**Precondition:** `PRD.md` exists at the project root.

### 2. blueprint-loop (`requirements/features/` → `blueprints/` tree)

```bash
python -m orchestrator blueprint-loop --project-root /path/to/project
```

Reads the approved FRD tree, produces `blueprints/{containers,components,features}/`. Five reviewers check per-blueprint shape, coverage of FRDs, cross-blueprint consistency, undecided architectural choices, and FRD-to-blueprint fidelity.

**Precondition:** `requirements-loop` has run to a pass.

**Optional input:** a `BLUEPRINT.md` at the project root acts as the operator's high-level architectural scratchpad — the generator treats it as authoritative starting context; the consistency and coverage judges flag drift.

### 3. work-orders-loop (`blueprints/` + existing code → `work-orders/` tree)

```bash
python -m orchestrator work-orders-loop --project-root /path/to/project
```

Reads the blueprints and the existing source code, produces flat slug-named work orders (`work-orders/wo-<slug>.md`) plus a `_sequence.md` drain order. Four reviewers check structural shape, coverage of blueprint surface, no-overlap of produced interfaces, and dependency sequencing.

**Precondition:** `blueprint-loop` has run to a pass.

### 4. coding-loop (drain `work-orders/` → merged PRs)

```bash
python -m orchestrator coding-loop --project-root /path/to/project [--one]
```

Walks `work-orders/_sequence.md`, picks the next ready work order, spawns one generator subprocess that writes code on `task/<wo-slug>` and opens a PR via `gh`. The orchestrator reads the work order's `## Gates` block and spawns the required reviewers in parallel — tests, Playwright, code-spec, code-regression, code-security, code-quality. On pass, posts a summary PR comment; status stays `in_progress` until you merge. On merge, the next `coding-loop` run transitions the work order to `done`.

**Precondition:** `work-orders-loop` has run to a pass.

**Flags:**
- `--one` — run a single work order and exit.
- `--base-branch <name>` — override the auto-detected default branch.
- `--memoryless` — disable session continuity within a work order.

---

## Project conventions

The autonomous loops read on-disk markdown, but the **coding loop** also runs *code* — and that part needs the project to conform to a small set of conventions.

### Required for any project the coding loop drives

- The project is a git repo with a default branch (`main` or `master`) and a working `gh` remote.
- The project's tests can be run via `make test` (the `tests-runner` reviewer invokes this).

### Required only if any work order's `## Gates` block declares `playwright: required`

The kit ships a bundled playwright harness at `playwright-harness/` (see [`BLUEPRINT.md §12`](BLUEPRINT.md)). The harness takes no config; instead, the project must satisfy these pinned conventions:

- **`Makefile` has `dev` and `playwright` targets.** `make dev` boots the app; `make playwright` runs the e2e suite.
- **App listens on `http://localhost:3000/`** when `make dev` is running. The harness wrapper polls `/` to know when the server is ready.
- **Playwright specs live in `tests/e2e/*.spec.ts`.** This is where the implementer skill writes new specs and where `code-spec-judge` looks for `via playwright` AC coverage.
- **`playwright.config.ts` at the project root**, copied from `playwright-harness/templates/` at bootstrap. Required for `npx playwright test` to work standalone (so GitHub Actions can re-run the suite without the kit checkout).
- **Browser binaries installed** (`npx playwright install`, ~500MB, one-time per machine).

The first work order in a project that needs Playwright should set these up; the `npx playwright install` step is filed as a one-time `operator-action` work order under `_external-blockers.md`.

A project that genuinely can't conform marks `playwright: not_applicable` in the relevant work order's `## Gates` block; the orchestrator skips Playwright for that WO.

---

## Where state lives

Everything under `harness/` in the project repo is committed to git and is the audit trail:

- `harness/state/<loop>.json` — per-loop state (requirements, blueprint, work-orders).
- `harness/state/<wo-slug>.json` — per-work-order state (coding loop).
- `harness/state/reviews/<loop>/[<wo-slug>/]attempt-<N>/<reviewer>.md` — frozen per-attempt snapshots of reviewer reviews.
- `harness/logs/<wo-slug-or-loop>/...` — hook logs.

The bidirectional generator↔reviewer transcripts live in `<loop>_communication/` (and `coding_communication/<wo-slug>/` for the coding loop). These folders are append-only and never wiped — they accumulate the project's full reviewer-generator conversation across attempts and across invocations.

---

## When things break

- **A loop exited with `awaiting_clarification` (exit code 2).** The generator surfaced a question it couldn't resolve. Look at `<artifact-tree>/_questions-pending.md` in the project repo, edit the source artifact named in the question (PRD, a blueprint, etc.), and re-run.
- **A loop exited `exhausted` (exit code 1).** The attempt cap was hit without a pass. Check the latest snapshot under `harness/state/reviews/<loop>/...` to see what every reviewer was saying. Either edit the source artifact and re-run, or bump `max_attempts` in `config.yaml` if you think one more attempt would have done it.
- **The coding loop posted an "attempts exhausted" comment on a PR.** Read the reviewers' reviews in the PR-linked `harness/state/reviews/coding-loop/<wo-slug>/...` directory, push manual fixes to the same branch, and (when satisfied) merge yourself. The next `coding-loop` invocation will pick up the next ready work order.
- **A work order is `blocked_external`.** The generator discovered it needs operator action (missing credentials, missing setup). Look at `work-orders/_external-blockers.md`, do the external thing, and flip the work order's `.wo-<slug>.meta.yaml.status` back to `ready`. Next `coding-loop` run picks it up.

---

## Common flags (every loop except `coding-loop`)

- `--skip-first-generator` — on attempt 1, skip the generator spawn and run reviewers directly against the existing tree. Useful when you've run the generator skill manually in an interactive Claude Code session and want to validate without a re-think.
- `--memoryless` — disable session continuity. Every attempt spawns a fresh `claude -p` subprocess; agents rely on the communication folder for prior context.

Exit codes for all four loops: `0` pass, `1` exhausted, `2` `awaiting_clarification` (upstream loops only; the coding loop never emits this).

---

## Layout of this repo

```
coding_harness/
  README.md                 # this file — operator manual
  PRD.md                    # design (read this if you want to understand "why")
  BLUEPRINT.md              # architecture (read this if you want to understand "how")
  config.yaml               # one config, every project: caps + per-role model selection
  orchestrator/             # the Python orchestrator
  skills/                   # generator + reviewer skill markdown
    requirements/
    blueprints/
    work-orders/
    coding/
  playwright-harness/       # bundled mechanism for the Playwright gate (see BLUEPRINT.md §12)
    with_server.py
    templates/
      playwright.config.ts
      smoke.spec.ts
  research/                 # background notes from the design phase
```
