"""Characterization tests for the state files under harness/state/."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from orchestrator import state


def run_loop_state(project: Path) -> dict:
    s = state.LoopState(project, "blueprint-loop")
    s.begin_invocation(3, 60)
    s.set_generator_session_id("gen-1")
    s.set_reviewer_session_id("bp-spec-judge", "rev-1")
    s.record_attempt(n=1, verdict="fail", summary="first", review_dir="r/1",
                     reviewer_verdicts={"bp-spec-judge": "fail"}, open_questions=2)
    s.record_rate_limit_exhaustion("reviewer", 1, "x" * 2100, reviewer_name="bp-spec-judge")
    s.finalise("exhausted")
    s.save()
    return json.loads(s.path.read_text())


def run_wo_state(project: Path) -> dict:
    s = state.WorkOrderState(project, "wo-x")
    s.begin_invocation(max_attempts=2, max_wall_minutes=30, title="X", body_path="work-orders/wo-x.md",
                       branch="task/wo-x")
    s.set_pr_info("https://example/pr/9", 9)
    s.set_pr_info(None, None)
    s.record_attempt(n=1, verdict="pass", summary="done", review_dir="r/1", reviewer_verdicts={})
    s.record_attempt(n=2, verdict="pass", summary="done again", review_dir="r/2",
                     reviewer_verdicts={"code-spec-judge": "pass"})
    s.finalise("pass")
    s.save()
    return json.loads(s.path.read_text())


class StateTest(unittest.TestCase):
    def setUp(self):
        self.project = Path(tempfile.mkdtemp())
        patcher = mock.patch.object(state, "_now_iso", return_value="T")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_loop_state_file(self):
        self.assertEqual(run_loop_state(self.project), {
            "loop": {"name": "blueprint-loop", "artifact_paths": ["blueprints/"],
                     "communication_dir": "blueprints_communication/"},
            "created_at": "T", "updated_at": "T", "status": "exhausted", "attempt_count": 1,
            "limits": {"max_attempts": 3, "max_wall_minutes": 60},
            "current": {"last_output": "first"},
            "verification": {"bp_spec_judge": {"result": "fail", "ran_at": "T"}},
            "open_questions": 2,
            "attempts": [{"n": 1, "at": "T", "verdict": "fail", "summary": "first", "review_dir": "r/1",
                          "reviewer_verdicts": {"bp-spec-judge": "fail"}, "open_questions": 2}],
            "history": [{"session": 1, "at": "T", "final_verdict": "exhausted", "output": "first"}],
            "rate_limit_failures": [{"at": "T", "subprocess_kind": "reviewer", "reviewer_name": "bp-spec-judge",
                                     "attempt_n": 1, "stderr_tail": "x" * 2000}],
            "sessions": {"generator": "gen-1", "reviewers": {"bp-spec-judge": "rev-1"}},
        })
        self.assertEqual((self.project / "harness/state/blueprint-loop.json").read_text()[-2:], "}\n")

    def test_work_order_state_file(self):
        self.assertEqual(run_wo_state(self.project), {
            "wo_slug": "wo-x", "local": {"title": "X", "path": "work-orders/wo-x.md"},
            "created_at": "T", "updated_at": "T", "status": "pass", "attempt_count": 2,
            "limits": {"max_attempts": 2, "max_wall_minutes": 30},
            "execution": {"branch": "task/wo-x", "pr_url": "https://example/pr/9", "pr_number": 9},
            "current": {"last_output": "done again"},
            "verification": {"code_spec_judge": {"result": "pass", "ran_at": "T"}},
            "attempts": [
                {"n": 1, "at": "T", "verdict": "pass", "summary": "done", "review_dir": "r/1", "reviewer_verdicts": {}},
                {"n": 2, "at": "T", "verdict": "pass", "summary": "done again", "review_dir": "r/2",
                 "reviewer_verdicts": {"code-spec-judge": "pass"}},
            ],
            "history": [{"session": 1, "at": "T", "final_verdict": "pass", "output": "done again"}],
            "rate_limit_failures": [],
            "sessions": {"generator": None, "reviewers": {}},
        })

    def test_state_persists_across_invocations(self):
        run_wo_state(self.project)
        again = state.WorkOrderState(self.project, "wo-x")
        again.begin_invocation(max_attempts=2, max_wall_minutes=30, title="X",
                               body_path="work-orders/wo-x.md", branch="task/wo-x")
        self.assertEqual(again.data["execution"]["pr_number"], 9)
        self.assertEqual(again.data["attempts"], [])
        self.assertEqual(len(again.data["history"]), 1)


if __name__ == "__main__":
    unittest.main()
