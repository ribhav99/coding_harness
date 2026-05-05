"""Blueprint-loop specialisation. Spec for the shared loop driver.

Defines: which generator skill to load, which reviewers to spawn, which
artifact paths to commit, and how to build prompts for each role. Mirrors
`requirements.py` — only the generator/reviewer skills, paths, and prompt
text differ.
"""

import sys
from pathlib import Path

from .. import git_ops, meta
from .requirements import LoopSpec


GENERATOR_SKILL = "frd-to-blueprint"
REVIEWERS = (
    "bp-spec-judge",
    "bp-coverage-judge",
    "bp-consistency-judge",
    "bp-decision-judge",
)
LOOP_NAME = "blueprint-loop"
COMMIT_PATHS = [
    "blueprints/",
    "blueprints_communication/",
    "harness/state/",
]
QUESTIONS_FILE = "blueprints/_questions-pending.md"


def precondition(project_root: Path) -> None:
    features_dir = project_root / "requirements" / "features"
    if not features_dir.is_dir():
        sys.exit(
            f"error: {features_dir} not found — run requirements-loop first to "
            f"produce the FRD tree before running blueprint-loop"
        )
    has_frd = any(
        entry.is_file() and entry.suffix == ".md" and not entry.name.startswith((".", "_"))
        for entry in features_dir.iterdir()
    )
    if not has_frd:
        sys.exit(
            f"error: {features_dir} contains no FRDs — run requirements-loop first"
        )


def post_generator(project_root: Path) -> None:
    """Materialise dotted-hidden meta files alongside the generator's output."""
    meta.reconcile_blueprint_tree(project_root / "blueprints")


def build_generator_prompt(
    *,
    project_root: Path,
    attempt: int,
    max_attempts: int,
    failing_reviewers: list[str],
) -> str:
    comm_dir_rel = "blueprints_communication/"
    if attempt == 1:
        return f"""# Blueprint loop — attempt {attempt} of {max_attempts}

Inputs (paths relative to the project repo root):
- requirements/features/  and  requirements/overview/  (approved FRD tree)
- BLUEPRINT.md  (project-level architectural scratchpad — read if present, ignore if absent)
- blueprints/containers/, blueprints/components/, blueprints/features/  (current on-disk tree, may be empty)
- blueprints/_questions-pending.md  (open questions, if any)
- {comm_dir_rel}  (empty on attempt 1; on subsequent attempts holds reviewer transcripts)

Produce the structural blueprints tree per the frd-to-blueprint skill — three types
(container, component, feature) under blueprints/. Write only the visible <slug>.md
content files; the orchestrator materialises the dotted-hidden meta files after you exit.

End your stdout summary with one of these lines:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: blueprints/_questions-pending.md
"""

    failing_block = "\n".join(f"- {name}" for name in failing_reviewers) or "- (none — all reviewers passed)"
    changed = git_ops.working_tree_changes(project_root, ["blueprints/"])
    if changed:
        change_lines = "\n".join(f"- {status}: {path}" for status, path in changed)
    else:
        change_lines = "(no working-tree changes detected since base)"

    return f"""# Blueprint loop — attempt {attempt} of {max_attempts}

The communication folder for this loop is at: {comm_dir_rel}
Each reviewer's full review history (and your prior responses) is in <reviewer-name>.md inside that folder.

Read every reviewer file before deciding what to change. Append your responses
(per-finding disposition + change-summary) to the SAME files you read from. Do
not overwrite prior content; append at the end.

## Failing reviewers this attempt
{failing_block}

## Current working tree state (blueprints/)
{change_lines}

Inputs:
- requirements/features/, requirements/overview/  (approved FRD tree)
- BLUEPRINT.md  (project-level architectural scratchpad, if present)
- blueprints/{{containers,components,features}}/  (current on-disk tree)
- blueprints/_questions-pending.md  (if any)

End your stdout summary with one of these lines:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: blueprints/_questions-pending.md
"""


def build_reviewer_prompt(
    *,
    reviewer_name: str,
    attempt: int,
    max_attempts: int,
    project_root: Path,
) -> str:
    comm_file_rel = f"blueprints_communication/{reviewer_name}.md"
    return f"""# Blueprint loop review — attempt {attempt} of {max_attempts}
# Reviewer: {reviewer_name}

Inputs:
- Your communication file: {comm_file_rel}
- The blueprints tree: blueprints/containers/, blueprints/components/, blueprints/features/
- requirements/features/ and requirements/overview/ (for grounding)
- BLUEPRINT.md (project-level architectural scratchpad, if present — flag drift between it and the generated blueprints)

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
    """Short follow-up message for a resumed generator session (attempts ≥ 2)."""
    failing_block = "\n".join(f"- {name}" for name in failing_reviewers) or "- (none — all reviewers passed)"
    return f"""# Continuing — attempt {attempt} of {max_attempts}

Failing reviewers this attempt:
{failing_block}

Read each failing reviewer's communication file in blueprints_communication/
to see their fresh review, then fix or push back per the frd-to-blueprint skill.
End your stdout summary with one of:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: blueprints/_questions-pending.md
"""


def build_reviewer_resume_prompt(
    *,
    reviewer_name: str,
    attempt: int,
    max_attempts: int,
    project_root: Path,
) -> str:
    """Short follow-up message for a resumed reviewer session (attempts ≥ 2)."""
    comm_file_rel = f"blueprints_communication/{reviewer_name}.md"
    return f"""# Continuing — attempt {attempt} of {max_attempts}

The generator has run again and updated artifacts and (likely) your
communication file at {comm_file_rel}. Re-read the current state of
blueprints/containers/, blueprints/components/, blueprints/features/ and
run your review per the {reviewer_name} skill.

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
