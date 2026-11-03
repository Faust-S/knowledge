"""Synthetic perturbation tests on source-bound BPI registered-event U1 inputs.

No external-source evidence, no new Task Engine, no independent task gold.
"""
import sys
from pathlib import Path
from unittest import TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bpi13_mutation_stress import SCENARIOS, modified, run
from bpi13_xes_u1_replay import inspect_registered_rows

def rows():
    cases = []
    for case in ("A", "B", "C"):
        for idx, (activity, stamp) in enumerate((
                ("opened", "2021-01-01T00:00:00+00:00"),
                ("assigned", "2021-01-01T01:00:00+00:00"),
                ("reviewed", "2021-01-01T02:00:00+00:00"),
                ("closed", "2021-01-01T03:00:00+00:00")), 1):
            cases.append({
                "event_id": f"{case}-{idx}",
                "case_id": f"test-{case}",
                "activity": activity,
                "timestamp": stamp,
                "attributes": {
                    "origin_scope": "REGISTERED_SYSTEM_EVENT_NOT_DIRECT_OBSERVATION",
                    "real_world_execution": "NOT_VERIFIED",
                    "task_type": "NOT_DETERMINED",
                },
            })
    return cases


class TestActivityMutations(TestCase):
    def test_baseline_has_native_original_u1_not_synthetic_reader(self):
        raw, receipt, pin = inspect_registered_rows(rows())
        self.assertEqual(pin, "eb15aec5ba1a749c29d7c40a868127e1a384b6bf")
        self.assertEqual(receipt["unit_count"], len(rows()))
        self.assertEqual(receipt["task_type_ids_assigned"], 0)
        self.assertFalse(receipt["engine_accepted"])

    def test_all_seven_scenarios_anchored_to_one_baseline(self):
        report = run(rows())
        self.assertEqual(report["schema"], "IWXA_BPI13_ACTIVITY_MUTATION_STRESS/0.1")
        self.assertEqual(report["summary"]["cases"], len(SCENARIOS))
        self.assertEqual(report["summary"]["accepted_as_formally_valid_reported_logs"], 6)
        self.assertEqual(report["summary"]["rejected_as_formally_invalid_logs"], 1)
        self.assertEqual(report["baseline"]["registered_event_rows"], 12)
        self.assertEqual(report["summary"]["independent_task_quality"], "NOT_MEASURED")
        self.assertEqual(report["summary"]["without_baseline_real_world_integrity"],
                         "NOT_DETERMINED")
        self.assertTrue(all(x["real_world_activity_truth"] == "UNKNOWN"
                            and not x["engine_accepted"]
                            and x["task_type_ids_assigned"] == 0
                            for x in report["scenarios"]))

    def test_missing_invisible_action_cannot_be_detected_in_log(self):
        baseline = rows()
        self.assertEqual(modified(baseline, "UNLOGGED_OFF_SYSTEM_ACTION"), baseline)
        by = {x["scenario"]: x for x in run(baseline)["scenarios"]}
        self.assertFalse(by["UNLOGGED_OFF_SYSTEM_ACTION"]["source_mutated"])
        self.assertFalse(by["UNLOGGED_OFF_SYSTEM_ACTION"]["reported_context_changed"])

    def test_reassignment_changes_context_not_original_human_truth(self):
        by = {x["scenario"]: x for x in run(rows())["scenarios"]}
        case = by["REASSIGN_REGISTERED_CASE"]
        self.assertEqual(case["u1_result"], "ACCEPTED_AS_REPORTED_SOURCE")
        self.assertTrue(case["reported_context_changed"])
        self.assertTrue(case["source_sha_changed"])
        self.assertEqual(case["real_world_activity_truth"], "UNKNOWN")

    def test_missing_event_changes_receipt_count_but_cannot_prove_unobserved_work(self):
        by = {x["scenario"]: x for x in run(rows())["scenarios"]}
        self.assertEqual(by["DELETE_REGISTERED_EVENT"]["unit_count_delta"], -1)
        self.assertEqual(by["INSERT_SYNTHETIC_EVENT"]["unit_count_delta"], 1)

    def test_duplicate_event_identifier_rejected_by_pinned_u1(self):
        by = {x["scenario"]: x for x in run(rows())["scenarios"]}
        self.assertEqual(by["DUPLICATE_EVENT_ID"]["u1_rejection"], "DUPLICATE_EVENT_ID")

    def test_mutations_do_not_modify_source_rows(self):
        baseline = rows()
        import copy
        previous = copy.deepcopy(baseline)
        for case in SCENARIOS:
            modified(baseline, case)
        self.assertEqual(baseline, previous)


if __name__ == "__main__":
    main()
