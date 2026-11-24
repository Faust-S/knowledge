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
        fourth_period_finance_case,
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
    complete_fourth = []
    for label, doc in sorted({
        "fourth_original_finance": fourth_period_finance_case(),
        "early_review_and_later_cost_shock": fourth_period_finance_case(early=True, material="520.00"),
        "missing_opening_owner_position": fourth_period_finance_case(missing_opening=True),
        "independent_pause_without_fourth_money": fourth_period_finance_case(pause=True),
        "stale_review_and_independent_pause": fourth_period_finance_case(pause=True, stale=True),
    }.items()):
        out = simulate(doc)
        rows = third_period_reviews(out)
        eco = out["economics"]
        complete_fourth.append({
            "trial": label,
            "original_accepted_work_count": sum(row["result"] == ACCEPTED for row in out["works"].values()),
            "original_transfer_count": eco["transfers_count"],
            "original_resource_use_count": eco["resource_uses_count"],
            "source_qualified_accepted_portfolio_forecast_review_count": sum(
                row["evaluation_portfolio_forecast_scope_status"] ==
                "MODEL_ORIGINAL_ACCEPTED_PORTFOLIO_FORECAST_SCOPE_QUALIFIED" for row in rows),
            "source_claimed_full_transfer_count": eco["work_payment_causality"]["settlement_progress"]["source_claimed_full_transfer_count"],
            "actual_bank_balance_at_review_verified": False,
            "future_work_financial_information_used_for_prior_review": False,
        })
    manifest = {
        "schema": "AKIS_R1P_R3_CUMULATIVE_EXECUTED_ROUTE_ECONOMICS/1.2",
        "engine": "MESA_3_5_2",
        "matched_route_experiments": results,
        "fourth_period_original_feedback_experiments": fourth,
        "unqualified_measurement_experiments": negative_capacity,
        "external_execution_and_independent_reentry_experiments": reentry,
        "four_period_original_financial_scope_and_prior_portfolio_forecast_experiments": complete_fourth,
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



def export_preparation_mode_economics():
    from research.akis.qualitative_mesa.comparative_trajectories import compare_original_preparation_modes
    from research.akis.qualitative_mesa.tests.test_s0_s1_s2_original_preparation_economics_mesa import (
        preparation_modes, adaptive_preparation_modes, diagnostic_profile, preparation_pattern_routes,
        operator_service_route,
    )
    from research.akis.qualitative_mesa.comparative_trajectories import compare_original_preparation_pattern_reuse
    cases = {
        "ordinary_rates": preparation_modes(),
        "agent_cost_equal_to_digital": preparation_modes(agent_fill="3.00", agent_overhead="18.00"),
        "expensive_agent": preparation_modes(agent_fill="8.00"),
        "adaptive_owner_choice": adaptive_preparation_modes(),
        "risk_reverses_low_direct_agent_cost": preparation_modes(
            profiles={key: diagnostic_profile(agent_base="0.60", error_loss="400.00")
                      for key in ("w1", "w2", "w3")}),
    }
    rows = []
    for label, docs in sorted(cases.items()):
        report = compare_original_preparation_modes(docs)
        local = report.pop("local_research_only")
        item = {
            "trial": label,
            "status": report["status"],
            "same_original_works_results_consents_and_cash": report["same_original_works_results_consents_and_cash"],
            "modes": {mode: {
                "accepted_original_work_count": row["accepted_original_work_count"],
                "applied_original_customer_reviews": row["applied_original_customer_reviews"],
                "modeled_activity_units": row["modeled_activity_units"],
                "economically_minimizing_owner_selection_count": row["economically_minimizing_owner_selection_count"],
                "original_diagnostic_review_count": row["original_diagnostic_review_count"],
            } for mode, row in local["modes"].items()},
            "S1_minus_S2_declared_preparation_cost_direction": direction(local["S1_minus_S2_preparation_cost"]),
            "best_fixed_minus_adaptive_declared_expected_cost_direction": (
                direction(local["best_fixed_minus_adaptive_expected_cost"])
                if "best_fixed_minus_adaptive_expected_cost" in local else "UNKNOWN"),
            "full_S0_S1_S2_organizational_experiment": False,
            "empirical_network_additionality": "NOT_IDENTIFIABLE",
        }
        rows.append(item)
    indexed = {row["trial"]: row for row in rows}
    assert indexed["ordinary_rates"]["S1_minus_S2_declared_preparation_cost_direction"] == "POSITIVE"
    assert indexed["agent_cost_equal_to_digital"]["S1_minus_S2_declared_preparation_cost_direction"] == "ZERO"
    assert indexed["expensive_agent"]["S1_minus_S2_declared_preparation_cost_direction"] == "NEGATIVE"
    assert indexed["adaptive_owner_choice"]["best_fixed_minus_adaptive_declared_expected_cost_direction"] == "POSITIVE"
    patterns = []
    for rate, expected in (("8.00", "POSITIVE"), ("60.00", "ZERO"), ("80.00", "NEGATIVE")):
        result = compare_original_preparation_pattern_reuse(preparation_pattern_routes(reuse_rate=rate))
        local = result.pop("local_research_only")
        observed = direction(local["rebuild_minus_reuse_declared_preparation_cost"])
        assert observed == expected
        patterns.append({
            "trial": "reuse_cost_" + expected.lower(),
            "rebuild_minus_reuse_direction": observed,
            "original_build_count": local["arms"]["REUSE"]["original_pattern_build_count"],
            "original_reuse_count": local["arms"]["REUSE"]["original_pattern_reuse_count"],
            "original_work_count": local["arms"]["REUSE"]["accepted_original_work_count"],
            "same_original_human_validation_units": (
                local["arms"]["REUSE"]["human_validation_units"] == local["arms"]["REBUILD"]["human_validation_units"]),
            "full_author_experience_return_ratio_proven": False,
        })
    from research.akis.qualitative_mesa.mesa_model import simulate
    services = []
    for label, doc in sorted({
        "manual_above_payer_cap": operator_service_route("S0"),
        "digital_above_payer_cap": operator_service_route("S1"),
        "agent_negative_at_current_fee": operator_service_route(),
        "agent_break_even": operator_service_route(cap="273.00", third_fee="203.00"),
        "agent_positive_within_declared_cap": operator_service_route(third_fee="230.00"),
        "agent_positive_above_declared_cap": operator_service_route(cap="270.00", third_fee="230.00"),
        "rebuild_above_cap": operator_service_route(cap="380.00", pattern="REBUILD"),
        "reuse_opens_fee_envelope": operator_service_route(cap="380.00", pattern="REUSE"),
    }.items()):
        view = simulate(doc)["economics"]["original_operator_service_economics"]
        view.pop("local_research_only")
        services.append({"trial": label, **view})
    manifest = {
        "schema": "AKIS_S0_S1_S2_ORIGINAL_PREPARATION_ECONOMICS/1.2",
        "engine": "MESA_3_5_2", "experiments": rows,
        "structural_pattern_reuse_experiments": patterns,
        "original_operator_service_fee_envelope_experiments": services,
        "actual_time_error_probabilities_and_money_not_empirically_observed": True,
        "private_amounts_and_source_references_excluded": True,
        "no_second_ledger_or_scheduler": True,
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False,
                         indent=2, allow_nan=False) + "\n"
    assert "model://" not in payload and "local_research_only" not in payload
    path = Path(__file__).resolve().parent / "s0_s1_s2_original_preparation_economics_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_executed_route_economics()
    print(f"AKIS_R2_EXECUTED_ROUTE_ECONOMICS_SHA256={digest}")
    print(f"AKIS_R2_EXECUTED_ROUTE_ECONOMICS_JSON={path}")
    path, digest = export_multiperiod_route_economics()
    print(f"AKIS_R1P_R3_MULTIPERIOD_ECONOMICS_SHA256={digest}")
    print(f"AKIS_R1P_R3_MULTIPERIOD_ECONOMICS_JSON={path}")
    path, digest = export_preparation_mode_economics()
    print(f"AKIS_S0_S1_S2_PREPARATION_ECONOMICS_SHA256={digest}")
    print(f"AKIS_S0_S1_S2_PREPARATION_ECONOMICS_JSON={path}")
