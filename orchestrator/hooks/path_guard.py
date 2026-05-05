#!/usr/bin/env python3
"""PreToolUse hook: block reviewer Write/Edit calls outside its own comm file.

Per BLUEPRINT.md §9. Reviewers run with Write/Edit allowed (so they can append
to their own communication file) but must not touch the artifact tree, the
operator's `_questions-pending.md`, or any other reviewer's file. This hook
fires on every Write/Edit tool call and blocks anything other than the
single allowed path.

Env vars (set by the orchestrator when spawning):
    HARNESS_REVIEWER_COMM_FILE   absolute path to <comm-dir>/<reviewer>.md
"""

import json
import os
import sys
from pathlib import Path


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")

    tool_name = payload.get("tool_name")
    if tool_name not in ("Write", "Edit", "MultiEdit"):
        return 0

    expected = os.environ.get("HARNESS_REVIEWER_COMM_FILE")
    if not expected:
        sys.stderr.write(
            "path-guard misconfigured: HARNESS_REVIEWER_COMM_FILE not set in env\n"
        )
        return 2

    target = (payload.get("tool_input") or {}).get("file_path", "")
    if not target:
        sys.stderr.write("path-guard: Write/Edit called without a file_path\n")
        return 2

    try:
        same = Path(target).resolve() == Path(expected).resolve()
    except OSError:
        same = False

    if not same:
        sys.stderr.write(
            f"path-guard: blocked {tool_name} on {target}.\n"
            f"Reviewers may only write to their own communication file: {expected}.\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
