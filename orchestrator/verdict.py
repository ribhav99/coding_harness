"""Parse the trailing `VERDICT:` line from a subprocess's stdout."""

from typing import Literal


GeneratorVerdict = Literal["ready_for_review", "awaiting_clarification"]
ReviewerVerdict = Literal["pass", "fail"]


def parse_reviewer_verdict(stdout: str) -> ReviewerVerdict | None:
    """Return 'pass' or 'fail' if the trailing line matches; None if malformed."""
    last = _last_nonblank_line(stdout)
    if last == "VERDICT: pass":
        return "pass"
    if last == "VERDICT: fail":
        return "fail"
    return None


def parse_generator_verdict(stdout: str) -> tuple[GeneratorVerdict | None, dict]:
    """Return (verdict, metadata).

    Metadata may include `open_questions: int` and `questions_file: str` for the
    `awaiting_clarification` form per BLUEPRINT.md §8.1.
    """
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        return None, {}

    metadata: dict = {}
    verdict_idx: int | None = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped == "VERDICT: ready_for_review":
            verdict_idx = i
            verdict: GeneratorVerdict = "ready_for_review"
            break
        if stripped == "VERDICT: awaiting_clarification":
            verdict_idx = i
            verdict = "awaiting_clarification"
            break
    else:
        return None, {}

    for trailer in lines[verdict_idx + 1:]:
        stripped = trailer.strip()
        if stripped.startswith("open_questions:"):
            try:
                metadata["open_questions"] = int(stripped.split(":", 1)[1].strip())
            except ValueError:
                pass
        elif stripped.startswith("questions_file:"):
            metadata["questions_file"] = stripped.split(":", 1)[1].strip()

    return verdict, metadata


def _last_nonblank_line(text: str) -> str:
    for line in reversed(text.splitlines()):
        if line.strip():
            return line.strip()
    return ""
