"""Reconcile dotted-hidden meta files alongside generator-written `<slug>.md` content.

Per BLUEPRINT.md §3.3 (`requirements-loop`, post-generator meta materialisation):

For each directory in the requirements tree, ensure two dotted-hidden meta
files sit alongside every visible `<slug>.md`:
    .<slug>.<kind>.meta.yaml             (overview | feature)
    .<slug>.requirements.meta.yaml

Remove meta files whose `<slug>.md` counterpart was deleted. Prune empty
`<slug>_children/` directories. Preserve existing meta-file fields whose
values are non-null (an SF mirror sync may have populated IDs).
"""

import re
from pathlib import Path


SLUG_BAD = re.compile(r"[^a-z0-9-]")


def reconcile_requirements_tree(requirements_root: Path) -> None:
    """Walk requirements/overview/ and requirements/features/ and reconcile metas."""
    for kind, sub in (("overview", "overview"), ("feature", "features")):
        root = requirements_root / sub
        if root.exists():
            _reconcile_dir(root, kind)


def reconcile_blueprint_tree(blueprints_root: Path) -> None:
    """Walk blueprints/{containers,components,features}/ and reconcile metas.

    Same per-directory shape as the requirements tree (visible <slug>.md plus
    two dotted-hidden meta files). Three kinds, one per subdirectory.
    """
    for kind, sub in (("container", "containers"), ("component", "components"), ("feature", "features")):
        root = blueprints_root / sub
        if root.exists():
            _reconcile_dir(root, kind)


def reconcile_work_orders_tree(work_orders_root: Path) -> None:
    """Materialise `.wo-<slug>.meta.yaml` from each `wo-<slug>.md` and refresh
    `_external-blockers.md` to reflect current operator-action / blocked_external state.

    Per work-orders-loop FRD REQ-WO-002, AC-LAYOUT-005.9, AC-WO-011.3:

    - The description (`wo-<slug>.md`) is the source of truth for `Depends on.work_orders`,
      `## Type`, `## Goal`, and `## Acceptance criteria`.
    - The orchestrator materialises `.wo-<slug>.meta.yaml` from the description, preserving
      mutable runtime fields (`status`, `priority`) when the meta already exists.
    - A `wo-<slug>.md` whose meta is missing gets a fresh meta with `status: ready`.
    - A `.wo-<slug>.meta.yaml` whose `wo-<slug>.md` was deleted is removed.
    - `_external-blockers.md` is regenerated from current meta state: operator-action work
      orders with status `ready` (anticipated) plus work orders with status `blocked_external`
      (discovered). When neither exists, the file is removed.
    """
    if not work_orders_root.is_dir():
        return

    visible_slugs = _wo_visible_slugs(work_orders_root)

    for slug in visible_slugs:
        _reconcile_wo_meta(work_orders_root, slug)

    _remove_orphaned_wo_metas(work_orders_root, visible_slugs)
    _regenerate_external_blockers(work_orders_root, visible_slugs)


def _wo_visible_slugs(work_orders_root: Path) -> list[str]:
    """Return slugs (without the `.md` extension) for `wo-<slug>.md` files at the top level."""
    out = []
    for entry in sorted(work_orders_root.iterdir()):
        if not entry.is_file() or entry.suffix != ".md":
            continue
        if entry.name.startswith("."):
            continue
        if entry.name.startswith("_"):
            continue
        if not entry.name.startswith("wo-"):
            continue
        out.append(entry.stem)
    return out


def _reconcile_wo_meta(work_orders_root: Path, slug: str) -> None:
    body_path = work_orders_root / f"{slug}.md"
    meta_path = work_orders_root / f".{slug}.meta.yaml"

    body = body_path.read_text()
    type_ = _extract_wo_type(body)
    blocked_by = _extract_wo_depends_work_orders(body)

    if meta_path.exists():
        existing = _parse_yaml_meta(meta_path.read_text())
        status = existing.get("status") or "ready"
        priority = existing.get("priority")
        parent_id = existing.get("parent_id")
    else:
        status = "ready"
        priority = None
        parent_id = None

    fields = {
        "id": slug,
        "status": status,
        "priority": priority,
        "type": type_,
        "parent_id": parent_id,
        "blocked_by": blocked_by,
        "blueprint_ids": [],
    }
    meta_path.write_text(_yaml_dump_wo(fields))


def _remove_orphaned_wo_metas(work_orders_root: Path, visible_slugs: list[str]) -> None:
    keep = {f".{slug}.meta.yaml" for slug in visible_slugs}
    for entry in work_orders_root.iterdir():
        if not entry.is_file() or not entry.name.startswith("."):
            continue
        if not entry.name.endswith(".meta.yaml"):
            continue
        if not entry.name.startswith(".wo-"):
            continue
        if entry.name not in keep:
            entry.unlink()


def _extract_wo_section(body: str, heading: str) -> str:
    """Return the body of a `## <heading>` section up to the next `## ` heading or EOF."""
    lines = body.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip() == f"## {heading}":
            start = i + 1
            break
    if start is None:
        return ""
    out = []
    for line in lines[start:]:
        if line.startswith("## "):
            break
        out.append(line)
    return "\n".join(out).strip()


def _extract_wo_type(body: str) -> str:
    """Read `## Type` (one of feature | refactor | bug-fix | infra | operator-action).

    Defaults to `feature` if the section is absent or unrecognised.
    """
    section = _extract_wo_section(body, "Type")
    if not section:
        return "feature"
    value = section.strip().split("\n", 1)[0].strip()
    if value in {"feature", "refactor", "bug-fix", "infra", "operator-action"}:
        return value
    return "feature"


def _extract_wo_depends_work_orders(body: str) -> list[str]:
    """Read `## Depends on` fenced YAML block; return the `work_orders` list as strings.

    Handles both inline form (`work_orders: [wo-a, wo-b]`) and dash-list form
    (`work_orders:\\n  - wo-a\\n  - wo-b`). Empty list (`[]`) returns [].
    """
    section = _extract_wo_section(body, "Depends on")
    if not section:
        return []

    fence_lines = _strip_fence(section)
    if fence_lines is None:
        return []

    return _parse_yaml_list_field(fence_lines, "work_orders")


def _extract_wo_goal(body: str) -> str:
    section = _extract_wo_section(body, "Goal")
    return section.strip()


def _extract_wo_ac_lines(body: str) -> list[str]:
    """Return the raw `- [ ]` lines of `## Acceptance criteria` for a work order."""
    section = _extract_wo_section(body, "Acceptance criteria")
    out = []
    for line in section.splitlines():
        stripped = line.strip()
        if stripped.startswith("- ["):
            out.append(stripped)
    return out


def _strip_fence(section: str) -> list[str] | None:
    """Return the lines inside a fenced ```yaml ... ``` block; None if no fence found."""
    lines = section.splitlines()
    in_block = False
    out = []
    for line in lines:
        if not in_block:
            if line.strip().startswith("```yaml"):
                in_block = True
            continue
        if line.strip() == "```":
            return out
        out.append(line)
    return out if in_block else None


def _parse_yaml_list_field(lines: list[str], field: str) -> list[str]:
    """Extract a list field from a YAML block. Supports inline `[a, b]` or dash-list."""
    in_field = False
    out: list[str] = []
    for raw in lines:
        line = raw.rstrip()
        if not in_field:
            if line.lstrip().startswith(f"{field}:"):
                _, _, value = line.partition(":")
                value = value.strip()
                if value.startswith("[") and value.endswith("]"):
                    inside = value[1:-1].strip()
                    if not inside:
                        return []
                    return [item.strip().strip('"').strip("'") for item in inside.split(",")]
                if value:
                    return [value.strip('"').strip("'")]
                in_field = True
        else:
            if not line.startswith((" ", "\t")):
                if line.lstrip().startswith("-"):
                    item = line.lstrip()[1:].strip().strip('"').strip("'")
                    out.append(item)
                else:
                    break
            else:
                stripped = line.strip()
                if stripped.startswith("-"):
                    item = stripped[1:].strip().strip('"').strip("'")
                    out.append(item)
                else:
                    break
    return out


def _yaml_dump_wo(fields: dict) -> str:
    """Serialise a work-order meta dict to YAML. Lists rendered inline; scalars on one line."""
    lines = []
    for k, v in fields.items():
        if v is None:
            lines.append(f"{k}: null")
        elif isinstance(v, list):
            if not v:
                lines.append(f"{k}: []")
            else:
                rendered = ", ".join(str(item) for item in v)
                lines.append(f"{k}: [{rendered}]")
        elif isinstance(v, str):
            needs_quote = any(c in v for c in (":", "#", "\n", '"', "'", "[", "]", "{", "}"))
            if needs_quote:
                escaped = v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
                lines.append(f'{k}: "{escaped}"')
            else:
                lines.append(f"{k}: {v}")
        else:
            lines.append(f"{k}: {v}")
    return "\n".join(lines) + "\n"


def _regenerate_external_blockers(work_orders_root: Path, visible_slugs: list[str]) -> None:
    """Rebuild `_external-blockers.md` from current meta state.

    Two sections: anticipated (operator-action + status: ready) and discovered
    (status: blocked_external). When both are empty, remove the file.
    """
    blockers_path = work_orders_root / "_external-blockers.md"

    anticipated: list[tuple[str, str, list[str]]] = []
    discovered: list[tuple[str, str, list[str]]] = []
    for slug in visible_slugs:
        meta_path = work_orders_root / f".{slug}.meta.yaml"
        if not meta_path.exists():
            continue
        meta = _parse_yaml_meta(meta_path.read_text())
        status = meta.get("status")
        type_ = meta.get("type")
        body = (work_orders_root / f"{slug}.md").read_text()
        goal = _extract_wo_goal(body)
        acs = _extract_wo_ac_lines(body)
        if type_ == "operator-action" and status == "ready":
            anticipated.append((slug, goal, acs))
        elif status == "blocked_external":
            discovered.append((slug, goal, acs))

    if not anticipated and not discovered:
        if blockers_path.exists():
            blockers_path.unlink()
        return

    out = ["# External blockers", "", "Operator action required before the loop can drain further. Mark each work order's `.wo-<slug>.meta.yaml.status` to `done` (operator-action) or `ready` (blocked_external) once the action is complete.", ""]
    out.append("## Anticipated operator actions")
    out.append("")
    if anticipated:
        for slug, goal, acs in anticipated:
            out.append(f"### `{slug}`")
            if goal:
                out.append(f"**Goal:** {goal}")
            if acs:
                out.append("**Acceptance criteria:**")
                for ac in acs:
                    out.append(ac)
            out.append("")
    else:
        out.append("(none)")
        out.append("")
    out.append("## Discovered mid-execution blockers")
    out.append("")
    if discovered:
        for slug, goal, acs in discovered:
            out.append(f"### `{slug}`")
            if goal:
                out.append(f"**Goal:** {goal}")
            if acs:
                out.append("**Acceptance criteria:**")
                for ac in acs:
                    out.append(ac)
            out.append("")
    else:
        out.append("(none)")
        out.append("")
    blockers_path.write_text("\n".join(out))


def _reconcile_dir(directory: Path, kind: str) -> None:
    """Reconcile one flat level: visible <slug>.md files + hidden metas + _children/ dirs."""
    if not directory.is_dir():
        return

    visible_slugs = _visible_slugs(directory)
    _add_missing_metas(directory, visible_slugs, kind)
    _remove_orphaned_metas(directory, visible_slugs, kind)

    for slug in visible_slugs:
        children_dir = directory / f"{slug}_children"
        if children_dir.is_dir():
            _reconcile_dir(children_dir, kind)
            if _is_empty_children(children_dir):
                children_dir.rmdir()

    for entry in directory.iterdir():
        if entry.is_dir() and entry.name.endswith("_children"):
            parent_slug = entry.name[: -len("_children")]
            if parent_slug not in visible_slugs and _is_empty_children(entry):
                entry.rmdir()


def _visible_slugs(directory: Path) -> list[str]:
    out = []
    for entry in sorted(directory.iterdir()):
        if entry.is_file() and entry.suffix == ".md" and not entry.name.startswith("."):
            slug = entry.stem
            if slug.startswith("_"):
                continue
            out.append(slug)
    return out


def _add_missing_metas(directory: Path, slugs: list[str], kind: str) -> None:
    for position, slug in enumerate(slugs):
        node_meta = directory / f".{slug}.{kind}.meta.yaml"
        doc_meta = directory / f".{slug}.requirements.meta.yaml"
        title = _read_h1(directory / f"{slug}.md") or slug

        if not node_meta.exists():
            node_meta.write_text(_yaml_dump({
                "id": None,
                "parent_id": None,
                "position": position,
                "title": title,
            }))
        else:
            _refresh_position_and_title(node_meta, position, title)

        if not doc_meta.exists():
            doc_meta.write_text(_yaml_dump({"id": None}))


def _remove_orphaned_metas(directory: Path, slugs: list[str], kind: str) -> None:
    keep = set()
    for slug in slugs:
        keep.add(f".{slug}.{kind}.meta.yaml")
        keep.add(f".{slug}.requirements.meta.yaml")
    for entry in directory.iterdir():
        if not entry.is_file() or not entry.name.startswith("."):
            continue
        if not entry.name.endswith(".meta.yaml"):
            continue
        if entry.name not in keep:
            entry.unlink()


def _is_empty_children(children_dir: Path) -> bool:
    return not any(children_dir.iterdir())


def _read_h1(content_file: Path) -> str | None:
    if not content_file.exists():
        return None
    for line in content_file.read_text().splitlines():
        stripped = line.lstrip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return None


def _refresh_position_and_title(meta_path: Path, position: int, title: str) -> None:
    """Update position + title in place, preserving existing non-null id/parent_id."""
    text = meta_path.read_text()
    fields = _parse_yaml_meta(text)
    if fields.get("position") != position:
        fields["position"] = position
    if fields.get("title") != title and not _id_is_set(fields):
        fields["title"] = title
    meta_path.write_text(_yaml_dump(fields))


def _id_is_set(fields: dict) -> bool:
    return fields.get("id") not in (None, "null", "")


def _parse_yaml_meta(text: str) -> dict:
    out: dict = {}
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or ":" not in line:
            continue
        k, _, v = line.partition(":")
        v = v.strip()
        key = k.strip()
        if v in ("null", ""):
            out[key] = None
        elif v.lstrip("-").isdigit():
            out[key] = int(v)
        else:
            out[key] = v.strip('"').strip("'")
    return out


def _yaml_dump(data: dict) -> str:
    lines = []
    for k, v in data.items():
        if v is None:
            lines.append(f"{k}: null")
        elif isinstance(v, str):
            needs_quote = any(c in v for c in (":", "#", "\n", '"', "'", "[", "]", "{", "}"))
            if needs_quote:
                escaped = v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
                lines.append(f'{k}: "{escaped}"')
            else:
                lines.append(f"{k}: {v}")
        else:
            lines.append(f"{k}: {v}")
    return "\n".join(lines) + "\n"
