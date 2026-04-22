"""Sync requirements documents from Software Factory into a local project repo.

Run from inside a project repo that has a `.env` with:
    SF_API_KEY      X-API-Key for the deployed SF instance
    SF_BASE_URL     e.g. https://api.factory.8090.dev
    SF_PROJECT_ID   UUID of the project (informational; auth derives scope)

Layout written (in CWD):

    requirements/
      overview/
        <slug>.md                            (visible content file)
        .<slug>.overview.meta.yaml           (hidden node meta)
        .<slug>.requirements.meta.yaml       (hidden doc meta)
        <slug>_children/                     (only if this node has children)
          <child-slug>.md
          .<child-slug>.overview.meta.yaml
          .<child-slug>.requirements.meta.yaml
          <child-slug>_children/...          (recursive)
      features/                              (same shape, with .feature.meta.yaml instead of .overview.meta.yaml)
        <slug>.md
        .<slug>.feature.meta.yaml
        .<slug>.requirements.meta.yaml
        <slug>_children/...

Nodes are flat within a level: content file + two dotted-hidden meta files
as siblings. If a node has children, they live in a sibling dir named
`<slug>_children/` with the same flat shape. The `_children` suffix is
reserved (kebab-case slugs never contain underscores).

    cd /path/to/some-project-repo
    python /path/to/coding_harness/orchestrator/sync_from_sf.py
    python /path/to/coding_harness/orchestrator/sync_from_sf.py --tree
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_PREFIX = "/v2/external-api"  # see sf-platform/backend/software_factory/app.py:333


def load_env(path: Path) -> dict[str, str]:
    if not path.exists():
        sys.exit(f"error: no .env at {path}")
    env: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def http_get(base_url: str, path: str, api_key: str, **params: str) -> dict:
    url = f"{base_url.rstrip('/')}{path}"
    qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
    if qs:
        url = f"{url}?{qs}"
    req = urllib.request.Request(
        url,
        headers={"X-API-Key": api_key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:600]
        sys.exit(f"HTTP {e.code} on {url}\n{body}")
    except urllib.error.URLError as e:
        sys.exit(f"connection error to {url}: {e.reason}")


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    s = _SLUG_RE.sub("-", (title or "").lower()).strip("-")
    return s or "untitled"


def yaml_dump_meta(data: dict) -> str:
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


def fetch_doc_markdown(base_url: str, api_key: str, doc_id: str) -> str:
    resp = http_get(
        base_url,
        f"{API_PREFIX}/requirements/document",
        api_key,
        requirements_document_id=doc_id,
    )
    return resp.get("content_markdown") or ""


def write_node(
    node: dict,
    parent_dir: Path,
    kind: str,
    base_url: str,
    api_key: str,
    depth: int,
) -> None:
    """Write one node (overview or feature) and recurse into its children.

    Files live flat in `parent_dir`:
      <slug>.md                             the markdown body
      .<slug>.{kind}.meta.yaml              node info (id, parent_id, position, title)
      .<slug>.requirements.meta.yaml        doc info (id)

    If the node has children, a sibling dir `<slug>_children/` holds them
    in the same flat shape.
    """
    slug = slugify(node["title"])
    parent_dir.mkdir(parents=True, exist_ok=True)

    kind_token = "overview" if kind == "overview" else "feature"
    (parent_dir / f".{slug}.{kind_token}.meta.yaml").write_text(yaml_dump_meta({
        "id": node["id"],
        "parent_id": node.get("parent_id"),
        "position": node.get("position", 0),
        "title": node["title"],
    }))

    doc_id = node.get("requirements_document_id")
    if doc_id:
        markdown = fetch_doc_markdown(base_url, api_key, doc_id)
        (parent_dir / f"{slug}.md").write_text(markdown)
        (parent_dir / f".{slug}.requirements.meta.yaml").write_text(yaml_dump_meta({"id": doc_id}))
        indent = "  " * depth
        print(f"{indent}{slug}  ({len(markdown):,} chars)")

    children = node.get("children") or []
    if children:
        children_dir = parent_dir / f"{slug}_children"
        for child in children:
            write_node(child, children_dir, kind, base_url, api_key, depth + 1)


def print_tree(tree: dict) -> None:
    overview = tree.get("overview_documents") or []
    features = tree.get("feature_requirements") or []
    print(f"Overview documents: {len(overview)}")
    for n in overview:
        _print_tree_node(n, depth=1)
    print(f"\nFeature requirements: {len(features)}")
    for n in features:
        _print_tree_node(n, depth=1)


def _print_tree_node(node: dict, depth: int) -> None:
    title = node.get("title") or "<untitled>"
    nid = (node.get("id") or "?")[:8]
    doc = (node.get("requirements_document_id") or "")[:8]
    print(f"{'  ' * depth}- {title!r} node={nid} doc={doc}")
    for child in node.get("children") or []:
        _print_tree_node(child, depth + 1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Sync requirements docs from SF.")
    ap.add_argument("--tree", action="store_true",
                    help="Print the tree only; don't write anything.")
    args = ap.parse_args()

    env = load_env(Path.cwd() / ".env")
    for required in ("SF_API_KEY", "SF_BASE_URL"):
        val = env.get(required, "")
        if not val or val.startswith("<"):
            sys.exit(f"error: {required} not set in .env (looks like placeholder)")

    base_url = env["SF_BASE_URL"]
    api_key = env["SF_API_KEY"]

    tree = http_get(base_url, f"{API_PREFIX}/requirements/document/tree", api_key)

    if args.tree:
        print_tree(tree)
        return

    requirements_root = Path.cwd() / "requirements"
    overview_dir = requirements_root / "overview"
    features_dir = requirements_root / "features"
    overview_dir.mkdir(parents=True, exist_ok=True)
    features_dir.mkdir(parents=True, exist_ok=True)

    print(f"writing to {requirements_root}\n")

    print("overview/")
    for node in tree.get("overview_documents") or []:
        write_node(node, overview_dir, "overview", base_url, api_key, depth=1)

    print("\nfeatures/")
    for node in tree.get("feature_requirements") or []:
        write_node(node, features_dir, "feature", base_url, api_key, depth=1)

    print(f"\ndone. wrote requirements to {requirements_root}")


if __name__ == "__main__":
    main()
