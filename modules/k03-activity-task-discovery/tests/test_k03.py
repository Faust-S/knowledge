#!/usr/bin/env python3
"""Contract tests on immutable, permitted ADP desk corpus; no private checkout."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import k03


class K03Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pilot = k03.load_pinned_pilot()
        cls.links = k03.load_rationale()

    def run_case(self, cid):
        return k03.discover_case(self.pilot, self.links, cid)

    def test_source_git_revision_is_pinned(self):
        self.assertEqual(k03.git_blob_sha(k03.PILOT_PATH.read_bytes()),
                         k03.PINNED_PILOT_BLOB)
        self.assertEqual(self.links["source_git_blob"], k03.PINNED_PILOT_BLOB)

    def test_replay_all_five_cases(self):
        for case in self.pilot["cases"]:
            with self.subTest(case=case["id"]):
                receipt = self.run_case(case["id"])
                self.assertEqual(receipt["independent_check"]["trace_check"],
                                 "PASS_REPLAYED_AGAINST_PINNED_SOURCE")
                self.assertEqual(receipt["accepted_task_count"], 0)
                self.assertFalse(receipt["human_task_gold"])
                self.assertEqual(receipt["source_git_blob"], k03.PINNED_PILOT_BLOB)

    def test_positive_case_has_source_bound_non_task_hypotheses(self):
        r = self.run_case("CASE-2")
        self.assertEqual(r["route"], "QUALIFICATION_REQUIRED")
        self.assertEqual(len(r["task_hypotheses"]), 3)
        self.assertEqual(len(r["activity_observations"]), 3)
        self.assertTrue(all(h["tag"] == "inferred" and h["evidence_links"]
                            and h["status"] == "PROPOSED_NOT_QUALIFIED_TASK"
                            for h in r["task_hypotheses"]))
        self.assertTrue(all(h["independent_field_confirmation"] is False
                            for h in r["task_hypotheses"]))
        self.assertTrue(all("source_ref" in x and "locator" in x
                            for x in r["activity_observations"][1:]))

    def test_negative_zero_data_abstains_and_asks(self):
        r = self.run_case("CASE-0")
        self.assertEqual(r["route"], "CLARIFICATION_REQUIRED")
        self.assertEqual(r["task_hypotheses"], [])
        self.assertEqual(r["abstained_unlinked_options"], 4)
        self.assertEqual(r["activity_observations"][0]["tag"], "target")
        self.assertEqual(len(r["clarification_requests"]), 1)

    def test_blind_prior_baseline_fails_zero_data_guard(self):
        baseline = k03.baseline_prior_first(self.pilot, "CASE-0")
        self.assertTrue(baseline["first_proposal_without_case_evidence"])
        self.assertEqual(baseline["prior_count"], 4)
        self.assertIsNone(baseline["task_f1"])
        self.assertEqual(len(self.run_case("CASE-0")["task_hypotheses"]), 0)

    def test_no_claim_of_independent_human_gold(self):
        r = self.run_case("CASE-1")
        self.assertEqual(r["independent_check"]["independent_field_truth"],
                         "NOT_MEASURED")
        self.assertFalse(r["independent_check"]["independent_human_task_gold"])
        tags = {x["tag"] for x in r["activity_observations"]}
        self.assertTrue({"reported", "observed", "inferred", "target"} <= tags)

    def test_structural_check_rejects_forged_observation(self):
        r = self.run_case("CASE-2")
        r["activity_observations"][1]["source_ref"] = "https://invalid.example"
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "OBSERVATION_SOURCE_REPLAY_FAILED"):
            k03.verify_trace(r, self.pilot, self.links)

    def test_structural_check_rejects_forged_proposal_text(self):
        r = self.run_case("CASE-2")
        r["task_hypotheses"][0]["text"] = "This task is already approved"
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "HYPOTHESIS_EVIDENCE_OR_AUTHORITY_CHANGED"):
            k03.verify_trace(r, self.pilot, self.links)

    def test_linked_evidence_must_belong_to_same_case(self):
        mutated = copy.deepcopy(self.links)
        mutated["cases"]["CASE-2"][0] = ["E02"]
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "HYPOTHESIS_CROSS_CASE_OR_DUPLICATE_LINK"):
            k03.discover_case(self.pilot, mutated, "CASE-2")

    def test_no_duplicate_evidence_links(self):
        mutated = copy.deepcopy(self.links)
        mutated["cases"]["CASE-1"][0] = ["E03", "E03"]
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "HYPOTHESIS_CROSS_CASE_OR_DUPLICATE_LINK"):
            k03.discover_case(self.pilot, mutated, "CASE-1")

    def test_select_requires_explicit_event(self):
        r = self.run_case("CASE-2")
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "EXPLICIT_HUMAN_SELECTION_REQUIRED"):
            k03.select_hypothesis(
                r, "H-CASE-2-1", choice="AUTO_APPROVE", selection_ref="decision-1")
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "EXPLICIT_HUMAN_SELECTION_REQUIRED"):
            k03.select_hypothesis(
                r, "H-CASE-2-1", choice="HUMAN_SELECT_FOR_QUALIFICATION",
                selection_ref="")

    def test_selection_never_creates_task_or_result(self):
        result = k03.select_hypothesis(
            self.run_case("CASE-2"), "H-CASE-2-1",
            choice="HUMAN_SELECT_FOR_QUALIFICATION",
            selection_ref="review-001")
        self.assertEqual(result["schema"], k03.SELECTION_SCHEMA)
        self.assertFalse(result["task_created"])
        self.assertFalse(result["result_created"])
        self.assertIsNone(result["task_id"])
        self.assertIn("HOST_TASK_QUALIFICATION", result["next_owner"])

    def test_selection_rejects_zero_data_and_unsupported_id(self):
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "HYPOTHESIS_NOT_SELECTABLE"):
            k03.select_hypothesis(
                self.run_case("CASE-0"), "H-CASE-0-1",
                choice="HUMAN_SELECT_FOR_QUALIFICATION",
                selection_ref="review-002")

    def test_clear_task_bypasses_discovery(self):
        r = k03.bypass_clear_task(
            "Prepare minutes for yesterday's meeting", "A reviewed draft")
        self.assertEqual(r["route"], "DIRECT_TASK_HOST_HANDOFF_NO_DISCOVERY")
        self.assertEqual(r["task_hypotheses"], [])
        self.assertFalse(r["task_created"])
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "DIRECT_TASK_REQUIRES_CLEAR_RESULT"):
            k03.bypass_clear_task("Some idea", "")

    def test_cli_roundtrip_selection(self):
        cmd = [sys.executable, str(HERE / "k03.py"),
               "--case-id", "CASE-2", "--select", "H-CASE-2-3",
               "--selection-ref", "human-review-1"]
        run = subprocess.run(cmd, capture_output=True, text=True, check=False)
        self.assertEqual(run.returncode, 0, run.stderr + run.stdout)
        receipt = json.loads(run.stdout)
        self.assertFalse(receipt["task_created"])
        self.assertEqual(receipt["hypothesis_id"], "H-CASE-2-3")

    def test_cli_full_replay_receipt(self):
        run = subprocess.run(
            [sys.executable, str(HERE / "k03.py"), "--all"],
            capture_output=True, text=True, check=False)
        self.assertEqual(run.returncode, 0, run.stderr + run.stdout)
        out = json.loads(run.stdout)
        self.assertEqual(out["cases"], 5)
        self.assertEqual(out["negative_no_source_cases"], 1)
        self.assertEqual(out["first_prior_unsupported_negative_count"], 1)
        self.assertTrue(out["all_trace_checks_pass"])
        self.assertEqual(out["task_instances_created"], 0)
        self.assertIsNone(out["task_f1"])


if __name__ == "__main__":
    unittest.main()
