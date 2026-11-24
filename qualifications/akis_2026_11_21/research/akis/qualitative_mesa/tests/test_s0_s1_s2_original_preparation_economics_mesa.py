"""Costed matched S0/S1/S2 preparation, within the same original Mesa.

A field-operation task model, not a measured human/LLM productivity trial.
The same original three accepted Works, four-core source gates, independent
human reviews, original economic ledger and owner-scoped sources are used.
"""
from copy import deepcopy
from decimal import Decimal

import pytest

from research.akis.qualitative_mesa.comparative_trajectories import (
    compare_original_preparation_modes, TrajectoryComparisonError,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_r1p_r3_executed_route_economics_mesa import cumulative_routes


MODES = ("S0", "S1", "S2")


def preparation_modes(*, agent_fill="1.00", agent_overhead="12.00",
                      profiles=None, adaptive_modes=None):
    """Declare common unit rates, independently calculate each original row."""
    template = cumulative_routes()["cooperation"]
    rates = {
        "S0": {"human_entry": "5.00", "program_fill": "1.00",
               "human_validation": "2.00", "packet_overhead": "0.00"},
        "S1": {"human_entry": "5.00", "program_fill": "1.00",
               "human_validation": "2.00", "packet_overhead": "8.00"},
        "S2": {"human_entry": "5.00", "program_fill": agent_fill,
               "human_validation": "2.00", "packet_overhead": agent_overhead},
    }
    # Independent control calculation for this fixture: four header fields,
    # five current state fields, two fields for each of the two principals.
    fields = 4 + 5 + 2 * 2
    docs = {}
    arms = (*MODES, "ADAPTIVE") if adaptive_modes is not None else MODES
    for mode in arms:
        doc = deepcopy(template)
        money = doc["economic_claims"]
        life = money["lifecycle_costs"]
        life["preparation_activity_bindings"] = []
        for event in doc["events"]:
            if event["action"] == "function_prepare":
                work = event["work"]
                event["preparation_mode"] = adaptive_modes[work] if mode == "ADAPTIVE" else mode
                if profiles is not None:
                    event["preparation_diagnostic"] = deepcopy(profiles[work])
        for work, rid in (("w1", "w1-coordination"), ("w2", "w2-coordination"),
                          ("w3", "cooperation-coordination")):
            pos, event = next((i, e) for i, e in enumerate(doc["events"])
                              if e["action"] == "function_prepare" and e.get("work") == work)
            assert event["actor"] == "op"
            cost_row = next(row for row in money["resource_uses"] if row["id"] == rid)
            binding = next(row for row in life["event_bindings"] if row["resource_use_id"] == rid)
            # Replace the EXISTING coordination cost; never add it again.
            binding.update(action="function_prepare", trace_position=pos, at=event["at"])
            selected = event["preparation_mode"]
            card = profiles[work]["unit_rates_by_mode"] if profiles is not None else rates
            fill = {"S0": 0, "S1": 4, "S2": fields}[selected]
            amounts = {"human_entry": fields - fill, "program_fill": fill,
                       "human_validation": fields, "packet_overhead": 1}
            cost_row["amount"] = f"{sum(Decimal(card[selected][key]) * value for key, value in amounts.items()):.2f}"
            life["preparation_activity_bindings"].append(
                {"resource_use_id": rid, "unit_rates_by_mode": deepcopy(card)})
        docs[mode] = doc
    return docs


def test_three_original_periods_costed_same_packet_all_original_decisions_remain():
    docs = preparation_modes()
    unchanged = deepcopy(docs)
    report = compare_original_preparation_modes(docs)
    assert docs == unchanged
    assert report["status"] == "MODEL_MATCHED_PREPARATION_ACTIVITY_COST_CONTRAST"
    local = report["local_research_only"]
    assert {key: row["declared_preparation_resource_cost"] for key, row in local["modes"].items()} == {
        "S0": "273.00", "S1": "249.00", "S2": "153.00"}
    assert local["S1_minus_S2_preparation_cost"] == "96.00"
    assert all(row["accepted_original_work_count"] == row["applied_original_customer_reviews"] == 3
               for row in local["modes"].values())
    assert all(row["modeled_activity_units"]["human_validation"] == 39
               for row in local["modes"].values())
    assert local["modes"]["S2"]["modeled_activity_units"]["program_fill"] == 39
    assert report["same_original_works_results_consents_and_cash"]
    assert not report["full_S0_S1_S2_organizational_experiment"]
    assert report["profit"] == "UNKNOWN"
    assert report == compare_original_preparation_modes(deepcopy(docs))


@pytest.mark.parametrize("fill,overhead,expected", [
    ("3.00", "18.00", "0.00"), ("8.00", "12.00", "-177.00"),
])
def test_agent_cost_can_erase_or_reverse_advantage(fill, overhead, expected):
    report = compare_original_preparation_modes(
        preparation_modes(agent_fill=fill, agent_overhead=overhead))
    assert report["local_research_only"]["S1_minus_S2_preparation_cost"] == expected


def test_cost_amount_must_equal_current_original_packet_activity():
    doc = preparation_modes()["S2"]
    next(row for row in doc["economic_claims"]["resource_uses"]
         if row["id"] == "cooperation-coordination")["amount"] = "0.00"
    with pytest.raises(InputError, match="PREPARATION_ACTIVITY_COST_AMOUNT_MISMATCH"):
        simulate(doc)


def test_missing_original_activity_cost_does_not_become_zero():
    doc = preparation_modes()["S2"]
    doc["economic_claims"]["lifecycle_costs"]["preparation_activity_bindings"].pop()
    with pytest.raises(InputError, match="PREPARATION_ACTIVITY_APPLIED_SCOPE_INCOMPLETE"):
        simulate(doc)


def test_no_double_attribution_of_one_original_preparation_cost():
    doc = preparation_modes()["S2"]
    bindings = doc["economic_claims"]["lifecycle_costs"]["preparation_activity_bindings"]
    bindings.append(deepcopy(bindings[0]))
    with pytest.raises(InputError, match="PREPARATION_ACTIVITY_COST_ROW_DUPLICATE"):
        simulate(doc)


def test_comparison_must_hold_original_cash_fixed():
    docs = preparation_modes()
    docs["S2"]["economic_claims"]["transfers"][0]["amount"] = "800.00"
    with pytest.raises(TrajectoryComparisonError, match="ORIGINAL_BASELINE_CHANGED"):
        compare_original_preparation_modes(docs)


def test_comparison_must_hold_full_unit_rate_card_fixed():
    docs = preparation_modes()
    docs["S2"]["economic_claims"]["lifecycle_costs"]["preparation_activity_bindings"][0][
        "unit_rates_by_mode"]["S0"]["human_entry"] = "4.00"
    with pytest.raises(TrajectoryComparisonError, match="ORIGINAL_BASELINE_CHANGED"):
        compare_original_preparation_modes(docs)


@pytest.mark.parametrize("mode", ["AUTO", None, 3])
def test_mode_is_not_a_new_authority_or_unqualified_event(mode):
    doc = preparation_modes()["S2"]
    next(event for event in doc["events"] if event["action"] == "function_prepare")[
        "preparation_mode"] = mode
    with pytest.raises(InputError, match="PREPARATION_MODE_REQUIRES_ORIGINAL_PREPARE_ACTION"):
        simulate(doc)


def test_mode_cannot_remove_independent_review_or_fabricate_preparation():
    doc = preparation_modes()["S2"]
    doc.pop("economic_claims")
    doc.pop("strict_economic_source_works")
    event = next(event for event in doc["events"] if event["action"] == "function_review"
                 and event.get("work") == "w3")
    event["human_decision"] = "REJECT"
    out = simulate(doc)
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["result"] == out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def diagnostic_profile(*, agent_fill="1.00", digital_overhead="8.00", agent_base="0.10",
                       error_loss="100.00", observed="0.90", critical=False):
    return {
        "source_ref": "model://op/route-terms", "source_revision": "finance-v1",
        "maturity_scores": [{"weight": "0.5", "score": "4"},
                            {"weight": "0.5", "score": "4"}],
        "context_scores": [{"weight": "1", "score": "4"}],
        "debt_observations": [{"weight": "1", "formal": "1", "observed": observed}],
        "frequency": "0.8", "connectivity": "0.8", "error_price_norm": "0.5",
        "complexity": "1", "error_loss": error_loss,
        "thresholds": {"maturity_min": "0.6", "context_min": "0.6",
                       "debt_max": "0.3", "risk_max": "0.10"},
        "critical_prohibition": critical,
        "unit_rates_by_mode": {
            "S0": {"human_entry": "5.00", "program_fill": "1.00",
                   "human_validation": "2.00", "packet_overhead": "0.00"},
            "S1": {"human_entry": "5.00", "program_fill": "1.00",
                   "human_validation": "2.00", "packet_overhead": digital_overhead},
            "S2": {"human_entry": "5.00", "program_fill": agent_fill,
                   "human_validation": "2.00", "packet_overhead": "12.00"},
        },
        "mode_risk": {
            "S0": {"declared_error_probability": "0.02"},
            "S1": {"declared_error_probability": "0.02"},
            "S2": {"base_error_probability": agent_base, "autonomy_factor": "1",
                   "autonomy": "0.5"},
        },
    }


def adaptive_preparation_modes():
    profiles = {
        "w1": diagnostic_profile(agent_fill="8.00"),
        "w2": diagnostic_profile(),
        "w3": diagnostic_profile(agent_fill="8.00", digital_overhead="20.00"),
    }
    return preparation_modes(profiles=profiles,
                             adaptive_modes={"w1": "S1", "w2": "S2", "w3": "S0"})


def test_original_independent_adaptive_mode_selection_beats_every_fixed_preparation_mode():
    docs = adaptive_preparation_modes()
    report = compare_original_preparation_modes(docs)
    local = report["local_research_only"]
    expected = {key: row["source_reviewed_risk_adjusted_expected_cost"]
                for key, row in local["modes"].items()}
    assert expected == {"S0": "279.00", "S1": "267.00", "S2": "341.60", "ADAPTIVE": "231.20"}
    assert local["best_fixed_mode_by_declared_expected_cost"] == "S1"
    assert local["best_fixed_minus_adaptive_expected_cost"] == "35.80"
    adaptive = local["modes"]["ADAPTIVE"]
    assert adaptive["economically_minimizing_owner_selection_count"] == 3
    assert adaptive["selected_modes_by_original_work"] == {"w1": "S1", "w2": "S2", "w3": "S0"}
    assert adaptive["applied_original_customer_reviews"] == 3
    assert adaptive["declared_preparation_resource_cost"] == "225.00"
    assert report["profit"] == "UNKNOWN"


def test_risk_adjustment_reverses_low_direct_agent_cost_without_automatic_selection():
    profile = diagnostic_profile(agent_base="0.60", error_loss="400.00")
    docs = preparation_modes(profiles={work: profile for work in ("w1", "w2", "w3")})
    report = compare_original_preparation_modes(docs)
    assert report["local_research_only"]["S1_minus_S2_preparation_cost"] == "96.00"
    out = simulate(docs["S2"])
    choices = [row["model_preparation_economic_choice"] for row in out["trace"]
               if "model_preparation_economic_choice" in row]
    assert len(choices) == 3
    assert all(row["recommended_mode"] == "S1" and row["selected_mode"] == "S2"
               and row["S2_admissible"] and row["no_automatic_original_consent"] for row in choices)
    assert all(out["works"][key]["obligation"] == "FULFILLED" for key in ("w1", "w2", "w3"))


@pytest.mark.parametrize("profile,reason", [
    (diagnostic_profile(observed="0.20"), "PROCESS_DEBT_ABOVE_OWNER_THRESHOLD"),
    (diagnostic_profile(critical=True), "ORIGINAL_DECLARED_CRITICAL_PROHIBITION"),
])
def test_cheap_agent_cannot_compensate_original_declared_critical_diagnostic(profile, reason):
    # Exercise the refusal on the third Work. Earlier accepted Works and
    # their original competence measurement remain available to the model.
    profiles = {"w1": diagnostic_profile(), "w2": diagnostic_profile(), "w3": profile}
    doc = preparation_modes(profiles=profiles)["S1"]
    out = simulate(doc)
    choices = [row["model_preparation_economic_choice"] for row in out["trace"]
               if "model_preparation_economic_choice" in row]
    assert len(choices) == 3
    assert all(row["S2_admissible"] for row in choices[:2])
    assert not choices[-1]["S2_admissible"]
    assert reason in choices[-1]["S2_ineligibility_reasons"]
    assert choices[-1]["recommended_mode"] in {"S0", "S1"}
    denied = preparation_modes(profiles=profiles)["S2"]
    denied.pop("economic_claims")
    denied.pop("strict_economic_source_works")
    out = simulate(denied)
    assert any(row["reason"] == "PREPARATION_DIAGNOSTIC_SELECTED_MODE_NOT_ADMISSIBLE"
               for row in out["trace"])
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert all(out["works"][key]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for key in ("w1", "w2"))


def test_economic_recommendation_requires_current_own_kpb_not_just_low_cost():
    doc = adaptive_preparation_modes()["ADAPTIVE"]
    doc.pop("economic_claims")
    doc.pop("strict_economic_source_works")
    last = next(row for row in doc["events"]
                if row["action"] == "function_prepare" and row.get("work") == "w3")
    last["preparation_diagnostic"]["source_revision"] = "stale"
    out = simulate(doc)
    assert any(row["reason"] == "PREPARATION_DIAGNOSTIC_ORIGINAL_SOURCE_NOT_QUALIFIED"
               for row in out["trace"])
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert all(out["works"][key]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for key in ("w1", "w2"))


def test_rate_card_cannot_be_replaced_after_original_diagnostic_review():
    doc = adaptive_preparation_modes()["ADAPTIVE"]
    doc["economic_claims"]["lifecycle_costs"]["preparation_activity_bindings"][0][
        "unit_rates_by_mode"]["S0"]["human_entry"] = "4.00"
    with pytest.raises(InputError, match="RATE_SOURCE_DIFFERS_FROM_ORIGINAL_REVIEW"):
        simulate(doc)


def test_author_risk_equations_are_exact_and_probability_is_bounded():
    from research.akis.qualitative_mesa.process_preparation import evaluate_preparation_diagnostic
    profile = diagnostic_profile()
    activity = {"original_header_field_count": 4, "original_current_field_count": 9}
    out = evaluate_preparation_diagnostic(profile, activity)
    assert out["maturity"] == Decimal("0.8")
    assert out["context_readiness"] == Decimal("0.8")
    assert out["process_debt"] == Decimal("0.1")
    assert out["modes"]["S2"]["modeled_error_probability"] == Decimal("0.022")
    assert out["modes"]["S2"]["digital_amplification_score"] == Decimal("0.016")
    assert out["modes"]["S2"]["risk_adjusted_expected_cost"] == Decimal("53.20")
    profile["mode_risk"]["S2"].update(base_error_probability="1", autonomy_factor="10")
    profile["complexity"] = "10"
    out = evaluate_preparation_diagnostic(profile, activity)
    assert out["modes"]["S2"]["modeled_error_probability"] == 1
    assert out["modes"]["S2"]["probability_saturated_at_one"]


def test_unknown_and_non_normalized_diagnostic_weights_are_not_filled_with_zero():
    from research.akis.qualitative_mesa.process_preparation import evaluate_preparation_diagnostic
    profile = diagnostic_profile()
    profile["maturity_scores"][0]["weight"] = "0"
    with pytest.raises(ValueError, match="WEIGHTS_MUST_SUM_TO_ONE"):
        evaluate_preparation_diagnostic(profile, {"original_header_field_count": 4,
                                                  "original_current_field_count": 9})


def preparation_pattern_routes(*, reuse_rate="8.00"):
    """Same operator, three original Works; build/reuse costs are reconciled."""
    template = preparation_modes()["S2"]
    source_ref = "model://op/structural-preparation-pattern"
    template["context_evidence"]["sources"].append({
        "id": source_ref, "owner": "op", "revision": "pattern-v1",
        "status": "CONFIRMED", "usable_by": ["op"], "core": "operator",
        "purposes": ["competence-reuse"], "operations": ["DERIVE"],
        "valid_from": 0, "valid_until": 160,
    })
    docs = {}
    for arm in ("REBUILD", "REUSE"):
        doc = deepcopy(template)
        life = doc["economic_claims"]["lifecycle_costs"]
        last = None
        for work, rid in (("w1", "w1-coordination"), ("w2", "w2-coordination"),
                          ("w3", "cooperation-coordination")):
            event = next(row for row in doc["events"] if row["action"] == "function_prepare"
                         and row.get("work") == work)
            pattern = {
                "operation": "BUILD", "pattern_id": f"template-{work}",
                "source_ref": source_ref, "source_revision": "pattern-v1",
            }
            if arm == "REUSE" and last is not None:
                pattern.update(operation="REUSE", pattern_id="template-w1",
                               prior_work=last["work"], prior_prepare_at=last["prepare_at"],
                               prior_result_ref=last["result_ref"], prior_accepted_at=last["accepted_at"])
            event["preparation_pattern"] = pattern
            last = {
                "work": work, "prepare_at": event["at"],
                "result_ref": next(row["result_ref"] for row in doc["events"]
                                   if row["action"] == "complete" and row.get("work") == work),
                "accepted_at": next(row["at"] for row in doc["events"]
                                    if row["action"] == "accept" and row.get("work") == work),
            }
            cost_row = next(row for row in doc["economic_claims"]["resource_uses"] if row["id"] == rid)
            binding = next(row for row in life["preparation_activity_bindings"]
                           if row["resource_use_id"] == rid)
            for mode, card in binding["unit_rates_by_mode"].items():
                card.update(pattern_build="60.00", pattern_reuse=reuse_rate)
            cost_row["amount"] = f"{Decimal(cost_row['amount']) + (Decimal('60') if pattern['operation'] == 'BUILD' else Decimal(reuse_rate)):.2f}"
        docs[arm] = doc
    return docs


@pytest.mark.parametrize("rate,expected", [
    ("8.00", "104.00"), ("60.00", "0.00"), ("80.00", "-40.00"),
])
def test_structural_operator_capital_only_saves_cost_with_qualified_actual_reuse(rate, expected):
    from research.akis.qualitative_mesa.comparative_trajectories import compare_original_preparation_pattern_reuse
    report = compare_original_preparation_pattern_reuse(preparation_pattern_routes(reuse_rate=rate))
    local = report["local_research_only"]
    assert local["rebuild_minus_reuse_declared_preparation_cost"] == expected
    assert local["arms"]["REUSE"]["original_pattern_build_count"] == 1
    assert local["arms"]["REUSE"]["original_pattern_reuse_count"] == 2
    assert local["arms"]["REUSE"]["original_pattern_distinct_reused_count"] == 1
    assert local["arms"]["REUSE"]["scoped_reuse_ratio"] == "0.6667"
    assert local["arms"]["REBUILD"]["human_validation_units"] == local["arms"]["REUSE"]["human_validation_units"] == 39
    assert report["profit"] == "UNKNOWN"


@pytest.mark.parametrize("field,value,reason", [
    ("source_revision", "stale", "PREPARATION_PATTERN_CURRENT_SOURCE_NOT_QUALIFIED"),
    ("source_ref", "model://b/other-pattern", "PREPARATION_PATTERN_OWN_SOURCE_REQUIRED"),
    ("prior_result_ref", "model://fake", "PREPARATION_PATTERN_PRIOR_ACCEPTED_RESULT_REQUIRED"),
    ("prior_accepted_at", 999, "PREPARATION_PATTERN_PRIOR_ACCEPTED_RESULT_REQUIRED"),
    ("pattern_id", "unbuilt-pattern", "PREPARATION_PATTERN_ORIGINAL_REUSE_CHAIN_NOT_QUALIFIED"),
])
def test_pattern_does_not_reuse_unqualified_sources_or_history(field, value, reason):
    doc = preparation_pattern_routes()["REUSE"]
    doc.pop("economic_claims")
    doc.pop("strict_economic_source_works")
    event = next(row for row in doc["events"] if row["action"] == "function_prepare" and row.get("work") == "w3")
    event["preparation_pattern"][field] = value
    out = simulate(doc)
    assert any(row["reason"] == reason for row in out["trace"])
    assert all(out["works"][key]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT" for key in ("w1", "w2"))
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"


def test_reuse_still_rechecks_independent_current_customer_decision():
    doc = preparation_pattern_routes()["REUSE"]
    doc.pop("economic_claims")
    doc.pop("strict_economic_source_works")
    review = next(row for row in doc["events"] if row["action"] == "function_review" and row.get("work") == "w3")
    review["human_decision"] = "REJECT"
    out = simulate(doc)
    assert any(row.get("model_preparation_pattern", {}).get("operation") == "REUSE"
               and row.get("work") == "w3" for row in out["trace"])
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"


def test_reuse_cost_cannot_hide_pattern_maintenance_in_previous_period():
    doc = preparation_pattern_routes()["REUSE"]
    row = next(row for row in doc["economic_claims"]["resource_uses"] if row["id"] == "w2-coordination")
    row["amount"] = "51.00"
    with pytest.raises(InputError, match="PREPARATION_ACTIVITY_COST_AMOUNT_MISMATCH"):
        simulate(doc)


def operator_service_route(mode="S2", *, cap="300.00", third_fee="150.00", pattern=None):
    """One original service portfolio; independently held scope and fee budget."""
    doc = (preparation_pattern_routes()[pattern] if pattern else preparation_modes()[mode])
    money = doc["economic_claims"]
    for owner, suffix, core in (("op", "nonoverlap", "operator"), ("a", "fee-cap", "corporate")):
        ref = f"model://{owner}/service-{suffix}"
        key = f"service-{suffix}"
        doc["context_evidence"]["sources"].append({
            "id": ref, "owner": owner, "revision": "v1", "status": "CONFIRMED",
            "usable_by": [owner], "core": core, "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
            "operations": ["READ"], "valid_from": 0, "valid_until": 160,
        })
        money["sources"].append({"id": key, "owner": owner, "reference": ref, "revision": "v1"})
    next(row for row in money["transfers"] if row["id"] == "operator-fee")["amount"] = third_fee
    money["operator_service_economics"] = {
        "owner": "op", "source": "service-nonoverlap",
        "fee_transfer_ids": ["w1-fee", "w2-fee", "operator-fee"],
        "cash_cost_transfer_ids": ["w1-overhead", "w2-overhead", "operator-cash-cost"],
        "exclusive_resource_use_ids": [
            "w1-coordination", "w2-coordination", "cooperation-coordination", "cooperation-shared"],
        "payer_fee_limits": [{"owner": "a", "source": "service-fee-cap", "maximum_total_fee": cap}],
    }
    return doc


@pytest.mark.parametrize("mode,break_even,contribution,envelope", [
    ("S0", "393.00", "-173.00", "DECLARED_CAPS_CANNOT_COVER_COST"),
    ("S1", "369.00", "-149.00", "DECLARED_CAPS_CANNOT_COVER_COST"),
    ("S2", "273.00", "-53.00", "POSITIVE_CONTRIBUTION_POSSIBLE_WITHIN_DECLARED_CAPS_ONLY"),
])
def test_original_operator_fee_break_even_respects_full_cost_and_independent_cap(
        mode, break_even, contribution, envelope):
    doc = operator_service_route(mode)
    frozen = deepcopy(doc)
    result = simulate(doc)
    assert doc == frozen
    view = result["economics"]["original_operator_service_economics"]
    local = view["local_research_only"]
    assert local["original_declared_cash_net"] == "125.00"
    assert local["break_even_total_fee"] == break_even
    assert local["model_service_contribution"] == contribution
    assert view["declared_fee_envelope_status"] == envelope
    assert result["economics"]["profit"] == "UNKNOWN"
    assert result["economics"]["resource_costs_additive_to_cash"] is False


@pytest.mark.parametrize("fee,cap,contribution,envelope,respects", [
    ("203.00", "273.00", "0.00", "BREAK_EVEN_ONLY_WITHIN_DECLARED_CAPS", True),
    ("230.00", "300.00", "27.00", "POSITIVE_CONTRIBUTION_POSSIBLE_WITHIN_DECLARED_CAPS_ONLY", True),
    ("230.00", "270.00", "27.00", "DECLARED_CAPS_CANNOT_COVER_COST", False),
])
def test_original_operator_positive_contribution_is_not_automatic_payer_advantage(
        fee, cap, contribution, envelope, respects):
    result = simulate(operator_service_route(cap=cap, third_fee=fee))
    view = result["economics"]["original_operator_service_economics"]
    assert view["local_research_only"]["model_service_contribution"] == contribution
    assert view["declared_fee_envelope_status"] == envelope
    assert view["current_fee_respects_all_declared_caps"] is respects
    assert view["fee_ceiling_does_not_prove_payer_advantage_or_agreement"]
    assert view["alternative_fee_timing_and_liquidity_not_simulated"]
    assert view["real_profit_and_causal_additionality"] == "NOT_IDENTIFIABLE"


def test_operator_capital_reuse_can_open_a_previously_empty_service_fee_envelope():
    rebuild = simulate(operator_service_route(cap="380.00", pattern="REBUILD"))[
        "economics"]["original_operator_service_economics"]
    reuse = simulate(operator_service_route(cap="380.00", pattern="REUSE"))[
        "economics"]["original_operator_service_economics"]
    assert rebuild["local_research_only"]["break_even_total_fee"] == "453.00"
    assert reuse["local_research_only"]["break_even_total_fee"] == "349.00"
    assert rebuild["declared_fee_envelope_status"] == "DECLARED_CAPS_CANNOT_COVER_COST"
    assert reuse["declared_fee_envelope_status"] == "POSITIVE_CONTRIBUTION_POSSIBLE_WITHIN_DECLARED_CAPS_ONLY"


@pytest.mark.parametrize("field,key,error", [
    ("cash_cost_transfer_ids", "w1-overhead", "FULL_DISJOINT_ORIGINAL_COST_SCOPE"),
    ("exclusive_resource_use_ids", "cooperation-shared", "FULL_DISJOINT_ORIGINAL_COST_SCOPE"),
    ("fee_transfer_ids", "w2-fee", "FULL_DISJOINT_ORIGINAL_COST_SCOPE"),
])
def test_operator_cannot_manufacture_margin_by_removing_original_rows(field, key, error):
    doc = operator_service_route()
    doc["economic_claims"]["operator_service_economics"][field].remove(key)
    with pytest.raises(InputError, match=error):
        simulate(doc)


def test_operator_cannot_supply_the_independent_payer_fee_ceiling():
    doc = operator_service_route()
    doc["economic_claims"]["operator_service_economics"]["payer_fee_limits"][0]["source"] = "service-nonoverlap"
    with pytest.raises(InputError, match="SOURCE_OWNER_NOT_PARTY"):
        simulate(doc)


def test_operator_service_costs_require_explicit_separate_nonoverlap_source():
    doc = operator_service_route()
    doc["economic_claims"]["operator_service_economics"]["source"] = "terms-op"
    with pytest.raises(InputError, match="SEPARATE_COST_NONOVERLAP_SOURCE"):
        simulate(doc)


def test_operator_service_scope_requires_original_timed_cost_anchors():
    doc = operator_service_route()
    life = doc["economic_claims"]["lifecycle_costs"]
    life["event_bindings"] = [row for row in life["event_bindings"]
                              if row["resource_use_id"] != "cooperation-shared"]
    with pytest.raises(InputError, match="ORIGINAL_COST_ANCHORS"):
        simulate(doc)


def test_operator_service_source_is_not_a_new_agreement_or_payment():
    doc = operator_service_route()
    original = deepcopy(doc)
    original["economic_claims"].pop("operator_service_economics")
    reviewed = simulate(doc)
    baseline = simulate(original)
    for key in ("works", "trace"):
        assert reviewed[key] == baseline[key]
    for key in ("per_subject", "cash_timing", "work_payment_causality"):
        assert reviewed["economics"][key] == baseline["economics"][key]


def test_operator_service_projection_cannot_bypass_strict_context():
    doc = operator_service_route()
    doc.pop("strict_economic_source_works")
    with pytest.raises(InputError, match="STRICT_MULTIPERIOD_ORIGINAL_SCOPE"):
        simulate(doc)
