# Shared skills in Codex

Resolve this shared file's real path before following its relative links;
installed skill folders link here through a symlink.

Check the session environment first. If `FM2_TASK` or `FM2_PANEL` is nonempty,
read [the fm CLI runtime](cli-runtime.md); its session, tool, and reporting rules
take precedence over app-specific instructions here. Otherwise this is the native
app workflow. The presence of a terminal or an installed `fm` command does not
select CLI mode.

Read the linked source procedure in full and retain its domain rules, evidence
requirements, and document formats. The following replaces its Claude/Python
harness invocation and reporting mechanics. Project instructions and the user's
current scope and authorization remain authoritative.

## Context and tools

Obtain the actual project, work order, source documents, review base, and changed
files from the assignment and repository. Include staged, unstaged, and untracked
changes when they are in the requested local review scope. Do not assume
`HARNESS_*` variables, `main` as the base branch, pre-passed tests, hidden path
guards, or a running orchestrator. Missing evidence is unknown, never a pass.
Use real gate output for the reviewed revision when judging tests or acceptance
criteria. Existing unchanged tests can prove a criterion; inspect their coverage
and current results instead of requiring a new test in the diff.

If a code review has no formal work order, use the actual request and documented
interfaces as its criteria. If intended behavior cannot be established, report
that limit; do not invent acceptance-criterion IDs or fail solely because a
harness work-order file is absent.

Use the session's file/shell tools where the source names Read, Write, Edit, or
Bash. Use the available Codex subagent tools where it names Task/subagents. Keep
work within the current task unless a separate sidebar task was explicitly requested. In a
judge assignment, read the assigned primary documents directly; do not delegate
their reading to a summarizing agent. Tool availability is not proof that hooks
or write restrictions are installed: uphold the judge's read-only scope yourself.

Read `AGENTS.md` and the applicable project rules before touching a path. Where a
project keeps shared guidance under `.claude/rules/`, use that real directory;
never invent `.Codex/rules/`. Resolve links in a source procedure relative to its
resolved source file, not the user skill directory or the project under review.
Preserve document mention syntax and verify its targets; use absolute Markdown
file links in app responses rather than assuming mentions become clickable links.

## Review and communication

Return findings, evidence, and uncertainty to the parent task through the native
subagent result or to the user in the current task. Preserve detailed coverage
tables and per-finding dispositions needed to assess the work. A source `VERDICT`
may be included in a judge result but does not drive an automatic retry loop.

If a project already has `*_communication/` or pending-question files, read the
relevant full records as historical context. Preserve them. Do not create or
append communication files solely to exchange native agent messages. Ask needed
questions in the task and continue independent work; do not silently log the only
copy of a blocking question to a file. Persist decisions in the affected product
document when appropriate, without inventing the user's answer. A pending marker
in a document still needs an identifiable recorded question. User answers and
existing approved decisions, including root `BLUEPRINT.md`, count as grounding.

## Planning artifacts

For `prd-to-frds`, `frd-to-blueprint`, and `blueprint-to-work-orders`, preserve the
canonical document trees, stable IDs, grounding, dependency order, and the
source's scope boundaries. Do not run the Python orchestrator or claim it will
materialize metadata after the turn. Do not generate hidden meta/status files,
automatically drain work orders, or rely on `.sequence.meta.yaml` hash equality
to skip inspecting the current documents and code. Read `_sequence.md` as a
product planning artifact; it is not a task scheduler in the app.

When a reviewed planning stage is requested, use these independent judge lenses
in available-capacity waves, with the actual source artifacts and a read-only
assignment. Reconcile their findings against the source; rerun the affected
lenses after substantive corrections. Do not silently omit a lens or lower the
review standard because of the concurrency limit.

| Stage | Judges |
| --- | --- |
| Requirements | req-spec-judge, req-cross-doc-judge, req-coverage-judge, req-scoping-judge, req-prd-fidelity-judge |
| Blueprints | bp-spec-judge, bp-consistency-judge, bp-coverage-judge, bp-decision-judge, bp-frd-fidelity-judge |
| Work orders | wo-spec-judge, wo-coverage-judge, wo-overlap-judge, wo-sequencing-judge |

A request for one document does not start all downstream stages. When the user
requests the next stage, invoke its native skill: `prd-to-frds`, then
`frd-to-blueprint`, then `blueprint-to-work-orders` (the source's
`blueprint-to-tasks` name is stale). Keep genuine source ambiguities visible to
the user and finish the parts that are grounded.
