"""Characterization tests for verdict parsing and the reviewer fan-out.

`claude.spawn_claude` is replaced with a fake, so these pin down what each
loop asks for (prompt kind, tools, environment) and how it turns reviewer
output into verdicts, without starting a subprocess.
"""

import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from orchestrator import attempts, claude, loop_driver, verdict, wo_planner
from orchestrator.loops import coding, requirements


class VerdictTest(unittest.TestCase):
    def test_reviewer_verdicts(self):
        self.assertEqual(verdict.parse_reviewer_verdict("ok\nVERDICT: pass\n\n"), "pass")
        self.assertEqual(verdict.parse_reviewer_verdict("VERDICT: not_run\nREASON: no UI"), "not_run")
        self.assertIsNone(verdict.parse_reviewer_verdict("VERDICT: maybe"))
        self.assertIsNone(verdict.parse_reviewer_verdict(""))

    def test_generator_verdict_and_trailers(self):
        self.assertEqual(
            verdict.parse_generator_verdict("x\nVERDICT: awaiting_clarification\nopen_questions: 3\nquestions_file: q.md"),
            ("awaiting_clarification", {"open_questions": 3, "questions_file": "q.md"}),
        )
        self.assertEqual(verdict.parse_generator_verdict("no trailer"), (None, {}))


class HelpersTest(unittest.TestCase):
    def test_frontmatter_and_summary_tail(self):
        strip = attempts.strip_frontmatter
        self.assertEqual(strip("---\nname: x\n---\n\nBody\n"), "Body\n")
        self.assertEqual(strip("---\nunterminated\n"), "---\nunterminated\n")
        self.assertEqual(strip("Body"), "Body")
        self.assertEqual(attempts.summary_tail("short"), "short")
        self.assertEqual(attempts.summary_tail("a" * 4001), "...\n" + "a" * 4000)

    def test_open_question_count(self):
        tmp = Path(tempfile.mkdtemp())
        answers = tmp / "a.md"
        answers.write_text("## Q1\n**Your answer:**\n## Q2\n**Your answer:** yes\n")
        headings = tmp / "h.md"
        headings.write_text("# Title\n## Q1\n## ~~Q2~~\n### sub\n## Q3\n")
        self.assertEqual(loop_driver._count_open_questions(answers), 1)
        self.assertEqual(loop_driver._count_open_questions(headings), 2)
        self.assertEqual(loop_driver._count_open_questions(tmp / "missing.md"), 0)


def fake_spawner(outputs):
    """A spawn_claude stand-in returning canned stdout per reviewer, recording calls."""
    calls = {}
    lock = threading.Lock()

    def spawn(**kwargs):
        name = kwargs["extra_env"]["HARNESS_REVIEWER_NAME"]
        with lock:
            calls[name] = kwargs
        out = outputs[name]
        if isinstance(out, Exception):
            raise out
        if out == "RATE":
            return claude.ClaudeResult("", "429", 1, True, f"sid-{name}")
        return claude.ClaudeResult(out, "", 0, False, f"sid-{name}")

    return spawn, calls


OUTPUTS = {
    "a": "fine\nVERDICT: pass",
    "b": "VERDICT: fail",
    "c": "no trailer",
    "d": "RATE",
    "e": claude.ClaudeSpawnError("boom", "stderr"),
}


class PlanningReviewersTest(unittest.TestCase):
    def test_fan_out(self):
        project = Path(tempfile.mkdtemp())
        spec = mock.Mock(
            name="spec", reviewers=tuple(OUTPUTS),
            build_reviewer_prompt=lambda **k: f"fresh {k['reviewer_name']}",
            build_reviewer_resume_prompt=lambda **k: f"resume {k['reviewer_name']}",
        )
        spec.name = requirements.LOOP_NAME
        spawn, calls = fake_spawner(OUTPUTS)
        with mock.patch.object(claude, "spawn_claude", spawn):
            verdicts, limited, sessions = loop_driver._run_reviewers_parallel(
                spec=spec, attempt=2, max_attempts=3, project_root=project,
                reviewer_skill_bodies={n: f"skill {n}" for n in OUTPUTS},
                timeout_seconds=60, max_agent_retries=1, memoryless=False, model="m",
                reviewer_session_ids={"a": "old-a", "b": None, "c": None, "d": None, "e": None},
            )
        self.assertEqual(verdicts, {"a": "pass", "b": "fail", "c": "fail", "d": "fail", "e": "fail"})
        self.assertEqual(limited, [{"reviewer": "d", "stderr": "429"}])
        self.assertEqual(sessions, {"b": "sid-b", "c": "sid-c"})
        self.assertEqual(calls["a"]["user_prompt"], "resume a")
        self.assertEqual(calls["b"]["user_prompt"], "fresh b")
        self.assertEqual(calls["a"]["existing_session_id"], "old-a")
        self.assertEqual(calls["b"]["disallowed_tools"], ["Bash", "NotebookEdit", "Task"])
        comm = project / "requirements_communication" / "b.md"
        self.assertTrue(comm.exists())
        self.assertEqual(calls["b"]["extra_env"], {
            "HARNESS_AGENT_KIND": "reviewer",
            "HARNESS_LOOP_NAME": "requirements-loop",
            "HARNESS_REVIEWER_NAME": "b",
            "HARNESS_REVIEWER_COMM_FILE": str(comm.resolve()),
            "HARNESS_MAX_AGENT_RETRIES": "1",
            "HARNESS_STOP_HOOK_COUNTER": str(project / "harness/state/.hook-counters/requirements-loop-attempt-2-b.txt"),
        })
        self.assertEqual(calls["b"]["append_system_prompt"], "skill b")
        self.assertTrue((project / "harness/state/.scratch-settings/requirements-loop-attempt-2-b.json").exists())


class CodingReviewersTest(unittest.TestCase):
    def test_fan_out(self):
        project = Path(tempfile.mkdtemp())
        root = project / "work-orders"
        root.mkdir()
        (root / "wo-x.md").write_text("# X\n")
        (root / ".wo-x.meta.yaml").write_text("id: wo-x\nstatus: ready\n")
        wo = wo_planner.load_work_order(root, "wo-x")
        spawn, calls = fake_spawner(OUTPUTS)
        with mock.patch.object(claude, "spawn_claude", spawn):
            verdicts, limited, sessions = coding._run_reviewers_parallel(
                project_root=project, wo=wo, attempt=1, max_attempts=3, branch="task/wo-x",
                base_branch="main", pr_number=7, pr_url="https://example/pr/7",
                reviewer_skills=list(OUTPUTS), reviewer_skill_bodies={n: n for n in OUTPUTS},
                timeout_seconds=60, max_agent_retries=2, memoryless=True, model="m",
                reviewer_session_ids={"a": "old-a"},
            )
        self.assertEqual(verdicts, {"a": "pass", "b": "fail", "c": "fail", "d": "fail", "e": "fail"})
        self.assertEqual(limited, [{"reviewer": "d", "stderr": "429"}])
        self.assertEqual(sessions, {})
        self.assertIsNone(calls["a"]["existing_session_id"])
        self.assertTrue(calls["a"]["user_prompt"].startswith("# Coding loop review — wo-x — attempt 1 of 3"))
        self.assertEqual(calls["a"]["disallowed_tools"], ["NotebookEdit", "Task"])
        comm = project / "coding_communication" / "wo-x" / "a.md"
        self.assertEqual(calls["a"]["extra_env"], {
            "HARNESS_AGENT_KIND": "reviewer",
            "HARNESS_LOOP_NAME": "coding-loop",
            "HARNESS_MAX_AGENT_RETRIES": "2",
            "HARNESS_STOP_HOOK_COUNTER": str(project / "harness/state/.hook-counters/coding-loop-wo-x-attempt-1-a.txt"),
            "HARNESS_TASK_ID": "wo-x",
            "HARNESS_BRANCH": "task/wo-x",
            "HARNESS_BASE_BRANCH": "main",
            "HARNESS_WO_PATH": str(root / "wo-x.md"),
            "PLAYWRIGHT_HARNESS_ROOT": str(Path(coding.paths.PLAYWRIGHT_HARNESS_DIR)),
            "HARNESS_PR_NUMBER": "7",
            "HARNESS_PR_URL": "https://example/pr/7",
            "HARNESS_REVIEWER_NAME": "a",
            "HARNESS_REVIEWER_COMM_FILE": str(comm.resolve()),
        })


if __name__ == "__main__":
    unittest.main()
