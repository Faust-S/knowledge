"""K05 consumer of C16/C17 *aggregate outputs*, not a video or review evaluator.

C16 owns selecting annotations, C17 owns review receipts/score, and C15 owns
conditional timing comparisons. K05 only projects pinned public evidence
metadata into the existing ComparisonResult shape with a separate schema.
"""
from __future__ import annotations

from dataclasses import asdict
import math
import re
from typing import Mapping

from k05_evaluation import ComparisonResult

SCHEMA = "IWXA_K05_C17_COMPARISON/0.1"
C16_SCHEMA = "IWXA_SOLVE4X_C16_ANNOTATION_REVIEW_FOOTPRINT/0.1"
C17_SCHEMA = "IWXA_SOLVE4X_C17_BLIND_VIDEO_REVIEW/0.1"
SOURCE_SHA256 = "619f52a0fb845926790388008b505fff5969adcd25cac31f0bb0e62d01980e99"
OWNER_C17_STATUS = "OWNER_CLAIMED_INDEPENDENT_CLIP_REVIEWS_NOT_ATTESTED_PHYSICAL_GOLD"
OWNER_C17_ARMS = (
    "all", "literal_enter_leave", "reed_closed_after_end_5s",
)
C16_TO_C17 = (
    ("all_published_video_annotations", "all", 23, 323.035, 361.376),
    ("literal_enter_leave_labels_only", "literal_enter_leave", 6, 27.669, 51.669),
    ("reed_closed_after_video_end_5s", "reed_closed_after_end_5s", 3, 12.688, 24.688),
)
HEX64 = re.compile(r"^[a-f0-9]{64}$")


class ProjectionHold(ValueError):
    """Fixed code only; never source events or reviewer identities."""


def need(ok: bool, code: str) -> None:
    if not ok:
        raise ProjectionHold(code)


def obj(value: object) -> bool:
    return type(value) is dict


def count(value: object, bound: int) -> bool:
    return type(value) is int and 0 <= value <= bound


def seconds(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def optional_seconds(value: object) -> bool:
    return value is None or seconds(value)


def same_ms(value: object, expected: float) -> bool:
    return seconds(value) and abs(value - expected) < 0.0000001


def check_owner_aggregate(score: object) -> dict:
    """Check only public aggregate invariants; C17.score owns private receipts."""
    need(obj(score) and score.get("schema") == C17_SCHEMA
         and score.get("status") == OWNER_C17_STATUS,
         "C17_OWNER_AGGREGATE_INVALID")
    den, summaries, refs = (score.get("denominators"),
                            score.get("arm_summaries"),
                            score.get("reference_active_seconds"))
    need(obj(den) and obj(summaries)
         and set(summaries) == set(OWNER_C17_ARMS)
         and obj(refs)
         and set(refs) == {"reference_a", "reference_b", "adjudicator"}
         and all(optional_seconds(value) for value in refs.values()),
         "C17_OWNER_AGGREGATE_INCOMPLETE")
    need(den.get("video_annotations") == 23
         and all(den.get(k) == 23 for k in (
             "reviewed_reference_a", "reviewed_reference_b", "adjudicated"))
         and all(count(den.get(k), 23) for k in (
             "adjudicated_visible", "adjudicated_not_visible",
             "adjudicated_unknown", "reference_a_b_disagreements",
             "reference_a_b_agreement_unknown"))
         and sum(den[k] for k in (
             "adjudicated_visible", "adjudicated_not_visible",
             "adjudicated_unknown")) == 23
         and den["reference_a_b_agreement_unknown"] <= 23,
         "C17_OWNER_DENOMINATORS_CONTRADICTORY")
    need(score.get("reported_active_time_is_self_report_not_verified") is True
         and score.get("label_studio_lead_time_may_include_idle") is True
         and score.get("reviewer_identity_and_independence_verified") is False
         and score.get("adjudicator_truth_independently_verified") is False
         and score.get("same_actor_or_intention_proven") is False
         and score.get("clock_calibration_proven") is False
         and score.get("causal_labor_saving_established") is False
         and score.get("task_precision") is None
         and score.get("accepted_tasks") == 0
         and score.get("source_identifiers_times_actors_or_reviewer_keys_exported") is False,
         "C17_OWNER_AGGREGATE_AUTHORITY_CHANGED")
    for _, name, n, _, _ in C16_TO_C17:
        part = summaries[name]
        need(obj(part) and part.get("clips_reviewed") == n
             and all(count(part.get(k), 23) for k in (
                 "adjudicated_visible_in_selection",
                 "adjudicated_visible_omitted",
                 "adjudicated_unknown_in_selection",
                 "confident_contradictions_vs_adjudicator",
                 "confident_on_adjudicated_unknown",
                 "unknown_agreement_with_adjudicator",
                 "unknown_on_resolved_reference"))
             and part["adjudicated_visible_in_selection"] <= n
             and part["adjudicated_visible_in_selection"] +
                 part["adjudicated_visible_omitted"] == den["adjudicated_visible"]
             and part["adjudicated_unknown_in_selection"] <= min(
                 n, den["adjudicated_unknown"])
             and part["unknown_agreement_with_adjudicator"] <= (
                 part["adjudicated_unknown_in_selection"])
             and part["confident_on_adjudicated_unknown"] <= (
                 part["adjudicated_unknown_in_selection"])
             and part["unknown_on_resolved_reference"] <= (
                 n - part["adjudicated_unknown_in_selection"])
             and part["confident_contradictions_vs_adjudicator"] <= min(
                 n - part["adjudicated_unknown_in_selection"],
                 den["adjudicated_not_visible"])
             and optional_seconds(part.get("reported_active_seconds"))
             and optional_seconds(part.get("label_studio_lead_time_seconds")),
             "C17_OWNER_ARM_AGGREGATES_CONTRADICTORY")
        visible = den["adjudicated_visible"]
        fraction = part.get("visible_clip_retrieval_fraction")
        if visible:
            need(seconds(fraction) and fraction <= 1
                 and abs(fraction - round(
                     part["adjudicated_visible_in_selection"] / visible, 6)) <= 0.0000001,
                 "C17_OWNER_VISIBLE_FRACTION_INVALID")
        else:
            need(fraction is None, "C17_UNKNOWN_NOT_NEGATIVE")
    delta = score.get("descriptive_active_seconds_full_minus_focused")
    full = summaries["all"]["reported_active_seconds"]
    focused = summaries["reed_closed_after_end_5s"]["reported_active_seconds"]
    if full is None or focused is None:
        need(delta is None, "C17_UNMEASURED_ACTIVE_TIME_FABRICATED")
    else:
        need(type(delta) in (int, float) and math.isfinite(delta)
             and abs(delta - round(full - focused, 3)) < 0.0000001,
             "C17_OWNER_ACTIVE_TIME_DELTA_INVALID")
    # Preserve C17's actual result; K05 does not score individual reviews.
    return score


def compare_c17_aggregate(
    footprint: Mapping[str, object],
    plan: Mapping[str, object],
    *,
    owner_score: Mapping[str, object] | None = None,
    expected_plan_sha256: str | None = None,
) -> ComparisonResult:
    """Scoped C15-C17 descriptive comparison of same pinned video source.

    expected_plan_sha256, when supplied, must be an independently pinned
    owner reference. A SHA copied from plan is not independent evidence.
    """
    need(obj(footprint) and footprint.get("schema") == C16_SCHEMA
         and footprint.get("status") ==
         "AUTHOR_ANNOTATION_DURATION_PROXY_NOT_OBSERVED_REVIEW_TIME",
         "C16_METHOD_OR_SOURCE_UNVERIFIED")
    need(obj(plan) and plan.get("schema") == C17_SCHEMA
         and plan.get("status") ==
         "BLIND_REVIEW_DESIGN_READY_NO_MEDIA_OR_HUMAN_MEASUREMENT"
         and plan.get("source_sha256") == SOURCE_SHA256
         and type(plan.get("frozen_plan_sha256")) is str
         and HEX64.fullmatch(plan["frozen_plan_sha256"]) is not None,
         "C17_SOURCE_OR_PLAN_SHA_MISMATCH")
    if expected_plan_sha256 is not None:
        need(type(expected_plan_sha256) is str
             and HEX64.fullmatch(expected_plan_sha256) is not None
             and plan["frozen_plan_sha256"] == expected_plan_sha256,
             "C17_SOURCE_OR_PLAN_SHA_MISMATCH")
    need(plan.get("denominators") ==
         {"video_annotations": 23, "literal_enter_leave": 6, "reed_focused": 3}
         and plan.get("independent_video_reviews") == 0
         and plan.get("adjudicated_clips") == 0
         and plan.get("human_activity_gold") == "NOT_MEASURED"
         and plan.get("active_review_seconds") is None
         and plan.get("label_studio_lead_time_seconds") is None
         and plan.get("missed_visible_clips") is None
         and plan.get("unknown_agreement_rate") is None
         and plan.get("contradicted_confident_claims") is None
         and plan.get("clock_calibration_proven") is False
         and plan.get("source_author_labels_are_human_gold") is False
         and plan.get("real_video_decoded") is False
         and plan.get("task_precision") is None
         and plan.get("accepted_tasks") == 0
         and plan.get("source_identifiers_times_actors_or_verdicts_exported") is False,
         "C17_PLAN_CONTRACT_CHANGED")
    den = footprint.get("denominators")
    base = footprint.get("review_baselines")
    need(obj(den) and obj(base)
         and den == {
             "video_annotation_total": 23,
             "literal_enter_leave_annotations": 6,
             "out_of_video_door_closings": 3,
         }
         and set(base) == {row[0] for row in C16_TO_C17}
         and footprint.get("annotation_count_reduction_full_to_label") == 17
         and footprint.get("annotation_count_reduction_label_to_focused") == 3
         and footprint.get("annotation_count_reduction_full_to_focused") == 20
         and footprint.get("human_effort_seconds_delta") is None
         and footprint.get("human_cost_savings") is None
         and footprint.get("reviewer_gains_measured") is False
         and footprint.get("source_annotation_labels_are_independent_human_gold") is False
         and footprint.get("clock_calibration_proven") is False
         and footprint.get("source_level_false_confident_rate") == "NOT_MEASURED"
         and footprint.get("correct_unknown_rate") == "NOT_MEASURED"
         and footprint.get("accepted_tasks") == 0
         and footprint.get("raw_event_ids_timestamps_actor_ids_or_values_exported") is False,
         "C16_AGGREGATE_CONTRACT_CHANGED")
    checked = []
    for c16_name, arm, n, annotated, union in C16_TO_C17:
        row = base[c16_name]
        need(obj(row) and row.get("annotations_to_review") == n
             and same_ms(row.get("sum_of_annotated_interval_seconds"), annotated)
             and same_ms(row.get("union_seconds_with_two_second_context"), union)
             and row.get("actual_human_review_seconds") is None,
             "C16_REVIEW_FOOTPRINT_MISMATCH")
        checked.append({
            "method": arm, "candidate_count": n,
            "annotated_seconds_sum": annotated,
            "footprint_union_seconds_with_2s_context": union,
            "actual_human_review_seconds": None,
        })
    five = footprint.get("fixed_window_selection")
    need(obj(five) and obj(five.get("5s"))
         and five["5s"].get("annotations_to_review") == 3
         and same_ms(five["5s"].get("union_seconds_with_two_second_context"), 24.688),
         "C16_FOCUSED_WINDOW_METHOD_CHANGED")
    owner = check_owner_aggregate(owner_score) if owner_score is not None else None
    reduction = round(100 * (361.376 - 24.688) / 361.376, 2)
    return ComparisonResult(
        schema=SCHEMA, case_id="SOLVE4X_SCENE01_C15_C17",
        status=("C16_FOOTPRINT_AND_C17_PLAN_VERIFIED_OWNER_SCORE_UNATTESTED"
                if owner is not None else
                "C16_FOOTPRINT_AND_C17_PLAN_VERIFIED_NO_HUMAN_REVIEWS"),
        baseline=checked[0],
        tested={"methods": checked[1:]},
        scope={
            "unit": "VIDEO_ANNOTATION_CLIP_NOT_PHYSICAL_EVENT",
            "source_sha256_from_owner_c17": SOURCE_SHA256,
            "source_bytes_read_by_k05": False,
            "c16_schema": C16_SCHEMA, "c17_schema": C17_SCHEMA,
            "c17_plan_sha256_from_owner": plan["frozen_plan_sha256"],
            "c17_plan_independently_pinned": expected_plan_sha256 is not None,
            "source_full_video_duration_seconds": None,
            "context_seconds_each_side": 2,
            "clock_synchronization_proven": False,
            "reviewer_independence_proven": False,
            "author_annotations_are_independent_gold": False,
            "human_gold": False,
        },
        checks={
            "three_methods_source_scoped": True,
            "c16_c17_candidate_denominators_match": True,
            "sensor_selection_uses_fixed_5s_window": True,
            "source_sha_matches_published_c17_pin": True,
            "owner_review_aggregate_structurally_consistent":
                owner is not None,
            "owner_review_receipts_verified_by_k05": False,
            "owner_review_aggregate_bound_to_plan_by_k05": False,
        },
        measured={
            "candidate_counts": {
                row["method"]: row["candidate_count"] for row in checked
            },
            "annotated_footprint_seconds": {
                row["method"]: row["footprint_union_seconds_with_2s_context"]
                for row in checked
            },
            "potential_footprint_reduction_seconds": round(361.376 - 24.688, 3),
            "potential_footprint_reduction_percent": reduction,
            "owner_c17_aggregate_only": owner,
        },
        unknown={
            "human_active_seconds": None,
            "label_studio_lead_time_seconds": None,
            "physically_confirmed_episodes_missed": None,
            "false_confident_physical_interpretations": None,
            "correct_unknown_physical_rate": None,
            "excess_unknown_physical_rate": None,
            "reviewer_disagreement": None,
            "causal_human_time_saved_seconds": None,
            "task_precision": None, "task_recall": None, "task_f1": None,
            "accepted_tasks": 0,
            "agent_result_readback": "NOT_TESTED",
        },
    )


def verify_c17_comparison(
    receipt: object,
    footprint: Mapping[str, object],
    plan: Mapping[str, object],
    *,
    owner_score: Mapping[str, object] | None = None,
    expected_plan_sha256: str | None = None,
) -> bool:
    """Recompute only public aggregate projection; do not attest human reviews."""
    try:
        return obj(receipt) and receipt == asdict(compare_c17_aggregate(
            footprint, plan, owner_score=owner_score,
            expected_plan_sha256=expected_plan_sha256))
    except (ProjectionHold, TypeError, KeyError, ValueError):
        return False
