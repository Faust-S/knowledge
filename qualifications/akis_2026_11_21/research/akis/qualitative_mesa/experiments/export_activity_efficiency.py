"""Deterministic redacted observation of original AKIS activity economics."""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.tests.test_r3_r4_original_multi_order_portfolio_mesa import (
    finance_portfolio, compare_portfolios, installment_portfolio,
)


def direction(value):
    exact = Decimal(value)
    return "POSITIVE" if exact > 0 else "NEGATIVE" if exact < 0 else "ZERO"


def export_activity_efficiency():
    cases = []
    for label, kwargs in (
        ("capacity_overlap", {}),
        ("capacity_nonoverlap", {"disjoint": True, "seller_opening": "800.00"}),
        ("increased_material_cost", {"outside_material": "260.00"}),
        ("insufficient_recipient_value", {"outside_observed": "2"}),
    ):
        result = compare_portfolios(finance_portfolio(**kwargs))
        assert result["status"] == "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS", result
        view = result["local_research_only"]["activity_efficiency"]
        effect = view["pairwise"][0]
        cases.append({
            "trial": label,
            "observed_accepted_work_count_change": effect["left_minus_right_accepted_work_count"],
            "observed_cost_value_and_contribution_directions": {
                key: direction(value) for key, value in effect["left_minus_right_consolidated"].items()},
            "resource_cost_nature_directions": {
                key: direction(value)
                for key, value in effect["left_minus_right_exclusive_resource_cost_by_nature"].items()},
            "no_route_search_ranking_or_owner_decision": view["no_route_search_ranking_or_owner_decision"],
        })
    old = compare_portfolios(installment_portfolio(scheduled=False))
    new = compare_portfolios(installment_portfolio())
    a, b = (r["local_research_only"]["activity_efficiency"]["arms"]["coproduction"]
            for r in (old, new))
    assert a == b
    manifest = {
        "schema": "AKIS_ORIGINAL_ACTIVITY_EFFICIENCY_EVIDENCE/1.0",
        "engine": "MESA_3_5_2",
        "matched_observations": cases,
        "independent_payment_timing_example": {
            "same_declared_cost_value_and_economic_contribution": a == b,
            "original_reserve_scope_met_before": old["local_research_only"]["arms"][
                "coproduction"]["all_owner_declared_reserves_met"],
            "original_reserve_scope_met_after": new["local_research_only"]["arms"][
                "coproduction"]["all_owner_declared_reserves_met"],
        },
        "observations_not_market_search_or_recommendation": True,
        "private_owner_values_identifiers_and_source_documents_excluded": True,
        "internal_transfers_are_not_system_output": True,
        "accounting_profit_and_real_productivity": "NOT_IDENTIFIABLE",
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    assert all(word not in payload for word in ("model://", "local_research_only", "source_ref", "opening_cash"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_activity_efficiency_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_activity_efficiency()
    print(f"AKIS_ORIGINAL_ACTIVITY_EFFICIENCY_SHA256={digest}")
    print(f"AKIS_ORIGINAL_ACTIVITY_EFFICIENCY_JSON={path}")
