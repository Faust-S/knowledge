"""Synthetic two-account Label Studio HTTP orchestration regression. Not human gold."""
import copy
import json
import unittest
from unittest.mock import patch

import live_labelstudio_smoke as smoke
import labelstudio_project_setup as transport


class TwoAccountSmokeTests(unittest.TestCase):
    def test_distinct_synthetic_accounts_write_and_export(self):
        writes = []
        exports = []
        saved_annotations = {}

        def auth(_base, token, mode="legacy"):
            self.assertEqual(mode, "legacy")
            return "Token " + token

        def call(_base, credential, route, body=None):
            if route == "/api/current-user/whoami":
                return {"id": 10 if credential == "Token one" else 20}
            if "/export?" in route:
                pid = int(route.split("/")[3])
                rows = []
                for n, row in enumerate(copy.deepcopy(smoke.synthetic_tasks())):
                    task_id = pid * 100 + n
                    rows.append({
                        "id": task_id, **row,
                        "annotations": copy.deepcopy(saved_annotations.get(task_id, [])),
                    })
                return rows
            if "/annotations/" in route:
                writes.append(credential)
                task_id = int(route.split("/")[3])
                saved_annotations[task_id] = [{
                    "completed_by": 10 if credential == "Token one" else 20,
                    "result": copy.deepcopy(body["result"]),
                    "was_cancelled": False,
                }]
                return {"id": len(writes)}
            raise AssertionError("unexpected route")

        def create(tasks, xml, base, credential, slots, call):
            self.assertEqual(slots, 2)
            self.assertEqual(len(tasks), 8)
            self.assertIn('perRegion="true"', xml)
            return {"project_ids": [71, 72]}

        def single_export(tasks, base, credential, pid, output, *,
                          expected_xml, call):
            self.assertEqual(expected_xml, smoke.SYNTHETIC_XML)
            rows = call(base, credential,
                        f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
            smoke.verify_synthetic_region_roundtrip(rows)
            output.write_text(json.dumps(rows), encoding="utf-8")
            return {"sources_per_export": 8, "human_gold": False,
                    "platform_isolation_verified": False}

        def export(tasks, base, credential, ids, a, b, *, expected_xml, call):
            self.assertEqual(expected_xml, smoke.SYNTHETIC_XML)
            self.assertEqual(ids, (71, 72))
            exports.extend((a, b))
            for pid, path in zip(ids, (a, b)):
                rows = call(base, credential,
                            f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true")
                smoke.verify_synthetic_region_roundtrip(rows)
                path.write_text(json.dumps(rows), encoding="utf-8")
            return {"sources_per_export": 8, "reviewer_id_claims_distinct": True,
                    "human_gold": False}

        with (patch.object(transport, "resolve_api_credential", side_effect=auth),
              patch.object(smoke, "traced_api", side_effect=call),
              patch.object(transport, "create_projects", side_effect=create),
              patch.object(transport, "export_reviewed_projects", side_effect=export),
              patch.object(transport, "export_single_reviewed_project", side_effect=single_export)):
            result = smoke.exercise_local_server(
                "http://127.0.0.1:8080", "one", second_token="two")
        self.assertEqual(writes, ["Token one"] * 8 + ["Token two"] * 8)
        self.assertEqual(len(exports), 2)
        self.assertTrue(result["two_synthetic_accounts_export_passed"])
        self.assertTrue(result["single_project_export_http_passed"])
        self.assertTrue(result["synthetic_task_region_and_interpretations_roundtrip"])
        self.assertFalse(result["same_user_export_refused"])
        self.assertFalse(result["independent_human_review_completed"])
        self.assertFalse(result["human_task_gold"])

    def test_synthetic_region_contains_three_paired_interpretations(self):
        source = smoke.synthetic_tasks()[0]["data"]["source_text"]
        fields = smoke.synthetic_annotation_result(source, task_example=True)
        self.assertEqual(len(fields), 5)
        self.assertEqual(fields[0]["value"]["labels"], ["INDEPENDENT_TASK"])
        self.assertEqual(fields[0]["value"]["text"], source[:len("Synthetic 1")])
        self.assertEqual(fields[-1]["value"]["choices"], ["ALL_RELEVANT_SPANS_MARKED"])
        self.assertEqual(
            [x["from_name"] for x in fields[1:-1]],
            ["goal", "expected_result", "acceptance_criterion"])
        self.assertEqual(
            smoke.synthetic_annotation_result(source, task_example=False)[0]
            ["value"]["choices"], ["NO_TASK_RELEVANT_SPANS"])

    def test_region_roundtrip_refuses_missing_goal(self):
        rows = []
        for i, row in enumerate(smoke.synthetic_tasks()):
            result = smoke.synthetic_annotation_result(
                row["data"]["source_text"], task_example=(i == 0))
            rows.append({"data": row["data"],
                         "annotations": [{"result": copy.deepcopy(result)}]})
        smoke.verify_synthetic_region_roundtrip(rows)
        rows[0]["annotations"][0]["result"].pop(1)
        with self.assertRaisesRegex(
                transport.SetupHold, "SYNTHETIC_REGION_RESULT_COUNT_CHANGED"):
            smoke.verify_synthetic_region_roundtrip(rows)

    def test_second_token_resolves_to_same_account_is_hold(self):
        def same_account(_base, _credential, route, body=None):
            self.assertEqual(route, "/api/current-user/whoami")
            return {"id": 11}

        with (patch.object(transport, "resolve_api_credential",
                           side_effect=lambda _base, token, mode="legacy":
                           "Token " + token),
              patch.object(smoke, "traced_api", side_effect=same_account),
              patch.object(transport, "create_projects") as create):
            with self.assertRaisesRegex(
                    transport.SetupHold,
                    "LIVE_SYNTHETIC_REVIEWER_ACCOUNTS_NOT_DISTINCT"):
                smoke.exercise_local_server(
                    "http://127.0.0.1:8080", "one", second_token="another")
            create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
