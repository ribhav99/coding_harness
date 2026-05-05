"""Thin wrappers around `git` for committing artifact trees.

Git is a soft requirement: if the project repo isn't a git repo, the
orchestrator runs in no-commit mode — everything else (reviewers, state
files, snapshots) still works; commits are skipped with a warning.
"""

import subprocess
from enum import Enum
from pathlib import Path


class CommitOutcome(Enum):
    COMMITTED = "committed"
    NOTHING_TO_COMMIT = "nothing_to_commit"
    NO_GIT = "no_git"


def is_git_repo(project_root: Path) -> bool:
    return (project_root / ".git").exists()


def commit_artifacts(project_root: Path, paths: list[str], message: str) -> CommitOutcome:
    """Stage paths and create a commit. Returns the outcome.

    NO_GIT — project isn't a git repo; commit step skipped (orchestrator warns).
    NOTHING_TO_COMMIT — no diff was staged.
    COMMITTED — commit succeeded.
    """
    if not is_git_repo(project_root):
        return CommitOutcome.NO_GIT
    if not paths:
        return CommitOutcome.NOTHING_TO_COMMIT

    add_cmd = ["git", "-C", str(project_root), "add", "--", *paths]
    subprocess.run(add_cmd, check=True)

    diff_cmd = ["git", "-C", str(project_root), "diff", "--cached", "--quiet"]
    if subprocess.run(diff_cmd).returncode == 0:
        return CommitOutcome.NOTHING_TO_COMMIT

    commit_cmd = ["git", "-C", str(project_root), "commit", "-m", message]
    subprocess.run(commit_cmd, check=True)
    return CommitOutcome.COMMITTED


def working_tree_changes(project_root: Path, scope: list[str]) -> list[tuple[str, str]]:
    """Return [(status, path)] for files changed in `scope` relative to HEAD.

    Status is `modified | added | deleted | renamed | other`. Returns [] if the
    project isn't a git repo (the working-tree-changes block is informational
    only; the generator can read the on-disk tree directly).
    """
    if not is_git_repo(project_root):
        return []
    cmd = ["git", "-C", str(project_root), "status", "--porcelain", "--", *scope]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    changes: list[tuple[str, str]] = []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        code = line[:2].strip()
        path = line[3:]
        status = {
            "M": "modified", "A": "added", "D": "deleted", "R": "renamed",
            "??": "added", "AM": "added", "MM": "modified",
        }.get(code, "other")
        changes.append((status, path))
    return changes
