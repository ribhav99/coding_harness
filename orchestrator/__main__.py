"""CLI entrypoint for the coding-harness orchestrator.

    python -m orchestrator requirements-loop --project-root /path/to/project

Subcommands available in v0.1: `requirements-loop`. Blueprint and coding loops
land in v0.2 / v0.3.
"""

import argparse
import sys
from pathlib import Path

from .loop_driver import run_loop
from .loops.requirements import SPEC as REQUIREMENTS_SPEC


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="orchestrator")
    sub = parser.add_subparsers(dest="subcommand", required=True)

    req = sub.add_parser(
        "requirements-loop",
        help="Decompose PRD.md into requirements/ tree (autonomous, with reviews).",
    )
    req.add_argument(
        "--project-root",
        type=Path,
        required=True,
        help="Path to the project repo root (the repo containing PRD.md).",
    )
    req.add_argument(
        "--skip-first-generator",
        action="store_true",
        help=(
            "On attempt 1, skip the generator spawn and run reviewers directly "
            "against the existing requirements/ tree. Useful when you've run "
            "prd-to-frds manually and want to validate without a re-think."
        ),
    )
    req.add_argument(
        "--memoryless",
        action="store_true",
        help=(
            "Disable session continuity: every attempt spawns a fresh "
            "`claude -p` subprocess for both the generator and each reviewer, "
            "and they rely on the communication folder for prior context. "
            "Default behavior is to resume the same session across attempts "
            "within an invocation (each new invocation still starts fresh)."
        ),
    )

    args = parser.parse_args(argv)

    project_root = args.project_root.resolve()
    if not project_root.is_dir():
        sys.exit(f"error: --project-root {project_root} is not a directory")

    if args.subcommand == "requirements-loop":
        return run_loop(
            REQUIREMENTS_SPEC,
            project_root,
            skip_first_generator=args.skip_first_generator,
            memoryless=args.memoryless,
        )

    parser.error(f"unknown subcommand {args.subcommand!r}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
