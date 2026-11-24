"""Redacted original acceptance/recovery economic observations; no physical rework inference."""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.tests.test_r3_r4_original_multi_order_portfolio_mesa import (
    original_quality_recovery_portfolio, _observed_quality_efficiency, OUTSIDE,
)
from research.akis.qualitative_mesa.experiments.export_activity_efficiency import direction


def export_original_quality_recovery_economics():
    _, before = _observed_quality_efficiency(original_quality_recovery_portfolio(recovery=False))
    trials = []
    for label, seller, buyer in (("declared_correction_cost", "90.00", "20.00"),
                                 ("explicit_zero_cost", "0.00", "0.00"),
                                 ("contribution_reversal", "1000.00", "100.00")):
        _, after = _observed_quality_efficiency(
            original_quality_recovery_portfolio(seller_cost=seller, buyer_cost=buyer))
        a, b = before["consolidated"], after["consolidated"]
        work = after["per_original_work"][OUTSIDE]
        trials.append({
            "trial": label,
            "same_accepted_work_count": before["accepted_original_work_count"] == after["accepted_original_work_count"],
            "same_declared_use_value": a["gross_incremental_recipient_use_value"] == b["gross_incremental_recipient_use_value"],
            "model_contribution_after_recovery_direction": direction(b["model_economic_contribution"]),
            "model_contribution_change_direction": direction(
                Decimal(b["model_economic_contribution"])-Decimal(a["model_economic_contribution"])),
            "original_rejected_result_count": work["original_rejected_result_count"],
            "original_resubmission_count": work["original_resubmission_count"],
            "original_quality_assessment_count": work["original_quality_assessment_count"],
            "accepted_after_original_resubmission": work["accepted_after_result_resubmission"],
            "first_submission_to_accept_increased": work["first_submission_to_accept_model_ticks"] >
                before["per_original_work"][OUTSIDE]["first_submission_to_accept_model_ticks"],
            "resubmission_not_physical_rework": work["resubmission_does_not_establish_physical_rework"],
        })
    _, unknown = _observed_quality_efficiency(original_quality_recovery_portfolio(declare_cost=False))
    manifest = {
        "schema": "AKIS_ORIGINAL_QUALITY_RECOVERY_ECONOMICS_EVIDENCE/1.0",
        "engine": "MESA_3_5_2",
        "matched_observations": trials,
        "quality_failure_without_separate_cost_measurement_is_unknown": unknown["per_original_work"][OUTSIDE][
            "separately_measured_rework_resource_cost"] is None,
        "physical_rework_actual_costs_accounting_profit": "NOT_IDENTIFIABLE",
        "private_owner_values_identifiers_and_sources_excluded": True,
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    assert all(word not in payload for word in ("model://", "local_research_only", "source_ref"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_quality_recovery_economics_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_original_quality_recovery_economics()
    print(f"AKIS_ORIGINAL_QUALITY_RECOVERY_ECONOMICS_SHA256={digest}")
    print(f"AKIS_ORIGINAL_QUALITY_RECOVERY_ECONOMICS_JSON={path}")
