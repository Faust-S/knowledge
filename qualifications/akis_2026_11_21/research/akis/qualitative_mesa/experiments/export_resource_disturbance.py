"""Deterministic model observations of an original active resource interruption."""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r3_r4_original_multi_order_portfolio_mesa import resource_disturbance_portfolio
from research.akis.qualitative_mesa.experiments.export_activity_efficiency import direction


def view(doc):
    out = simulate(doc)
    report = out["economics"]["original_portfolio_economics"]
    assert report["status"] == "MODEL_ORIGINAL_MULTI_ORDER_PORTFOLIO_ECONOMICS", report
    return out, report["local_research_only"]["activity_efficiency"]


def export_resource_disturbance():
    _, before = view(resource_disturbance_portfolio(disturbed=False))
    trials = []
    for label, cost in (("declared_restoration_cost", "85.00"),
                        ("explicit_zero_cost", "0.00"), ("contribution_reversal", "1100.00")):
        out, after = view(resource_disturbance_portfolio(cost=cost))
        work = after["per_original_work"]["w3"]
        readiness = work["original_execution_readiness"]
        assert [r["reason"] for r in out["trace"] if r["outcome"] == "BLOCKED"] == ["RESOURCE_NOT_AVAILABLE"]
        trials.append({
            "trial": label,
            "accepted_original_work_count": after["accepted_original_work_count"],
            "same_declared_recipient_use_value": before["consolidated"]["gross_incremental_recipient_use_value"] ==
                after["consolidated"]["gross_incremental_recipient_use_value"],
            "same_original_reservations": before["reserved_capacity_unit_ticks_by_resource"] ==
                after["reserved_capacity_unit_ticks_by_resource"],
            "same_original_acceptance_elapsed_ticks": work["request_to_accept_model_ticks"] ==
                before["per_original_work"]["w3"]["request_to_accept_model_ticks"],
            "completion_blocked_until_original_resource_owner_restores_readiness": True,
            "original_not_ready_model_ticks": readiness["any_required_resource_not_ready_model_ticks"],
            "closed_interruptions": readiness["all_observed_readiness_interruptions_closed"],
            "contribution_after_direction": direction(after["consolidated"]["model_economic_contribution"]),
            "contribution_change_direction": direction(
                Decimal(after["consolidated"]["model_economic_contribution"]) -
                Decimal(before["consolidated"]["model_economic_contribution"])),
        })
    _, unknown = view(resource_disturbance_portfolio(declared=False))
    result = {
        "schema": "AKIS_ORIGINAL_RESOURCE_READINESS_DISTURBANCE_EVIDENCE/1.0",
        "engine": "MESA_3_5_2",
        "matched_controlled_observations": trials,
        "unreported_restoration_cost_is_not_zero_measurement": unknown["per_original_work"]["w3"][
            "separately_declared_resource_restoration_cost"] is None,
        "event_clock_not_physical_machine_time": True,
        "actual_scrap_wip_physical_rework_accounting_profit": "NOT_IDENTIFIABLE",
        "private_owner_values_and_sources_excluded": True,
    }
    payload = json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    assert all(word not in payload for word in ("model://", "local_research_only", "source_ref"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_resource_disturbance_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_resource_disturbance()
    print(f"AKIS_ORIGINAL_RESOURCE_DISTURBANCE_SHA256={digest}")
    print(f"AKIS_ORIGINAL_RESOURCE_DISTURBANCE_JSON={path}")
