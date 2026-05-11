"""Communication-folder lifecycle: ensure + snapshot only.

Per BLUEPRINT.md §1.8. The folder holds one append-only markdown file per
agent (the generator + each reviewer). Both sides read and write the per-
reviewer files. The orchestrator never wipes — the folder accumulates the
full conversation across attempts and across invocations forever. Snapshots
into `harness/state/reviews/<loop>/attempt-<N>/` capture per-attempt state
for audit.
"""

import shutil
from pathlib import Path

from . import paths


def snapshot_communication_folder(
    project_root: Path,
    loop_name: str,
    attempt: int,
    wo_slug: str | None = None,
) -> Path:
    """Copy every `<agent>.md` to the loop's reviews archive for this attempt.

    Upstream loops snapshot to `harness/state/reviews/<loop>/attempt-<N>/`.
    The coding loop snapshots per-WO to
    `harness/state/reviews/coding-loop/<wo-slug>/attempt-<N>/`.
    """
    comm = paths.communication_dir(project_root, loop_name, wo_slug=wo_slug)
    if loop_name == "coding-loop":
        if wo_slug is None:
            raise ValueError("coding-loop snapshot requires wo_slug")
        archive = paths.coding_reviews_archive_dir(project_root, wo_slug, attempt)
    else:
        archive = paths.reviews_archive_dir(project_root, loop_name, attempt)
    archive.mkdir(parents=True, exist_ok=True)
    if comm.exists():
        for entry in comm.iterdir():
            if entry.is_file() and entry.suffix == ".md":
                shutil.copy2(entry, archive / entry.name)
    return archive


def comm_file_for(
    project_root: Path,
    loop_name: str,
    agent_name: str,
    wo_slug: str | None = None,
) -> Path:
    return paths.communication_dir(project_root, loop_name, wo_slug=wo_slug) / f"{agent_name}.md"


def ensure_comm_folder(
    project_root: Path,
    loop_name: str,
    wo_slug: str | None = None,
) -> Path:
    comm = paths.communication_dir(project_root, loop_name, wo_slug=wo_slug)
    comm.mkdir(parents=True, exist_ok=True)
    return comm
