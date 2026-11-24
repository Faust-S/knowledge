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


def preparation_modes(*, agent_fill="1.00", agent_overhead="12.00"):
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
    for mode in MODES:
        doc = deepcopy(template)
        money = doc["economic_claims"]
        life = money["lifecycle_costs"]
        life["preparation_activity_bindings"] = []
        for event in doc["events"]:
            if event["action"] == "function_prepare":
                event["preparation_mode"] = mode
        for work, rid in (("w1", "w1-coordination"), ("w2", "w2-coordination"),
                          ("w3", "cooperation-coordination")):
            pos, event = next((i, e) for i, e in enumerate(doc["events"])
                              if e["action"] == "function_prepare" and e.get("work") == work)
            assert event["actor"] == "op"
            cost_row = next(row for row in money["resource_uses"] if row["id"] == rid)
            binding = next(row for row in life["event_bindings"] if row["resource_use_id"] == rid)
            # Replace the EXISTING coordination cost; never add it again.
            binding.update(action="function_prepare", trace_position=pos, at=event["at"])
            fill = {"S0": 0, "S1": 4, "S2": fields}[mode]
            amounts = {"human_entry": fields - fill, "program_fill": fill,
                       "human_validation": fields, "packet_overhead": 1}
            cost_row["amount"] = f"{sum(Decimal(rates[mode][key]) * value for key, value in amounts.items()):.2f}"
            life["preparation_activity_bindings"].append(
                {"resource_use_id": rid, "unit_rates_by_mode": deepcopy(rates)})
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
