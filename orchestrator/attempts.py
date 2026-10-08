"""Pieces both attempt loops share: the planning-loop driver (`loop_driver`)
and the coding loop (`loops/coding.py`).

Each loop decides what its generator and reviewers are told and how they are
launched; what happens to their answers is the same in both, and lives here.
"""

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

from . import claude, paths, verdict


PASS_EXIT = 0
FAIL_EXIT = 1
AWAITING_EXIT = 2


def load_skill_body(skill_name: str) -> str:
    """A skill's markdown with its frontmatter removed, ready to append to a system prompt."""
    return strip_frontmatter(paths.skill_path(skill_name).read_text())


def strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    if end == -1:
        return text
    return text[end + 5:].lstrip()


def summary_tail(text: str, limit: int = 4000) -> str:
    if len(text) <= limit:
        return text
    return "...\n" + text[-limit:]


# What one reviewer spawn returns: (reviewer name, result, spawn error). Exactly
# one of result and error is set.
ReviewerOutcome = tuple[str, claude.ClaudeResult | None, str | None]


def run_reviewers_parallel(
    reviewer_names: list[str] | tuple[str, ...],
    spawn_one: Callable[[str], ReviewerOutcome],
    *,
    memoryless: bool,
    reviewer_session_ids: dict[str, str | None],
) -> tuple[dict[str, str], list[dict], dict[str, str]]:
    """Spawn every reviewer concurrently with `spawn_one` and read their verdicts.

    Returns (verdicts, rate_limited_entries, newly_assigned_session_ids). A
    reviewer that failed to spawn, ran out of rate-limit retries, or exited
    with a malformed VERDICT trailer is recorded as `fail`. A reviewer that
    started a fresh session reports its id, so the caller can resume it next
    attempt.
    """
    verdicts: dict[str, str] = {}
    rate_limited: list[dict] = []
    new_sessions: dict[str, str] = {}

    print(f"  spawning {len(reviewer_names)} reviewers in parallel", flush=True)
    with ThreadPoolExecutor(max_workers=len(reviewer_names)) as pool:
        futures = [pool.submit(spawn_one, name) for name in reviewer_names]
        for fut in as_completed(futures):
            name, res, err = fut.result()
            if err is not None:
                print(f"  {name}: {err}", file=sys.stderr)
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


def record_reviewer_rate_limits(state, attempt: int, rate_limited: list[dict]) -> None:
    """Record every reviewer that ran out of rate-limit retries this attempt."""
    for entry in rate_limited:
        state.record_rate_limit_exhaustion(
            "reviewer", attempt, entry["stderr"], reviewer_name=entry["reviewer"]
        )


def prepare_reviewer_comm_file(comm_file: Path) -> Path:
    """Make sure a reviewer's communication file exists before it is spawned."""
    comm_file.parent.mkdir(parents=True, exist_ok=True)
    comm_file.touch(exist_ok=True)
    return comm_file
