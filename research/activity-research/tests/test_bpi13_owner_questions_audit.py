"""BPI13 owner-question audit: source roles, evidence limits and honest baselines."""
import sys
from pathlib import Path
from unittest import TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bpi13_owner_questions_audit import QUESTIONS, counts_from_reported_events, compose_audit


def cases():
    return {
        "case-a": [
            (1, "Opened", "2013-01-01T09:00:00+00:00", None),
            (2, "Assigned", "2013-01-01T10:00:00+00:00", None),
            (3, "Opened", "2013-01-01T11:00:00+00:00", None),
        ],
        "case-b": [
            (1, "Waiting", "2013-01-01T12:00:00+00:00", None),
            (2, "Closed", "2013-01-01T13:00:00+00:00", None),
        ],
    }


def u1():
    return {
        "u1": {
            "task_type_ids_assigned": 0,
            "engine_accepted": False,
            "pinned_owner_git_blob": "eb15aec5ba1a749c29d7c40a868127e1a384b6bf",
        },
        "sample": {"registered_events": 5},
    }


class AuditTests(TestCase):
    def test_four_original_questions_are_not_individual_task_acceptance(self):
        report = compose_audit(cases(), source_sha="a" * 64, u1_report=u1())
        self.assertEqual(report["question_count"], 4)
        self.assertEqual(report["accepted_task_count"], 0)
        self.assertEqual(report["accepted_task_type_count"], 0)
        self.assertEqual(report["actual_independent_work_observation_count"], 0)
        self.assertEqual(report["quality_of_task_discovery"], "NOT_MEASURED")
        self.assertTrue(all(not x["can_conclude_misconduct_or_fault_exists"]
                            and not x["can_conclude_real_human_task_instance"]
                            and not x["task_type_accepted"] for x in report["questions"]))
        self.assertTrue(all(x["required_but_not_verified"] for x in report["questions"]))

    def test_activity_pattern_not_staff_pingpong(self):
        baseline = counts_from_reported_events(cases())
        self.assertEqual(baseline["reported_cases"], 2)
        self.assertEqual(baseline["reported_events"], 5)
        self.assertEqual(baseline["activity_A_B_A_motifs_in_declared_timestamp_order"], 1)
        self.assertFalse(baseline["motif_can_prove_team_ping_pong"])
        self.assertFalse(baseline["log_can_prove_actual_human_work"])

    def test_source_differences_are_not_independent_event_confirmation(self):
        r = compose_audit(cases(), source_sha="f" * 64, u1_report=u1())
        self.assertTrue(r["sources"]["source_artifacts_distinct"])
        self.assertFalse(r["sources"]["independent_real_world_event_confirmation"])
        self.assertEqual(r["sources"]["official_4tu_byte_identity"], "NOT_VERIFIED")
        self.assertEqual(r["log_scope"], "BPI_2013_OPEN_PROBLEMS_ONLY")
        self.assertEqual(r["questions"][0]["evidence_sufficiency"],
                         "NOT_APPLICABLE_TO_OPEN_PROBLEMS_LOG")

    def test_owner_questions_require_independent_organizational_sources(self):
        expected = {
            "INCIDENT_ESCALATION_TIMING",
            "TEAM_PING_PONG",
            "WAIT_USER_STATUS_ABUSE",
            "ORGANIZATION_PROCESS_CONFORMITY",
        }
        self.assertEqual({q["id"] for q in QUESTIONS}, expected)
        self.assertTrue(all(q["required_but_not_verified"] for q in QUESTIONS))
        r = compose_audit(cases(), source_sha="1" * 64, u1_report=u1())
        self.assertFalse(any(q["can_conclude_misconduct_or_fault_exists"]
                             for q in r["questions"]))

    def test_accepted_task_authority_escalation_rejected(self):
        bad = u1()
        bad["u1"]["engine_accepted"] = True
        with self.assertRaisesRegex(ValueError, "BPI_OWNER_SOURCE_PROMOTED_TO_TASK"):
            compose_audit(cases(), source_sha="1" * 64, u1_report=bad)

    def test_timestamp_order_mismatch_is_not_causality(self):
        value = cases()
        value["case-b"][0] = (1, "Waiting", "2013-01-01T14:00:00+00:00", None)
        baseline = counts_from_reported_events(value)
        self.assertEqual(baseline["registered_file_order_timestamp_regressions"], 1)
        self.assertFalse(baseline["log_can_prove_stated_motive"])

if __name__ == "__main__":
    main()
