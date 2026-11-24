"""Redacted, deterministic original preparation/context/risk economic observations."""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.comparative_trajectories import compare_original_preparation_pattern_reuse
from research.akis.qualitative_mesa.tests.test_s0_s1_s2_original_preparation_economics_mesa import (
    preparation_pattern_risk_routes, operator_service_route, simulate,
)
from research.akis.qualitative_mesa.experiments.export_activity_efficiency import direction


def export_preparation_context_risk():
    trials = []
    for mode, rate in (("S1", "8.00"), ("S2", "8.00"), ("S2", "60.00"), ("S2", "80.00")):
        local = compare_original_preparation_pattern_reuse(
            preparation_pattern_risk_routes(mode=mode, reuse_rate=rate))["local_research_only"]
        rows = local["arms"]
        trials.append({
            "original_mode": mode,
            "trial": {"8.00": "lower_reuse_cost", "60.00": "equal_cost", "80.00": "higher_reuse_cost"}[rate],
            "direct_cost_saving_direction": direction(local["rebuild_minus_reuse_declared_preparation_cost"]),
            "risk_adjusted_cost_saving_direction": direction(
                local["rebuild_minus_reuse_risk_adjusted_expected_cost"]),
            "unchanged_declared_risk": local["same_declared_error_risk_not_assumed_to_improve_from_reuse"],
            "expected_error_loss_not_posted": local["expected_error_loss_not_an_added_original_resource_cost"],
            "original_risk_review_counts": {arm: row["original_pattern_risk_review_count"] for arm, row in rows.items()},
            "human_validation_counts": {arm: row["human_validation_units"] for arm, row in rows.items()},
        })
    operator = []
    for mode, third_fee in (("S1", "380.00"), ("S2", "330.00")):
        rows = {}
        for arm in ("REBUILD", "REUSE"):
            out = simulate(operator_service_route(mode, cap="500.00", third_fee=third_fee,
                                                  pattern=arm, pattern_risk=True))
            rows[arm] = out["economics"]["original_operator_service_economics"]["local_research_only"]
        a, b = rows["REBUILD"], rows["REUSE"]
        assert a["original_fee_amount"] == b["original_fee_amount"]
        assert a["original_cash_cost"] == b["original_cash_cost"]
        operator.append({
            "original_mode": mode,
            "same_declared_fee_and_cash_cost": True,
            "original_operator_model_contribution_before": direction(a["model_service_contribution"]),
            "original_operator_model_contribution_after": direction(b["model_service_contribution"]),
            "original_operator_model_contribution_change": direction(
                Decimal(b["model_service_contribution"]) - Decimal(a["model_service_contribution"])),
        })
    manifest = {
        "schema": "AKIS_ORIGINAL_PREPARATION_CONTEXT_RISK_EVIDENCE/1.0",
        "engine": "MESA_3_5_2",
        "matched_preparation_observations": trials,
        "fixed_fee_original_operator_observations": operator,
        "no_mode_ranking_or_automatic_owner_decision": True,
        "private_owner_values_and_sources_excluded": True,
        "empirical_profit_and_realized_error_losses": "NOT_IDENTIFIABLE",
        "full_S0_S1_S2_organizational_experiment": False,
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    assert all(word not in payload for word in ("model://", "local_research_only", "source_ref"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_preparation_context_risk_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_preparation_context_risk()
    print(f"AKIS_ORIGINAL_PREPARATION_CONTEXT_RISK_SHA256={digest}")
    print(f"AKIS_ORIGINAL_PREPARATION_CONTEXT_RISK_JSON={path}")
