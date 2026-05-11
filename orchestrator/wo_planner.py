"""Local planner for the work-orders queue.

Reads `work-orders/_sequence.md`, the per-WO meta files
(`.wo-<slug>.meta.yaml`), and the WO body files (`wo-<slug>.md`) to:

  * pick the next ready work order in dependency order,
  * inspect a WO's `## Gates` block to decide which reviewers to spawn,
  * read/write the WO's `status` field on the meta file.

Status transitions in the coding loop:
    ready → in_progress  (orchestrator picks the WO)
    in_progress → done   (orchestrator detects the PR was merged on next run)
    in_progress → blocked_external (generator surfaced a discovered blocker)

The orchestrator is the only writer of `.wo-<slug>.meta.yaml.status` outside
the work-orders loop. Generators may not edit meta files.
"""

import re
from dataclasses import dataclass
from pathlib import Path

from . import meta as meta_mod


SEQUENCE_FILE = "_sequence.md"


# Gates declared in a WO's `## Gates` fenced YAML block; the coding-loop reviewer
# set the orchestrator can spawn per WO. Tests and Playwright run as Claude
# subprocesses using the `tests-runner` and `playwright-runner` skills — those
# subprocesses do execute Bash, but their verdict still comes from a trailing
# VERDICT line so the dispatch is uniform with the LLM-as-judge reviewers.
GATE_TO_REVIEWER_SKILL = {
    "tests": "tests-runner",
    "playwright": "playwright-runner",
    "code_spec": "code-spec-judge",
    "code_regression": "code-regression-judge",
    "code_security": "code-security-judge",
    "code_quality": "code-quality-judge",
}

# Fastest-first ordering for short-circuit if we ever revert to serial fan-out.
# Parallel fan-out ignores this ordering — kept here as the canonical reference.
GATE_ORDER = (
    "tests",
    "playwright",
    "code_spec",
    "code_regression",
    "code_security",
    "code_quality",
)


@dataclass(frozen=True)
class WorkOrder:
    slug: str
    body_path: Path
    meta_path: Path
    status: str
    type: str
    blocked_by: list[str]


def read_sequence(work_orders_root: Path) -> list[str]:
    """Parse `_sequence.md` into an ordered list of work-order slugs.

    The file is a markdown numbered list; the orchestrator extracts `wo-<slug>`
    tokens line-by-line and preserves order. Lines without a wo-token are ignored,
    so headings and prose are fine.
    """
    seq_path = work_orders_root / SEQUENCE_FILE
    if not seq_path.exists():
        return []

    out: list[str] = []
    seen: set[str] = set()
    pattern = re.compile(r"\b(wo-[a-z0-9][a-z0-9-]*)\b")
    for line in seq_path.read_text().splitlines():
        match = pattern.search(line)
        if not match:
            continue
        slug = match.group(1)
        if slug in seen:
            continue
        seen.add(slug)
        out.append(slug)
    return out


def load_work_order(work_orders_root: Path, slug: str) -> WorkOrder | None:
    body_path = work_orders_root / f"{slug}.md"
    meta_path = work_orders_root / f".{slug}.meta.yaml"
    if not body_path.exists() or not meta_path.exists():
        return None
    meta_fields = meta_mod._parse_yaml_meta(meta_path.read_text())
    return WorkOrder(
        slug=slug,
        body_path=body_path,
        meta_path=meta_path,
        status=meta_fields.get("status") or "ready",
        type=meta_fields.get("type") or "feature",
        blocked_by=_parse_meta_list(meta_path.read_text(), "blocked_by"),
    )


def all_work_orders(work_orders_root: Path) -> dict[str, WorkOrder]:
    """Return {slug: WorkOrder} for every wo-<slug>.md at the top level."""
    if not work_orders_root.is_dir():
        return {}
    out: dict[str, WorkOrder] = {}
    for entry in sorted(work_orders_root.iterdir()):
        if not entry.is_file() or entry.suffix != ".md":
            continue
        if entry.name.startswith((".", "_")):
            continue
        if not entry.name.startswith("wo-"):
            continue
        wo = load_work_order(work_orders_root, entry.stem)
        if wo is not None:
            out[wo.slug] = wo
    return out


def pick_next_ready(work_orders_root: Path) -> WorkOrder | None:
    """Walk `_sequence.md` top-to-bottom; return the first agent-executable WO
    whose `status: ready` and whose `blocked_by[]` are all `done`.

    Operator-action WOs are skipped — they wait for the operator.
    Missing meta or body for a sequence entry is silently skipped (a
    sequencing error the work-orders loop should have caught).
    """
    wos = all_work_orders(work_orders_root)
    for slug in read_sequence(work_orders_root):
        wo = wos.get(slug)
        if wo is None:
            continue
        if wo.status != "ready":
            continue
        if wo.type == "operator-action":
            continue
        deps_ok = all(
            (wos.get(dep) is not None and wos[dep].status == "done")
            for dep in wo.blocked_by
        )
        if deps_ok:
            return wo
    return None


def in_progress_slugs(work_orders_root: Path) -> list[str]:
    return [slug for slug, wo in all_work_orders(work_orders_root).items() if wo.status == "in_progress"]


def set_status(wo: WorkOrder, new_status: str) -> None:
    """Update `status` on the meta file in place, preserving other fields."""
    text = wo.meta_path.read_text()
    fields = meta_mod._parse_yaml_meta(text)
    fields["status"] = new_status
    # Preserve list fields that the flat parser flattens to strings.
    blocked_by = _parse_meta_list(text, "blocked_by")
    blueprint_ids = _parse_meta_list(text, "blueprint_ids")
    fields["blocked_by"] = blocked_by
    fields["blueprint_ids"] = blueprint_ids
    wo.meta_path.write_text(meta_mod._yaml_dump_wo(fields))


def read_gates(wo: WorkOrder) -> dict[str, str]:
    """Parse the `## Gates` fenced YAML block. Returns {gate_key: status}.

    Status is `required` | `not_applicable`. Missing block returns {} (the
    orchestrator will treat that as no gates required — only meaningful for
    operator-action WOs which already get skipped before reviewer dispatch).
    """
    body = wo.body_path.read_text()
    section = meta_mod._extract_wo_section(body, "Gates")
    if not section:
        return {}
    fence_lines = meta_mod._strip_fence(section)
    if fence_lines is None:
        return {}
    out: dict[str, str] = {}
    for raw in fence_lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if value in ("required", "not_applicable"):
            out[key] = value
    return out


def required_reviewer_skills(gates: dict[str, str]) -> list[str]:
    """Map a Gates block to the ordered list of reviewer skill names to spawn.

    Always includes the four code-* judges (the WO's Gates block declares them
    `required`; we don't second-guess `not_applicable` for code-*). For `tests`
    and `playwright`, include only if `required`.
    """
    skills: list[str] = []
    for gate in GATE_ORDER:
        status = gates.get(gate)
        skill = GATE_TO_REVIEWER_SKILL[gate]
        if status == "required":
            skills.append(skill)
    return skills


def read_title(wo: WorkOrder) -> str:
    """First `# Heading` line, falling back to the slug."""
    for line in wo.body_path.read_text().splitlines():
        stripped = line.lstrip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return wo.slug


def _parse_meta_list(text: str, field: str) -> list[str]:
    """Return a list field from a `.wo-<slug>.meta.yaml` file.

    The file's flat parser doesn't reconstruct lists from inline `[a, b]` form
    or from dash-list form. This helper reparses the field directly.
    """
    for line in text.splitlines():
        line = line.rstrip()
        if not line.startswith(f"{field}:"):
            continue
        _, _, value = line.partition(":")
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            inside = value[1:-1].strip()
            if not inside:
                return []
            return [item.strip().strip('"').strip("'") for item in inside.split(",")]
        if value and not value.startswith("["):
            return [value.strip('"').strip("'")]
        return []
    return []
