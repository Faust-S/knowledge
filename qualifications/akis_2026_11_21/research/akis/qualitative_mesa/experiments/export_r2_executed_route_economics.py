"""Redacted deterministic experiment for two independently executed routes.

Only directions, statuses and counts are exported. Local research reports
contain synthetic per-owner cash and source-scoped costs, not shared data.
"""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.tests.test_r2_executed_route_economics_mesa import (
    compare, paired_economics, OUTSIDE,
)


def direction(value):
    exact = Decimal(value)
    return "POSITIVE" if exact > 0 else "NEGATIVE" if exact < 0 else "ZERO"


def export_executed_route_economics():
    assert mesa.__version__ == "3.5.2"
    trials = {
        "supplier_cash_positive": paired_economics(cooperative_price="1200.00"),
        "supplier_cash_neutral": paired_economics(cooperative_price="1050.00"),
        "supplier_cash_negative": paired_economics(cooperative_price="900.00"),
        "outside_result_not_accepted": paired_economics(),
        "missing_cost_scope": paired_economics(),
        "missing_cost_anchor": paired_economics(),
    }
    d = trials["outside_result_not_accepted"]["outside"]
    d["events"] = [
        row for row in d["events"]
        if not (row.get("work") == OUTSIDE and row["action"] == "accept")
    ]
    for d in trials["missing_cost_scope"].values():
        del d["economic_claims"]["lifecycle_costs"]["scope_proofs"]["COOPERATION"]["b"]
    trials["missing_cost_anchor"]["outside"]["economic_claims"]["lifecycle_costs"][
        "event_bindings"].pop()
    reports = []
    for label, docs in sorted(trials.items()):
        report = compare(docs)
        private = report.pop("local_research_only")
        delta = private["boundary_and_cost_contrast"]
        owner_delta = private["original_owner_contrasts"]
        report["trial"] = label
        if delta is not None:
            report["declared_boundary_and_cost_directions"] = {
                key: direction(value) for key, value in sorted(delta.items())
            }
            report["supplier_declared_cash_direction"] = direction(
                owner_delta["a"]["cash_cooperation_minus_outside"])
            report["operator_reserve_risk_in_declared_late_case"] = (
                private["original_owner_projections"]["cooperation"]["op"][
                    "late_receipt_liquidity"]
                == "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
            )
        else:
            report["declared_boundary_and_cost_directions"] = None
            report["supplier_declared_cash_direction"] = "UNKNOWN"
        reports.append(report)
    by = {row["trial"]: row for row in reports}
    for label, expected in (
        ("supplier_cash_positive", "POSITIVE"),
        ("supplier_cash_neutral", "ZERO"),
        ("supplier_cash_negative", "NEGATIVE"),
    ):
        assert by[label]["supplier_declared_cash_direction"] == expected
    assert all(by[label]["declared_boundary_and_cost_directions"] is None
               for label in ("outside_result_not_accepted", "missing_cost_scope", "missing_cost_anchor"))
    manifest = {
        "schema": "AKIS_R2_EXECUTED_ROUTE_REDACTED_ECONOMICS/1.0",
        "engine": "MESA_3_5_2",
        "trials": reports,
        "private_owner_amounts_and_source_references_excluded": True,
        "no_cash_and_noncash_addition": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False,
                         indent=2, allow_nan=False) + "\n"
    assert "model://" not in payload
    assert "original_owner_contrasts" not in payload
    path = Path(__file__).resolve().parent / "r2_executed_route_economics_evidence.json"
    # Hash the actual portable artifact bytes, not an in-memory text surrogate.
    # Writing bytes also prevents Windows from translating LF into CRLF.
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()



def export_multiperiod_route_economics():
    """Same evaluator and model, now with common historical finance and R3 feedback."""
    from research.akis.qualitative_mesa.mesa_model import simulate
    from research.akis.qualitative_mesa.tests.test_r1p_r3_executed_route_economics_mesa import (
        compare as compare_periods, cumulative_routes, fourth_period_case,
        adverse_execution_cost_routes, delayed_receipt_routes,
        third_period_reviews, without_finance, outside_then_reenter_case, ACCEPTED,
    )

    trials = {
        "supplier_cash_positive": cumulative_routes(cooperative_price="1200.00"),
        "supplier_cash_neutral": cumulative_routes(cooperative_price="1050.00"),
        "supplier_cash_negative": cumulative_routes(cooperative_price="900.00"),
        "cost_shock_after_favourable_forecast": adverse_execution_cost_routes(),
        "outside_longer_original_execution": cumulative_routes(outside_extra_ticks=2),
        "prior_cost_and_late_receipt": delayed_receipt_routes(),
        "same_prior_cost_and_on_time_receipt": delayed_receipt_routes(on_time=True),
        "incomplete_selected_cost_anchor": cumulative_routes(),
    }
    life = trials["incomplete_selected_cost_anchor"]["cooperation"][
        "economic_claims"]["lifecycle_costs"]
    life["event_bindings"] = [
        row for row in life["event_bindings"]
        if row["resource_use_id"] != "cooperation-negotiation"
    ]
    results = []
    for label, docs in sorted(trials.items()):
        report = compare_periods(docs)
        private = report.pop("local_research_only")
        delta = private["boundary_and_cost_contrast"]
        report["trial"] = label
        report["declared_boundary_and_cost_directions"] = (
            {key: direction(value) for key, value in sorted(delta.items())}
            if delta is not None else None
        )
        report["supplier_declared_cash_direction"] = (
            direction(private["original_owner_contrasts"]["a"]["cash_cooperation_minus_outside"])
            if delta is not None else "UNKNOWN"
        )
        report["operator_declared_late_reserve_status"] = (
            private["original_owner_projections"]["cooperation"]["op"]["late_receipt_liquidity"]
            if delta is not None else "UNKNOWN"
        )
        results.append(report)
    indexed = {row["trial"]: row for row in results}
    for label, expected in (
        ("supplier_cash_positive", "POSITIVE"),
        ("supplier_cash_neutral", "ZERO"),
        ("supplier_cash_negative", "NEGATIVE"),
        ("cost_shock_after_favourable_forecast", "NEGATIVE"),
        ("incomplete_selected_cost_anchor", "UNKNOWN"),
    ):
        assert indexed[label]["supplier_declared_cash_direction"] == expected
    assert indexed["prior_cost_and_late_receipt"]["operator_declared_late_reserve_status"] == (
        "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    )
    assert indexed["same_prior_cost_and_on_time_receipt"]["operator_declared_late_reserve_status"] == (
        "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    )

    fourth = []
    for label, doc in sorted({
        "continue_after_independent_review": fourth_period_case(),
        "pause_after_independent_review": fourth_period_case(pause=True),
        "pause_after_cost_shock": fourth_period_case(pause=True, cost_shock=True),
        "review_before_later_payment_reports": fourth_period_case(early=True),
        "pause_with_stale_economic_basis": fourth_period_case(stale=True, pause=True),
    }.items()):
        out = simulate(doc)
        reviews = third_period_reviews(out)
        fourth.append({
            "trial": label,
            "prior_accepted_results": sum(
                out["works"][key]["result"] == ACCEPTED
                for key in ("w1", "w2", "w3")
            ),
            "source_qualified_independent_review_count": sum(
                row["evaluation_economic_basis_status"] ==
                "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
                for row in reviews
            ),
            "unknown_economic_basis_count": sum(
                row["evaluation_economic_basis_status"] == "UNKNOWN"
                for row in reviews
            ),
            "independent_future_participation_paused_count": sum(
                row["participation_value"] == "PAUSED_NEW_WORK" for row in reviews
            ),
            "fourth_original_result": out["works"].get("w4", {}).get("result", "NOT_CREATED"),
            "bank_payment_or_causal_gain_verified": False,
        })
    assert all(row["prior_accepted_results"] == 3 for row in fourth)
    assert all(
        row["fourth_original_result"] == (
            "NOT_CREATED" if row["trial"].startswith("pause") else ACCEPTED
        ) for row in fourth
    )
    negative_capacity = []
    for name, doc in sorted(cumulative_routes().items()):
        original = without_finance(doc)
        original["competence_reuse_evidence"][0]["subsequent_observation"]["value"] = "9.8000"
        out = simulate(original)
        adoption = next(row for row in out["trace"] if row["action"] == "adopt_capability")
        assert adoption["outcome"] == "BLOCKED"
        negative_capacity.append({
            "trial": name, "original_adoption_outcome": adoption["outcome"],
            "prior_accepted_results": sum(
                out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2")
            ),
            "third_original_result_accepted": any(
                out["works"].get(key, {}).get("result") == ACCEPTED
                for key in ("w3", OUTSIDE)
            ),
        })
    assert all(row["prior_accepted_results"] == 2 and not row["third_original_result_accepted"]
               for row in negative_capacity)
    reentry = []
    for label, doc in sorted({
        "return_after_own_outside_execution": outside_then_reenter_case(),
        "remain_paused_after_own_outside_execution": outside_then_reenter_case(stay_paused=True),
        "wrong_original_outside_result": outside_then_reenter_case(
            stay_paused=True, wrong_basis={"result_ref": "model://a/wrong-result"}),
        "stale_original_outside_revision": outside_then_reenter_case(
            stay_paused=True, wrong_basis={"source_revision": "stale"}),
    }.items()):
        out = simulate(doc)
        review = next(row for row in out["trace"]
                      if row.get("evaluation_economic_basis_kind") ==
                      "OWN_EXECUTED_OUTSIDE_ALTERNATIVE")
        item = {
            "trial": label,
            "prior_accepted_results": sum(
                out["works"][key]["result"] == ACCEPTED
                for key in ("w1", "w2", OUTSIDE)
            ),
            "outside_basis_scope_status": review["evaluation_economic_basis_status"],
            "independent_future_participation": review["participation_value"],
            "fourth_original_result": out["works"].get("w4", {}).get("result", "NOT_CREATED"),
            "cooperative_third_obligation_accepted": (
                out["works"]["w3"]["obligation"] != "NOT_ACCEPTED"),
            "outside_buyer_replaces_original_cooperative_principal": False,
            "empirical_additionality_verified": False,
        }
        assert item["prior_accepted_results"] == 3
        assert not item["cooperative_third_obligation_accepted"]
        assert item["fourth_original_result"] == (
            ACCEPTED if label.startswith("return") else "NOT_CREATED")
        assert item["outside_basis_scope_status"] == (
            "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
            if label.startswith(("return", "remain")) else "UNKNOWN")
        reentry.append(item)
    manifest = {
        "schema": "AKIS_R1P_R3_CUMULATIVE_EXECUTED_ROUTE_ECONOMICS/1.1",
        "engine": "MESA_3_5_2",
        "matched_route_experiments": results,
        "fourth_period_original_feedback_experiments": fourth,
        "unqualified_measurement_experiments": negative_capacity,
        "external_execution_and_independent_reentry_experiments": reentry,
        "private_owner_amounts_and_source_references_excluded": True,
        "independent_owner_review_is_not_automatic_consent": True,
        "no_cumulative_ledger_created_outside_original_model": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False,
                         indent=2, allow_nan=False) + "\n"
    assert "model://" not in payload
    assert "original_owner_contrasts" not in payload
    assert "local_research_only" not in payload
    path = Path(__file__).resolve().parent / "r1p_r3_multiperiod_route_economics_evidence.json"
    # Hash the actual portable artifact bytes, not an in-memory text surrogate.
    # Writing bytes also prevents Windows from translating LF into CRLF.
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_executed_route_economics()
    print(f"AKIS_R2_EXECUTED_ROUTE_ECONOMICS_SHA256={digest}")
    print(f"AKIS_R2_EXECUTED_ROUTE_ECONOMICS_JSON={path}")
    path, digest = export_multiperiod_route_economics()
    print(f"AKIS_R1P_R3_MULTIPERIOD_ECONOMICS_SHA256={digest}")
    print(f"AKIS_R1P_R3_MULTIPERIOD_ECONOMICS_JSON={path}")
