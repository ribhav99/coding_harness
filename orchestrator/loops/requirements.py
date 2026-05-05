"""Requirements-loop specialisation. Spec for the shared loop driver.

Defines: which generator skill to load, which reviewers to spawn, which
artifact paths to commit, and how to build prompts for each role.
"""

import sys
from dataclasses import dataclass
from pathlib import Path

from .. import git_ops, meta


GENERATOR_SKILL = "prd-to-frds"
REVIEWERS = (
    "req-spec-judge",
    "req-cross-doc-judge",
    "req-coverage-judge",
    "req-scoping-judge",
)
LOOP_NAME = "requirements-loop"
COMMIT_PATHS = [
    "requirements/",
    "requirements_communication/",
    "harness/state/",
]
QUESTIONS_FILE = "requirements/_questions-pending.md"


@dataclass
class LoopSpec:
    name: str
    generator_skill: str
    reviewers: tuple[str, ...]
    commit_paths: list[str]
    precondition: callable  # type: ignore[type-arg]
    post_generator: callable  # type: ignore[type-arg]
    questions_file: str
    build_generator_prompt: callable  # type: ignore[type-arg]
    build_reviewer_prompt: callable  # type: ignore[type-arg]
    build_generator_resume_prompt: callable  # type: ignore[type-arg]
    build_reviewer_resume_prompt: callable  # type: ignore[type-arg]


def precondition(project_root: Path) -> None:
    if not (project_root / "PRD.md").exists():
        sys.exit(f"error: {project_root / 'PRD.md'} not found — required for requirements-loop")


def post_generator(project_root: Path) -> None:
    """Materialise dotted-hidden meta files alongside the generator's output."""
    meta.reconcile_requirements_tree(project_root / "requirements")


def build_generator_prompt(
    *,
    project_root: Path,
    attempt: int,
    max_attempts: int,
    failing_reviewers: list[str],
) -> str:
    comm_dir_rel = "requirements_communication/"
    if attempt == 1:
        return f"""# Requirements loop — attempt {attempt} of {max_attempts}

Inputs (paths relative to the project repo root):
- PRD.md
- requirements/overview/  and  requirements/features/  (current on-disk tree, may be empty)
- requirements/_questions-pending.md  (open questions, if any)
- {comm_dir_rel}  (empty on attempt 1; on subsequent attempts holds reviewer transcripts)

Decompose PRD.md into the structural requirements tree following the prd-to-frds skill.
Write only the visible <slug>.md content files; the orchestrator materialises the
dotted-hidden meta files after you exit.

End your stdout summary with one of these lines:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: requirements/_questions-pending.md
"""

    failing_block = "\n".join(f"- {name}" for name in failing_reviewers) or "- (none — all reviewers passed)"
    changed = git_ops.working_tree_changes(project_root, ["requirements/"])
    if changed:
        change_lines = "\n".join(f"- {status}: {path}" for status, path in changed)
    else:
        change_lines = "(no working-tree changes detected since base)"

    return f"""# Requirements loop — attempt {attempt} of {max_attempts}

The communication folder for this loop is at: {comm_dir_rel}
Each reviewer's full review history (and your prior responses) is in <reviewer-name>.md inside that folder.

Read every reviewer file before deciding what to change. Append your responses
(per-finding disposition + change-summary) to the SAME files you read from. Do
not overwrite prior content; append at the end.

## Failing reviewers this attempt
{failing_block}

## Current working tree state (requirements/)
{change_lines}

Inputs:
- PRD.md
- requirements/overview/, requirements/features/  (current on-disk tree)
- requirements/_questions-pending.md  (if any)

End your stdout summary with one of these lines:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: requirements/_questions-pending.md
"""


def build_reviewer_prompt(
    *,
    reviewer_name: str,
    attempt: int,
    max_attempts: int,
    project_root: Path,
) -> str:
    comm_file_rel = f"requirements_communication/{reviewer_name}.md"
    return f"""# Requirements loop review — attempt {attempt} of {max_attempts}
# Reviewer: {reviewer_name}

Inputs:
- Your communication file: {comm_file_rel}
- The requirements tree: requirements/overview/ and requirements/features/
- PRD.md (for coverage/grounding context)

Run your review per the {reviewer_name} skill. Append a `## Review — attempt {attempt}` block
to your communication file. Do not write any other file — Write/Edit on any path other
than {comm_file_rel} will be blocked.

End your final chat message with exactly one line, on its own:
  VERDICT: pass
or
  VERDICT: fail
"""


def build_generator_resume_prompt(
    *,
    project_root: Path,
    attempt: int,
    max_attempts: int,
    failing_reviewers: list[str],
) -> str:
    """Short follow-up message for a resumed generator session (attempts ≥ 2).

    The generator already has the prior conversation in its session memory.
    We only need to point at what changed and what's failing.
    """
    failing_block = "\n".join(f"- {name}" for name in failing_reviewers) or "- (none — all reviewers passed)"
    changed = git_ops.working_tree_changes(project_root, ["requirements/"])
    if changed:
        change_lines = "\n".join(f"- {status}: {path}" for status, path in changed)
    else:
        change_lines = "(no working-tree changes detected; treat as: made updates to requirements/)"

    return f"""# Continuing — attempt {attempt} of {max_attempts}

Failing reviewers this attempt:
{failing_block}

Changes you made since the previous attempt (working tree, requirements/):
{change_lines}

Read each failing reviewer's communication file in requirements_communication/
to see their fresh review, then fix or push back per the prd-to-frds skill.
End your stdout summary with one of:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: requirements/_questions-pending.md
"""


def build_reviewer_resume_prompt(
    *,
    reviewer_name: str,
    attempt: int,
    max_attempts: int,
    project_root: Path,
) -> str:
    """Short follow-up message for a resumed reviewer session (attempts ≥ 2)."""
    changed = git_ops.working_tree_changes(project_root, ["requirements/"])
    if changed:
        change_lines = "\n".join(f"- {status}: {path}" for status, path in changed)
    else:
        change_lines = "(no working-tree changes detected; the generator reports: made updates)"

    comm_file_rel = f"requirements_communication/{reviewer_name}.md"
    return f"""# Continuing — attempt {attempt} of {max_attempts}

The generator has run again and updated artifacts and (likely) your
communication file at {comm_file_rel}. Re-run your review per the
{reviewer_name} skill against the current state of requirements/overview/
and requirements/features/.

Changes since previous attempt (working tree, requirements/):
{change_lines}

Append a `## Review — attempt {attempt}` block to {comm_file_rel} (do not
overwrite prior content). Write/Edit on any path other than that file is blocked.

End your final chat message with exactly one line, on its own:
  VERDICT: pass
or
  VERDICT: fail
"""


SPEC = LoopSpec(
    name=LOOP_NAME,
    generator_skill=GENERATOR_SKILL,
    reviewers=REVIEWERS,
    commit_paths=COMMIT_PATHS,
    precondition=precondition,
    post_generator=post_generator,
    questions_file=QUESTIONS_FILE,
    build_generator_prompt=build_generator_prompt,
    build_reviewer_prompt=build_reviewer_prompt,
    build_generator_resume_prompt=build_generator_resume_prompt,
    build_reviewer_resume_prompt=build_reviewer_resume_prompt,
)
