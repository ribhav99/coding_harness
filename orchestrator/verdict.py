"""Parse the trailing `VERDICT:` line from a subprocess's stdout."""

from typing import Literal


GeneratorVerdict = Literal["ready_for_review", "awaiting_clarification", "blocked_external"]
ReviewerVerdict = Literal["pass", "fail", "not_run"]


def parse_reviewer_verdict(stdout: str) -> ReviewerVerdict | None:
    """Return 'pass', 'fail', or 'not_run' if the trailing line matches; None if malformed.

    `not_run` is emitted by `tests-runner` / `playwright-runner` when the gate
    isn't applicable for the current change (no test command found, no UI ACs,
    etc.). The orchestrator records it but does not count it as a failure.
    """
    last = _last_nonblank_line(stdout)
    if last == "VERDICT: pass":
        return "pass"
    if last == "VERDICT: fail":
        return "fail"
    if last == "VERDICT: not_run":
        return "not_run"
    # `tests-runner` and `playwright-runner` emit a `REASON:` line after the
    # VERDICT; tolerate one trailing REASON line so the hook's strict format
    # doesn't reject either skill's documented exit shape.
    second_last = _nth_last_nonblank_line(stdout, 2)
    if second_last in ("VERDICT: pass", "VERDICT: fail", "VERDICT: not_run") and last.startswith("REASON:"):
        return second_last.split(": ", 1)[1]  # type: ignore[return-value]
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
    verdict: GeneratorVerdict
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped == "VERDICT: ready_for_review":
            verdict_idx = i
            verdict = "ready_for_review"
            break
        if stripped == "VERDICT: awaiting_clarification":
            verdict_idx = i
            verdict = "awaiting_clarification"
            break
        if stripped == "VERDICT: blocked_external":
            verdict_idx = i
            verdict = "blocked_external"
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


def _nth_last_nonblank_line(text: str, n: int) -> str:
    """Return the n-th-from-last non-blank line (1 = last, 2 = second-to-last)."""
    count = 0
    for line in reversed(text.splitlines()):
        if line.strip():
            count += 1
            if count == n:
                return line.strip()
    return ""
