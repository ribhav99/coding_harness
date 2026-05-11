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


def detect_base_branch(project_root: Path) -> str:
    """Best-effort detection of the repo's default branch (typically `main` or `master`).

    Order: `gh repo view` → `git symbolic-ref refs/remotes/origin/HEAD` →
    fall back to `main` (a sensible modern default; if the repo actually uses
    `master` and there's no remote, the operator can pass --base-branch).
    """
    if not is_git_repo(project_root):
        return "main"
    try:
        out = subprocess.run(
            ["gh", "repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
            cwd=str(project_root), capture_output=True, text=True,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except FileNotFoundError:
        pass
    try:
        out = subprocess.run(
            ["git", "-C", str(project_root), "symbolic-ref", "refs/remotes/origin/HEAD"],
            capture_output=True, text=True,
        )
        if out.returncode == 0 and out.stdout.strip():
            # form: refs/remotes/origin/<branch>
            return out.stdout.strip().split("/")[-1]
    except FileNotFoundError:
        pass
    # Local-only repos: check whether master or main exists.
    for candidate in ("main", "master"):
        check = subprocess.run(
            ["git", "-C", str(project_root), "rev-parse", "--verify", "--quiet", candidate],
            capture_output=True,
        )
        if check.returncode == 0:
            return candidate
    return "main"


def checkout_task_branch(project_root: Path, branch: str, base_branch: str) -> None:
    """Switch to `branch` (creating it from `base_branch` if it doesn't exist).

    On first use the branch is created with `git checkout -b <branch> <base>`.
    On subsequent uses (the branch already exists locally) it's a plain
    `git checkout <branch>`. The orchestrator does NOT reset the branch — any
    prior commits the generator made are preserved across attempts.
    """
    if not is_git_repo(project_root):
        return
    exists = subprocess.run(
        ["git", "-C", str(project_root), "rev-parse", "--verify", "--quiet", branch],
        capture_output=True,
    ).returncode == 0
    if exists:
        subprocess.run(["git", "-C", str(project_root), "checkout", branch], check=True)
    else:
        subprocess.run(
            ["git", "-C", str(project_root), "checkout", "-b", branch, base_branch],
            check=True,
        )


def current_branch(project_root: Path) -> str | None:
    if not is_git_repo(project_root):
        return None
    out = subprocess.run(
        ["git", "-C", str(project_root), "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return None
    name = out.stdout.strip()
    return name or None


def lookup_pr(project_root: Path, branch: str) -> tuple[int | None, str | None, str | None]:
    """Return (pr_number, pr_url, state) for the open/closed PR on `branch`, or (None, None, None).

    `state` is one of `OPEN | MERGED | CLOSED`. Best-effort: returns None tuple
    if `gh` isn't installed, isn't authenticated, or the call otherwise fails.
    """
    try:
        out = subprocess.run(
            [
                "gh", "pr", "list",
                "--head", branch,
                "--state", "all",
                "--json", "number,url,state",
                "--limit", "1",
            ],
            cwd=str(project_root), capture_output=True, text=True,
        )
    except FileNotFoundError:
        return None, None, None
    if out.returncode != 0 or not out.stdout.strip():
        return None, None, None
    import json as _json
    try:
        items = _json.loads(out.stdout)
    except _json.JSONDecodeError:
        return None, None, None
    if not items:
        return None, None, None
    item = items[0]
    return item.get("number"), item.get("url"), item.get("state")


def post_pr_comment(project_root: Path, pr_number: int, body: str) -> bool:
    """Post a comment on the PR. Returns True on success."""
    try:
        out = subprocess.run(
            ["gh", "pr", "comment", str(pr_number), "--body", body],
            cwd=str(project_root), capture_output=True, text=True,
        )
    except FileNotFoundError:
        return False
    return out.returncode == 0


def working_tree_clean(project_root: Path) -> bool:
    if not is_git_repo(project_root):
        return True
    out = subprocess.run(
        ["git", "-C", str(project_root), "status", "--porcelain"],
        capture_output=True, text=True,
    )
    return out.returncode == 0 and not out.stdout.strip()


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
