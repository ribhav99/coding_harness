"""Path helpers. All paths are absolute; the project root is supplied at startup."""

from pathlib import Path


HARNESS_REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = HARNESS_REPO_ROOT / "skills"
HOOK_SCRIPTS_DIR = HARNESS_REPO_ROOT / "orchestrator" / "hooks"
PLAYWRIGHT_HARNESS_DIR = HARNESS_REPO_ROOT / "playwright-harness"


def harness_state_dir(project_root: Path) -> Path:
    return project_root / "harness" / "state"


def harness_logs_dir(project_root: Path) -> Path:
    return project_root / "harness" / "logs"


def reviews_archive_dir(project_root: Path, loop_name: str, attempt: int) -> Path:
    return project_root / "harness" / "state" / "reviews" / loop_name / f"attempt-{attempt}"


def coding_reviews_archive_dir(project_root: Path, wo_slug: str, attempt: int) -> Path:
    """Per-WO review archive under `harness/state/reviews/coding-loop/<wo-slug>/attempt-<N>/`."""
    return project_root / "harness" / "state" / "reviews" / "coding-loop" / wo_slug / f"attempt-{attempt}"


def loop_state_file(project_root: Path, loop_name: str) -> Path:
    return harness_state_dir(project_root) / f"{loop_name}.json"


def communication_dir(project_root: Path, loop_name: str, wo_slug: str | None = None) -> Path:
    if loop_name == "requirements-loop":
        return project_root / "requirements_communication"
    if loop_name == "blueprint-loop":
        return project_root / "blueprints_communication"
    if loop_name == "work-orders-loop":
        return project_root / "work-orders_communication"
    if loop_name == "coding-loop":
        if wo_slug is None:
            raise ValueError("coding-loop communication_dir requires wo_slug")
        return project_root / "coding_communication" / wo_slug
    raise ValueError(f"loop_name {loop_name!r} has no communication folder")


def settings_scratch_dir(project_root: Path) -> Path:
    """One-shot Claude Code settings JSON files written per subprocess spawn."""
    return harness_state_dir(project_root) / ".scratch-settings"


def hook_counter_path(project_root: Path, spawn_label: str) -> Path:
    """One-shot per-spawn counter file used by the Stop hook to cap retries."""
    return harness_state_dir(project_root) / ".hook-counters" / f"{spawn_label}.txt"


def skill_path(skill_name: str) -> Path:
    """Locate a skill markdown file in the harness's skills/ tree."""
    for sub in ("requirements", "blueprints", "work-orders", "coding"):
        candidate = SKILLS_DIR / sub / f"{skill_name}.md"
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"skill {skill_name!r} not found under {SKILLS_DIR}")
