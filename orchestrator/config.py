"""Load `config.yaml` from the harness repo root.

One config for all projects (harness-level). No defaults: every field listed
in REQUIRED_FIELDS must be present, otherwise the orchestrator exits with an
error. The operator owns the config; the harness does not paper over missing
values.
"""

import sys
from typing import Any

from . import paths


REQUIRED_FIELDS = (
    "max_attempts",
    "max_wall_minutes",
    "max_agent_retries",
    "model_generator",
    "model_reviewer",
)


def load_config() -> dict[str, Any]:
    path = paths.HARNESS_REPO_ROOT / "config.yaml"
    if not path.exists():
        sys.exit(f"error: missing {path} — orchestrator config must be specified")

    data = _parse_minimal_yaml(path.read_text())
    missing = [f for f in REQUIRED_FIELDS if f not in data]
    if missing:
        sys.exit(f"error: {path} is missing required fields: {', '.join(missing)}")

    for field in ("max_attempts", "max_wall_minutes", "max_agent_retries"):
        if not isinstance(data[field], int) or data[field] <= 0:
            sys.exit(f"error: config field {field!r} must be a positive integer")

    for field in ("model_generator", "model_reviewer"):
        if not isinstance(data[field], str) or not data[field].strip():
            sys.exit(f"error: config field {field!r} must be a non-empty string (a Claude model id, e.g. claude-opus-4-7[1m])")

    return data


def _parse_minimal_yaml(source: str) -> dict[str, Any]:
    """A flat key:value parser that handles ints, strings, [] and lists of strings.

    Strips inline `#` comments. Avoids a PyYAML dependency for v0.1. The schema
    is intentionally tiny — when we add nested mirror configs and similar, swap
    this out for PyYAML.
    """
    out: dict[str, Any] = {}
    current_list_key: str | None = None
    for raw in source.splitlines():
        line = _strip_inline_comment(raw).rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line.startswith("  - "):
            if current_list_key is None:
                continue
            out.setdefault(current_list_key, []).append(line[4:].strip())
            continue
        current_list_key = None
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if not value:
            current_list_key = key
            out[key] = []
        elif value == "[]":
            out[key] = []
        elif value.lstrip("-").isdigit():
            out[key] = int(value)
        else:
            out[key] = value.strip('"').strip("'")
    return out


def _strip_inline_comment(line: str) -> str:
    """Strip a trailing `# ...` comment, ignoring `#` inside quoted strings."""
    in_single = False
    in_double = False
    for i, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            if i == 0 or line[i - 1].isspace():
                return line[:i]
    return line
