#!/usr/bin/env python3
"""C12-C16 Solve4X source-receipt projection into K03 observations.

Consumes the already redacted, pinned C12/C13/C14/C15/C16 *research receipt*.
It is NOT a second activity/discovery engine or human-task predictor. An
individual sensor/UI/video match is not made from redacted aggregate records.
Use replay_scene01() for actual upstream byte/ZIP-verified source replay.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
from time import perf_counter_ns

import k03

SCHEMA = "IWXA_K03_C12_C16_ACTIVITY_PROJECTION/0.1"
DOI = "https://doi.org/10.6084/m9.figshare.25246291"
SCENE = "scene01/"
C12_SCHEMA = "IWXA_SOLVE4X_C12_MULTICHANNEL/0.1"
C13_SCHEMA = "IWXA_SOLVE4X_C13_SENSOR_UI_REVIEW/0.1"
C14_SCHEMA = "IWXA_SOLVE4X_C14_RAW_REED_EPISODE_REVIEW/0.1"
C15_SCHEMA = "IWXA_SOLVE4X_C15_VIDEO_BOUNDARY_EVIDENCE/0.1"
C16_SCHEMA = "IWXA_SOLVE4X_C16_ANNOTATION_REVIEW_FOOTPRINT/0.1"
SOURCE_SHA = {
    "scene01/scene01_video_ocel.json": "619f52a0fb845926790388008b505fff5969adcd25cac31f0bb0e62d01980e99",
    "scene01/scene01_sensors_ocel.json": "4f16d799a7ff96b99e25192331fa6ef4edf3dcac876e9f8adc4e570514318918",
    "scene01/scene01_ui.csv": "653e0b52ec64c9f1629eb758091cdad5e5c3cb47d68531b2174ec0c6a6c0a1bb",
    "scene01/scene01_reed_switches.csv": "5e469a4bd4f14f831bbdce1048fe4ec963a8c263c05b90c77a167cf0dc5bf5e0",
}
QUESTION = ("Проверьте по оригинальным записям и видео, связаны ли "
            "показания датчика, UI и видео одним действием: известна ли "
            "калибровка часов, кто действовал и какой результат ему требовался?")
NO_TASK = "CLARIFICATION_REQUIRED"


def _need(value: bool, code: str) -> None:
    if not value:
        raise k03.DiscoveryHold(code)


def _source_ref(name: str) -> str:
    return f"{DOI}#{name}"


def _bound(name: str, *, episode: int | None = None, scope: str) -> dict:
    # Ordinals are derived C13/C14 review ordinals, NOT original event IDs.
    locator = {"kind": "DERIVED_REVIEW_EPISODE_ORDINAL"
               if episode is not None else "C15_C16_SCENE_LEVEL_SUMMARY",
               "scope": scope}
    if episode is not None:
        locator["review_ordinal"] = episode
    return {
        "source_id": name,
        "source_ref": _source_ref(name),
        "source_version": SOURCE_SHA[name],
        "source_sha256": SOURCE_SHA[name],
        "locator": locator,
        "locator_granularity": "DERIVED_ORDINAL_NOT_RAW_EVENT_OR_VIDEO_FRAME",
    }


def _int_count(x, code: str) -> int:
    _need(type(x) is int and 0 <= x <= 100_000, code)
    return x


def _source_check(receipt: dict) -> tuple[dict, dict, dict, dict]:
    _need(type(receipt) is dict and receipt.get("schema") == C12_SCHEMA
          and receipt.get("status") == "SOURCE_COVERAGE_ONLY_NO_HUMAN_GOLD"
          and receipt.get("calibrated_clock") is False
          and receipt.get("same_human_action_confirmed") is False
          and receipt.get("accepted_tasks") == 0,
          "K03_C12_UNQUALIFIED_RESEARCH_RECEIPT")
    origin = receipt.get("source")
    _need(type(origin) is dict and origin.get("article") == 25246291
          and origin.get("archive_downloaded") is False
          and origin.get("raw_events_published") is False
          and type(origin.get("sha256")) is dict
          and type(receipt.get("c14_raw_reed_sha256")) is str,
          "K03_C12_REQUIRED_SOURCE_MISSING")
    claimed = {**origin["sha256"],
               "scene01/scene01_reed_switches.csv": receipt["c14_raw_reed_sha256"]}
    _need(all(claimed.get(name) == digest
              for name, digest in SOURCE_SHA.items()),
          "K03_C12_SOURCE_REVISION_DRIFT")
    c13, c14 = receipt.get("c13_review_episodes"), receipt.get("c14_raw_reed_review")
    _need(type(c13) is dict and c13.get("schema") == C13_SCHEMA
          and c13.get("status") == "REDACTED_SOURCE_REVIEW_EPISODES_NOT_TASKS"
          and c13.get("clock_synchronization_confirmed") is False
          and c13.get("new_human_actions_confirmed") == 0
          and c13.get("accepted_tasks") == 0
          and type(c13.get("episodes")) is list,
          "K03_C13_RESEARCH_RECEIPT_INVALID")
    _need(type(c14) is dict and c14.get("schema") == C14_SCHEMA
          and c14.get("status") == "RAW_REED_SOURCE_DESCRIPTIVE_COMPARISON"
          and c14.get("raw_values_or_identifiers_exported") is False
          and type(c14.get("review_episodes")) is list
          and type(c14.get("limitations")) is dict
          and c14["limitations"].get("cross_device_clock_calibration_proven") is False
          and c14["limitations"].get("human_activity_gold") == "NOT_MEASURED"
          and c14["limitations"].get("accepted_tasks") == 0,
          "K03_C14_RESEARCH_RECEIPT_INVALID")
    c15, c16 = c14.get("c15_video_annotation_boundaries"), c14.get("c16_annotation_review_footprint")
    _need(type(c15) is dict and c15.get("schema") == C15_SCHEMA
          and c15.get("status") == "AUTHOR_VIDEO_LABEL_BOUNDARY_PROXIMITY_NOT_HUMAN_GOLD"
          and c15.get("clock_synchronization_confirmed") is False
          and c15.get("same_human_action") == "UNKNOWN"
          and c15.get("author_video_labels_independent_human_gold") is False
          and c15.get("accepted_tasks") == 0,
          "K03_C15_RESEARCH_RECEIPT_INVALID")
    _need(type(c16) is dict and c16.get("schema") == C16_SCHEMA
          and c16.get("status") == "AUTHOR_ANNOTATION_DURATION_PROXY_NOT_OBSERVED_REVIEW_TIME"
          and c16.get("clock_calibration_proven") is False
          and c16.get("source_annotation_labels_are_independent_human_gold") is False
          and c16.get("accepted_tasks") == 0,
          "K03_C16_RESEARCH_RECEIPT_INVALID")
    return c13, c14, c15, c16


def project_scene01(receipt: dict) -> dict:
    """Pure consumer of C12 probe receipt: pin checks, not an independent fetch.

    Each source file is independently SHA-pinned *upstream* by c12.probe().
    Direct caller receipts cannot prove the original bytes were replayed.
    """
    start_ns = perf_counter_ns()
    c13, c14, c15, c16 = _source_check(receipt)
    rows13, rows14 = c13["episodes"], c14["review_episodes"]
    _need(len(rows13) == len(rows14)
          == c13.get("sensor_outside_video") == 3
          and c14.get("denominators", {}).get("outside_video_sensor_events") == 3,
          "K03_C13_C14_EPISODE_ALIGNMENT_CHANGED")
    strict = c14.get("time_sensor_and_state", {}).get("5s")
    _need(type(strict) is dict, "K03_C14_STRICT_BASELINE_MISSING")
    _need(_int_count(strict.get("candidate_edges"), "K03_C14_STRICT_COUNTS_INVALID")
          == sum(_int_count(r.get("raw_same_sensor_and_state_5s"),
                             "K03_C14_STRICT_COUNTS_INVALID") for r in rows14)
          and _int_count(strict.get("episodes_with_multiple_raw_candidates"),
                         "K03_C14_STRICT_COUNTS_INVALID")
          == sum(r["raw_same_sensor_and_state_5s"] > 1 for r in rows14),
          "K03_C14_STRICT_EPISODE_BASELINE_DISAGREES")
    windows = c15.get("fixed_boundary_windows", {})
    _need(type(windows) is dict and type(windows.get("5s")) is dict
          and type(c16.get("review_baselines")) is dict,
          "K03_C15_C16_BASELINE_MISSING")
    _need(c16["denominators"]["video_annotation_total"] == c15["video_annotated_events"]
          and c16["review_baselines"]["reed_closed_after_video_end_5s"]["annotations_to_review"]
          == windows["5s"]["unique_candidate_annotation_segments"],
          "K03_C15_C16_REVIEW_SCOPE_DISAGREES")
    video_count = _int_count(windows["5s"].get("candidate_annotation_edges"),
                             "K03_C15_VIDEO_BOUNDARY_COUNT_INVALID")
    observations, summaries, questions = [], [], []
    for position, (r13, r14) in enumerate(zip(rows13, rows14), 1):
        _need(type(r13) is dict and type(r14) is dict
              and r13.get("review_ordinal") == position
              and r14.get("review_ordinal") == position
              and r13.get("same_human_action") == "UNKNOWN"
              and r13.get("task_hypothesis") == "NOT_QUALIFIED"
              and r14.get("same_human_action") == "UNKNOWN"
              and r14.get("task_proposal") == "NOT_QUALIFIED"
              and r13.get("sensor_signal_class") == "ENTRANCE_REED_SWITCH_CANDIDATE"
              and r14.get("sensor_class") == "ENTRANCE"
              and r14.get("ocel_state_class") == "CLOSED",
              "K03_C13_C14_EPISODE_IDENTITY_OR_TRUTH_CHANGED")
        ui_count = _int_count(r13.get("nearby_ui_record_count"),
                              "K03_C13_UI_COUNT_INVALID")
        raw_count = _int_count(r14.get("raw_same_sensor_and_state_5s"),
                               "K03_C14_RAW_COUNT_INVALID")
        _need(ui_count == r14.get("ui_candidates_5s")
              and type(r13.get("ui_event_classes")) is dict
              and sum(r13["ui_event_classes"].values()) == ui_count
              and type(r13.get("ui_target_classes")) is dict
              and sum(r13["ui_target_classes"].values()) == ui_count,
              "K03_C13_C14_UI_EVIDENCE_DISAGREES")
        evid = f"C12-C16-{position}"
        observations.append({
            "id": evid + "-sensor", "tag": "reported",
            "source_role": "SENSOR_OCEL_DERIVED_RECORD",
            "signal_class": r13["sensor_signal_class"],
            "transition": "ENTRANCE_CLOSED",
            "physical_activity_truth": "UNKNOWN",
            **_bound("scene01/scene01_sensors_ocel.json",
                     episode=position, scope="C13_OUTSIDE_VIDEO_SENSOR"),
        })
        if raw_count == 1:
            observations.append({
                "id": evid + "-reed", "tag": "observed",
                "source_role": "RECORDED_DIGITAL_REED_TRANSITION_NOT_PHYSICAL_TRUTH",
                "candidate_count_5s": raw_count,
                "matching_sensor_and_state": True,
                "source_event_independently_reviewed": False,
                **_bound("scene01/scene01_reed_switches.csv",
                         episode=position, scope="C14_STRICT_RAW_TRANSITION_5S"),
            })
        else:
            observations.append({
                "id": evid + "-reed", "tag": "inferred",
                "source_role": "RAW_REED_MATCH_ABSENT_OR_COMPETING",
                "candidate_count_5s": raw_count,
                "resolution": "UNKNOWN",
                **_bound("scene01/scene01_reed_switches.csv",
                         episode=position, scope="C14_STRICT_RAW_CANDIDATE_SET_5S"),
            })
        observations.append({
            "id": evid + "-ui", "tag": "observed",
            "source_role": "RECORDED_BROWSER_UI_EVENTS_NOT_CAUSAL_LINK",
            "candidate_count_5s": ui_count,
            "ui_event_classes": r13["ui_event_classes"],
            "ui_target_classes": r13["ui_target_classes"],
            "clock_calibrated": False,
            **_bound("scene01/scene01_ui.csv",
                     episode=position, scope="C13_NEARBY_UI_5S"),
        })
        observations.append({
            "id": evid + "-video", "tag": "inferred",
            "source_role": "AUTHOR_VIDEO_BOUNDARY_GROUP_PROXIMITY_ONLY",
            "scene_level_target_boundary_edges_5s": video_count,
            "episode_specific_video_match": "UNKNOWN",
            "author_annotation_is_independent_human_gold": False,
            **_bound("scene01/scene01_video_ocel.json",
                     episode=position, scope="C15_GROUP_LEVEL_VIDEO_BOUNDARIES_5S"),
        })
        observations.append({
            "id": evid + "-relation", "tag": "inferred",
            "source_role": "UNCALIBRATED_TIME_WINDOW_ASSOCIATION",
            "nearest_candidate_distance_band": r13["nearest_candidate_distance_band"],
            "matching_raw_reed_candidates": raw_count,
            "browser_ui_candidates": ui_count,
            "clock_calibration": "UNKNOWN",
            "same_human_action": "UNKNOWN",
            **_bound("scene01/scene01_sensors_ocel.json",
                     episode=position, scope="C13_C14_CONDITIONAL_EPISODE_REVIEW"),
        })
        summaries.append({
            "review_ordinal": position,
            "activity": "UNKNOWN",
            "raw_reed_strict_candidates": raw_count,
            "ui_nearby_candidates": ui_count,
            "video_group_proximity_only": True,
            "independent_human_confirmation": False,
        })
        questions.append({
            "id": f"Q-C12-C16-{position}",
            "question": QUESTION,
            "reason": "UNQUALIFIED_HUMAN_ACTIVITY_AND_CLOCK_DOMAIN",
            "review_ordinal": position,
        })
    result = {
        "schema": SCHEMA,
        "method": "C12_C16_EXISTING_SOURCE_RESEARCH_RECEIPT_CONSUMER",
        "route": NO_TASK,
        "activity_status": "UNKNOWN",
        "activity_observations": observations,
        "task_hypotheses": [],
        "clarification_requests": questions,
        "source_references": [
            _bound(name, scope="PINNED_ORIGINAL_SCENE01_FILE")
            for name in SOURCE_SHA
        ],
        "source_integrity": "PINNED_C12_C14_RECEIPT_UNVERIFIED_BYTES_IN_THIS_FUNCTION",
        "episode_summaries": summaries,
        "evidence_metrics_for_k05": {
            "research_episodes": len(rows13),
            "digitally_recorded_raw_transitions_unique": sum(
                r["raw_reed_strict_candidates"] == 1 for r in summaries),
            "missing_or_competing_raw_transitions": sum(
                r["raw_reed_strict_candidates"] != 1 for r in summaries),
            "ui_candidate_records_5s": c13["unique_ui_candidate_records_5s"],
            "video_source_annotation_total": c16["denominators"]["video_annotation_total"],
            "video_annotation_review_candidates_5s": c16["review_baselines"]
                ["reed_closed_after_video_end_5s"]["annotations_to_review"],
            "video_union_seconds_context_proxy": c16["review_baselines"]
                ["reed_closed_after_video_end_5s"]["union_seconds_with_two_second_context"],
            "unknown_activity_count": len(rows13),
            "hypothesis_count": 0, "accepted_tasks": 0,
            "independent_human_activity_gold": False,
            "false_confident_rate": None, "correct_unknown_rate": None,
            "human_review_seconds": None, "task_precision": None,
            "task_recall": None, "task_f1": None,
        },
        "clock_domain_calibrated": False,
        "same_human_action_confirmed": False,
        "accepted_task_count": 0,
        "task_type_accepted": False,
        "task_created": False,
        "result_created": False,
        "selection": None,
        "next_owner": "HUMAN_CLARIFICATION_NOT_P01_TASK",
    }
    return result


def verify_projection(projection: dict, receipt: dict) -> dict:
    """Independent structural replay against a supplied C12 report, not raw bytes."""
    _need(type(projection) is dict and projection == project_scene01(receipt),
          "K03_C12_C16_EVIDENCE_PROJECTION_CHANGED")
    return {
        "status": "PASS_REPROJECTED_FROM_PINNED_C12_RECEIPT",
        "source_bytes_independently_reloaded": False,
        "human_activity_verified": False,
        "task_qualified": False,
    }


def replay_scene01() -> dict:
    """Call existing C12 source reader (ZIP CRC + SHA); no new download pipeline."""
    root = Path(__file__).resolve().parents[2] / "research/activity-research"
    sys.path.insert(0, str(root))
    try:
        from solve4x_cross_source_coverage import probe
        report = probe()
    finally:
        sys.path.remove(str(root))
    result = project_scene01(report)
    result["source_integrity"] = "UPSTREAM_C12_PINNED_ORIGINAL_BYTES_ZIP_CRC_VERIFIED"
    return result


def main() -> int:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--original-scene01", action="store_true", required=True)
    args = p.parse_args()
    try:
        result = replay_scene01()
        # The aggregate is enough for CI. Never print original event IDs/values.
        aggregate = {
            "schema": result["schema"], "route": result["route"],
            "source_integrity": result["source_integrity"],
            "source_revisions": {s["source_id"]: s["source_sha256"]
                                  for s in result["source_references"]},
            "evidence_metrics_for_k05": result["evidence_metrics_for_k05"],
            "observation_tags": {
                t: sum(o["tag"] == t for o in result["activity_observations"])
                for t in ("reported", "observed", "inferred")},
            "clarification_count": len(result["clarification_requests"]),
            "task_hypotheses": result["task_hypotheses"],
            "accepted_task_count": result["accepted_task_count"],
        }
        print(json.dumps(aggregate, sort_keys=True, allow_nan=False))
        return 0
    except (k03.DiscoveryHold, OSError, ValueError, KeyError, TypeError,
            UnicodeError, TimeoutError):
        print(json.dumps({
            "status": "HOLD", "code": "K03_C12_C16_ORIGINAL_SOURCE_UNAVAILABLE"
        }, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
