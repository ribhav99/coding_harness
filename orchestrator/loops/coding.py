"""Coding-loop runtime (BLUEPRINT.md §3.3 / PRD §6.5).

Execution-only loop. Drains the ready work-order queue produced by the
work-orders loop, one work order per orchestrator subprocess. Each work order
runs through a per-WO attempt loop:

    spawn `implement-work-order` generator (writes code, opens PR)
        → orchestrator reads the WO's `## Gates` block
        → spawns the required reviewers IN PARALLEL
        → orchestrator aggregates VERDICT lines from each reviewer's stdout
        → any fail → re-spawn generator pointed at the per-WO comm folder
        → all pass → post final PR comment; status stays `in_progress` for operator merge
        → exhausted → record, post triage comment, move on
        → generator emitted `blocked_external` → record, move on

Per-WO communication folder at `coding_communication/<wo-slug>/<agent>.md`,
one file per agent (the generator + each reviewer). Both sides read and write
their reviewer file; the orchestrator snapshots into
`harness/state/reviews/coding-loop/<wo-slug>/attempt-<N>/` at attempt
boundaries and never wipes — the folder accumulates the full conversation
across attempts and across invocations forever.

Queue drain: by default the loop runs every ready WO in `_sequence.md` order
until the queue is empty. `--one` runs a single WO and exits.
"""

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .. import claude, comm, git_ops, meta, paths, verdict, wo_planner
from ..config import load_config
from ..hooks import settings as hook_settings
from ..state import WorkOrderState
from ..wo_planner import WorkOrder


LOOP_NAME = "coding-loop"
PASS_EXIT = 0
FAIL_EXIT = 1
NOTHING_TO_DO_EXIT = 0


def run_coding_loop(
    project_root: Path,
    *,
    one: bool = False,
    base_branch_override: str | None = None,
    memoryless: bool = False,
) -> int:
    """Top-level entrypoint. Returns a process exit code."""
    work_orders_root = project_root / "work-orders"
    if not work_orders_root.is_dir():
        sys.exit(
            f"error: {work_orders_root} not found — run work-orders-loop first to "
            f"produce the work-orders tree before running coding-loop"
        )
    if not (work_orders_root / wo_planner.SEQUENCE_FILE).exists():
        sys.exit(
            f"error: {work_orders_root / wo_planner.SEQUENCE_FILE} not found — "
            f"run work-orders-loop first to produce a drain order"
        )

    if not git_ops.is_git_repo(project_root):
        print(
            f"warning: {project_root} is not a git repo; the coding loop opens PRs and "
            "needs git history. Running anyway, but `open-task-pr` will fail.",
            file=sys.stderr,
        )

    config = load_config()
    base_branch = base_branch_override or git_ops.detect_base_branch(project_root)
    print(f"coding-loop: base branch = {base_branch}", flush=True)

    # 1. Sync any in_progress WOs whose PR has merged since last run.
    _sync_merged_prs(project_root, work_orders_root)

    # 2. Regenerate _external-blockers.md from current meta state.
    meta.reconcile_work_orders_tree(work_orders_root)

    # 3. Queue drain.
    drained = 0
    while True:
        wo = wo_planner.pick_next_ready(work_orders_root)
        if wo is None:
            if drained == 0:
                print("coding-loop: no ready work orders to drain.", flush=True)
            else:
                print(f"coding-loop: drained {drained} work order(s); queue empty.", flush=True)
            return NOTHING_TO_DO_EXIT

        print(f"\ncoding-loop: picking up {wo.slug}", flush=True)
        outcome = _run_one_work_order(
            wo=wo,
            project_root=project_root,
            base_branch=base_branch,
            config=config,
            memoryless=memoryless,
        )
        drained += 1
        # Regenerate blockers after each WO in case the generator updated meta.
        meta.reconcile_work_orders_tree(work_orders_root)
        if outcome == "fatal":
            return FAIL_EXIT
        if one:
            print(f"coding-loop: --one specified; exiting after {wo.slug}.", flush=True)
            return PASS_EXIT


def _sync_merged_prs(project_root: Path, work_orders_root: Path) -> None:
    """Detect merged PRs for `in_progress` WOs and transition them to `done`."""
    for slug in wo_planner.in_progress_slugs(work_orders_root):
        wo = wo_planner.load_work_order(work_orders_root, slug)
        if wo is None:
            continue
        branch = f"task/{slug}"
        _, _, state = git_ops.lookup_pr(project_root, branch)
        if state == "MERGED":
            print(f"  detected merged PR for {slug}; transitioning to done.", flush=True)
            wo_planner.set_status(wo, "done")


def _run_one_work_order(
    *,
    wo: WorkOrder,
    project_root: Path,
    base_branch: str,
    config: dict,
    memoryless: bool,
) -> str:
    """Run the per-WO attempt loop. Returns `"ok"`, `"blocked"`, `"exhausted"`, or `"fatal"`."""
    max_attempts: int = config["max_attempts"]
    max_wall_minutes: int = config["max_wall_minutes"]
    max_agent_retries: int = config["max_agent_retries"]
    model_generator: str = config["model_generator"]
    model_reviewer: str = config["model_reviewer"]
    timeout_seconds = max_wall_minutes * 60

    branch = f"task/{wo.slug}"
    title = wo_planner.read_title(wo)
    body_path_rel = str(wo.body_path.relative_to(project_root))

    # Mark in_progress and prepare the branch.
    wo_planner.set_status(wo, "in_progress")
    if git_ops.is_git_repo(project_root):
        if not git_ops.working_tree_clean(project_root):
            print(
                "  error: working tree is dirty before checkout; aborting this WO. "
                "Commit or stash and re-run.",
                file=sys.stderr,
            )
            wo_planner.set_status(wo, "ready")
            return "fatal"
        git_ops.checkout_task_branch(project_root, branch, base_branch)

    state = WorkOrderState(project_root, wo.slug)
    state.begin_invocation(
        max_attempts=max_attempts,
        max_wall_minutes=max_wall_minutes,
        title=title,
        body_path=body_path_rel,
        branch=branch,
    )
    state.save()

    gates = wo_planner.read_gates(wo)
    reviewer_skills = wo_planner.required_reviewer_skills(gates)
    print(
        f"  gates required: {', '.join(reviewer_skills) if reviewer_skills else '(none)'}",
        flush=True,
    )

    skill_body = _strip_frontmatter(paths.skill_path("implement-work-order").read_text())
    reviewer_skill_bodies = {
        name: _strip_frontmatter(paths.skill_path(name).read_text())
        for name in reviewer_skills
    }

    # Ensure the per-WO communication folder and touch each agent's file so
    # both sides can read on first attempt. The folder is never wiped — it
    # accumulates the full reviewer↔generator conversation across attempts
    # and across orchestrator invocations.
    comm_dir = comm.ensure_comm_folder(project_root, LOOP_NAME, wo_slug=wo.slug)
    for agent_name in ("implement-work-order", *reviewer_skills):
        agent_file = comm.comm_file_for(project_root, LOOP_NAME, agent_name, wo_slug=wo.slug)
        agent_file.touch(exist_ok=True)
    comm_dir_rel = str(comm_dir.relative_to(project_root))

    last_review_archive: Path | None = None
    failing_reviewers: list[str] = []

    for attempt in range(1, max_attempts + 1):
        print(f"\n  === {wo.slug} — attempt {attempt} of {max_attempts} ===", flush=True)

        # PR info from the prior attempt (empty on attempt 1).
        pr_number, pr_url, pr_state = git_ops.lookup_pr(project_root, branch)
        if pr_url is not None:
            state.set_pr_info(pr_url, pr_number)

        gen_session_id = None if memoryless else state.get_generator_session_id()
        if gen_session_id is None:
            gen_prompt = _build_generator_prompt(
                wo=wo,
                attempt=attempt,
                max_attempts=max_attempts,
                branch=branch,
                base_branch=base_branch,
                pr_url=pr_url,
                comm_dir_rel=comm_dir_rel,
                failing_reviewers=failing_reviewers,
            )
        else:
            gen_prompt = _build_generator_resume_prompt(
                wo=wo,
                attempt=attempt,
                max_attempts=max_attempts,
                comm_dir_rel=comm_dir_rel,
                failing_reviewers=failing_reviewers,
            )
        gen_spawn_label = f"{LOOP_NAME}-{wo.slug}-attempt-{attempt}-generator"
        gen_settings = hook_settings.write_generator_settings(project_root, gen_spawn_label)
        gen_counter = paths.hook_counter_path(project_root, gen_spawn_label)
        gen_env = _coding_env(
            wo=wo,
            branch=branch,
            base_branch=base_branch,
            pr_number=pr_number,
            pr_url=pr_url,
            agent_kind="generator",
            spawn_counter=gen_counter,
            max_agent_retries=max_agent_retries,
        )
        try:
            gen_result = claude.spawn_claude(
                user_prompt=gen_prompt,
                append_system_prompt=skill_body,
                cwd=project_root,
                settings_file=gen_settings,
                disallowed_tools=None,
                extra_env=gen_env,
                timeout_seconds=timeout_seconds,
                max_agent_retries=max_agent_retries,
                existing_session_id=gen_session_id,
                model=model_generator,
            )
        except claude.ClaudeSpawnError as e:
            print(f"  generator subprocess failed: {e}\n--- stderr ---\n{e.stderr}", file=sys.stderr)
            state.finalise("exhausted")
            state.save()
            wo_planner.set_status(wo, "ready")
            return "fatal"

        if not memoryless and gen_session_id is None:
            state.set_generator_session_id(gen_result.session_id)
        if gen_result.rate_limited_out:
            state.record_rate_limit_exhaustion("generator", attempt, gen_result.stderr)
            state.finalise("exhausted")
            state.save()
            wo_planner.set_status(wo, "ready")
            return "exhausted"

        gen_verdict, _ = verdict.parse_generator_verdict(gen_result.stdout)
        gen_summary_tail = _summary_tail(gen_result.stdout)

        # Refresh PR info now that the generator may have opened it.
        pr_number, pr_url, pr_state = git_ops.lookup_pr(project_root, branch)
        if pr_url is not None:
            state.set_pr_info(pr_url, pr_number)

        if gen_verdict == "blocked_external":
            archive = comm.snapshot_communication_folder(
                project_root, LOOP_NAME, attempt, wo_slug=wo.slug
            )
            state.record_attempt(
                n=attempt,
                verdict="blocked_external",
                summary=gen_summary_tail,
                review_dir=str(archive.relative_to(project_root)),
                reviewer_verdicts={},
            )
            state.finalise("blocked_external")
            state.save()
            wo_planner.set_status(wo, "blocked_external")
            print(f"  {wo.slug}: generator surfaced an external blocker; moving on.", flush=True)
            return "blocked"

        if gen_verdict is None:
            print(
                "  generator did not emit a recognised VERDICT trailer; "
                "treating attempt as fail.",
                file=sys.stderr,
            )

        # Reviewer fan-out (parallel).
        if not reviewer_skills:
            print(
                "  no reviewers required by this WO's Gates block; "
                "auto-passing (this is unusual — typically only operator-action WOs lack gates).",
                flush=True,
            )
            review_verdicts: dict[str, str] = {}
            rate_limited: list[dict] = []
            new_sessions: dict[str, str] = {}
        else:
            review_verdicts, rate_limited, new_sessions = _run_reviewers_parallel(
                project_root=project_root,
                wo=wo,
                attempt=attempt,
                max_attempts=max_attempts,
                branch=branch,
                base_branch=base_branch,
                pr_number=pr_number,
                pr_url=pr_url,
                reviewer_skills=reviewer_skills,
                reviewer_skill_bodies=reviewer_skill_bodies,
                timeout_seconds=timeout_seconds,
                max_agent_retries=max_agent_retries,
                memoryless=memoryless,
                model=model_reviewer,
                reviewer_session_ids={
                    name: state.get_reviewer_session_id(name) for name in reviewer_skills
                },
            )
            if not memoryless:
                for name, sid in new_sessions.items():
                    state.set_reviewer_session_id(name, sid)
            if rate_limited:
                for entry in rate_limited:
                    state.record_rate_limit_exhaustion(
                        "reviewer", attempt, entry["stderr"], reviewer_name=entry["reviewer"]
                    )
                state.finalise("exhausted")
                state.save()
                wo_planner.set_status(wo, "ready")
                return "exhausted"

        archive = comm.snapshot_communication_folder(
            project_root, LOOP_NAME, attempt, wo_slug=wo.slug
        )
        last_review_archive = archive

        # `not_run` counts as not-a-failure (skipped gate, e.g. no UI ACs).
        all_pass = all(v in ("pass", "not_run") for v in review_verdicts.values())

        attempt_verdict = "pass" if all_pass else "fail"
        state.record_attempt(
            n=attempt,
            verdict=attempt_verdict,
            summary=gen_summary_tail,
            review_dir=str(archive.relative_to(project_root)),
            reviewer_verdicts=review_verdicts,
        )

        if all_pass:
            state.finalise("pass")
            state.save()
            _post_pass_comment(
                project_root=project_root,
                pr_number=pr_number,
                wo_slug=wo.slug,
                attempt=attempt,
                gen_summary=gen_summary_tail,
                review_verdicts=review_verdicts,
            )
            # Status stays `in_progress` until the operator merges.
            print(
                f"  {wo.slug}: ALL GATES PASSED (attempt {attempt}). "
                f"Status remains in_progress until operator merges PR.",
                flush=True,
            )
            return "ok"

        # Prepare retry: pass the failing reviewer names through so the
        # generator's resume prompt can name them; the prose review lives in
        # each reviewer's comm file and the generator reads from there.
        failing_reviewers = [
            name for name, v in review_verdicts.items()
            if v not in ("pass", "not_run")
        ]
        state.save()
        print(
            f"  attempt {attempt}: "
            f"{sum(1 for v in review_verdicts.values() if v == 'pass')} pass, "
            f"{sum(1 for v in review_verdicts.values() if v not in ('pass', 'not_run'))} fail. "
            f"Retrying.",
            flush=True,
        )

    # Exhausted.
    state.finalise("exhausted")
    state.save()
    _post_exhausted_comment(
        project_root=project_root,
        pr_number=pr_number,
        wo_slug=wo.slug,
        attempts=max_attempts,
        last_review_dir=last_review_archive,
    )
    # Status remains in_progress so the operator can pick it up and decide
    # whether to push more fixes by hand or close the PR.
    print(
        f"  {wo.slug}: exhausted after {max_attempts} attempts. "
        f"Status remains in_progress for operator triage.",
        flush=True,
    )
    return "exhausted"


def _run_reviewers_parallel(
    *,
    project_root: Path,
    wo: WorkOrder,
    attempt: int,
    max_attempts: int,
    branch: str,
    base_branch: str,
    pr_number: int | None,
    pr_url: str | None,
    reviewer_skills: list[str],
    reviewer_skill_bodies: dict[str, str],
    timeout_seconds: int,
    max_agent_retries: int,
    memoryless: bool,
    model: str,
    reviewer_session_ids: dict[str, str | None],
) -> tuple[dict[str, str], list[dict], dict[str, str]]:
    """Spawn all reviewers concurrently. Returns (verdicts, rate_limited, new_sessions).

    Each reviewer appends its full review (a `## Review` block) to its own
    comm file in `coding_communication/<wo-slug>/<reviewer-name>.md` and
    emits a short stdout acknowledgement ending with a `VERDICT:` line that
    the orchestrator parses. The PreToolUse path-guard hook blocks any
    Write/Edit on a path other than the reviewer's own comm file, so the
    diff under review cannot be mutated.

    Reviewer disallowed tools: `NotebookEdit, Task`. `Bash` is allowed —
    execution gates run their suite; LLM judges run `git diff` to read the
    diff. `Write, Edit` are allowed but path-guarded to the comm file only.
    """
    verdicts: dict[str, str] = {}
    rate_limited: list[dict] = []
    new_sessions: dict[str, str] = {}

    def _one(reviewer_name: str) -> tuple[str, claude.ClaudeResult | None, str | None]:
        comm_file = comm.comm_file_for(project_root, LOOP_NAME, reviewer_name, wo_slug=wo.slug)
        comm_file.parent.mkdir(parents=True, exist_ok=True)
        comm_file.touch(exist_ok=True)

        existing_sid = None if memoryless else reviewer_session_ids.get(reviewer_name)
        if existing_sid is None:
            rev_prompt = _build_reviewer_prompt(
                reviewer_name=reviewer_name,
                wo=wo,
                attempt=attempt,
                max_attempts=max_attempts,
                branch=branch,
                base_branch=base_branch,
                comm_file_rel=str(comm_file.relative_to(project_root)),
            )
        else:
            rev_prompt = _build_reviewer_resume_prompt(
                reviewer_name=reviewer_name,
                wo=wo,
                attempt=attempt,
                max_attempts=max_attempts,
                branch=branch,
                base_branch=base_branch,
                comm_file_rel=str(comm_file.relative_to(project_root)),
            )

        rev_spawn_label = f"{LOOP_NAME}-{wo.slug}-attempt-{attempt}-{reviewer_name}"
        rev_settings = hook_settings.write_reviewer_settings(project_root, rev_spawn_label)
        rev_counter = paths.hook_counter_path(project_root, rev_spawn_label)
        rev_env = _coding_env(
            wo=wo,
            branch=branch,
            base_branch=base_branch,
            pr_number=pr_number,
            pr_url=pr_url,
            agent_kind="reviewer",
            spawn_counter=rev_counter,
            max_agent_retries=max_agent_retries,
        )
        rev_env["HARNESS_REVIEWER_NAME"] = reviewer_name
        rev_env["HARNESS_REVIEWER_COMM_FILE"] = str(comm_file.resolve())
        try:
            res = claude.spawn_claude(
                user_prompt=rev_prompt,
                append_system_prompt=reviewer_skill_bodies[reviewer_name],
                cwd=project_root,
                settings_file=rev_settings,
                disallowed_tools=["NotebookEdit", "Task"],
                extra_env=rev_env,
                timeout_seconds=timeout_seconds,
                max_agent_retries=max_agent_retries,
                existing_session_id=existing_sid,
                model=model,
            )
        except claude.ClaudeSpawnError as e:
            return reviewer_name, None, f"spawn error: {e}"
        return reviewer_name, res, None

    print(f"  spawning {len(reviewer_skills)} reviewers in parallel", flush=True)
    with ThreadPoolExecutor(max_workers=len(reviewer_skills)) as pool:
        futures = [pool.submit(_one, name) for name in reviewer_skills]
        for fut in as_completed(futures):
            name, res, err = fut.result()
            if err is not None:
                print(f"  {name}: {err}", file=sys.stderr)
                verdicts[name] = "fail"
                continue
            if res is None:
                verdicts[name] = "fail"
                continue
            if res.rate_limited_out:
                rate_limited.append({"reviewer": name, "stderr": res.stderr})
                verdicts[name] = "fail"
                continue
            if not memoryless and reviewer_session_ids.get(name) is None:
                new_sessions[name] = res.session_id
            v = verdict.parse_reviewer_verdict(res.stdout)
            if v is None:
                print(
                    f"  {name}: malformed VERDICT trailer; recording as fail",
                    file=sys.stderr,
                )
                verdicts[name] = "fail"
            else:
                verdicts[name] = v
                print(f"  {name}: {v}", flush=True)
    return verdicts, rate_limited, new_sessions


def _coding_env(
    *,
    wo: WorkOrder,
    branch: str,
    base_branch: str,
    pr_number: int | None,
    pr_url: str | None,
    agent_kind: str,
    spawn_counter: Path,
    max_agent_retries: int,
) -> dict[str, str]:
    env = {
        "HARNESS_AGENT_KIND": agent_kind,
        "HARNESS_LOOP_NAME": LOOP_NAME,
        "HARNESS_MAX_AGENT_RETRIES": str(max_agent_retries),
        "HARNESS_STOP_HOOK_COUNTER": str(spawn_counter),
        "HARNESS_TASK_ID": wo.slug,
        "HARNESS_BRANCH": branch,
        "HARNESS_BASE_BRANCH": base_branch,
        "HARNESS_WO_PATH": str(wo.body_path),
        "PLAYWRIGHT_HARNESS_ROOT": str(paths.PLAYWRIGHT_HARNESS_DIR),
    }
    if pr_number is not None:
        env["HARNESS_PR_NUMBER"] = str(pr_number)
    if pr_url:
        env["HARNESS_PR_URL"] = pr_url
    return env


def _build_generator_prompt(
    *,
    wo: WorkOrder,
    attempt: int,
    max_attempts: int,
    branch: str,
    base_branch: str,
    pr_url: str | None,
    comm_dir_rel: str,
    failing_reviewers: list[str],
) -> str:
    pr_block = (
        f"There is an existing PR for this branch: {pr_url}. Subsequent pushes update it; do NOT call open-task-pr again."
        if pr_url
        else "No PR exists yet for this branch. On your first commit worth reviewing, call the `open-task-pr` skill to open one."
    )
    if failing_reviewers:
        failing_block = "\n".join(f"- {name}" for name in failing_reviewers)
        reviewer_section = f"""
## Failing reviewers from the previous attempt

{failing_block}

Read each failing reviewer's file in `{comm_dir_rel}/` to see their fresh
review (the latest `## Review` block at the bottom of each file is the most
recent). Address every finding — fix, push back with cited evidence, or
surface as a gap. Append your per-finding responses (and a change-summary
of what you pushed this attempt) to the SAME files you read from, preserving
all prior content verbatim — never overwrite or modify content already in the
file.
"""
    else:
        reviewer_section = ""

    your_outbound = f"{comm_dir_rel}/implement-work-order.md"
    return f"""# Coding loop — {wo.slug} — attempt {attempt} of {max_attempts}

You are implementing **{wo.slug}** on branch **{branch}**. Base branch is **{base_branch}**.

Read the work-order body in full before writing any code:
    {wo.body_path}

The body holds the Goal, In/Out scope, Produces/Depends on contracts, the
Acceptance criteria checklist (each row tagged `via tests`, `via playwright`,
or `via code-spec`), and the `## Gates` block (which reviewers will run after
you exit).

Environment variables already set for you:
- HARNESS_TASK_ID = {wo.slug}
- HARNESS_BRANCH = {branch}
- HARNESS_BASE_BRANCH = {base_branch}
- HARNESS_WO_PATH = {wo.body_path}

## Communication folder

The per-work-order communication folder is at: `{comm_dir_rel}/`. One file per
agent (the generator + each reviewer). Reviewers append `## Review` blocks to
their own files after you exit. Your outbound file is `{your_outbound}` — append
a per-attempt change-summary there describing what you pushed this attempt.

Both you and the reviewers read and write these files. Preserve all prior
content verbatim — never overwrite or modify content already in the files.
The orchestrator snapshots the folder to
`harness/state/reviews/coding-loop/{wo.slug}/attempt-<N>/` at each attempt
boundary and never wipes the live folder, so the conversation accumulates
forever.

{pr_block}
{reviewer_section}

End your stdout summary with one of these lines:
  VERDICT: ready_for_review
  VERDICT: blocked_external

`blocked_external` is only correct if you discovered mid-implementation that
operator action is required (missing credentials / external setup / sample
data) and you cannot proceed without it. Otherwise emit `ready_for_review`.
"""


def _build_generator_resume_prompt(
    *,
    wo: WorkOrder,
    attempt: int,
    max_attempts: int,
    comm_dir_rel: str,
    failing_reviewers: list[str],
) -> str:
    failing_block = "\n".join(f"- {name}" for name in failing_reviewers) or "- (none — unusual on a resume)"
    return f"""# Continuing {wo.slug} — attempt {attempt} of {max_attempts}

Failing reviewers this attempt:
{failing_block}

Read each failing reviewer's file in `{comm_dir_rel}/` to see their fresh
review. Append your per-finding responses (and a change-summary describing
what you pushed this attempt) to the SAME files you read from, preserving all
prior content verbatim. Also append a per-attempt change-summary to
`{comm_dir_rel}/implement-work-order.md`.

Then push more commits to {wo.slug}'s existing PR (do NOT call open-task-pr
again — it is idempotent but unnecessary on retries) and re-emit the exit
summary.

End your stdout summary with one of:
  VERDICT: ready_for_review
  VERDICT: blocked_external
"""


def _build_reviewer_prompt(
    *,
    reviewer_name: str,
    wo: WorkOrder,
    attempt: int,
    max_attempts: int,
    branch: str,
    base_branch: str,
    comm_file_rel: str,
) -> str:
    return f"""# Coding loop review — {wo.slug} — attempt {attempt} of {max_attempts}
# Reviewer: {reviewer_name}

The implementation generator has just finished writing code on branch **{branch}**.
Base branch is **{base_branch}**. The diff under review is `git diff {base_branch}...{branch}`.

Inputs:
- Work order body: {wo.body_path}
- Branch: {branch}
- Base branch: {base_branch}
- Diff: `git diff {base_branch}...{branch}` (or `git log --oneline {base_branch}..{branch}` for commit list)
- Your communication file: {comm_file_rel}

Run your review per the {reviewer_name} skill. Append a `## Review` block to your
communication file at `{comm_file_rel}` (preserve all prior content verbatim —
do not overwrite). The path-guard hook will block Write/Edit on any other path.

End your final chat message with exactly one line, on its own:
  VERDICT: pass
  VERDICT: fail
  VERDICT: not_run    (execution gates only — when the gate isn't applicable to this WO)
"""


def _build_reviewer_resume_prompt(
    *,
    reviewer_name: str,
    wo: WorkOrder,
    attempt: int,
    max_attempts: int,
    branch: str,
    base_branch: str,
    comm_file_rel: str,
) -> str:
    return f"""# Continuing review — {wo.slug} — attempt {attempt} of {max_attempts}
# Reviewer: {reviewer_name}

The generator has pushed new commits to {branch} and (likely) appended responses
to your communication file at `{comm_file_rel}`. Re-read the latest state of
{comm_file_rel} and re-run your review against the updated diff
(`git diff {base_branch}...{branch}`), then append a fresh `## Review` block to
{comm_file_rel} (preserve all prior content verbatim). Write/Edit on any path
other than that file is blocked.

End your final chat message with exactly one line, on its own:
  VERDICT: pass
  VERDICT: fail
  VERDICT: not_run    (execution gates only)
"""


def _post_pass_comment(
    *,
    project_root: Path,
    pr_number: int | None,
    wo_slug: str,
    attempt: int,
    gen_summary: str,
    review_verdicts: dict[str, str],
) -> None:
    if pr_number is None:
        print(
            f"  no PR detected for {wo_slug}; skipping pass comment.",
            file=sys.stderr,
        )
        return
    verdict_lines = "\n".join(f"- `{name}`: {v}" for name, v in review_verdicts.items())
    body = f"""## Coding loop — all gates passed (attempt {attempt})

### Reviewer verdicts
{verdict_lines}

### Generator's exit summary
{gen_summary}

Status remains `in_progress` until the operator merges this PR. The next
`coding-loop` run will detect the merge and transition `{wo_slug}` to `done`.
"""
    ok = git_ops.post_pr_comment(project_root, pr_number, body)
    if not ok:
        print(f"  failed to post pass comment to PR #{pr_number}.", file=sys.stderr)


def _post_exhausted_comment(
    *,
    project_root: Path,
    pr_number: int | None,
    wo_slug: str,
    attempts: int,
    last_review_dir: Path | None,
) -> None:
    if pr_number is None:
        return
    review_path = (
        str(last_review_dir.relative_to(project_root)) if last_review_dir else "(no archive)"
    )
    body = f"""## Coding loop — attempts exhausted

`{wo_slug}` did not converge after {attempts} attempts. Reviewer logs from the
final attempt: `{review_path}`.

Operator action needed: read the final reviews, decide whether to push manual
fixes (status remains `in_progress`) or close the PR and re-scope the work
order.
"""
    git_ops.post_pr_comment(project_root, pr_number, body)


def _strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    if end == -1:
        return text
    return text[end + 5:].lstrip()


def _summary_tail(text: str, limit: int = 4000) -> str:
    if len(text) <= limit:
        return text
    return "...\n" + text[-limit:]
