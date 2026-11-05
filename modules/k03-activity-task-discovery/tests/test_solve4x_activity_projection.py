"""K03 C12-C16 projection tests. Synthetic redacted receipts, no raw scene export."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import k03
import solve4x_activity_projection as adapter


def fixture():
    c13episodes = []
    c14episodes = []
    for idx, (ui_n, ui_kind) in enumerate(
            [(2, "PAGE_NAVIGATION"), (2, "PAGE_NAVIGATION"),
             (1, "MOUSE_CLICK")], 1):
        c13episodes.append({
            "review_ordinal": idx,
            "sensor_signal_class": "ENTRANCE_REED_SWITCH_CANDIDATE",
            "nearby_ui_record_count": ui_n,
            "ui_event_classes": {ui_kind: ui_n},
            "ui_target_classes": {"UNMAPPED_TARGET": ui_n},
            "nearest_candidate_distance_band": "WITHIN_5_SECONDS",
            "same_human_action": "UNKNOWN",
            "task_hypothesis": "NOT_QUALIFIED",
        })
        c14episodes.append({
            "review_ordinal": idx,
            "sensor_class": "ENTRANCE",
            "ocel_state_class": "CLOSED",
            "raw_same_sensor_and_state_5s": 1,
            "ui_candidates_5s": ui_n,
            "same_human_action": "UNKNOWN",
            "task_proposal": "NOT_QUALIFIED",
        })
    return {
        "schema": adapter.C12_SCHEMA,
        "status": "SOURCE_COVERAGE_ONLY_NO_HUMAN_GOLD",
        "calibrated_clock": False,
        "same_human_action_confirmed": False,
        "accepted_tasks": 0,
        "source": {
            "article": 25246291,
            "sha256": {key: value for key, value in adapter.SOURCE_SHA.items()
                       if not key.endswith("_reed_switches.csv")},
            "archive_downloaded": False,
            "raw_events_published": False,
        },
        "c14_raw_reed_sha256":
            adapter.SOURCE_SHA["scene01/scene01_reed_switches.csv"],
        "c13_review_episodes": {
            "schema": adapter.C13_SCHEMA,
            "status": "REDACTED_SOURCE_REVIEW_EPISODES_NOT_TASKS",
            "sensor_outside_video": 3,
            "clock_synchronization_confirmed": False,
            "new_human_actions_confirmed": 0,
            "accepted_tasks": 0,
            "unique_ui_candidate_records_5s": 5,
            "episodes": c13episodes,
        },
        "c14_raw_reed_review": {
            "schema": adapter.C14_SCHEMA,
            "status": "RAW_REED_SOURCE_DESCRIPTIVE_COMPARISON",
            "raw_values_or_identifiers_exported": False,
            "denominators": {"outside_video_sensor_events": 3},
            "limitations": {
                "cross_device_clock_calibration_proven": False,
                "human_activity_gold": "NOT_MEASURED",
                "accepted_tasks": 0,
            },
            "time_sensor_and_state": {
                "5s": {
                    "candidate_edges": 3,
                    "episodes_with_multiple_raw_candidates": 0,
                },
            },
            "review_episodes": c14episodes,
            "c15_video_annotation_boundaries": {
                "schema": adapter.C15_SCHEMA,
                "status": "AUTHOR_VIDEO_LABEL_BOUNDARY_PROXIMITY_NOT_HUMAN_GOLD",
                "clock_synchronization_confirmed": False,
                "same_human_action": "UNKNOWN",
                "author_video_labels_independent_human_gold": False,
                "accepted_tasks": 0,
                "video_annotated_events": 23,
                "fixed_boundary_windows": {
                    "5s": {
                        "candidate_annotation_edges": 3,
                        "unique_candidate_annotation_segments": 3,
                    },
                },
            },
            "c16_annotation_review_footprint": {
                "schema": adapter.C16_SCHEMA,
                "status": "AUTHOR_ANNOTATION_DURATION_PROXY_NOT_OBSERVED_REVIEW_TIME",
                "clock_calibration_proven": False,
                "source_annotation_labels_are_independent_human_gold": False,
                "accepted_tasks": 0,
                "denominators": {"video_annotation_total": 23},
                "review_baselines": {
                    "reed_closed_after_video_end_5s": {
                        "annotations_to_review": 3,
                        "union_seconds_with_two_second_context": 24.688,
                    },
                },
            },
        },
    }


class ActivityProjectionTests(unittest.TestCase):
    def test_sensor_raw_source_bound_positive_digital_observation(self):
        projection = adapter.project_scene01(fixture())
        self.assertEqual(projection["schema"], adapter.SCHEMA)
        self.assertEqual(projection["route"], "CLARIFICATION_REQUIRED")
        self.assertEqual(len(projection["activity_observations"]), 15)
        first = projection["activity_observations"][0:5]
        self.assertEqual(first[0]["tag"], "reported")
        raw = first[1]
        self.assertEqual(raw["tag"], "observed")
        self.assertEqual(raw["candidate_count_5s"], 1)
        self.assertEqual(raw["source_revision"],
                         adapter.SOURCE_SHA["scene01/scene01_reed_switches.csv"])
        self.assertEqual(raw["source_sha256"], raw["source_version"])
        self.assertEqual(raw["locator"]["review_ordinal"], 1)
        self.assertIn("NOT_PHYSICAL_TRUTH", raw["source_role"])
        self.assertEqual(projection["accepted_task_count"], 0)
        self.assertFalse(projection["task_created"])

    def test_video_temporal_proximity_uncalibrated_unknown(self):
        projection = adapter.project_scene01(fixture())
        first = projection["activity_observations"][0:5]
        video = first[3]
        inferred = first[4]
        self.assertEqual(video["tag"], "inferred")
        self.assertEqual(video["episode_specific_video_match"], "UNKNOWN")
        self.assertEqual(video["scene_level_target_boundary_edges_5s"], 3)
        self.assertFalse(video["author_annotation_is_independent_human_gold"])
        self.assertEqual(inferred["clock_calibration"], "UNKNOWN")
        self.assertEqual(inferred["same_human_action"], "UNKNOWN")
        self.assertFalse(projection["clock_domain_calibrated"])
        self.assertFalse(projection["same_human_action_confirmed"])
        self.assertEqual(len(projection["clarification_requests"]), 3)

    def test_absent_original_source_evidence_holds(self):
        original = fixture()
        del original["source"]["sha256"]["scene01/scene01_sensors_ocel.json"]
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C12_SOURCE_REVISION_DRIFT"):
            adapter.project_scene01(original)
        original = fixture()
        del original["source"]
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C12_REQUIRED_SOURCE_MISSING"):
            adapter.project_scene01(original)

    def test_one_episode_multiple_competing_raw_candidates_remains_unknown(self):
        original = fixture()
        original["c14_raw_reed_review"]["review_episodes"][0][
            "raw_same_sensor_and_state_5s"] = 2
        strict = original["c14_raw_reed_review"]["time_sensor_and_state"]["5s"]
        strict["candidate_edges"] = 4
        strict["episodes_with_multiple_raw_candidates"] = 1
        projection = adapter.project_scene01(original)
        raw = projection["activity_observations"][1]
        self.assertEqual(raw["tag"], "inferred")
        self.assertEqual(raw["candidate_count_5s"], 2)
        self.assertEqual(raw["resolution"], "UNKNOWN")
        self.assertEqual(projection["activity_status"], "UNKNOWN")
        self.assertEqual(projection["task_hypotheses"], [])
        self.assertEqual(projection["evidence_metrics_for_k05"][
            "missing_or_competing_raw_transitions"], 1)

    def test_unknown_is_not_accepted_task_or_task_hypothesis(self):
        result = adapter.project_scene01(fixture())
        self.assertEqual(result["task_hypotheses"], [])
        self.assertFalse(result["task_type_accepted"])
        self.assertFalse(result["task_created"])
        self.assertFalse(result["result_created"])
        self.assertIsNone(result["selection"])
        self.assertEqual(result["next_owner"],
                         "HUMAN_CLARIFICATION_NOT_P01_TASK")
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "DISCOVERY_NOT_TRACE_CHECKED"):
            k03.select_hypothesis(
                result, "H-C12-C16-1",
                choice="HUMAN_SELECT_FOR_QUALIFICATION",
                selection_ref="human-choice-1")

    def test_wrong_source_revision_and_mutated_evidence_rejected(self):
        original = fixture()
        original["source"]["sha256"]["scene01/scene01_ui.csv"] = "f"*64
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C12_SOURCE_REVISION_DRIFT"):
            adapter.project_scene01(original)
        original = fixture()
        projection = adapter.project_scene01(original)
        forged = copy.deepcopy(projection)
        forged["activity_observations"][1]["tag"] = "reported"
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C12_C16_EVIDENCE_PROJECTION_CHANGED"):
            adapter.verify_projection(forged, original)
        self.assertFalse(adapter.verify_projection(projection, original)[
            "human_activity_verified"])

    def test_c13_c14_ordinal_shift_refused(self):
        original = fixture()
        original["c14_raw_reed_review"]["review_episodes"][1][
            "review_ordinal"] = 3
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C13_C14_EPISODE_IDENTITY_OR_TRUTH_CHANGED"):
            adapter.project_scene01(original)

    def test_c14_strict_baseline_must_agree_with_episode_edges(self):
        original = fixture()
        original["c14_raw_reed_review"]["time_sensor_and_state"]["5s"][
            "candidate_edges"] = 2
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C14_STRICT_EPISODE_BASELINE_DISAGREES"):
            adapter.project_scene01(original)

    def test_c15_c16_video_footprint_consistency_required(self):
        original = fixture()
        original["c14_raw_reed_review"]["c16_annotation_review_footprint"][
            "review_baselines"]["reed_closed_after_video_end_5s"][
                "annotations_to_review"] = 2
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C15_C16_REVIEW_SCOPE_DISAGREES"):
            adapter.project_scene01(original)

    def test_unverified_clock_or_human_truth_not_promoted(self):
        original = fixture()
        original["c14_raw_reed_review"]["c15_video_annotation_boundaries"][
            "same_human_action"] = "CONFIRMED"
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C15_RESEARCH_RECEIPT_INVALID"):
            adapter.project_scene01(original)
        original = fixture()
        original["calibrated_clock"] = True
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_C12_UNQUALIFIED_RESEARCH_RECEIPT"):
            adapter.project_scene01(original)

    def test_k05_metrics_are_descriptive_not_new_quality_evaluator(self):
        projection = adapter.project_scene01(fixture())
        metrics = projection["evidence_metrics_for_k05"]
        self.assertEqual(metrics["research_episodes"], 3)
        self.assertEqual(metrics["digitally_recorded_raw_transitions_unique"], 3)
        self.assertEqual(metrics["ui_candidate_records_5s"], 5)
        self.assertEqual(metrics["video_source_annotation_total"], 23)
        self.assertEqual(metrics["video_annotation_review_candidates_5s"], 3)
        self.assertEqual(metrics["video_union_seconds_context_proxy"], 24.688)
        self.assertEqual(metrics["unknown_activity_count"], 3)
        self.assertEqual(metrics["hypothesis_count"], 0)
        self.assertEqual(metrics["accepted_tasks"], 0)
        self.assertIsNone(metrics["task_f1"])
        self.assertIsNone(metrics["human_review_seconds"])
        self.assertIsNone(metrics["false_confident_rate"])
        self.assertIsNone(metrics["correct_unknown_rate"])
        self.assertNotIn("time_ms", metrics)

    def test_no_raw_event_ids_timestamps_or_media_in_receipt(self):
        result = adapter.project_scene01(fixture())
        printed = json.dumps(result, ensure_ascii=False)
        for field in ("raw_event_id", "ocel:timestamp", "event_id", "actor_id",
                      "raw_media", "video_frame", "clock_offset_fitted"):
            self.assertNotIn('"' + field + '"', printed)
        self.assertEqual(result["source_integrity"],
                         "PINNED_C12_C14_RECEIPT_UNVERIFIED_BYTES_IN_THIS_FUNCTION")
        self.assertEqual(len(result["source_references"]), 4)


if __name__ == "__main__":
    unittest.main()
