"""Deterministic redacted evidence for two actual original orders in one horizon."""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.tests.test_r3_r4_original_multi_order_portfolio_mesa import (
    finance_portfolio, compare_portfolios,
)


def export_multi_order_portfolio():
    cases = []
    for label, kwargs in sorted({
        "overlapping_capacity": {},
        "independent_nonoverlapping_capacity": {"disjoint": True, "seller_opening": "800.00"},
        "independent_buyer_reserve_shortfall": {"outside_opening": "500.00"},
        "supplier_higher_input_cost": {"outside_material": "260.00"},
        "low_independent_use_value": {"outside_observed": "2"},
    }.items()):
        report = compare_portfolios(finance_portfolio(**kwargs))
        assert report["status"] == "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS", report
        private = report["local_research_only"]
        delta = Decimal(private["pairwise"][0]["left_minus_right_model_contribution"])
        owners = [Decimal(v) for v in private["pairwise"][0]["per_original_owner_left_minus_right"].values()]
        cases.append({
            "trial": label,
            "status": report["status"],
            "original_owner_count": report["original_owner_count"],
            "qualified_route_count": report["qualified_route_count"],
            "selected_portfolio_value_direction": "POSITIVE" if delta > 0 else "NEGATIVE" if delta < 0 else "ZERO",
            "owners_improved_count": sum(v > 0 for v in owners),
            "owners_unchanged_count": sum(v == 0 for v in owners),
            "owners_worsened_count": sum(v < 0 for v in owners),
            "coproduction_weak_pareto_improvement": report["pairwise_contrasts"][0]["left_weak_pareto_improvement_on_portfolio"],
            "accepted_orders": {k: v["accepted_original_order_count"] for k, v in private["arms"].items()},
            "cumulative_reserves_met": {k: v["all_owner_declared_reserves_met"] for k, v in private["arms"].items()},
            "preferred_viable_route_classes": report["best_model_contribution_among_executed_portfolio_viable_routes"],
            "same_original_secondary_demand_offer_response_and_preparation": report["same_original_secondary_demand_offer_response_and_preparation"],
        })
    indexed = {r["trial"]: r for r in cases}
    assert indexed["overlapping_capacity"]["coproduction_weak_pareto_improvement"]
    assert indexed["overlapping_capacity"]["accepted_orders"] == {"coproduction": 2, "supplier": 1}
    assert indexed["independent_nonoverlapping_capacity"]["accepted_orders"] == {"coproduction": 2, "supplier": 2}
    assert not indexed["independent_nonoverlapping_capacity"]["coproduction_weak_pareto_improvement"]
    assert indexed["independent_buyer_reserve_shortfall"]["preferred_viable_route_classes"] == []
    assert indexed["supplier_higher_input_cost"]["owners_worsened_count"] == 1
    assert indexed["low_independent_use_value"]["selected_portfolio_value_direction"] == "NEGATIVE"
    manifest = {
        "schema": "AKIS_R3_R4_ORIGINAL_MULTI_ORDER_PORTFOLIO/1.0",
        "engine": "MESA_3_5_2",
        "matched_portfolio_experiments": cases,
        "no_fictitious_lost_receipts_or_double_counted_opportunity_cost": True,
        "original_capacity_work_result_ledger_and_owner_scope_preserved": True,
        "private_amounts_sources_and_raw_trace_excluded": True,
        "real_costs_demand_value_and_causal_effect_not_verified": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    assert all(x not in payload for x in ("model://", "local_research_only", "opening_cash", "source_ref", "per_original_owner"))
    path = Path(__file__).resolve().parent / "r3_r4_multi_order_portfolio_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_multi_order_portfolio()
    print(f"AKIS_R3_R4_MULTI_ORDER_PORTFOLIO_SHA256={digest}")
    print(f"AKIS_R3_R4_MULTI_ORDER_PORTFOLIO_JSON={path}")
