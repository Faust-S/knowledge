"""R1-I: original customer/resource-owner formation actions constrain new Work.

First three doctoral formation phases only; model acknowledgement is not a
legal signature or a claim of all eight phases completed. One original trace,
one original Work, one Mesa event scheduler, no synthetic automatic consent.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_general_system_mesa_integration import design
from .test_rules import fixture


def formation_case(*, with_confirmations=True, enable=True):
    scenario = fixture()
    work = scenario["works"].pop()
    work["slot_start"] = 12
    work["slot_end"] = 19
    scenario["resources"][0].update(
        availability="AVAILABLE", capacity_units=1, capacity_unit="UNIT"
    )
    general = design()
    general["enforce_model_formation_phases"] = enable
    general["goals"] = [{
        "owner": "b", "source_ref": "model://b/goal-w1",
        "revision": "oc-1", "available_at": 0, "expires_at": 30,
        "work": "w1", "work_revision": "d-1",
        "objective": "TRANSACTION_COST", "priority": 1,
    }]
    general["formation_phases"] = [
        {"phase": phase, "owner": owner,
         "source_ref": f"model://{owner}/formation-{phase}",
         "revision": "oc-1", "available_at": 0, "expires_at": 30}
        for phase, owner in ((1, "b"), (2, "b"), (3, "a"))
    ]
    scenario["general_akis"] = general
    events = [{"at": 1, "action": "request", "actor": "b", "work_spec": work}]
    if with_confirmations:
        events += [
            {"at": phase + 1, "action": "formation_confirm", "actor": owner,
             "work": "w1", "phase": phase, "org_revision": "oc-1",
             "formation_source_ref": f"model://{owner}/formation-{phase}"}
            for phase, owner in ((1, "b"), (2, "b"), (3, "a"))
        ]
    events += [
        {"at": 5, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 6, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 7, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 8, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 9, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 13, "action": "start", "actor": "a", "work": "w1"},
        {"at": 14, "action": "complete", "actor": "a", "work": "w1",
         "result_ref": "model://w1-result"},
        {"at": 15, "action": "accept", "actor": "b", "work": "w1"},
    ]
    scenario["events"] = events
    scenario["model_horizon"] = 20
    return scenario


def trace_for(result, action):
    return [row for row in result["trace"] if row["action"] == action]


def test_r1i_all_three_original_source_bound_stages_enable_only_original_commit():
    d = formation_case()
    before = deepcopy(d)
    out = simulate(d)
    assert d == before
    assert out["counts"] == {"applied": 12, "blocked": 0}
    assert out["works"]["w1"]["obligation"] == "FULFILLED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    confirmations = trace_for(out, "formation_confirm")
    assert [(x["phase"], x["actor"]) for x in confirmations] == [
        (1, "b"), (2, "b"), (3, "a")
    ]
    view = out["general_akis_model"]
    assert view["first_three_formation_model_gate"]["opted_in"] is True
    assert view["first_three_formation_model_gate"]["original_model_event_confirmations"] == 3
    assert [x["original_model_formation_confirmations"]
            for x in view["formation_phases"]][:3] == [1, 1, 1]
    assert all(x["actual_formation_phase_completed"] is False
               for x in view["formation_phases"])
    assert view["first_three_formation_model_gate"][
        "full_eight_author_formation_phases_completed"] is False
    assert view["legal_consent_created"] is False
    assert out == simulate(deepcopy(d))


def test_r1i_missing_original_phase_three_blocks_commit_without_undoing_consents():
    d = formation_case(with_confirmations=False)
    out = simulate(d)
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_PRIOR_OWNER_PHASE_CONFIRMATION_MISSING"
    )
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"
    assert [x["outcome"] for x in trace_for(out, "consent")] == [
        "APPLIED", "APPLIED"
    ]


@pytest.mark.parametrize("change, blocked_reason", [
    (lambda d: d["events"][1].update(actor="op"),
     "FORMATION_WRONG_ORIGINAL_PHASE_OWNER"),
    (lambda d: d["events"][1].update(org_revision="oc-old"),
     "FORMATION_ORIGINAL_ORG_REVISION_MISMATCH"),
    (lambda d: d["events"][1].update(phase=4),
     "FORMATION_ONLY_FIRST_THREE_PHASES_EXECUTABLE"),
    (lambda d: d["events"][1].update(formation_source_ref="model://op/forged"),
     "FORMATION_ORIGINAL_OWNER_PHASE_SOURCE_MISSING"),
    (lambda d: d["general_akis"]["goals"][0].update(available_at=2),
     "FORMATION_GOAL_AND_ORIGINAL_CUSTOMER_REQUEST_NOT_LINKED"),
    (lambda d: d["resources"][0].pop("capacity_units"),
     "INPUT_REJECTED_AT_PARSING"),
])
def test_r1i_denied_phase_ack_does_not_create_valid_commit(change, blocked_reason):
    d = formation_case()
    change(d)
    if blocked_reason == "INPUT_REJECTED_AT_PARSING":
        with pytest.raises(ValueError, match="CAPACITY_UNITS_AND_UNIT_REQUIRED_TOGETHER"):
            simulate(d)
    else:
        out = simulate(d)
        assert trace_for(out, "formation_confirm")[0]["reason"] == blocked_reason
        assert trace_for(out, "commit")[0]["outcome"] == "BLOCKED"
        assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_r1i_expired_original_phase_source_blocks_later_commit_not_history():
    d = formation_case()
    d["general_akis"]["formation_phases"][2]["expires_at"] = 9
    out = simulate(d)
    assert trace_for(out, "formation_confirm")[-1]["outcome"] == "APPLIED"
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_ORIGINAL_PHASE_SOURCE_STALE_OR_EXPIRED"
    )
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_r1i_no_formation_opt_in_preserves_existing_original_authorization():
    d = formation_case(with_confirmations=False, enable=False)
    out = simulate(d)
    assert trace_for(out, "commit")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["first_three_formation_model_gate"][
        "opted_in"] is False


def test_r1i_phase_event_without_opt_in_does_not_amend_work():
    d = formation_case(enable=False)
    out = simulate(d)
    assert all(row["reason"] == "FORMATION_MODEL_POLICY_NOT_CONFIGURED"
               for row in trace_for(out, "formation_confirm"))
    assert trace_for(out, "commit")[0]["outcome"] == "APPLIED"


def test_r1i_legacy_implicit_capacity_is_not_enough_for_phase_three():
    d = formation_case()
    del d["resources"][0]["capacity_units"]
    del d["resources"][0]["capacity_unit"]
    out = simulate(d)
    assert trace_for(out, "formation_confirm")[-1]["reason"] == (
        "FORMATION_ORIGINAL_RESOURCE_CAPACITY_NOT_DECLARED_READY"
    )
    assert trace_for(out, "commit")[0]["outcome"] == "BLOCKED"


def test_r1i_original_acceptance_is_not_reversed_by_late_phase_attempt():
    d = formation_case()
    d["events"].append({
        "at": 16, "action": "formation_confirm", "actor": "a",
        "work": "w1", "phase": 3, "org_revision": "oc-1",
        "formation_source_ref": "model://a/formation-3",
    })
    out = simulate(d)
    assert trace_for(out, "formation_confirm")[-1]["reason"] == (
        "FORMATION_CANNOT_REWRITE_ACCEPTED_OBLIGATION"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1i_duplicate_live_owner_source_confirmation_is_not_two_phases():
    d = formation_case()
    d["events"].insert(3, {
        "at": 4, "action": "formation_confirm", "actor": "b", "work": "w1",
        "phase": 2, "org_revision": "oc-1",
        "formation_source_ref": "model://b/formation-2",
    })
    # Move the existing phase-three confirmation to a later unused time
    # and subsequent original decisions forward, preserving strict order.
    d["events"][4]["at"] = 5
    for event in d["events"][5:]:
        event["at"] += 1
    d["model_horizon"] = 21
    out = simulate(d)
    assert trace_for(out, "formation_confirm")[2]["reason"] == (
        "FORMATION_DUPLICATE_LIVE_PHASE_CONFIRMATION"
    )
    assert trace_for(out, "commit")[0]["outcome"] == "APPLIED"


def test_r1i_non_operator_configuration_cannot_claim_full_original_phase_guards():
    d = formation_case()
    d["general_akis"]["configuration"] = "macro"
    with pytest.raises(ValueError, match="OC_ENFORCEMENT_ONLY_ORIGINAL_OPERATOR_MODEL"):
        simulate(d)
