"""Review export handoff tests against the existing Label Studio transport adapter.

Synthetic exports are not human gold, and these checks do not verify reviewer
independence. The owning Review Bridge remains responsible for semantics.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile
import unittest

import labelstudio_project_setup as setup
from test_labelstudio_project_setup import fixture


def fake_export(tasks, *, same_user=False, missing=False, drift=False):
    def respond(base, token, route, body=None):
        pid = int(route.split("/")[3])
        rows = copy.deepcopy(tasks)
        for index, entry in enumerate(rows):
            entry["predictions"] = []
            entry["annotations"] = [] if (missing and index == 0) else [{
                "completed_by": 15 if same_user else 15 + pid,
                "was_cancelled": False,
                "result": [{"from_name": "review_coverage",
                            "to_name": "source_text", "type": "choices",
                            "value": {"choices": ["NO_TASK_RELEVANT_SPANS"]}}],
            }]
        if drift:
            rows[0]["data"]["source_text"] += "unexpected"
        return rows
    return respond


class ExportHandoffTests(unittest.TestCase):
    def test_two_complete_exports_remain_distinct_and_ungolded(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a.json", Path(folder) / "b.json"
            result = setup.export_reviewed_projects(
                tasks, "http://127.0.0.1:8080", "synthetic",
                (10, 11), a, b, call=fake_export(tasks))
            self.assertEqual(result["sources_per_export"], 8)
            self.assertEqual(result["project_ids"], [10, 11])
            self.assertFalse(result["human_gold"])
            self.assertFalse(result["reviewer_independence_verified"])
            self.assertEqual(len(json.loads(a.read_text("utf-8"))), 8)
            self.assertEqual(len(json.loads(b.read_text("utf-8"))), 8)
            self.assertTrue(all(len(x["annotations"]) == 1
                                for x in json.loads(a.read_text("utf-8"))))
            if __import__("os").name == "posix":
                self.assertEqual(a.stat().st_mode & 0o777, 0o600)

    def test_incomplete_annotation_prevents_any_export(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a", Path(folder) / "b"
            with self.assertRaisesRegex(
                    setup.SetupHold, "LABEL_STUDIO_REVIEW_EXPORT_NOT_SINGLE_COMPLETE"):
                setup.export_reviewed_projects(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    (10, 11), a, b, call=fake_export(tasks, missing=True))
            self.assertFalse(a.exists())
            self.assertFalse(b.exists())

    def test_identity_or_source_drift_prevents_export(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a", Path(folder) / "b"
            for opts, error in (
                ({"same_user": True}, "LABEL_STUDIO_SAME_REVIEWER_IN_BOTH_PROJECTS"),
                ({"drift": True}, "LABEL_STUDIO_REVIEW_SOURCE_MISMATCH")):
                with self.assertRaisesRegex(setup.SetupHold, error):
                    setup.export_reviewed_projects(
                        tasks, "http://127.0.0.1:8080", "synthetic",
                        (10, 11), a, b, call=fake_export(tasks, **opts))
                self.assertFalse(a.exists())
                self.assertFalse(b.exists())
            with self.assertRaisesRegex(setup.SetupHold, "TWO_DISTINCT_PROJECT_IDS_REQUIRED"):
                setup.export_reviewed_projects(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    (10, 10), a, b, call=fake_export(tasks))

    def test_isolated_one_project_export_on_each_local_instance(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a.json", Path(folder) / "b.json"
            result_a = setup.export_single_reviewed_project(
                tasks, "http://127.0.0.1:8080", "synthetic-a",
                10, a, call=fake_export(tasks))
            result_b = setup.export_single_reviewed_project(
                tasks, "http://127.0.0.1:8081", "synthetic-b",
                11, b, call=fake_export(tasks))
            self.assertEqual(result_a["sources_per_export"], 8)
            self.assertEqual(result_b["sources_per_export"], 8)
            self.assertFalse(result_a["platform_isolation_verified"])
            self.assertFalse(result_b["reviewer_independence_verified"])
            self.assertFalse(result_b["human_gold"])
            exported_a = json.loads(a.read_text("utf-8"))
            exported_b = json.loads(b.read_text("utf-8"))
            self.assertEqual(len(exported_a), len(exported_b))
            self.assertEqual(len(exported_a), 8)
            self.assertNotEqual(exported_a[0]["annotations"][0]["completed_by"],
                                exported_b[0]["annotations"][0]["completed_by"])
            if __import__("os").name == "posix":
                self.assertEqual(a.stat().st_mode & 0o777, 0o600)
                self.assertEqual(b.stat().st_mode & 0o777, 0o600)

    def test_single_export_rejects_incomplete_or_changed_source_without_file(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "review-a.json"
            for options, error in (
                    ({"missing": True}, "LABEL_STUDIO_REVIEW_EXPORT_NOT_SINGLE_COMPLETE"),
                    ({"drift": True}, "LABEL_STUDIO_REVIEW_SOURCE_MISMATCH")):
                with self.subTest(options=options), self.assertRaisesRegex(setup.SetupHold, error):
                    setup.export_single_reviewed_project(
                        tasks, "http://127.0.0.1:8080", "synthetic",
                        10, output, call=fake_export(tasks, **options))
                self.assertFalse(output.exists())
            with self.assertRaisesRegex(setup.SetupHold, "SINGLE_REVIEW_PROJECT_OR_TOKEN_MISSING"):
                setup.export_single_reviewed_project(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    0, output, call=fake_export(tasks))
            self.assertFalse(output.exists())

    def test_single_export_never_overwrites_or_follows_symlink(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "review-a.json"
            output.write_text("existing", encoding="utf-8")
            with self.assertRaisesRegex(
                    setup.SetupHold, "REVIEW_OUTPUT_PATHS_MUST_BE_NEW_AND_DISTINCT"):
                setup.export_single_reviewed_project(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    10, output, call=fake_export(tasks))
            self.assertEqual(output.read_text("utf-8"), "existing")
            output.unlink()
            output.symlink_to(Path(folder) / "nonexistent")
            with self.assertRaisesRegex(
                    setup.SetupHold, "REVIEW_OUTPUT_PATHS_MUST_BE_NEW_AND_DISTINCT"):
                setup.export_single_reviewed_project(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    10, output, call=fake_export(tasks))

    def test_existing_file_is_not_overwritten(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a", Path(folder) / "b"
            a.write_text("preserve", encoding="utf-8")
            with self.assertRaisesRegex(setup.SetupHold, "REVIEW_OUTPUT_PATHS_MUST_BE_NEW_AND_DISTINCT"):
                setup.export_reviewed_projects(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    (10, 11), a, b, call=fake_export(tasks))
            self.assertEqual(a.read_text("utf-8"), "preserve")


if __name__ == "__main__":
    unittest.main()
