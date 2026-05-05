# Coding Harness

A reusable harness for running long-horizon coding work through Claude Code
autonomously. See [`PRD.md`](PRD.md) for the full design.

## Layout

- `PRD.md` — design document.
- `skills/` — source markdown for the Claude Code skills (planning + execution).
- `.claude/skills/` — the same skills in the form Claude Code loads them
  (`<name>/SKILL.md`). Symlink each subdirectory into `~/.claude/skills/` to
  make the harness skills available in every repo on your machine.
- `orchestrator/` — Python entry points.
  - `__main__.py` — `python -m orchestrator <subcommand>`. v0.1 ships
    `requirements-loop` (PRD → reviewed FRD tree).
  - `sync_from_sf.py` — pulls requirements documents from a Software Factory
    deployment into a local project repo.
- `research/` — background notes from the design phase.

A project repo's on-disk layout (`requirements/`, `blueprints/`,
`work-orders/`, `artifacts/`) is defined by the skills themselves — they
create whatever directories they need on first use. No template to clone.

## Sync from Software Factory

The harness can mirror a project's requirements (PRD overview sections + FRDs,
recursively including children) from a deployed SF instance into the project's
own repo. The script is run from inside the project repo:

```bash
cd /path/to/some-project-repo
python /path/to/coding_harness/orchestrator/sync_from_sf.py
```

Each project repo carries its own `.env` with the SF credentials:

```
SF_API_KEY=sf-...
SF_BASE_URL=https://api.factory.8090.dev
SF_PROJECT_ID=<uuid>
```

`.env` must be gitignored. The script writes documents flat inside
`requirements/overview/` and `requirements/features/` in the project repo
root. Each node is three sibling files at the same level: a visible
`<slug>.md` content file plus two dotted-hidden meta files
(`.<slug>.<overview|feature>.meta.yaml` and `.<slug>.requirements.meta.yaml`).
If a node has children, they live in a sibling dir named `<slug>_children/`
with the same flat shape, recursively. Existing files are overwritten on each
sync; other top-level dirs (`blueprints/`, `work-orders/`, `artifacts/`) are
untouched.

Use `--tree` to print the requirements tree without writing anything.

The API path is `/v2/external-api/requirements/...` on the SF host; routes are
documented in
`sf-platform/backend/software_factory/modules/external_api/controllers/`.

## Requirements loop (v0.1)

```bash
python -m orchestrator requirements-loop --project-root /path/to/project
```

Drives Stage 2 of the harness: reads `PRD.md`, decomposes it into
`requirements/overview/` and `requirements/features/`, runs four reviewers
(`req-spec-judge`, `req-cross-doc-judge`, `req-coverage-judge`,
`req-scoping-judge`), iterates on failures, commits on pass when the project
repo is a git repo.

**Optional flags.**

- `--skip-first-generator` — on attempt 1, skip the generator and run
  reviewers directly against the existing `requirements/` tree. Use this
  when you've run `prd-to-frds` manually (e.g. in an interactive Claude
  Code session) and want to validate the result without the generator
  re-thinking it. If reviewers fail, attempts 2+ run the generator
  normally with the failing reviewers' feedback.
- `--memoryless` — disable session continuity. Every attempt spawns a
  fresh `claude -p` subprocess for both the generator and each reviewer,
  and they rely on the communication folder for prior context. Default
  behavior is to resume the same session across attempts within an
  invocation (each new invocation still starts fresh — sessions are
  per-invocation, not persisted across orchestrator runs). Use
  `--memoryless` for a clean replay or when you've edited `PRD.md` /
  the artifact tree mid-invocation and want the agents to re-derive
  without prior bias.

**Git is a soft requirement.** If the project repo isn't a git repo, the
orchestrator runs in no-commit mode — reviewers, state files, and the
communication folder still work; commits are skipped with a warning. To
capture a per-pass diff in git history, `git init` and make an initial
commit before running.

**Communication folder is never wiped.** The
`requirements_communication/<reviewer>.md` files accumulate the
generator-vs-reviewer conversation across every attempt and every
invocation, even after a full pass. With session-resume on (the default)
the folder is the operator audit trail and the cross-invocation /
`--memoryless` fallback memory channel; with `--memoryless` it's the
agents' only memory of prior attempts.

Loop caps live in `config.yaml` at the **harness** repo root (this kit), not
in each project repo. Edit it there once; it applies to every project the
orchestrator is run against.

```yaml
max_attempts: 25
max_wall_minutes: 60
max_agent_retries: 3   # per-subprocess: rate-limit re-spawns and Stop-hook in-session retries
mirrors: []            # v0.1 has no mirrors; placeholder for v1.0
```

Exit codes: `0` full pass, `1` exhausted, `2` `awaiting_clarification` (open
questions in `requirements/_questions-pending.md` block further progress —
operator clarifies `PRD.md` and re-runs).

## Blueprint loop (v0.2)

```bash
python -m orchestrator blueprint-loop --project-root /path/to/project
```

Drives Stage 3 of the harness: reads the approved `requirements/features/`
tree (and the optional project-root `BLUEPRINT.md` if present), produces
the structural blueprints tree under `blueprints/{containers,components,features}/`,
runs four reviewers (`bp-spec-judge`, `bp-coverage-judge`,
`bp-consistency-judge`, `bp-decision-judge`), iterates on failures, commits
on pass when the project repo is a git repo. When the generator hits an
architectural choice that requires operator judgment, it appends a question
block to `blueprints/_questions-pending.md` and the loop exits
`awaiting_clarification` (exit code 2) — operator answers in the file and
re-runs.

Same flags as `requirements-loop`: `--skip-first-generator`, `--memoryless`.
Same retry, session-continuity, and communication-folder semantics.

Precondition: `requirements/features/` must contain at least one FRD —
run `requirements-loop` to a pass first.

Optional input: a `BLUEPRINT.md` at the project repo root acts as the
operator's high-level architectural scratchpad. The generator treats it as
an authoritative starting point (component lists, data-model sketches,
stack choices); `bp-coverage-judge` and `bp-consistency-judge` flag drift
between it and the generated blueprints. Absent is fine — the generator
proceeds without it.
