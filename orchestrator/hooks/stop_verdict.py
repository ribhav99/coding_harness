#!/usr/bin/env python3
"""Stop hook: validate that the model's last assistant turn ends with VERDICT line.

Wired into `.claude/settings.json` as a Stop hook (per BLUEPRINT.md §9). Reads
the Claude Code hook payload from stdin, walks the transcript JSONL, finds the
final assistant message, and exits 2 with a stderr message if its text doesn't
end with a recognised `VERDICT:` trailer — this surfaces back to the model and
forces it to continue the turn with the corrective instruction.

The hook self-caps at `HARNESS_MAX_AGENT_RETRIES` blocks per spawn via a
per-spawn counter file (`HARNESS_STOP_HOOK_COUNTER`). Once the cap is reached
the hook returns 0 (allow the turn to end with malformed output); the
orchestrator records a soft fail and the loop continues. Without this cap a
stubbornly-malformed model could ping-pong with the hook forever.

Env vars (set by the orchestrator when spawning):
    HARNESS_AGENT_KIND          "generator" | "reviewer"
    HARNESS_MAX_AGENT_RETRIES   integer cap on retries (matches config.yaml)
    HARNESS_STOP_HOOK_COUNTER   path to a per-spawn counter file

Reviewer trailers: `VERDICT: pass` | `VERDICT: fail`.
Generator trailers:
    VERDICT: ready_for_review
    VERDICT: awaiting_clarification     (may be followed by metadata lines)
"""

import json
import os
import sys
from pathlib import Path


REVIEWER_VERDICTS = {"VERDICT: pass", "VERDICT: fail"}
GENERATOR_VERDICTS = {"VERDICT: ready_for_review", "VERDICT: awaiting_clarification"}


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")

    transcript_path = payload.get("transcript_path")
    if not transcript_path or not Path(transcript_path).exists():
        return 0

    last_text = _last_assistant_text(Path(transcript_path))
    if last_text is None:
        return 0

    kind = os.environ.get("HARNESS_AGENT_KIND", "")
    valid = REVIEWER_VERDICTS if kind == "reviewer" else GENERATOR_VERDICTS

    last_line = _last_nonblank_line(last_text)
    if kind == "generator" and last_line.startswith(("open_questions:", "questions_file:")):
        last_line = _verdict_line_above_metadata(last_text) or last_line

    if last_line in valid:
        return 0

    if _retries_exhausted():
        sys.stderr.write(
            "Stop hook: VERDICT trailer still malformed after retry cap reached; "
            "letting the turn end. Orchestrator will record a soft fail.\n"
        )
        return 0

    expected = " or ".join(sorted(valid))
    sys.stderr.write(
        "Your final response must end with one of: "
        f"{expected}. Add the trailing VERDICT line and try again.\n"
    )
    return 2


def _retries_exhausted() -> bool:
    """Increment the per-spawn retry counter; return True once the cap is reached."""
    counter_path_str = os.environ.get("HARNESS_STOP_HOOK_COUNTER")
    max_retries_str = os.environ.get("HARNESS_MAX_AGENT_RETRIES")
    if not counter_path_str or not max_retries_str:
        return False
    try:
        max_retries = int(max_retries_str)
    except ValueError:
        return False

    counter_path = Path(counter_path_str)
    counter_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        prior = int(counter_path.read_text().strip()) if counter_path.exists() else 0
    except ValueError:
        prior = 0
    new_count = prior + 1
    counter_path.write_text(f"{new_count}\n")
    return new_count > max_retries


def _last_assistant_text(transcript_path: Path) -> str | None:
    text: str | None = None
    with transcript_path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("role") == "assistant" or entry.get("type") == "assistant":
                text = _extract_text(entry)
    return text


def _extract_text(entry: dict) -> str | None:
    content = entry.get("content") or entry.get("message", {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        if parts:
            return "\n".join(parts)
    return None


def _last_nonblank_line(text: str) -> str:
    for line in reversed(text.splitlines()):
        if line.strip():
            return line.strip()
    return ""


def _verdict_line_above_metadata(text: str) -> str | None:
    """For `awaiting_clarification` the VERDICT line may be followed by metadata."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.startswith("VERDICT:"):
            return line
    return None


if __name__ == "__main__":
    sys.exit(main())
