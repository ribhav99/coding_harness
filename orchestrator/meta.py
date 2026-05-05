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
