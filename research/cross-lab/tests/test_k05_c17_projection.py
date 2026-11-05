"""K05 C17 aggregate consumer tests; C17 owns scoring and review validation."""
from __future__ import annotations

from dataclasses import asdict
import copy
import json
from pathlib import Path
import sys
import unittest

CROSS = Path(__file__).resolve().parents[1]
ACTIVITY = CROSS.parent / "activity-research"
sys.path.insert(0, str(CROSS))
sys.path.insert(0, str(ACTIVITY))
import k05_c17_projection as projection
import solve4x_c16_review_footprint as c16
import solve4x_c17_blind_review as c17


def case():
    """Offline synthetic author annotations whose C16 duration totals match real pinned case.

    This fixture is a *shape and validator* input, not a counterfeit video
    review. Actual measured 23/6/3 values are source-pinned in projection.
    """
    c16_rows = {
        "all_published_video_annotations": (23, 323.035, 361.376),
        "literal_enter_leave_labels_only": (6, 27.669, 51.669),
        "reed_closed_after_video_end_5s": (3, 12.688, 24.688),
    }
    review = {
        name: {
            "annotations_to_review": n,
            "sum_of_annotated_interval_seconds": annotated,
            "union_seconds_with_two_second_context": union,
            "actual_human_review_seconds": None,
        }
        for name, (n, annotated, union) in c16_rows.items()
    }
    review["reed_closed_after_video_end_5s"].update({
        "closing_events_without_candidate": 0,
        "closing_events_with_ambiguous_candidates": 0,
    })
    footprint = {
        "schema": c16.SCHEMA,
        "status": "AUTHOR_ANNOTATION_DURATION_PROXY_NOT_OBSERVED_REVIEW_TIME",
        "denominators": {
            "video_annotation_total": 23,
            "literal_enter_leave_annotations": 6,
            "out_of_video_door_closings": 3,
        },
        "review_baselines": review,
        "fixed_window_selection": {
            "5s": dict(review["reed_closed_after_video_end_5s"]),
        },
        "annotation_count_reduction_full_to_label": 17,
        "annotation_count_reduction_label_to_focused": 3,
        "annotation_count_reduction_full_to_focused": 20,
        "human_effort_seconds_delta": None,
        "human_cost_savings": None,
        "reviewer_gains_measured": False,
        "source_annotation_labels_are_independent_human_gold": False,
        "clock_calibration_proven": False,
        "source_level_false_confident_rate": "NOT_MEASURED",
        "correct_unknown_rate": "NOT_MEASURED",
        "accepted_tasks": 0,
        "raw_event_ids_timestamps_actor_ids_or_values_exported": False,
    }
    plan = {
        "schema": c17.SCHEMA,
        "status": "BLIND_REVIEW_DESIGN_READY_NO_MEDIA_OR_HUMAN_MEASUREMENT",
        "source_sha256": projection.SOURCE_SHA256,
        "frozen_plan_sha256": "a" * 64,
        "denominators": {
            "video_annotations": 23,
            "literal_enter_leave": 6,
            "reed_focused": 3,
        },
        "independent_video_reviews": 0,
        "adjudicated_clips": 0,
        "active_review_seconds": None,
        "label_studio_lead_time_seconds": None,
        "missed_visible_clips": None,
        "unknown_agreement_rate": None,
        "contradicted_confident_claims": None,
        "clock_calibration_proven": False,
        "source_author_labels_are_human_gold": False,
        "real_video_decoded": False,
        "human_activity_gold": "NOT_MEASURED",
        "task_precision": None,
        "accepted_tasks": 0,
        "source_identifiers_times_actors_or_verdicts_exported": False,
    }
    return footprint, plan


def owner_score():
    """Actual owner scorer with SYNTHETIC receipts, not independent human reviews."""
    from datetime import datetime, timedelta
    start = datetime(2024, 3, 25, 8, 30)
    video = {"ocel:events": {}}
    closed = []
    for i in range(23):
        t = start + timedelta(seconds=10 * i)
        end = t + timedelta(seconds=5)
        label = ("Enter room" if i in (0, 8, 16) else
                 "Leave room" if i in (4, 12, 20) else "Other")
        video["ocel:events"][str(i)] = {
            "ocel:timestamp": t.isoformat(),
            "ocel:vmap": {"end_time": end.isoformat()},
            "ocel:activity": label,
        }
        if i in (0, 8, 16):
            closed.append((c16.naive_timestamp(end.isoformat()) + 0.7,
                           "ENTRANCE", "CLOSED"))
    packet = c17.prepare(video, closed)
    receipts = {}
    for index, role in enumerate(c17.ROLES):
        receipt = c17.blank_receipt(packet, role)
        receipt["reviewer_key"] = f"synthetic-reviewer-{index}"
        for row in receipt["items"]:
            row["verdict"] = "UNKNOWN"
            row["active_seconds"] = None
            row["label_studio_lead_time_seconds"] = None
        receipts[role] = receipt
    return packet, receipts


class C17Projection(unittest.TestCase):
    def test_baseline_exact_numbers_and_no_human_measurements(self):
        footprint, plan = case()
        result = asdict(projection.compare_c17_aggregate(footprint, plan))
        self.assertEqual(result["schema"], projection.SCHEMA)
        self.assertEqual(result["measured"]["candidate_counts"],
                         {"all": 23, "literal_enter_leave": 6,
                          "reed_closed_after_end_5s": 3})
        self.assertEqual(result["measured"]["annotated_footprint_seconds"],
                         {"all": 361.376, "literal_enter_leave": 51.669,
                          "reed_closed_after_end_5s": 24.688})
        self.assertEqual(result["measured"]["potential_footprint_reduction_seconds"], 336.688)
        self.assertEqual(result["measured"]["potential_footprint_reduction_percent"], 93.17)
        self.assertIsNone(result["scope"]["source_full_video_duration_seconds"])
        self.assertIsNone(result["unknown"]["human_active_seconds"])
        self.assertIsNone(result["unknown"]["label_studio_lead_time_seconds"])
        self.assertIsNone(result["unknown"]["causal_human_time_saved_seconds"])
        self.assertIsNone(result["unknown"]["task_f1"])
        self.assertFalse(result["checks"]["owner_review_aggregate_structurally_consistent"])
        self.assertFalse(result["scope"]["human_gold"])
        self.assertTrue(projection.verify_c17_comparison(result, footprint, plan))
        self.assertEqual(result["status"],
                         "C16_FOOTPRINT_AND_C17_PLAN_VERIFIED_NO_HUMAN_REVIEWS")
        self.assertEqual(result["measured"]["owner_c17_aggregate_only"], None)

    def test_source_and_method_tampering_rejected(self):
        footprint, plan = case()
        changed = copy.deepcopy(plan)
        changed["source_sha256"] = "0" * 64
        with self.assertRaisesRegex(projection.ProjectionHold, "SOURCE_OR_PLAN_SHA"):
            projection.compare_c17_aggregate(footprint, changed)
        changed = copy.deepcopy(footprint)
        changed["review_baselines"]["reed_closed_after_video_end_5s"]["union_seconds_with_two_second_context"] = 29.
        with self.assertRaisesRegex(projection.ProjectionHold, "FOOTPRINT_MISMATCH"):
            projection.compare_c17_aggregate(changed, plan)
        changed = copy.deepcopy(footprint)
        changed["fixed_window_selection"]["5s"]["annotations_to_review"] = 4
        with self.assertRaisesRegex(projection.ProjectionHold, "METHOD_CHANGED"):
            projection.compare_c17_aggregate(changed, plan)
        changed = copy.deepcopy(plan)
        changed["human_activity_gold"] = "PASS"
        with self.assertRaisesRegex(projection.ProjectionHold, "PLAN_CONTRACT_CHANGED"):
            projection.compare_c17_aggregate(footprint, changed)

    def test_explicit_expected_plan_pin_and_receipt_integrity(self):
        footprint, plan = case()
        result = asdict(projection.compare_c17_aggregate(
            footprint, plan, expected_plan_sha256="a" * 64))
        self.assertTrue(result["scope"]["c17_plan_independently_pinned"])
        self.assertTrue(projection.verify_c17_comparison(
            result, footprint, plan, expected_plan_sha256="a" * 64))
        result["measured"]["potential_footprint_reduction_percent"] = 99.
        self.assertFalse(projection.verify_c17_comparison(
            result, footprint, plan, expected_plan_sha256="a" * 64))
        with self.assertRaisesRegex(projection.ProjectionHold, "SOURCE_OR_PLAN_SHA"):
            projection.compare_c17_aggregate(
                footprint, plan, expected_plan_sha256="b" * 64)

    def test_unfilled_owner_review_stays_unknown(self):
        packet, receipts = owner_score()
        plan = c17.public_plan(packet)
        self.assertEqual(plan["human_activity_gold"], "NOT_MEASURED")
        self.assertEqual(plan["independent_video_reviews"], 0)
        with self.assertRaisesRegex(c17.ReviewHold, "C17_REVIEWER_CLAIM_REQUIRED"):
            c17.score(packet, {role: c17.blank_receipt(packet, role)
                               for role in c17.ROLES})
        footprint, _ = case()
        output = asdict(projection.compare_c17_aggregate(footprint, case()[1]))
        self.assertIsNone(output["unknown"]["human_active_seconds"])
        self.assertIsNone(output["unknown"]["physically_confirmed_episodes_missed"])
        self.assertIsNone(output["unknown"]["correct_unknown_physical_rate"])

    def test_owner_score_aggregate_preserves_unknown_and_missing_time(self):
        packet, receipts = owner_score()
        score = c17.score(packet, receipts)
        footprint, plan = case()
        output = asdict(projection.compare_c17_aggregate(
            footprint, plan, owner_score=score))
        self.assertIn("OWNER_SCORE_UNATTESTED", output["status"])
        self.assertIsNone(output["measured"]["owner_c17_aggregate_only"]
                          ["arm_summaries"]["all"]["reported_active_seconds"])
        self.assertIsNone(output["measured"]["owner_c17_aggregate_only"]
                          ["arm_summaries"]["all"]["label_studio_lead_time_seconds"])
        self.assertIsNone(output["unknown"]["causal_human_time_saved_seconds"])
        self.assertEqual(score["denominators"]["adjudicated_unknown"], 23)
        self.assertIsNone(score["arm_summaries"]["all"]["visible_clip_retrieval_fraction"])
        self.assertFalse(output["checks"]["owner_review_aggregate_bound_to_plan_by_k05"])

    def test_owner_receipts_duplicate_contradiction_and_missing_rejected_by_owner(self):
        packet, receipts = owner_score()
        altered = copy.deepcopy(receipts)
        altered["reference_a"]["items"].pop()
        with self.assertRaisesRegex(c17.ReviewHold, "C17_REVIEW_COVERAGE_INCOMPLETE"):
            c17.score(packet, altered)
        altered = copy.deepcopy(receipts)
        altered["reference_a"]["items"][1]["clip_id"] = (
            altered["reference_a"]["items"][0]["clip_id"])
        with self.assertRaisesRegex(c17.ReviewHold, "C17_REVIEW_ROW_INVALID"):
            c17.score(packet, altered)
        altered = copy.deepcopy(receipts)
        altered["reference_b"]["reviewer_key"] = altered["reference_a"]["reviewer_key"]
        with self.assertRaisesRegex(c17.ReviewHold, "C17_REUSED_REVIEWER_CLAIM"):
            c17.score(packet, altered)
        altered = copy.deepcopy(receipts)
        altered["adjudicator"]["items"][0]["verdict"] = "FALSE_NEGATIVE"
        with self.assertRaisesRegex(c17.ReviewHold, "C17_REVIEW_ROW_INVALID"):
            c17.score(packet, altered)

    def test_inconsistent_owner_aggregate_rejected_without_rechecking_private_rows(self):
        packet, receipts = owner_score()
        owner = c17.score(packet, receipts)
        footprint, plan = case()
        owner["denominators"]["adjudicated_unknown"] = 0
        with self.assertRaisesRegex(projection.ProjectionHold, "DENOMINATORS_CONTRADICTORY"):
            projection.compare_c17_aggregate(footprint, plan, owner_score=owner)
        owner = c17.score(packet, receipts)
        owner["arm_summaries"]["reed_closed_after_end_5s"]["adjudicated_visible_omitted"] = 1
        with self.assertRaisesRegex(projection.ProjectionHold, "ARM_AGGREGATES_CONTRADICTORY"):
            projection.compare_c17_aggregate(footprint, plan, owner_score=owner)

    def test_unknown_not_negative_and_unverified_clocks(self):
        packet, receipts = owner_score()
        owner = c17.score(packet, receipts)
        footprint, plan = case()
        outcome = asdict(projection.compare_c17_aggregate(footprint, plan, owner_score=owner))
        self.assertFalse(outcome["scope"]["clock_synchronization_proven"])
        self.assertEqual(owner["denominators"]["adjudicated_unknown"], 23)
        self.assertIsNone(owner["arm_summaries"]["all"]["visible_clip_retrieval_fraction"])
        self.assertIsNone(outcome["unknown"]["physically_confirmed_episodes_missed"])
        self.assertIsNone(outcome["unknown"]["false_confident_physical_interpretations"])
        self.assertFalse(outcome["checks"]["owner_review_receipts_verified_by_k05"])
        self.assertNotIn("synthetic-reviewer", json.dumps(outcome))

if __name__ == "__main__":
    unittest.main()
