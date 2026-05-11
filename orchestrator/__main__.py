"""CLI entrypoint for the coding-harness orchestrator.

    python -m orchestrator requirements-loop --project-root /path/to/project
    python -m orchestrator blueprint-loop    --project-root /path/to/project
    python -m orchestrator work-orders-loop  --project-root /path/to/project
    python -m orchestrator coding-loop       --project-root /path/to/project [--one]

`status` is part of the same orchestrator program; will be added later.
"""

import argparse
import sys
from pathlib import Path

from .loop_driver import run_loop
from .loops.blueprints import SPEC as BLUEPRINT_SPEC
from .loops.coding import run_coding_loop
from .loops.requirements import SPEC as REQUIREMENTS_SPEC
from .loops.work_orders import SPEC as WORK_ORDERS_SPEC


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

    wo = sub.add_parser(
        "work-orders-loop",
        help="Decompose blueprints/ + existing code into work-orders/ tree (autonomous, with reviews).",
    )
    _add_loop_args(
        wo,
        skip_first_help=(
            "On attempt 1, skip the generator spawn and run reviewers directly "
            "against the existing work-orders/ tree. Useful when you've run "
            "blueprint-to-work-orders manually and want to validate without a re-think."
        ),
    )

    cd = sub.add_parser(
        "coding-loop",
        help="Drain the ready work-order queue: one PR per work order, with reviewer gates.",
    )
    cd.add_argument(
        "--project-root",
        type=Path,
        required=True,
        help="Path to the project repo root.",
    )
    cd.add_argument(
        "--one",
        action="store_true",
        help="Run a single work order and exit, instead of draining the full queue.",
    )
    cd.add_argument(
        "--base-branch",
        type=str,
        default=None,
        help="Override the auto-detected default branch (e.g. main, master). "
             "Useful for local-only repos with no `gh` / `origin` configured.",
    )
    cd.add_argument(
        "--memoryless",
        action="store_true",
        help=(
            "Disable session continuity within a single work order: every attempt "
            "spawns fresh generator and reviewer sessions. Default resumes within "
            "the WO's invocation; each new orchestrator invocation still starts fresh."
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
    if args.subcommand == "work-orders-loop":
        return run_loop(
            WORK_ORDERS_SPEC,
            project_root,
            skip_first_generator=args.skip_first_generator,
            memoryless=args.memoryless,
        )
    if args.subcommand == "coding-loop":
        return run_coding_loop(
            project_root,
            one=args.one,
            base_branch_override=args.base_branch,
            memoryless=args.memoryless,
        )

    parser.error(f"unknown subcommand {args.subcommand!r}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
