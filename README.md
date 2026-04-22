# Coding Harness

A reusable harness for running long-horizon coding work through Claude Code
autonomously. See [`PRD.md`](PRD.md) for the full design.

## Layout

- `PRD.md` — design document.
- `skills/` — reusable Claude Code skills (planning + execution).
- `orchestrator/` — Python entry points.
  - `sync_from_sf.py` — pulls requirements documents from a Software Factory
    deployment into a local project repo.
- `project-template/` — reference skeleton matching SF's entity model
  (PRD §6.2.1). Clone into a new repo to start a project. One repo per project.
- `research/` — background notes from the design phase.

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
