"""Characterization tests for the files the loops write into a project.

Every expected string here is what the code produced before it was
refactored; a change to any of them changes a file on disk in someone's
project.
"""

import tempfile
import unittest
from pathlib import Path

from orchestrator import meta, wo_planner


WO_BODY = """# Wire the login form

## Type
{type_}

## Goal
Users can sign in with email.

## Depends on
```yaml
work_orders: [{deps}]
```

## Acceptance criteria
- [ ] AC-1 form renders (via playwright)
- [ ] AC-2 bad password is refused (via tests)

## Gates
```yaml
tests: required
playwright: not_applicable
code_spec: required
code_quality: required
# a comment
bogus: maybe
```
"""


def write_wo(root: Path, slug: str, *, type_: str = "feature", deps: str = "") -> None:
    (root / f"{slug}.md").write_text(WO_BODY.format(type_=type_, deps=deps))


class RequirementsTreeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.features = self.tmp / "requirements" / "features"
        self.features.mkdir(parents=True)

    def test_metas_are_created_refreshed_and_pruned(self):
        (self.features / "auth.md").write_text("# Authentication\n\nbody\n")
        (self.features / "billing.md").write_text("no heading here\n")
        (self.features / "_index.md").write_text("# ignored\n")
        children = self.features / "auth_children"
        children.mkdir()
        (children / "sso.md").write_text("# Single sign-on: SAML\n")
        (self.features / "gone_children").mkdir()
        (self.features / ".gone.feature.meta.yaml").write_text("id: null\n")

        meta.reconcile_requirements_tree(self.tmp / "requirements")

        self.assertEqual(
            (self.features / ".auth.feature.meta.yaml").read_text(),
            "id: null\nparent_id: null\nposition: 0\ntitle: Authentication\n",
        )
        self.assertEqual((self.features / ".auth.requirements.meta.yaml").read_text(), "id: null\n")
        self.assertEqual(
            (self.features / ".billing.feature.meta.yaml").read_text(),
            "id: null\nparent_id: null\nposition: 1\ntitle: billing\n",
        )
        self.assertEqual(
            (children / ".sso.feature.meta.yaml").read_text(),
            'id: null\nparent_id: null\nposition: 0\ntitle: "Single sign-on: SAML"\n',
        )
        self.assertFalse((self.features / ".gone.feature.meta.yaml").exists())
        self.assertFalse((self.features / "gone_children").exists())
        self.assertFalse((self.features / "._index.feature.meta.yaml").exists())

    def test_refresh_keeps_title_once_an_id_is_set(self):
        (self.features / "a.md").write_text("# New title\n")
        (self.features / "b.md").write_text("# B\n")
        (self.features / ".b.feature.meta.yaml").write_text(
            "id: SF-12\nparent_id: SF-1\nposition: 7\ntitle: Old title\n"
        )
        (self.features / ".a.feature.meta.yaml").write_text(
            "id: null\nparent_id: null\nposition: 3\ntitle: Old\n"
        )

        meta.reconcile_requirements_tree(self.tmp / "requirements")

        self.assertEqual(
            (self.features / ".a.feature.meta.yaml").read_text(),
            "id: null\nparent_id: null\nposition: 0\ntitle: New title\n",
        )
        self.assertEqual(
            (self.features / ".b.feature.meta.yaml").read_text(),
            "id: SF-12\nparent_id: SF-1\nposition: 1\ntitle: Old title\n",
        )


class WorkOrdersTreeTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())

    def test_wo_metas_and_external_blockers(self):
        write_wo(self.root, "wo-login", deps="wo-schema, wo-api")
        write_wo(self.root, "wo-keys", type_="operator-action")
        write_wo(self.root, "wo-stuck")
        write_wo(self.root, "wo-schema", type_="infra")
        (self.root / ".wo-deleted.meta.yaml").write_text("id: wo-deleted\n")
        (self.root / ".wo-stuck.meta.yaml").write_text(
            "id: wo-stuck\nstatus: blocked_external\npriority: 2\nparent_id: null\n"
        )

        meta.reconcile_work_orders_tree(self.root)

        self.assertEqual(
            (self.root / ".wo-login.meta.yaml").read_text(),
            "id: wo-login\nstatus: ready\npriority: null\ntype: feature\nparent_id: null\n"
            "blocked_by: [wo-schema, wo-api]\nblueprint_ids: []\n",
        )
        self.assertEqual(
            (self.root / ".wo-stuck.meta.yaml").read_text(),
            "id: wo-stuck\nstatus: blocked_external\npriority: 2\ntype: feature\nparent_id: null\n"
            "blocked_by: []\nblueprint_ids: []\n",
        )
        self.assertFalse((self.root / ".wo-deleted.meta.yaml").exists())
        entry = (
            "**Goal:** Users can sign in with email.\n"
            "**Acceptance criteria:**\n"
            "- [ ] AC-1 form renders (via playwright)\n"
            "- [ ] AC-2 bad password is refused (via tests)\n"
        )
        self.assertEqual(
            (self.root / "_external-blockers.md").read_text(),
            "# External blockers\n\n"
            "Operator action required before the loop can drain further. Mark each work order's "
            "`.wo-<slug>.meta.yaml.status` to `done` (operator-action) or `ready` (blocked_external) "
            "once the action is complete.\n\n"
            "## Anticipated operator actions\n\n"
            "### `wo-keys`\n" + entry + "\n"
            "## Discovered mid-execution blockers\n\n"
            "### `wo-stuck`\n" + entry,
        )

    def test_blockers_file_lists_none_and_is_removed_when_empty(self):
        write_wo(self.root, "wo-keys", type_="operator-action")
        meta.reconcile_work_orders_tree(self.root)
        text = (self.root / "_external-blockers.md").read_text()
        self.assertTrue(text.endswith("## Discovered mid-execution blockers\n\n(none)\n"))

        (self.root / ".wo-keys.meta.yaml").write_text("id: wo-keys\nstatus: done\n")
        meta.reconcile_work_orders_tree(self.root)
        self.assertFalse((self.root / "_external-blockers.md").exists())


class PlannerTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        write_wo(self.root, "wo-schema", type_="infra")
        write_wo(self.root, "wo-keys", type_="operator-action")
        write_wo(self.root, "wo-login", deps="wo-schema")
        (self.root / "_sequence.md").write_text(
            "# Order\n\n1. wo-keys\n2. wo-login\n3. wo-schema\n4. wo-login again\n"
        )
        meta.reconcile_work_orders_tree(self.root)

    def test_sequence_and_ready_pick_respects_dependencies(self):
        self.assertEqual(wo_planner.read_sequence(self.root), ["wo-keys", "wo-login", "wo-schema"])
        self.assertEqual(wo_planner.pick_next_ready(self.root).slug, "wo-schema")
        wo_planner.set_status(wo_planner.load_work_order(self.root, "wo-schema"), "done")
        self.assertEqual(wo_planner.pick_next_ready(self.root).slug, "wo-login")

    def test_set_status_rewrites_meta_preserving_lists(self):
        wo = wo_planner.load_work_order(self.root, "wo-login")
        self.assertEqual(wo.blocked_by, ["wo-schema"])
        wo_planner.set_status(wo, "in_progress")
        self.assertEqual(
            wo.meta_path.read_text(),
            "id: wo-login\nstatus: in_progress\npriority: null\ntype: feature\nparent_id: null\n"
            "blocked_by: [wo-schema]\nblueprint_ids: []\n",
        )
        self.assertEqual(wo_planner.in_progress_slugs(self.root), ["wo-login"])

    def test_gates_title_and_reviewers(self):
        wo = wo_planner.load_work_order(self.root, "wo-login")
        gates = wo_planner.read_gates(wo)
        self.assertEqual(
            gates,
            {"tests": "required", "playwright": "not_applicable", "code_spec": "required", "code_quality": "required"},
        )
        self.assertEqual(
            wo_planner.required_reviewer_skills(gates),
            ["tests-runner", "code-spec-judge", "code-quality-judge"],
        )
        self.assertEqual(wo_planner.read_title(wo), "Wire the login form")


if __name__ == "__main__":
    unittest.main()
