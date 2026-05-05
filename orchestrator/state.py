"""Per-loop state file under `harness/state/<loop>.json` (BLUEPRINT.md §7.3)."""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import paths


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class LoopState:
    """Read/modify/write a loop-level state file.

    State is fresh per orchestrator invocation: `attempts[]` is cleared at the
    start of each run; `history[]` accumulates one summary per past
    invocation. Schema follows BLUEPRINT.md §7.3.
    """

    def __init__(self, project_root: Path, loop_name: str) -> None:
        self.project_root = project_root
        self.loop_name = loop_name
        self.path = paths.loop_state_file(project_root, loop_name)
        self.data: dict[str, Any] = self._load_or_init()

    def _load_or_init(self) -> dict[str, Any]:
        if self.path.exists():
            return json.loads(self.path.read_text())
        artifact_paths = {
            "requirements-loop": ["requirements/"],
            "blueprint-loop": ["blueprints/"],
        }.get(self.loop_name, [])
        comm_dir = {
            "requirements-loop": "requirements_communication/",
            "blueprint-loop": "blueprints_communication/",
        }.get(self.loop_name)
        return {
            "loop": {
                "name": self.loop_name,
                "artifact_paths": artifact_paths,
                "communication_dir": comm_dir,
            },
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "status": "fresh",
            "attempt_count": 0,
            "limits": {},
            "current": {"last_output": ""},
            "verification": {},
            "open_questions": 0,
            "attempts": [],
            "history": [],
            "rate_limit_failures": [],
            "sessions": {"generator": None, "reviewers": {}},
        }

    def begin_invocation(self, max_attempts: int, max_wall_minutes: int) -> None:
        self.data["status"] = "in_progress"
        self.data["attempt_count"] = 0
        self.data["limits"] = {
            "max_attempts": max_attempts,
            "max_wall_minutes": max_wall_minutes,
        }
        self.data["attempts"] = []
        self.data["current"] = {"last_output": ""}
        self.data["verification"] = {}
        self.data["open_questions"] = 0
        # Sessions are per-invocation. Each new invocation starts agents from
        # scratch; attempts within the invocation resume the same session.
        self.data["sessions"] = {"generator": None, "reviewers": {}}
        self._touch()

    def get_generator_session_id(self) -> str | None:
        return (self.data.get("sessions") or {}).get("generator")

    def set_generator_session_id(self, session_id: str) -> None:
        self.data.setdefault("sessions", {"generator": None, "reviewers": {}})
        self.data["sessions"]["generator"] = session_id
        self._touch()

    def get_reviewer_session_id(self, reviewer_name: str) -> str | None:
        return (self.data.get("sessions") or {}).get("reviewers", {}).get(reviewer_name)

    def set_reviewer_session_id(self, reviewer_name: str, session_id: str) -> None:
        sessions = self.data.setdefault("sessions", {"generator": None, "reviewers": {}})
        sessions.setdefault("reviewers", {})[reviewer_name] = session_id
        self._touch()

    def record_attempt(
        self,
        n: int,
        verdict: str,
        summary: str,
        review_dir: str | None,
        reviewer_verdicts: dict[str, str],
        open_questions: int,
    ) -> None:
        self.data["attempts"].append({
            "n": n,
            "at": _now_iso(),
            "verdict": verdict,
            "summary": summary,
            "review_dir": review_dir,
            "reviewer_verdicts": reviewer_verdicts,
            "open_questions": open_questions,
        })
        self.data["attempt_count"] = n
        self.data["current"]["last_output"] = summary
        self.data["verification"] = {
            reviewer.replace("-", "_"): {"result": v, "ran_at": _now_iso()}
            for reviewer, v in reviewer_verdicts.items()
        }
        self.data["open_questions"] = open_questions
        self._touch()

    def record_rate_limit_exhaustion(
        self,
        subprocess_kind: str,
        attempt_n: int,
        captured_stderr: str,
        reviewer_name: str | None = None,
    ) -> None:
        self.data["rate_limit_failures"].append({
            "at": _now_iso(),
            "subprocess_kind": subprocess_kind,
            "reviewer_name": reviewer_name,
            "attempt_n": attempt_n,
            "stderr_tail": captured_stderr[-2000:],
        })
        self._touch()

    def finalise(self, final_verdict: str) -> None:
        self.data["status"] = final_verdict
        attempts = self.data.get("attempts") or []
        last_summary = attempts[-1]["summary"] if attempts else ""
        self.data["history"].append({
            "session": len(self.data["history"]) + 1,
            "at": _now_iso(),
            "final_verdict": final_verdict,
            "output": last_summary,
        })
        self._touch()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2) + "\n")

    def _touch(self) -> None:
        self.data["updated_at"] = _now_iso()
