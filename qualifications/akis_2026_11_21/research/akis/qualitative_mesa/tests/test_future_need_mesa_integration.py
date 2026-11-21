"""AKIS M1.3: source-owned needs before an order and coupled network constraints.

All cases are synthetic research evidence. Mesa confirms behavior, not field
validation or original owner consent.
"""
from __future__ import annotations

from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.future_needs import (
    FutureNeedInputError, parse_future_needs, future_need_projection,
)
from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from .test_rules import fixture


def future(owner="b", ident="n2", work_id="w2", start=1, end=12,
           slot_start=20, slot_end=30, resource="ra", prereq=None):
    return {
        "id": ident,
        "owner": owner,
        "source_ref": f"model://{owner}/future-{ident}",
        "source_revision": f"need-{ident}-1",
        "org_revision": "oc-1",
        "available_at": start, "expires_at": end,
        "work_spec": {
            "id": work_id, "customer": owner, "resource": resource,
            "source_revision": f"spec-{work_id}-1",
            "slot_start": slot_start, "slot_end": slot_end,
        },
        "requires_accepted_results": prereq or [],
    }


def setup(*, units=1, avail=True):
    scenario = fixture()
    if units is not None:
        scenario["resources"][0]["capacity_units"] = units
        scenario["resources"][0]["capacity_unit"] = "research_staff"
    if avail:
        scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["events"] = []
    return scenario


def test_independent_owner_claim_precedes_any_original_order():
    scenario = setup()
    state = QualitativeAKIS(scenario)
    signals = parse_future_needs([future()], state)
    assert "w2" not in state.works
    view = future_need_projection(state, signals, at=2)
    assert view["count"] == 1
    assert view["needs"][0]["status"] == "SOURCE_ACTIVE_FOR_RESEARCH"
    assert view["needs"][0]["original_work_request_confirmed"] is False
    assert state.trace == [] and state.capacity_ledger.reservations == []
    assert "w2" not in state.works
    assert view["original_work_created"] is False
    assert "source_ref" not in view["needs"][0]
    assert "goal" not in view["needs"][0]
    assert view["needs"][0]["transaction_cost_effect"] == "NOT_IDENTIFIABLE"


@pytest.mark.parametrize("bad,reason", [
    ({"owner": "a"}, "FUTURE_NEED_ORIGINAL_CUSTOMER_REQUIRED"),
    ({"owner": "missing"}, "FUTURE_NEED_OWNER_UNKNOWN"),
    ({"source_ref": "model://op/not-customer"}, "FUTURE_NEED_OWNER_SOURCE_REQUIRED"),
    ({"available_at": True}, "FUTURE_NEED_TIME_INVALID"),
    ({"expires_at": 1}, "FUTURE_NEED_TIME_INVALID"),
    ({"work_spec": {"id": "w2"}}, "FUTURE_NEED_WORK_SPEC_INVALID"),
    ({"requires_accepted_results": [{"work": "w2", "source_revision": "x"}]},
     "FUTURE_NEED_PREREQUISITE_MUST_BE_ORIGINAL_WORK"),
    ({"requires_accepted_results": [{"work": "unknown", "source_revision": "x"}]},
     "FUTURE_NEED_PREREQUISITE_MUST_BE_ORIGINAL_WORK"),
])
def test_invalid_owner_owned_future_need_rejected(bad, reason):
    claim = future()
    claim.update(bad)
    if bad.get("owner") == "a":
        claim["source_ref"] = "model://a/independent-owner-source"
    with pytest.raises(FutureNeedInputError, match=reason):
        parse_future_needs([claim], QualitativeAKIS(setup()))


def test_simultaneous_claims_for_same_work_must_not_be_assumed_compatible():
    one = future(start=1, end=5)
    two = future(ident="n3", start=4, end=8)
    with pytest.raises(FutureNeedInputError, match="OVERLAPPING_FUTURE_NEED_SOURCE"):
        parse_future_needs([one, two], QualitativeAKIS(setup()))


def test_future_need_cannot_silently_replace_existing_original_work():
    claim = future(work_id="w1")
    scenario = setup()
    with pytest.raises(FutureNeedInputError, match="FUTURE_NEED_DISAGREES_WITH_ORIGINAL_WORK"):
        parse_future_needs([claim], QualitativeAKIS(scenario))


def test_two_independently_declared_possible_works_conflict_only_when_declared_capacity_insufficient():
    claims = [future(), future(ident="n3", work_id="w3", slot_start=22, slot_end=26)]
    for units, expected in [(1, 2), (2, 0)]:
        state = QualitativeAKIS(setup(units=units))
        signals = parse_future_needs(claims, state)
        view = future_need_projection(state, signals, at=2)
        assert view["capacity_contested_count"] == expected
        assert all(row["status"] == ("FUTURE_NEED_REQUIRES_INDEPENDENT_CAPACITY_ALLOCATION_REVIEW"
                                     if expected else "SOURCE_ACTIVE_FOR_RESEARCH")
                   for row in view["needs"])
        assert state.capacity_ledger.reservations == []
        assert len(state.works) == 1


def test_missing_source_declared_capacity_never_turns_into_allocatable_resource():
    state = QualitativeAKIS(setup(units=None))
    signals = parse_future_needs([future()], state)
    assert future_need_projection(state, signals, at=2)["needs"][0]["status"] == (
        "FUTURE_NEED_CAPACITY_UNQUALIFIED"
    )


def test_unknown_resource_availability_blocks_only_future_need():
    scenario = setup()
    scenario["resources"][0]["availability"] = "UNKNOWN"
    state = QualitativeAKIS(scenario)
    signals = parse_future_needs([future()], state)
    assert future_need_projection(state, signals, at=2)["needs"][0]["status"] == (
        "FUTURE_NEED_RESOURCE_NOT_CURRENTLY_AVAILABLE"
    )


def test_independent_declined_original_customer_cannot_be_overridden_by_signal():
    scenario = setup()
    scenario["works"].append(deepcopy(future()["work_spec"]))
    state = QualitativeAKIS(scenario)
    signals = parse_future_needs([future()], state)
    choices = {"b": {"w2": {"action": "DECLINE_NEW_OPPORTUNITY"}}}
    assert future_need_projection(state, signals, at=2, actor_choices=choices)["needs"][0]["status"] == (
        "FUTURE_NEED_INDEPENDENT_OWNER_DECLINES"
    )


def test_explicit_original_result_gate_cannot_be_satisfied_by_completion_only():
    state = QualitativeAKIS(setup())
    claims = [future(prereq=[{"work": "w1", "source_revision": "d-1"}])]
    signals = parse_future_needs(claims, state)
    assert future_need_projection(state, signals, at=2)["needs"][0]["status"] == (
        "FUTURE_NEED_AWAIT_ORIGINAL_ACCEPTED_RESULT"
    )
    state.works["w1"].result = "SUBMITTED"
    assert future_need_projection(state, signals, at=2)["needs"][0]["status"] == (
        "FUTURE_NEED_AWAIT_ORIGINAL_ACCEPTED_RESULT"
    )
    state.works["w1"].result = "REJECTED"
    assert future_need_projection(state, signals, at=2)["needs"][0]["status"] == (
        "FUTURE_NEED_AWAIT_ORIGINAL_ACCEPTED_RESULT"
    )
    state.works["w1"].result = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert future_need_projection(state, signals, at=2)["needs"][0]["status"] == (
        "SOURCE_ACTIVE_FOR_RESEARCH"
    )


def test_native_mesa_preorder_owner_need_is_never_a_spontaneous_legal_request():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = setup()
    scenario["future_need_signals"] = [future()]
    scenario["model_horizon"] = 12
    output = simulate(scenario)
    assert output["counts"] == {"applied": 0, "blocked": 0}
    assert len(output["trace"]) == 0
    assert "w2" not in output["works"]
    evolve = output["future_need_dynamics"]["read_only_evolution"]
    assert [row["at"] for row in evolve] == [0.0, 1.0, 12.0]
    assert evolve[1]["projection"]["needs"][0]["status"] == "SOURCE_ACTIVE_FOR_RESEARCH"
    assert evolve[2]["projection"]["needs"][0]["status"] == "FUTURE_OWNER_NEED_SOURCE_EXPIRED"
    assert output["future_need_dynamics"]["no_automatic_original_request_or_contract"]
    assert output["future_need_dynamics"]["no_automatic_resource_reservation"]
    assert simulate(deepcopy(scenario)) == output


def test_native_mesa_prior_original_accepted_result_changes_later_need_without_creating_work():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = setup()
    scenario["future_need_signals"] = [
        future(prereq=[{"work": "w1", "source_revision": "d-1"}])
    ]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 4, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 5, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 6, "action": "start", "actor": "a", "work": "w1"},
        {"at": 7, "action": "complete", "actor": "a", "work": "w1",
         "result_ref": "model://w1-result"},
        {"at": 8, "action": "accept", "actor": "b", "work": "w1"},
    ]
    result = simulate(scenario)
    timeline = result["future_need_dynamics"]["read_only_evolution"]
    states = {row["at"]: row["projection"]["needs"][0]["status"] for row in timeline}
    assert states[1.0] == "FUTURE_NEED_AWAIT_ORIGINAL_ACCEPTED_RESULT"
    assert states[8.0] == "SOURCE_ACTIVE_FOR_RESEARCH"
    assert result["counts"] == {"applied": 8, "blocked": 0}
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "w2" not in result["works"]
    assert len(result["trace"]) == 8
    assert result["future_need_dynamics"]["single_existing_original_capacity_ledger"]


def test_native_mesa_original_customer_request_is_separate_from_need_signal():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = setup()
    claim = future()
    scenario["future_need_signals"] = [claim]
    scenario["events"] = [
        {"at": 2, "action": "request", "actor": "b",
         "work_spec": deepcopy(claim["work_spec"])}
    ]
    out = simulate(scenario)
    history = out["future_need_dynamics"]["read_only_evolution"]
    active = {row["at"]: row["projection"]["needs"][0] for row in history}
    assert active[1.0]["original_work_request_confirmed"] is False
    assert active[2.0]["original_work_request_confirmed"] is True
    assert out["works"]["w2"]["requested_at"] == 2
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
    assert out["counts"] == {"applied": 1, "blocked": 0}


def test_native_mesa_source_owner_availability_changes_future_capabilities():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = setup()
    scenario["future_need_signals"] = [future()]
    scenario["events"] = [
        {"at": 2, "action": "resource_status", "actor": "a",
         "resource": "ra", "availability": "UNAVAILABLE"},
        {"at": 3, "action": "resource_status", "actor": "a",
         "resource": "ra", "availability": "AVAILABLE"},
    ]
    out = simulate(scenario)
    states = {row["at"]: row["projection"]["needs"][0]["status"]
              for row in out["future_need_dynamics"]["read_only_evolution"]}
    assert states[2.0] == "FUTURE_NEED_RESOURCE_NOT_CURRENTLY_AVAILABLE"
    assert states[3.0] == "SOURCE_ACTIVE_FOR_RESEARCH"
    assert out["counts"] == {"applied": 2, "blocked": 0}
    assert "w2" not in out["works"]


def test_existing_accepted_capacity_is_not_appropriated_by_new_need():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = setup()
    scenario["future_need_signals"] = [future(slot_start=7, slot_end=11)]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 4, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 5, "action": "commit", "actor": "op", "work": "w1"},
    ]
    out = simulate(scenario)
    states = {row["at"]: row["projection"]["needs"][0]["status"]
              for row in out["future_need_dynamics"]["read_only_evolution"]}
    assert states[5.0] == "FUTURE_NEED_CONFLICTS_WITH_ACCEPTED_CAPACITY"
    assert out["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert "w2" not in out["works"]
    assert out["counts"] == {"applied": 5, "blocked": 0}


def test_native_mesa_customer_request_with_reused_id_but_changed_work_scope_is_not_same_need():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = setup()
    claim = future()
    scenario["future_need_signals"] = [claim]
    changed = deepcopy(claim["work_spec"])
    changed["slot_start"] = 21
    scenario["events"] = [
        {"at": 2, "action": "request", "actor": "b", "work_spec": changed}
    ]
    out = simulate(scenario)
    states = {row["at"]: row["projection"]["needs"][0]
              for row in out["future_need_dynamics"]["read_only_evolution"]}
    assert states[2.0]["status"] == "FUTURE_NEED_ORIGINAL_WORK_SCOPE_CHANGED"
    assert states[2.0]["original_work_request_confirmed"] is False
    assert out["counts"] == {"applied": 1, "blocked": 0}
    assert out["works"]["w2"]["requested_at"] == 2
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"


def test_native_mesa_source_declared_calendar_insufficiency_is_not_existing_contract():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = setup()
    scenario["resources"][0]["calendar"] = {
        "revision": "cal-1", "source": "model://a/calendar-1",
        "windows": [{"start": 20, "end": 30, "units": 0}],
    }
    scenario["future_need_signals"] = [future()]
    out = simulate(scenario)
    rows = out["future_need_dynamics"]["read_only_evolution"]
    status = rows[1]["projection"]["needs"][0]["status"]
    assert status == "FUTURE_NEED_SOURCE_DECLARED_CAPACITY_INSUFFICIENT"
    assert out["counts"] == {"applied": 0, "blocked": 0}
    assert "w2" not in out["works"]
    assert out["future_need_dynamics"]["no_automatic_resource_reservation"]


def test_native_mesa_goal_conflict_changes_original_customer_future_need_readiness():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = setup()
    scenario["endogenous_subjects"] = True
    claim = future(ident="n1", work_id="w1", slot_start=7, slot_end=11)
    claim["work_spec"]["source_revision"] = "d-1"
    scenario["future_need_signals"] = [claim]
    scenario["decision_profiles"] = [
        {"subject": p, "work": "w1", "source_revision": "d-1",
         "org_revision": "oc-1", "willingness": "WILLING",
         "outside_option": "UNKNOWN"} for p in ("a", "b")
    ]
    scenario["subject_goals"] = [{
        "owner": "b", "work": "w1", "work_source_revision": "d-1",
        "org_revision": "oc-1", "source_ref": "model://b/goal-conflict",
        "available_at": 2, "expires_at": 5,
        "objectives": {
            "economic_surplus": "COOPERATION_BETTER",
            "liquidity": "OUTSIDE_BETTER",
        },
    }]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    scenario["model_horizon"] = 5
    result = simulate(scenario)
    statuses = {row["at"]: row["projection"]["needs"][0]["status"]
                for row in result["future_need_dynamics"]["read_only_evolution"]}
    assert statuses[2.0] == "FUTURE_NEED_OWNER_GOAL_CONFLICT"
    assert result["works"]["w1"]["consenting_principals"] == []
    assert result["counts"] == {"applied": 2, "blocked": 0}
    assert result["future_need_dynamics"]["current"]["original_work_created"] is False
