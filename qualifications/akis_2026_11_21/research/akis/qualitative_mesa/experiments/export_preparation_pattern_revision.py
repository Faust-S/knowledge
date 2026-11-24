"""Redacted reproducible structural capital renewal in the original Mesa."""
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.comparative_trajectories import compare_original_preparation_pattern_reuse
from research.akis.qualitative_mesa.tests.test_original_preparation_pattern_revision_mesa import revision_routes
from research.akis.qualitative_mesa.experiments.export_activity_efficiency import direction


def export_pattern_revision():
    observations = []
    for mode, rate in (("S1", "8.00"), ("S2", "8.00"), ("S2", "60.00"), ("S2", "80.00")):
        report = compare_original_preparation_pattern_reuse(
            revision_routes(mode=mode, reuse_rate=rate))
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
        })
    payload = json.dumps({
        "schema": "AKIS_ORIGINAL_PREPARATION_PATTERN_REVISION_EVIDENCE/1.0",
        "engine": "MESA_3_5_2",
        "observations": observations,
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
