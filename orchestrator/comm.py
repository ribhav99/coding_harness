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


def snapshot_communication_folder(project_root: Path, loop_name: str, attempt: int) -> Path:
    """Copy every `<reviewer>.md` to harness/state/reviews/<loop>/attempt-<N>/."""
    comm = paths.communication_dir(project_root, loop_name)
    archive = paths.reviews_archive_dir(project_root, loop_name, attempt)
    archive.mkdir(parents=True, exist_ok=True)
    if comm.exists():
        for entry in comm.iterdir():
            if entry.is_file() and entry.suffix == ".md":
                shutil.copy2(entry, archive / entry.name)
    return archive


def comm_file_for(project_root: Path, loop_name: str, agent_name: str) -> Path:
    return paths.communication_dir(project_root, loop_name) / f"{agent_name}.md"


def ensure_comm_folder(project_root: Path, loop_name: str) -> Path:
    comm = paths.communication_dir(project_root, loop_name)
    comm.mkdir(parents=True, exist_ok=True)
    return comm
