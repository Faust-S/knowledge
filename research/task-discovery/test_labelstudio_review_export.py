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
from test_labelstudio_project_setup import fixture, CONFIG

REVIEW_XML = CONFIG.decode("utf-8")


def fake_export(tasks, *, same_user=False, missing=False, drift=False,
                form_drift=False, coverage_missing=False, coverage_incomplete=False,
                coverage_duplicate=False):
    def respond(base, token, route, body=None):
        if route == "/api/current-user/whoami":
            # The fixture's single-project author follows the native token
            # for each isolated instance. Same-server legacy export never
            # uses this branch.
            return {"id": 26 if token == "synthetic-b" else 25}
        pid = int(route.split("/")[3])
        if route.endswith("/"):
            xml = (REVIEW_XML.replace("review_coverage", "drifted_control")
                   if form_drift else REVIEW_XML)
            return {"id": pid, "label_config": xml}
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
        if coverage_missing:
            rows[0]["annotations"][0]["result"] = []
        if coverage_incomplete:
            rows[0]["annotations"][0]["result"][0]["value"]["choices"] = ["REVIEW_INCOMPLETE"]
        if coverage_duplicate:
            rows[0]["annotations"][0]["result"].append(copy.deepcopy(
                rows[0]["annotations"][0]["result"][0]))
        return rows
    return respond


class ExportHandoffTests(unittest.TestCase):
    def test_read_only_progress_partial_vs_final_source_coverage(self):
        _, tasks = fixture()
        def partial(base, token, route, body=None):
            value = fake_export(tasks)(base, token, route, body)
            if "export?exportType=JSON" in route:
                value[0]["annotations"] = []
                value[1]["annotations"][0]["result"] = []
                value[2]["annotations"][0]["result"][0]["value"]["choices"] = [
                    "REVIEW_INCOMPLETE"]
            return value
        partial_result = setup.review_progress(
            tasks, "http://127.0.0.1:8080", "synthetic", 10,
            expected_xml=REVIEW_XML, call=partial)
        self.assertEqual(partial_result["sources_unannotated"], 1)
        self.assertEqual(partial_result["sources_with_nonfinal_annotation"], 2)
        self.assertEqual(partial_result["sources_with_final_coverage"], 5)
        self.assertFalse(partial_result["human_gold"])
        complete = setup.review_progress(
            tasks, "http://127.0.0.1:8080", "synthetic", 10,
            expected_xml=REVIEW_XML, call=fake_export(tasks))
        self.assertEqual(complete["sources_with_final_coverage"], 8)
        self.assertEqual(
            complete["status"], "REVIEW_FINAL_COVERAGE_RECORDED_NOT_GOLD")
        self.assertEqual(
            complete["review_export_readiness"],
            "COVERAGE_ONLY_NOT_OWNER_BRIDGE_QUALIFIED")
        self.assertNotIn("completed_by", json.dumps(complete))
        self.assertNotIn("Synthetic task", json.dumps(complete))
        self.assertNotIn("source_ref", json.dumps(complete))

    def test_progress_refuses_foreign_author_and_ambiguous_annotations(self):
        _, tasks = fixture()
        for mutation, code in (
            (lambda rows: rows[0]["annotations"][0].update(completed_by=51),
             "REVIEW_PROGRESS_FOREIGN_ANNOTATOR"),
            (lambda rows: rows[0]["annotations"].append(
                copy.deepcopy(rows[0]["annotations"][0])),
             "REVIEW_PROGRESS_EXPORT_AMBIGUOUS"),
            (lambda rows: rows[0]["annotations"][0]["result"].append(
                copy.deepcopy(rows[0]["annotations"][0]["result"][0])),
             "REVIEW_PROGRESS_DUPLICATE_COVERAGE"),
            (lambda rows: rows[0]["data"].update(source_text="tampered"),
             "REVIEW_PROGRESS_SOURCE_MISMATCH"),
        ):
            def changed(base, token, route, body=None):
                value = fake_export(tasks)(base, token, route, body)
                if "export?exportType=JSON" in route:
                    mutation(value)
                return value
            with self.subTest(code=code), self.assertRaisesRegex(
                    setup.SetupHold, code):
                setup.review_progress(tasks, "http://127.0.0.1:8080",
                                      "synthetic", 10,
                                      expected_xml=REVIEW_XML, call=changed)

    def test_progress_refuses_drifted_form_and_does_not_write_export(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "review.json"
            with self.assertRaisesRegex(
                    setup.SetupHold, "REVIEW_PROGRESS_OWNER_FORM_CHANGED"):
                setup.review_progress(
                    tasks, "http://127.0.0.1:8080", "synthetic", 10,
                    expected_xml=REVIEW_XML,
                    call=fake_export(tasks, form_drift=True))
            self.assertFalse(output.exists())

    def test_two_complete_exports_remain_distinct_and_ungolded(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a.json", Path(folder) / "b.json"
            result = setup.export_reviewed_projects(
                tasks, "http://127.0.0.1:8080", "synthetic",
                (10, 11), a, b, expected_xml=REVIEW_XML, call=fake_export(tasks))
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
                    (10, 11), a, b, expected_xml=REVIEW_XML, call=fake_export(tasks, missing=True))
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
                        (10, 11), a, b, expected_xml=REVIEW_XML, call=fake_export(tasks, **opts))
                self.assertFalse(a.exists())
                self.assertFalse(b.exists())
            with self.assertRaisesRegex(setup.SetupHold, "TWO_DISTINCT_PROJECT_IDS_REQUIRED"):
                setup.export_reviewed_projects(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    (10, 10), a, b, expected_xml=REVIEW_XML, call=fake_export(tasks))

    def test_isolated_one_project_export_on_each_local_instance(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a.json", Path(folder) / "b.json"
            result_a = setup.export_single_reviewed_project(
                tasks, "http://127.0.0.1:8080", "synthetic-a",
                10, a, expected_xml=REVIEW_XML, call=fake_export(tasks))
            result_b = setup.export_single_reviewed_project(
                tasks, "http://127.0.0.1:8081", "synthetic-b",
                11, b, expected_xml=REVIEW_XML, call=fake_export(tasks))
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

    def test_nonfinal_coverage_refuses_single_and_legacy_exports(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / "a.json", Path(folder) / "b.json"
            for flaw in ("coverage_missing", "coverage_incomplete", "coverage_duplicate"):
                with self.subTest(flaw=flaw):
                    call = fake_export(tasks, **{flaw: True})
                    with self.assertRaisesRegex(
                            setup.SetupHold, "LABEL_STUDIO_REVIEW_COVERAGE_NOT_FINAL"):
                        setup.export_single_reviewed_project(
                            tasks, "http://127.0.0.1:8080", "synthetic-a", 10,
                            first, expected_xml=REVIEW_XML, call=call)
                    with self.assertRaisesRegex(
                            setup.SetupHold, "LABEL_STUDIO_REVIEW_COVERAGE_NOT_FINAL"):
                        setup.export_reviewed_projects(
                            tasks, "http://127.0.0.1:8080", "synthetic",
                            (10, 11), first, second,
                            expected_xml=REVIEW_XML, call=call)
                    self.assertFalse(first.exists())
                    self.assertFalse(second.exists())

    def test_single_export_author_must_match_authenticated_reviewer(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "single.json"
            with self.assertRaisesRegex(
                    setup.SetupHold, "SINGLE_REVIEW_EXPORT_AUTHOR_AUTH_MISMATCH"):
                # This account is not the author of project 11 (id 26).
                setup.export_single_reviewed_project(
                    tasks, "http://127.0.0.1:8081", "synthetic-a",
                    11, output, expected_xml=REVIEW_XML,
                    call=fake_export(tasks))
            self.assertFalse(output.exists(), "Never write a misattributed export")

    def test_single_export_whoami_absent_or_invalid_is_hold(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "single.json"
            native = fake_export(tasks)
            for malformed in (None, {}, {"id": True}, {"id": "25"}, {"id": 0}):
                def called(base, token, route, body=None):
                    if route == "/api/current-user/whoami":
                        return malformed
                    return native(base, token, route, body)
                with self.subTest(malformed=malformed), self.assertRaisesRegex(
                        setup.SetupHold, "SINGLE_REVIEW_EXPORT_AUTHOR_AUTH_MISMATCH"):
                    setup.export_single_reviewed_project(
                        tasks, "http://127.0.0.1:8080", "synthetic",
                        10, output, expected_xml=REVIEW_XML, call=called)
                self.assertFalse(output.exists())

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
                        10, output, expected_xml=REVIEW_XML, call=fake_export(tasks, **options))
                self.assertFalse(output.exists())
            with self.assertRaisesRegex(setup.SetupHold, "SINGLE_REVIEW_PROJECT_OR_TOKEN_MISSING"):
                setup.export_single_reviewed_project(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    0, output, expected_xml=REVIEW_XML, call=fake_export(tasks))
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
                    10, output, expected_xml=REVIEW_XML, call=fake_export(tasks))
            self.assertEqual(output.read_text("utf-8"), "existing")
            output.unlink()
            output.symlink_to(Path(folder) / "nonexistent")
            with self.assertRaisesRegex(
                    setup.SetupHold, "REVIEW_OUTPUT_PATHS_MUST_BE_NEW_AND_DISTINCT"):
                setup.export_single_reviewed_project(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    10, output, expected_xml=REVIEW_XML, call=fake_export(tasks))

    def test_form_drift_refused_at_export_with_no_output(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a", Path(folder) / "b"
            with self.assertRaisesRegex(
                    setup.SetupHold, "LABEL_STUDIO_EXPORT_REVIEW_FORM_CHANGED"):
                setup.export_single_reviewed_project(
                    tasks, "http://127.0.0.1:8080", "synthetic", 10, a,
                    expected_xml=REVIEW_XML, call=fake_export(tasks, form_drift=True))
            self.assertFalse(a.exists())
            with self.assertRaisesRegex(
                    setup.SetupHold, "LABEL_STUDIO_EXPORT_REVIEW_FORM_CHANGED"):
                setup.export_reviewed_projects(
                    tasks, "http://127.0.0.1:8080", "synthetic", (10, 11), a, b,
                    expected_xml=REVIEW_XML, call=fake_export(tasks, form_drift=True))
            self.assertFalse(a.exists())
            self.assertFalse(b.exists())

    def test_export_requires_expected_owner_form(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "one.json"
            with self.assertRaisesRegex(
                    setup.SetupHold, "LABEL_STUDIO_EXPORT_EXPECTED_REVIEW_FORM_MISSING"):
                setup.export_single_reviewed_project(
                    tasks, "http://127.0.0.1:8080", "synthetic", 10, path,
                    expected_xml="", call=fake_export(tasks))
            self.assertFalse(path.exists())

    def test_existing_file_is_not_overwritten(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a", Path(folder) / "b"
            a.write_text("preserve", encoding="utf-8")
            with self.assertRaisesRegex(setup.SetupHold, "REVIEW_OUTPUT_PATHS_MUST_BE_NEW_AND_DISTINCT"):
                setup.export_reviewed_projects(
                    tasks, "http://127.0.0.1:8080", "synthetic",
                    (10, 11), a, b, expected_xml=REVIEW_XML, call=fake_export(tasks))
            self.assertEqual(a.read_text("utf-8"), "preserve")


if __name__ == "__main__":
    unittest.main()
