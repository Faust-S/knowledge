"""Deterministic owner-redacted evidence of competing routes on original Mesa.

No private monetary amounts, source references, buyer quotes, source IDs,
cash balances, or raw trace are exported.
"""
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r1t3_original_technology_route_mesa import (
    matched_competing_market_cases, compare_competing_market, competing_market_price,
    original_market_recipient_feedback_case, market_recipient_feedback_report,
)


def export_competing_market_economics():
    routes = []
    for label, kwargs in sorted({
        "baseline_coproduction": {},
        "own_finishing_more_expensive": {"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00"},
        "repriced_independent_offer": {"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00",
                                       "supplier_finish_price": "350.00"},
        "lower_observed_recipient_value": {"buyer_observed": "12"},
        "supplier_reserve_gap": {"c_opening": "200.00", "buyer_finish_material": "220.00",
                                 "buyer_finish_labor": "160.00"},
        "failed_recipient_quality": {"buyer_failed_quality": True},
    }.items()):
        r = compare_competing_market(matched_competing_market_cases(**kwargs))
        routes.append({
            "trial": label,
            "status": r["status"],
            "qualified_route_count": r["qualified_route_count"],
            "original_owner_count": r["original_owner_count"],
            "qualified_participant_viable_route_count": r.get("qualified_participant_viable_route_count", 0),
            "preferred_qualified_route_classes": r.get("best_model_contribution_among_executed_participant_viable_routes", []),
            "pairwise_contrasts": r.get("pairwise_contrasts", []),
            "independent_precommit_terms_qualified": bool(
                r.get("same_original_buyer_budget_and_precommit_commercial_terms_required")
                and r["status"] == "MODEL_MATCHED_EXECUTED_COMPETING_MARKET_ROUTES"),
        })
    indexed = {r["trial"]: r for r in routes}
    assert indexed["baseline_coproduction"]["preferred_qualified_route_classes"] == ["coproduction"]
    assert indexed["repriced_independent_offer"]["preferred_qualified_route_classes"] == ["supplier"]
    assert indexed["lower_observed_recipient_value"]["preferred_qualified_route_classes"] == ["supplier"]
    assert indexed["failed_recipient_quality"]["status"] == "UNKNOWN"

    price_cases = []
    for label, kwargs in sorted({
        "insufficient_combined_value": {},
        "value_interval": {"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00"},
        "budget_binds": {"buyer_finish_material": "260.00", "buyer_finish_labor": "180.00", "buyer_budget": "1200.00"},
        "buyer_reserve_binds": {"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00",
                               "buyer_opening": "1950.00"},
        "buyer_reserve_gap": {"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00",
                             "buyer_opening": "1850.00"},
        "supplier_pre_receipt_reserve_gap": {"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00",
                                            "c_opening": "200.00"},
        "no_qualified_commercial_budget": {"commercial": False},
    }.items()):
        r = competing_market_price(matched_competing_market_cases(**kwargs))
        view = r["fixed_timing_commercial_negotiation"]
        original, constrained = r.get("local_research_only", {}), view.get("local_research_only", {})
        qualified = view["status"] == "MODEL_VALUE_BUDGET_AND_RESERVE_PRICE_INTERVAL"
        price_cases.append({
            "trial": label,
            "contribution_interval_status": r["status"],
            "fixed_timing_commercial_interval_status": view["status"],
            "qualified_interval_upper_bound_tightened": (
                constrained["maximum_purchase_price"] != original["maximum_purchase_price"] if qualified else None),
            "fresh_independent_offer_and_consents_required": view["new_offer_and_fresh_consents_still_required"],
            "actual_financing_not_verified": view["actual_financing_not_verified"],
        })
    indexed = {r["trial"]: r for r in price_cases}
    assert indexed["budget_binds"]["qualified_interval_upper_bound_tightened"]
    assert indexed["buyer_reserve_binds"]["qualified_interval_upper_bound_tightened"]
    assert indexed["supplier_pre_receipt_reserve_gap"]["fixed_timing_commercial_interval_status"] == (
        "NO_PRICE_SATISFIES_ALL_OWNER_RESERVES_AT_FIXED_TIMING")
    assert indexed["no_qualified_commercial_budget"]["fixed_timing_commercial_interval_status"] == "UNKNOWN"

    feedback = []
    for label, kwargs in sorted({
        "favourable_continue": {},
        "favourable_pause": {"pause": True},
        "adverse_pause": {"observed": "6", "pause": True},
        "adverse_continue": {"observed": "6"},
        "same_tick_observation": {"early": True},
        "foreign_owner": {"wrong_owner": True},
        "stale_review_revision": {"stale": True},
    }.items()):
        out = simulate(original_market_recipient_feedback_case(**kwargs))
        row = market_recipient_feedback_report(out)
        assert "private_owner_model_contribution" not in row
        feedback.append({
            "trial": label,
            "recipient_value_asof_qualification_status": row["evaluation_recipient_value_scope_status"],
            "prior_original_result_preserved": out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT",
            "subsequent_original_result_accepted": out["works"].get("w4", {}).get("result") == "ACCEPTED_BY_ORIGINAL_RECIPIENT",
            "owner_decision_not_automatic": True,
        })
    indexed = {r["trial"]: r for r in feedback}
    assert indexed["favourable_continue"]["subsequent_original_result_accepted"]
    assert not indexed["favourable_pause"]["subsequent_original_result_accepted"]
    assert indexed["adverse_continue"]["subsequent_original_result_accepted"]
    assert all(indexed[k]["recipient_value_asof_qualification_status"] == "UNKNOWN"
               for k in ("same_tick_observation", "foreign_owner", "stale_review_revision"))
    manifest = {
        "schema": "AKIS_R3_COMPETING_MARKET_ECONOMICS/1.0",
        "engine": "MESA_3_5_2",
        "matched_competing_route_experiments": routes,
        "fixed_timing_commercial_price_experiments": price_cases,
        "asof_recipient_value_and_strategy_experiments": feedback,
        "private_amounts_sources_and_raw_trace_excluded": True,
        "one_original_work_result_capacity_context_and_ledger_per_trajectory": True,
        "real_demand_quality_costs_payment_utility_and_profit_not_verified": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False,
                         indent=2, allow_nan=False) + "\n"
    assert all(x not in payload for x in ("model://", "local_research_only", "private_owner_model_contribution",
                                         "buyer_maximum_payment", "opening_cash", "source_ref"))
    path = Path(__file__).resolve().parent / "r3_competing_market_economics_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_competing_market_economics()
    print(f"AKIS_R3_COMPETING_MARKET_ECONOMICS_SHA256={digest}")
    print(f"AKIS_R3_COMPETING_MARKET_ECONOMICS_JSON={path}")
