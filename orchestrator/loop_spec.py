"""What a planning loop hands the shared driver (`loop_driver.run_loop`).

Each of `loops/requirements.py`, `loops/blueprints.py` and
`loops/work_orders.py` builds one `SPEC` from this: its generator skill, its
reviewers, what it commits, and how it prompts each role.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass
class LoopSpec:
    name: str
    generator_skill: str
    reviewers: tuple[str, ...]
    commit_paths: list[str]
    precondition: Callable[[Path], None]
    post_generator: Callable[[Path], None]
    questions_file: str
    build_generator_prompt: Callable[..., str]
    build_reviewer_prompt: Callable[..., str]
    build_generator_resume_prompt: Callable[..., str]
    build_reviewer_resume_prompt: Callable[..., str]
