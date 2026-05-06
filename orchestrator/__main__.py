"""CLI entrypoint for the coding-harness orchestrator.

    python -m orchestrator requirements-loop --project-root /path/to/project
    python -m orchestrator blueprint-loop    --project-root /path/to/project

Subcommands implemented today: `requirements-loop`, `blueprint-loop`.
`work-orders-loop`, `coding-loop`, and `status` are part of the same orchestrator
program; they will be added as their loop specialisations land.
"""

import argparse
import sys
from pathlib import Path

from .loop_driver import run_loop
from .loops.blueprints import SPEC as BLUEPRINT_SPEC
from .loops.requirements import SPEC as REQUIREMENTS_SPEC


def _add_loop_args(p: argparse.ArgumentParser, *, skip_first_help: str) -> None:
    p.add_argument(
        "--project-root",
        type=Path,
        required=True,
        help="Path to the project repo root.",
    )
    p.add_argument(
        "--skip-first-generator",
        action="store_true",
        help=skip_first_help,
    )
    p.add_argument(
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="orchestrator")
    sub = parser.add_subparsers(dest="subcommand", required=True)

    req = sub.add_parser(
        "requirements-loop",
        help="Decompose PRD.md into requirements/ tree (autonomous, with reviews).",
    )
    _add_loop_args(
        req,
        skip_first_help=(
            "On attempt 1, skip the generator spawn and run reviewers directly "
            "against the existing requirements/ tree. Useful when you've run "
            "prd-to-frds manually and want to validate without a re-think."
        ),
    )

    bp = sub.add_parser(
        "blueprint-loop",
        help="Synthesize blueprints from requirements/features/ (autonomous, with reviews).",
    )
    _add_loop_args(
        bp,
        skip_first_help=(
            "On attempt 1, skip the generator spawn and run reviewers directly "
            "against the existing blueprints/ tree. Useful when you've run "
            "frd-to-blueprint manually and want to validate without a re-think."
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
    if args.subcommand == "blueprint-loop":
        return run_loop(
            BLUEPRINT_SPEC,
            project_root,
            skip_first_generator=args.skip_first_generator,
            memoryless=args.memoryless,
        )

    parser.error(f"unknown subcommand {args.subcommand!r}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
