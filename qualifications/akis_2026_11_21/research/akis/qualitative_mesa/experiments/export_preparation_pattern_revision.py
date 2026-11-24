"""Redacted reproducible structural capital renewal in the original Mesa."""
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.comparative_trajectories import compare_original_preparation_pattern_reuse
from research.akis.qualitative_mesa.tests.test_original_preparation_pattern_revision_mesa import revision_routes, structural_view, observe_pattern_change_timing
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.experiments.export_activity_efficiency import direction


def export_pattern_revision():
    observations = []
    for mode, rate in (("S1", "8.00"), ("S2", "8.00"), ("S2", "60.00"), ("S2", "80.00")):
        docs = revision_routes(mode=mode, reuse_rate=rate)
        report = compare_original_preparation_pattern_reuse(docs)
        views = {arm: structural_view(simulate(doc)) for arm, doc in docs.items()}
        local = report["local_research_only"]
        arms = local["arms"]
        observations.append({
            "original_mode": mode,
            "trial": {"8.00": "lower_reuse_cost", "60.00": "equal_cost",
                      "80.00": "higher_reuse_cost"}[rate],
            "saving_direction": direction(local["rebuild_minus_reuse_declared_preparation_cost"]),
            "accepted_original_work_counts": {arm: row["accepted_original_work_count"]
                                               for arm, row in arms.items()},
            "build_counts": {arm: row["original_pattern_build_count"] for arm, row in arms.items()},
            "reuse_counts": {arm: row["original_pattern_reuse_count"] for arm, row in arms.items()},
            "original_revision_count": arms["REUSE"]["original_pattern_revision_count"],
            "revision_build_cost_included": arms["REUSE"]["original_pattern_revision_build_cost_included"],
            "human_validation_counts": {arm: row["human_validation_units"] for arm, row in arms.items()},
            "same_original_works_results_consents_and_cash": report["same_original_works_results_consents_and_cash"],
            "accepted_effective_reuse_share": {arm: row["accepted_preparation_reuse_share"]
                                               for arm, row in views.items()},
            "accepted_built_version_return_share": {arm: row["accepted_built_version_return_share"]
                                                    for arm, row in views.items()},
            "current_source_and_oc_version_count": {
                arm: row["accepted_versions_with_current_source_and_oc"]
                for arm, row in views.items()},
            "cost_scope_complete": all(row["original_pattern_cost_scope_complete"]
                                       for row in views.values()),
        })
    timing = []
    for label, rate, fee in (("late_positive_to_negative", "8.00", "350.00"),
                             ("late_zero_to_negative", "8.00", "331.00"),
                             ("late_positive_to_zero", "8.00", "390.00"),
                             ("zero_reuse_rate", "0.00", "350.00"),
                             ("equal_build_reuse_rate", "60.00", "350.00")):
        report = observe_pattern_change_timing(reuse_rate=rate, third_fee=fee, cap="500.00")
        timing.append({
            "trial": label,
            "accepted_effective_preparation_counts": {
                arm: row["accepted_effective_preparation_count"]
                for arm, row in report["views"].items()},
            "non_effective_preparation_counts": {
                arm: row["non_effective_preparations_on_accepted_works"]
                for arm, row in report["views"].items()},
            "operator_model_contribution_direction": {
                arm: row["contribution_direction"] for arm, row in report["services"].items()},
            "extra_applied_preparation_cost_direction": direction(
                report["costs"]["LATE"]["other_applied_preparation_cost"]),
            "same_original_commit_accept_capacity_and_cash": True,
        })
    payload = json.dumps({
        "schema": "AKIS_ORIGINAL_PREPARATION_PATTERN_REVISION_EVIDENCE/1.1",
        "engine": "MESA_3_5_2",
        "observations": observations,
        "matched_source_change_timing": timing,
        "no_automatic_owner_decision": True,
        "private_owner_values_and_sources_excluded": True,
        "empirical_organizational_capital_value": "NOT_IDENTIFIABLE",
        "full_author_experience_return_ratio": "NOT_IDENTIFIED",
    }, sort_keys=True, indent=2, allow_nan=False) + "\n"
    assert all(word not in payload for word in ("model://", "local_research_only", "source_ref"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_preparation_pattern_revision_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_pattern_revision()
    print(f"AKIS_ORIGINAL_PREPARATION_PATTERN_REVISION_SHA256={digest}")
    print(f"AKIS_ORIGINAL_PREPARATION_PATTERN_REVISION_JSON={path}")
