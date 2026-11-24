"""Live organizational capital observation in the original Mesa clock.

No replay of a final snapshot into an earlier state; no new scheduler or
original cost record. The independently accepted Results and the existing
ContextBasis govern the observed version stock.
"""
from copy import deepcopy
from decimal import Decimal
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate, OperatorAKISModel
from research.akis.qualitative_mesa.process_preparation import (
    summarize_original_pattern_evolution,
)
from .test_original_preparation_pattern_revision_mesa import (
    ACCEPTED, SOURCE, event, pattern_source, preparation_pattern_routes,
    revision_routes, recovery_after_pattern_change, without_costs,
    structural_view,
)


def live_points(out):
    return [
        (int(row["at"]), row["original_trace_position"], observation)
        for row in out["general_akis_model"]["read_only_evolution"]
        if (observation := row["projection"]["author_operator_reproducibility"].get(
            "structural_preparation_scope")) is not None
    ]


def at_tick(out, tick):
    return next((pos, v) for at, pos, v in live_points(out) if at == tick)


def time_view(out):
    return out["general_akis_model"]["author_operator_reproducibility"][
        "structural_preparation_model_time"]


def expiry_route(*, revise=False):
    doc = without_costs((revision_routes() if revise else preparation_pattern_routes())["REUSE"])
    expiry = max(row["at"] for row in doc["events"]) + 5
    pattern_source(doc)["valid_until"] = expiry
    doc["model_horizon"] = expiry + 10
    return doc, expiry


@pytest.mark.parametrize("revise", [False, True])
def test_live_observation_uses_actual_acceptance_and_expiry_without_new_work(revise):
    doc, expiry = expiry_route(revise=revise)
    original = deepcopy(doc)
    out = simulate(doc)
    assert doc == original
    assert out["counts"]["blocked"] == 0
    assert all(out["works"][w]["result"] == ACCEPTED for w in ("w1", "w2", "w3"))
    before = event(doc, "function_prepare", "w1")["at"]
    a1 = event(doc, "accept", "w1")["at"]
    a2 = event(doc, "accept", "w2")["at"]
    a3 = event(doc, "accept", "w3")["at"]
    _, prep = at_tick(out, before)
    assert prep["applied_preparation_count"] == 1
    assert prep["distinct_accepted_pattern_versions"] == 0
    assert prep["accepted_preparation_reuse_share"] == "UNKNOWN_ZERO_DENOMINATOR"
    _, first = at_tick(out, a1)
    assert first["distinct_accepted_pattern_versions"] == 1
    assert first["accepted_versions_with_current_source_and_oc"] == 1
    assert first["distinct_versions_returned_to_accepted_work"] == 0
    _, second = at_tick(out, a2)
    assert second["distinct_accepted_pattern_versions"] == (2 if revise else 1)
    assert second["distinct_versions_returned_to_accepted_work"] == (0 if revise else 1)
    _, third = at_tick(out, a3)
    assert third["distinct_versions_returned_to_accepted_work"] == 1
    position, expired = at_tick(out, expiry + 1)
    assert position == len(out["trace"])
    assert expired["distinct_accepted_pattern_versions"] == (2 if revise else 1)
    assert expired["accepted_versions_with_current_source_and_oc"] == 0
    assert expired["distinct_versions_returned_to_accepted_work"] == 1
    assert not any(row["at"] == expiry + 1 for row in out["trace"])
    assert structural_view(out)["accepted_versions_not_currently_qualified"] == (2 if revise else 1)
    assert out == simulate(deepcopy(doc))

    for tick, pos, observation in live_points(out):
        prefix = out["trace"][:pos]
        assert all(row["at"] <= tick for row in prefix)
        assert observation["applied_preparation_count"] == sum(
            row.get("action") == "function_prepare" and row.get("outcome") == "APPLIED"
            and "model_preparation_pattern" in row for row in prefix)
        assert observation["accepted_effective_preparation_count"] == sum(
            row.get("action") == "accept" and row.get("outcome") == "APPLIED"
            for row in prefix)
        assert observation["cost_status"] == "NOT_EVALUATED_AT_THIS_OBSERVATION"
        assert "original_pattern_cost_scope_complete" not in observation
        assert "original_cost_record_count" not in observation
        assert "model://" not in json.dumps(observation)


@pytest.mark.parametrize("revise", [False, True])
def test_version_time_integrates_actual_count_changes_on_original_clock(revise):
    doc, expiry = expiry_route(revise=revise)
    out = simulate(doc)
    time = time_view(out)
    a1 = event(doc, "accept", "w1")["at"]
    a2 = event(doc, "accept", "w2")["at"]
    a3 = event(doc, "accept", "w3")["at"]
    h = doc["model_horizon"]
    accepted = h-a1
    current = expiry+1-a1
    returned = h-a2
    gap = h-expiry-1
    if revise:
        change = next(row["at"] for row in doc["events"]
                      if row["action"] == "source_update" and row["source"] == SOURCE)
        accepted += h-a2
        current = change-a1 + expiry+1-a2
        returned = h-a3
        gap += a2-change
        _, stale = at_tick(out, change)
        assert stale["distinct_accepted_pattern_versions"] == 1
        assert stale["accepted_versions_with_current_source_and_oc"] == 0
        # Preparing a new version is not its acceptance.
        _, pending = at_tick(out, event(doc, "function_prepare", "w2")["at"])
        assert pending["distinct_accepted_pattern_versions"] == 1
        assert pending["accepted_versions_with_current_source_and_oc"] == 0
    assert time["model_horizon_tick"] == h
    assert time["accepted_version_model_ticks"] == accepted
    assert time["current_accepted_version_model_ticks"] == current
    assert time["returned_version_model_ticks"] == returned
    assert time["not_current_accepted_version_model_ticks"] == accepted-current
    assert time["model_ticks_with_accepted_history_but_no_current_version"] == gap
    assert time["time_weighted_current_accepted_version_share"] == (
        f"{Decimal(current)/Decimal(accepted):.4f}")
    assert time["new_original_events_or_cost_rows_created"] == 0
    assert not time["actual_time_and_costs_measured"]


def test_same_revision_source_update_invalidates_at_exact_observed_tick():
    doc, expiry = expiry_route()
    last = max(row["at"] for row in doc["events"])
    at = last+1
    # Legacy sources may be updated with the same revision; the existing
    # pattern contract invalidates intervening owner updates even then.
    doc["events"].append({"at": at, "action": "source_update", "actor": "op",
                          "source": SOURCE, "status": "CONFIRMED",
                          "expected_revision": "pattern-v1", "new_revision": "pattern-v1"})
    doc["events"].append({"at": at+1, "action": "source_update", "actor": "op",
                          "source": SOURCE, "status": "UNKNOWN",
                          "expected_revision": "pattern-v1"})
    doc["events"].append({"at": at+2, "action": "source_update", "actor": "op",
                          "source": SOURCE, "status": "CONFIRMED",
                          "expected_revision": "pattern-v1"})
    out = simulate(doc)
    updates = [r for r in out["trace"] if r["action"] == "source_update"
               and r.get("source") == SOURCE]
    assert len(updates) == 3 and all(r["outcome"] == "APPLIED" for r in updates)
    pos, observed = at_tick(out, at)
    assert out["trace"][pos-1]["at"] == at
    assert observed["accepted_versions_with_current_source_and_oc"] == 0
    assert observed["distinct_accepted_pattern_versions"] == 1
    assert observed["distinct_versions_returned_to_accepted_work"] == 1
    assert structural_view(out)["accepted_versions_with_current_source_and_oc"] == 0
    assert all(v["accepted_versions_with_current_source_and_oc"] == 0
               for t, _, v in live_points(out) if t >= at)
    assert time_view(out)["model_ticks_with_accepted_history_but_no_current_version"] == (
        doc["model_horizon"]-at)


def test_live_prefix_does_not_depend_on_future_cost_rate_or_source_change():
    a = preparation_pattern_routes(reuse_rate="8.00")["REUSE"]
    b = revision_routes(reuse_rate="80.00")["REUSE"]
    cutoff = event(a, "accept", "w1")["at"]
    oa, ob = simulate(a), simulate(b)
    assert [v for v in live_points(oa) if v[0] <= cutoff] == [
        v for v in live_points(ob) if v[0] <= cutoff]
    assert oa["economics"]["original_pattern_reproduction_costs"] != (
        ob["economics"]["original_pattern_reproduction_costs"])
    assert all("total_original_pattern_preparation_cost" not in v
               for _, _, v in live_points(ob))


def test_replacement_has_two_applied_packets_but_one_effective_accepted_packet():
    doc = recovery_after_pattern_change()
    out = simulate(doc)
    preparations = [r for r in doc["events"] if r.get("work") == "w3"
                    and r["action"] == "function_prepare"]
    _, first = at_tick(out, preparations[0]["at"])
    _, second = at_tick(out, preparations[1]["at"])
    _, accepted = at_tick(out, event(doc, "accept", "w3")["at"])
    assert first["applied_preparation_count"] == 3
    assert second["applied_preparation_count"] == 4
    assert first["accepted_effective_preparation_count"] == second["accepted_effective_preparation_count"] == 2
    assert accepted["accepted_effective_preparation_count"] == 3
    assert accepted["non_effective_preparations_on_accepted_works"] == 1
    assert out["economics"]["original_pattern_reproduction_costs"]["other_applied_preparation_cost"] == "59.00"


def test_no_accepted_version_time_before_first_acceptance_is_unknown_not_zero():
    doc = without_costs(preparation_pattern_routes()["REUSE"])
    review = event(doc, "function_review", "w1")
    review["human_decision"] = "REJECT"
    model = OperatorAKISModel(doc)
    model.run_until(float(review["at"])+0.5)
    time = summarize_original_pattern_evolution(model.general_views, horizon=review["at"])
    assert time["accepted_version_model_ticks"] == 0
    assert time["current_accepted_version_model_ticks"] == 0
    assert time["time_weighted_current_accepted_version_share"] == "UNKNOWN_ZERO_DENOMINATOR"


def test_expiry_beyond_horizon_does_not_extend_original_clock():
    doc, expiry = expiry_route()
    doc["model_horizon"] = expiry
    out = simulate(doc)
    assert all(t <= expiry for t, _, _ in live_points(out))
    assert structural_view(out)["accepted_versions_with_current_source_and_oc"] == 1
    assert time_view(out)["model_horizon_tick"] == expiry
    assert time_view(out)["model_ticks_with_accepted_history_but_no_current_version"] == 0
