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

        def auth(_base, token, mode="legacy"):
            self.assertEqual(mode, "legacy")
            return "Token " + token

        def call(_base, credential, route, body=None):
            if route == "/api/current-user/whoami":
                return {"id": 10 if credential == "Token one" else 20}
            if "/export?" in route:
                return [{"id": 100 + n, **row}
                        for n, row in enumerate(copy.deepcopy(smoke.synthetic_tasks()))]
            if "/annotations/" in route:
                writes.append(credential)
                return {"id": len(writes)}
            raise AssertionError("unexpected route")

        def create(tasks, xml, base, credential, slots, call):
            self.assertEqual(slots, 2)
            self.assertEqual(len(tasks), 8)
            self.assertIn('perRegion="true"', xml)
            return {"project_ids": [71, 72]}

        def export(tasks, base, credential, ids, a, b, call):
            self.assertEqual(ids, (71, 72))
            exports.extend((a, b))
            for path in (a, b):
                path.write_text(json.dumps([
                    {"data": row["data"],
                     "annotations": [{"completed_by": 10 if path == a else 20,
                                      "result": []}]}
                    for row in tasks]), encoding="utf-8")
            return {"sources_per_export": 8, "reviewer_id_claims_distinct": True,
                    "human_gold": False}

        with (patch.object(transport, "resolve_api_credential", side_effect=auth),
              patch.object(smoke, "traced_api", side_effect=call),
              patch.object(transport, "create_projects", side_effect=create),
              patch.object(transport, "export_reviewed_projects", side_effect=export)):
            result = smoke.exercise_local_server(
                "http://127.0.0.1:8080", "one", second_token="two")
        self.assertEqual(writes, ["Token one"] * 8 + ["Token two"] * 8)
        self.assertEqual(len(exports), 2)
        self.assertTrue(result["two_synthetic_accounts_export_passed"])
        self.assertFalse(result["same_user_export_refused"])
        self.assertFalse(result["independent_human_review_completed"])
        self.assertFalse(result["human_task_gold"])

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
