"""Spawn `claude -p` subprocesses and capture stdout, with rate-limit retry.

The `Stop` hook (see `orchestrator/hooks/stop_verdict.py`) is the sole
verdict-format enforcement layer; if a subprocess somehow exits with a
malformed VERDICT trailer despite the hook (hook bypass, subprocess crash,
truncated output), the orchestrator records that as a soft fail and the loop
continues. There is no post-exit recovery layer for malformed output —
keeping the orchestrator simple at the cost of treating rare malformed cases
as soft fails.

Rate-limit retries are different: the model never produced output at all,
so we re-spawn with a doubling backoff up to `max_agent_retries` times.

Session continuity. By default the orchestrator runs each role (generator,
each reviewer) as a single `claude -p` session that persists across attempts
within an invocation: attempt 1 is a fresh spawn with `--session-id <uuid>`,
attempts 2+ pass `--resume <uuid>` and a shorter follow-up message. New
invocations start from scratch. The `--memoryless` CLI flag forces every
spawn to be a fresh session, restoring v0.1's original behavior (the
communication folder is the only memory channel).
"""

import os
import re
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path


RATE_LIMIT_PATTERNS = (
    re.compile(r"\brate[- ]?limit", re.IGNORECASE),
    re.compile(r"\b429\b"),
    re.compile(r"server is temporarily limiting", re.IGNORECASE),
    re.compile(r"\boverloaded\b", re.IGNORECASE),
)


def _backoff_schedule(max_agent_retries: int) -> tuple[int, ...]:
    """Doubling backoff starting at 30s, capped to `max_agent_retries` entries."""
    base = 30
    return tuple(base * (2 ** i) for i in range(max_agent_retries))


@dataclass
class ClaudeResult:
    stdout: str
    stderr: str
    exit_code: int
    rate_limited_out: bool
    session_id: str


@dataclass
class ClaudeSpawnError(RuntimeError):
    """Raised when a subprocess fails for reasons other than a recovered rate limit."""

    message: str
    stderr: str

    def __str__(self) -> str:
        return self.message


def spawn_claude(
    *,
    user_prompt: str,
    append_system_prompt: str,
    cwd: Path,
    settings_file: Path | None = None,
    disallowed_tools: list[str] | None = None,
    extra_env: dict[str, str] | None = None,
    timeout_seconds: int,
    max_agent_retries: int,
    existing_session_id: str | None = None,
    model: str | None = None,
) -> ClaudeResult:
    """Spawn one `claude -p` subprocess with rate-limit retries.

    If `existing_session_id` is None, starts a fresh session with a
    deterministic UUID (`--session-id <uuid>`); the system prompt comes from
    `append_system_prompt`. If provided, resumes the existing session
    (`--resume <uuid>`) and the system prompt is inherited from that session,
    so `append_system_prompt` is ignored in the resume branch.

    `model` is the Claude model id passed via `--model` (e.g. `claude-opus-4-7[1m]`,
    `claude-sonnet-4-6`). When None, the subprocess inherits the operator's `claude`
    CLI default. Generators and reviewers each receive their own model per
    `config.yaml`'s `model_generator` / `model_reviewer` fields.

    Returns a ClaudeResult on the first success. Returns a result with
    `rate_limited_out=True` only if every retry also rate-limits. Raises
    ClaudeSpawnError on non-rate-limit failures (non-zero exit not caused by
    a recognised rate-limit signature, or the process was killed).
    """
    sid = existing_session_id or str(uuid.uuid4())
    cmd = [
        "claude",
        "--print",
        "--permission-mode", "bypassPermissions",
        "--output-format", "text",
    ]
    if model is not None:
        cmd += ["--model", model]
    if existing_session_id is None:
        cmd += ["--session-id", sid, "--append-system-prompt", append_system_prompt]
    else:
        cmd += ["--resume", sid]
    if settings_file is not None:
        cmd += ["--settings", str(settings_file)]
    if disallowed_tools:
        cmd += ["--disallowedTools", ",".join(disallowed_tools)]

    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)

    backoffs = _backoff_schedule(max_agent_retries)
    attempts: list[ClaudeResult] = []
    for attempt_i, backoff in enumerate([0, *backoffs]):
        if backoff > 0:
            print(
                f"  rate-limited; waiting {backoff}s before retry {attempt_i} of {max_agent_retries}...",
                flush=True,
            )
            time.sleep(backoff)
        try:
            completed = subprocess.run(
                cmd,
                input=user_prompt,
                capture_output=True,
                text=True,
                cwd=str(cwd),
                env=env,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired as e:
            raise ClaudeSpawnError(
                message=f"claude subprocess exceeded wall-clock cap of {timeout_seconds}s",
                stderr=(e.stderr or b"").decode(errors="replace") if isinstance(e.stderr, (bytes, bytearray)) else (e.stderr or ""),
            ) from e

        result = ClaudeResult(
            stdout=completed.stdout,
            stderr=completed.stderr,
            exit_code=completed.returncode,
            rate_limited_out=False,
            session_id=sid,
        )

        if completed.returncode == 0:
            return result

        if _looks_rate_limited(completed.stderr) or _looks_rate_limited(completed.stdout):
            attempts.append(result)
            continue

        raise ClaudeSpawnError(
            message=f"claude subprocess exited {completed.returncode}",
            stderr=completed.stderr,
        )

    final = attempts[-1]
    final.rate_limited_out = True
    return final


def _looks_rate_limited(text: str) -> bool:
    if not text:
        return False
    return any(p.search(text) for p in RATE_LIMIT_PATTERNS)
