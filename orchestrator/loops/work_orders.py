"""Work-orders-loop specialisation. Spec for the shared loop driver.

Defines: which generator skill to load, which reviewers to spawn, which
artifact paths to commit, and how to build prompts for each role. Mirrors
`blueprints.py` — only the generator/reviewer skills, paths, and prompt text
differ. Adds the post-generator hook that materialises `.wo-<slug>.meta.yaml`
files from each `wo-<slug>.md`'s `## Depends on` and `## Type` sections, plus
regenerates `work-orders/_external-blockers.md` from current meta state.
"""

import sys
from pathlib import Path

from .. import git_ops, meta
from .requirements import LoopSpec


GENERATOR_SKILL = "blueprint-to-work-orders"
REVIEWERS = (
    "wo-spec-judge",
    "wo-coverage-judge",
    "wo-overlap-judge",
    "wo-sequencing-judge",
)
LOOP_NAME = "work-orders-loop"
COMMIT_PATHS = [
    "work-orders/",
    "work-orders_communication/",
    "harness/state/",
]
QUESTIONS_FILE = "work-orders/_questions-pending.md"


def precondition(project_root: Path) -> None:
    blueprints_dir = project_root / "blueprints"
    if not blueprints_dir.is_dir():
        sys.exit(
            f"error: {blueprints_dir} not found — run blueprint-loop first to "
            f"produce the blueprints tree before running work-orders-loop"
        )
    has_any_blueprint = False
    for sub in ("containers", "components", "features"):
        sub_dir = blueprints_dir / sub
        if not sub_dir.is_dir():
            continue
        for entry in sub_dir.iterdir():
            if entry.is_file() and entry.suffix == ".md" and not entry.name.startswith((".", "_")):
                has_any_blueprint = True
                break
        if has_any_blueprint:
            break
    if not has_any_blueprint:
        sys.exit(
            f"error: {blueprints_dir} contains no blueprints — run blueprint-loop first"
        )


def post_generator(project_root: Path) -> None:
    """Materialise `.wo-<slug>.meta.yaml` from each `wo-<slug>.md` and refresh
    `_external-blockers.md` from current meta state.
    """
    meta.reconcile_work_orders_tree(project_root / "work-orders")


def build_generator_prompt(
    *,
    project_root: Path,
    attempt: int,
    max_attempts: int,
    failing_reviewers: list[str],
) -> str:
    comm_dir_rel = "work-orders_communication/"
    if attempt == 1:
        return f"""# Work-orders loop — attempt {attempt} of {max_attempts}

Inputs (paths relative to the project repo root):
- blueprints/{{containers,components,features}}/  (approved blueprints tree)
- work-orders/  (current on-disk tree, may be empty; if non-empty includes wo-<slug>.md
  files plus _sequence.md, _questions-pending.md, .sequence.meta.yaml)
- The project's existing source code: everything in the project root EXCEPT the
  harness-managed trees (requirements/, blueprints/, work-orders/, harness/, and any
  *_communication/ folders). Scan it per the blueprint-to-work-orders skill's
  "Codebase awareness" section: walk top-level structure and language/framework config;
  read entry-point files named in container blueprints; grep for symbols, models, and
  routes named in component / feature blueprints. The scan is targeted, not exhaustive.
- {comm_dir_rel}  (empty on attempt 1; on subsequent attempts holds reviewer transcripts)

Decompose the blueprints into a flat tree of slug-named work orders under work-orders/
following the blueprint-to-work-orders skill. Decision rule: blueprint surface fully
realised in code → no work order; partial → gap-scoped work order; unrealised → full
work order. Material divergence between code and blueprint shape → log a clarification
question. Write only the visible wo-<slug>.md content files plus _sequence.md; the
orchestrator materialises the dotted-hidden .wo-<slug>.meta.yaml files and regenerates
_external-blockers.md after you exit.

End your stdout summary with one of these lines:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: work-orders/_questions-pending.md
"""

    failing_block = "\n".join(f"- {name}" for name in failing_reviewers) or "- (none — all reviewers passed)"
    changed = git_ops.working_tree_changes(project_root, ["work-orders/"])
    if changed:
        change_lines = "\n".join(f"- {status}: {path}" for status, path in changed)
    else:
        change_lines = "(no working-tree changes detected since base)"

    return f"""# Work-orders loop — attempt {attempt} of {max_attempts}

The communication folder for this loop is at: {comm_dir_rel}
Each reviewer's full review history (and your prior responses) is in <reviewer-name>.md inside that folder.

Read every reviewer file before deciding what to change. Append your responses
(per-finding disposition + change-summary) to the SAME files you read from. Preserve
all prior content verbatim — never overwrite or modify content already in the file.

## Failing reviewers this attempt
{failing_block}

## Current working tree state (work-orders/)
{change_lines}

Inputs:
- blueprints/{{containers,components,features}}/  (approved blueprints tree)
- work-orders/  (current on-disk tree)
- The project's existing source code (everything outside the harness-managed trees)
- work-orders/_questions-pending.md  (if any)

End your stdout summary with one of these lines:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: work-orders/_questions-pending.md
"""


def build_reviewer_prompt(
    *,
    reviewer_name: str,
    attempt: int,
    max_attempts: int,
    project_root: Path,
) -> str:
    comm_file_rel = f"work-orders_communication/{reviewer_name}.md"
    return f"""# Work-orders loop review — attempt {attempt} of {max_attempts}
# Reviewer: {reviewer_name}

Inputs:
- Your communication file: {comm_file_rel}
- The work-orders tree: work-orders/wo-<slug>.md files plus work-orders/_sequence.md
- The blueprints tree: blueprints/containers/, blueprints/components/, blueprints/features/
- The project's existing source code (for coverage-judge and the generator's decision rule)

Run your review per the {reviewer_name} skill. Append a `## Review` block to your
communication file. Preserve all prior content verbatim — do not write any other file.
Write/Edit on any path other than {comm_file_rel} will be blocked.

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

Read each failing reviewer's communication file in work-orders_communication/
to see their fresh review, then fix or push back per the blueprint-to-work-orders skill.
End your stdout summary with one of:
  VERDICT: ready_for_review
  VERDICT: awaiting_clarification
followed (for awaiting_clarification only) by:
  open_questions: <N>
  questions_file: work-orders/_questions-pending.md
"""


def build_reviewer_resume_prompt(
    *,
    reviewer_name: str,
    attempt: int,
    max_attempts: int,
    project_root: Path,
) -> str:
    """Short follow-up message for a resumed reviewer session (attempts ≥ 2)."""
    comm_file_rel = f"work-orders_communication/{reviewer_name}.md"
    return f"""# Continuing — attempt {attempt} of {max_attempts}

The generator has run again and updated artifacts and (likely) your
communication file at {comm_file_rel}. Re-read the current state of
work-orders/ (every wo-<slug>.md plus _sequence.md), the blueprints tree,
and (if your rubric needs it) the project's existing source code. Run your
review per the {reviewer_name} skill.

Append a `## Review` block to {comm_file_rel} (preserve all prior content verbatim).
Write/Edit on any path other than that file is blocked.

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
