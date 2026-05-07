"""Shared per-attempt driver. One loop subcommand passes a `LoopSpec` and runs.

Implements BLUEPRINT.md §3.2 (the shared driver pseudocode):
    wipe comm folder; for each attempt: spawn generator → spawn reviewers →
    aggregate verdicts → snapshot + commit on pass / continue on fail /
    snapshot + commit + exit-2 on awaiting_clarification.
"""

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import claude, comm, git_ops, paths, verdict
from .config import load_config
from .hooks import settings as hook_settings
from .loops.requirements import LoopSpec
from .state import LoopState


PASS_EXIT = 0
FAIL_EXIT = 1
AWAITING_EXIT = 2


def run_loop(
    spec: LoopSpec,
    project_root: Path,
    *,
    skip_first_generator: bool = False,
    memoryless: bool = False,
) -> int:
    spec.precondition(project_root)

    config = load_config()
    max_attempts: int = config["max_attempts"]
    max_wall_minutes: int = config["max_wall_minutes"]
    max_agent_retries: int = config["max_agent_retries"]
    model_generator: str = config["model_generator"]
    model_reviewer: str = config["model_reviewer"]
    timeout_seconds = max_wall_minutes * 60

    state = LoopState(project_root, spec.name)
    state.begin_invocation(max_attempts, max_wall_minutes)
    state.save()

    skill_body = _strip_frontmatter(paths.skill_path(spec.generator_skill).read_text())
    reviewer_skill_bodies = {
        name: _strip_frontmatter(paths.skill_path(name).read_text())
        for name in spec.reviewers
    }

    comm.ensure_comm_folder(project_root, spec.name)
    if not git_ops.is_git_repo(project_root):
        print(
            f"warning: {project_root} is not a git repo; running in no-commit mode. "
            "Reviews and state still write to harness/state/.",
            file=sys.stderr,
        )

    failing_reviewers: list[str] = []
    last_summary = ""

    for attempt in range(1, max_attempts + 1):
        print(f"\n=== {spec.name} — attempt {attempt} of {max_attempts} ===", flush=True)

        skip_generator_this_attempt = skip_first_generator and attempt == 1

        if skip_generator_this_attempt:
            print(
                "  [skipping generator on attempt 1: --skip-first-generator was passed]",
                flush=True,
            )
            spec.post_generator(project_root)
        else:
            gen_session_id = None if memoryless else state.get_generator_session_id()
            if gen_session_id is None:
                gen_prompt = spec.build_generator_prompt(
                    project_root=project_root,
                    attempt=attempt,
                    max_attempts=max_attempts,
                    failing_reviewers=failing_reviewers,
                )
            else:
                gen_prompt = spec.build_generator_resume_prompt(
                    project_root=project_root,
                    attempt=attempt,
                    max_attempts=max_attempts,
                    failing_reviewers=failing_reviewers,
                )
            gen_spawn_label = f"{spec.name}-attempt-{attempt}-generator"
            gen_settings = hook_settings.write_generator_settings(project_root, gen_spawn_label)
            gen_counter = paths.hook_counter_path(project_root, gen_spawn_label)
            try:
                gen_result = claude.spawn_claude(
                    user_prompt=gen_prompt,
                    append_system_prompt=skill_body,
                    cwd=project_root,
                    settings_file=gen_settings,
                    disallowed_tools=None,
                    extra_env={
                        "HARNESS_AGENT_KIND": "generator",
                        "HARNESS_LOOP_NAME": spec.name,
                        "HARNESS_MAX_AGENT_RETRIES": str(max_agent_retries),
                        "HARNESS_STOP_HOOK_COUNTER": str(gen_counter),
                    },
                    timeout_seconds=timeout_seconds,
                    max_agent_retries=max_agent_retries,
                    existing_session_id=gen_session_id,
                    model=model_generator,
                )
            except claude.ClaudeSpawnError as e:
                print(f"generator subprocess failed: {e}\n--- stderr ---\n{e.stderr}", file=sys.stderr)
                return _finalise(state, "exhausted", FAIL_EXIT, project_root, spec.name, attempt)

            if not memoryless and gen_session_id is None:
                state.set_generator_session_id(gen_result.session_id)

            if gen_result.rate_limited_out:
                state.record_rate_limit_exhaustion("generator", attempt, gen_result.stderr)
                return _finalise(state, "exhausted", FAIL_EXIT, project_root, spec.name, attempt)

            last_summary = gen_result.stdout
            spec.post_generator(project_root)

            gen_verdict, meta_fields = verdict.parse_generator_verdict(gen_result.stdout)
            if gen_verdict == "awaiting_clarification":
                archive = comm.snapshot_communication_folder(project_root, spec.name, attempt)
                state.record_attempt(
                    n=attempt,
                    verdict="awaiting_clarification",
                    summary=_summary_tail(gen_result.stdout),
                    review_dir=str(archive.relative_to(project_root)),
                    reviewer_verdicts={},
                    open_questions=int(meta_fields.get("open_questions", 0)),
                )
                state.finalise("awaiting_clarification")
                state.save()
                _commit_with_warn(
                    project_root,
                    spec.commit_paths,
                    f"{spec.name}: attempt {attempt} — awaiting_clarification",
                )
                print(_awaiting_summary(spec.questions_file, meta_fields), flush=True)
                return AWAITING_EXIT

        if not skip_generator_this_attempt and gen_verdict is None:
            print(
                "generator did not emit a recognised VERDICT trailer; treating attempt as fail.",
                file=sys.stderr,
            )

        review_verdicts, hit_rate_limit, new_reviewer_sessions = _run_reviewers_parallel(
            spec=spec,
            attempt=attempt,
            max_attempts=max_attempts,
            project_root=project_root,
            reviewer_skill_bodies=reviewer_skill_bodies,
            timeout_seconds=timeout_seconds,
            max_agent_retries=max_agent_retries,
            memoryless=memoryless,
            model=model_reviewer,
            reviewer_session_ids={
                name: state.get_reviewer_session_id(name) for name in spec.reviewers
            },
        )
        if not memoryless:
            for name, sid in new_reviewer_sessions.items():
                state.set_reviewer_session_id(name, sid)
        if hit_rate_limit:
            for entry in hit_rate_limit:
                state.record_rate_limit_exhaustion(
                    "reviewer", attempt, entry["stderr"], reviewer_name=entry["reviewer"]
                )
            return _finalise(state, "exhausted", FAIL_EXIT, project_root, spec.name, attempt)

        archive = comm.snapshot_communication_folder(project_root, spec.name, attempt)
        open_q = _count_open_questions(project_root / spec.questions_file)
        reviewers_all_pass = all(v == "pass" for v in review_verdicts.values())

        if reviewers_all_pass and open_q == 0:
            attempt_verdict = "pass"
        elif reviewers_all_pass and open_q > 0:
            attempt_verdict = "awaiting_clarification"
        else:
            attempt_verdict = "fail"

        state.record_attempt(
            n=attempt,
            verdict=attempt_verdict,
            summary=_summary_tail(last_summary),
            review_dir=str(archive.relative_to(project_root)),
            reviewer_verdicts=review_verdicts,
            open_questions=open_q,
        )

        if attempt_verdict == "pass":
            state.finalise("pass")
            state.save()
            _commit_with_warn(
                project_root,
                spec.commit_paths,
                f"{spec.name}: attempt {attempt} passed",
            )
            print(f"\nALL REVIEWERS PASSED (attempt {attempt}).", flush=True)
            return PASS_EXIT

        if attempt_verdict == "awaiting_clarification":
            state.finalise("awaiting_clarification")
            state.save()
            _commit_with_warn(
                project_root,
                spec.commit_paths,
                f"{spec.name}: attempt {attempt} — awaiting_clarification",
            )
            print(
                f"\nALL REVIEWERS PASSED (attempt {attempt}) but {open_q} open question(s) "
                f"in {spec.questions_file}. Resolve there and re-run; live communication "
                f"folder left in place for context.",
                flush=True,
            )
            return AWAITING_EXIT

        failing_reviewers = [name for name, v in review_verdicts.items() if v != "pass"]
        state.save()

    state.finalise("exhausted")
    state.save()
    print(
        f"\n{spec.name}: exhausted after {max_attempts} attempts. "
        f"Live communication folder left in place for inspection.",
        file=sys.stderr,
    )
    return FAIL_EXIT


def _run_reviewers_parallel(
    *,
    spec: LoopSpec,
    attempt: int,
    max_attempts: int,
    project_root: Path,
    reviewer_skill_bodies: dict[str, str],
    timeout_seconds: int,
    max_agent_retries: int,
    memoryless: bool,
    model: str,
    reviewer_session_ids: dict[str, str | None],
) -> tuple[dict[str, str], list[dict], dict[str, str]]:
    """Spawn all reviewers concurrently.

    Returns (verdicts, rate_limited_entries, newly_assigned_session_ids).
    Each reviewer either resumes its prior session (if `memoryless` is False
    and a session id is in `reviewer_session_ids`) or starts fresh; in the
    fresh case the new session id is reported back so the main thread can
    persist it for subsequent attempts.

    Malformed VERDICT trailers are an in-session-only concern: the reviewer's
    Stop hook (§9) blocks completion until the trailer is well-formed. If a
    subprocess somehow exits malformed despite the hook, this function records
    `fail` and the loop continues — there's no post-exit recovery layer.
    """
    verdicts: dict[str, str] = {}
    rate_limited: list[dict] = []
    new_sessions: dict[str, str] = {}

    def _one(reviewer_name: str) -> tuple[str, claude.ClaudeResult | None, str | None]:
        comm_file = comm.comm_file_for(project_root, spec.name, reviewer_name)
        comm_file.parent.mkdir(parents=True, exist_ok=True)
        comm_file.touch(exist_ok=True)

        existing_sid = None if memoryless else reviewer_session_ids.get(reviewer_name)
        if existing_sid is None:
            rev_prompt = spec.build_reviewer_prompt(
                reviewer_name=reviewer_name,
                attempt=attempt,
                max_attempts=max_attempts,
                project_root=project_root,
            )
        else:
            rev_prompt = spec.build_reviewer_resume_prompt(
                reviewer_name=reviewer_name,
                attempt=attempt,
                max_attempts=max_attempts,
                project_root=project_root,
            )

        rev_spawn_label = f"{spec.name}-attempt-{attempt}-{reviewer_name}"
        rev_settings = hook_settings.write_reviewer_settings(project_root, rev_spawn_label)
        rev_counter = paths.hook_counter_path(project_root, rev_spawn_label)
        try:
            res = claude.spawn_claude(
                user_prompt=rev_prompt,
                append_system_prompt=reviewer_skill_bodies[reviewer_name],
                cwd=project_root,
                settings_file=rev_settings,
                disallowed_tools=["Bash", "NotebookEdit"],
                extra_env={
                    "HARNESS_AGENT_KIND": "reviewer",
                    "HARNESS_LOOP_NAME": spec.name,
                    "HARNESS_REVIEWER_NAME": reviewer_name,
                    "HARNESS_REVIEWER_COMM_FILE": str(comm_file.resolve()),
                    "HARNESS_MAX_AGENT_RETRIES": str(max_agent_retries),
                    "HARNESS_STOP_HOOK_COUNTER": str(rev_counter),
                },
                timeout_seconds=timeout_seconds,
                max_agent_retries=max_agent_retries,
                existing_session_id=existing_sid,
                model=model,
            )
        except claude.ClaudeSpawnError as e:
            return reviewer_name, None, f"spawn error: {e}"
        return reviewer_name, res, None

    print(f"  spawning {len(spec.reviewers)} reviewers in parallel", flush=True)
    with ThreadPoolExecutor(max_workers=len(spec.reviewers)) as pool:
        futures = [pool.submit(_one, name) for name in spec.reviewers]
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


def _finalise(
    state: LoopState,
    status: str,
    exit_code: int,
    project_root: Path,
    loop_name: str,
    attempt: int,
) -> int:
    comm.snapshot_communication_folder(project_root, loop_name, attempt)
    state.finalise(status)
    state.save()
    return exit_code


def _commit_with_warn(project_root: Path, commit_paths: list[str], message: str) -> None:
    outcome = git_ops.commit_artifacts(project_root, commit_paths, message)
    if outcome == git_ops.CommitOutcome.NO_GIT:
        print(
            "  (no git repo at project root — skipping commit; "
            "harness/state/ snapshots still written.)",
            flush=True,
        )
    elif outcome == git_ops.CommitOutcome.NOTHING_TO_COMMIT:
        print("  (nothing new to commit)", flush=True)
    else:
        print(f"  committed: {message}", flush=True)


def _summary_tail(text: str, limit: int = 4000) -> str:
    if len(text) <= limit:
        return text
    return "...\n" + text[-limit:]


def _count_open_questions(questions_file: Path) -> int:
    """Count unanswered/unresolved questions in the per-loop questions file.

    Two layouts to support:

      * **Blueprint-loop questions** carry a `**Your answer:**` line per block.
        The operator resolves by either deleting the block or filling in the
        line. Open questions are blocks where the line exists and is blank.

      * **Requirements-loop questions** don't have a `Your answer:` field —
        the operator resolves by clarifying `PRD.md` and deleting the block.
        Open questions are surviving `## <title>` blocks that don't have
        children with a `Your answer:` field (since a surviving block is by
        definition unresolved here).

    Heading level (`## ` vs `### `) varies: some operators use `## ` for
    section grouping and `### ` for individual questions. This counter does
    not gate on heading level — it scans the file for both `**Your answer:**`
    lines (blueprint shape) and surviving `## ` headings (requirements shape)
    and reports the residual.
    """
    if not questions_file.exists():
        return 0

    text = questions_file.read_text()

    has_answer_field = "**Your answer:**" in text
    if has_answer_field:
        unanswered = 0
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("**Your answer:**"):
                after = stripped[len("**Your answer:**"):].strip()
                if not after:
                    unanswered += 1
        return unanswered

    return sum(
        1
        for line in text.splitlines()
        if line.strip().startswith("## ") and not line.strip().startswith("## ~~")
    )


def _strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    if end == -1:
        return text
    return text[end + 5:].lstrip()


def _awaiting_summary(questions_file_rel: str, meta_fields: dict) -> str:
    n = meta_fields.get("open_questions", "?")
    return (
        f"\n{n} open clarification question(s) in {questions_file_rel}.\n"
        f"Resolve there, then re-run the loop. Live communication folder kept for context."
    )
