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


def two_independent_resource_owners_case(*, acknowledge_second_owner=True):
    d = formation_case()
    d["subjects"].append({"id": "c", "kind": "SME"})
    d["resources"].append({
        "id": "rc", "owner": "c", "availability": "AVAILABLE",
        "capacity_units": 1, "capacity_unit": "UNIT",
    })
    d["events"][0]["work_spec"]["resource_requirements"] = [
        {"resource": "ra", "units": 1},
        {"resource": "rc", "units": 1},
    ]
    d["general_akis"]["formation_phases"].append({
        "phase": 3, "owner": "c", "source_ref": "model://c/formation-3",
        "revision": "oc-1", "available_at": 0, "expires_at": 30,
    })
    d["events"] = d["events"][:4] + (
        [{
            "at": 5, "action": "formation_confirm", "actor": "c",
            "work": "w1", "phase": 3, "org_revision": "oc-1",
            "formation_source_ref": "model://c/formation-3",
        }] if acknowledge_second_owner else []
    ) + [
        {"at": 6, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 7, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 8, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 9, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 10, "action": "consent", "actor": "c", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 11, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 13, "action": "start", "actor": "a", "work": "w1"},
        {"at": 14, "action": "complete", "actor": "a", "work": "w1",
         "result_ref": "model://two-owners-result"},
        {"at": 15, "action": "accept", "actor": "b", "work": "w1"},
    ]
    return d


def test_r1i_two_distinct_resource_owners_each_confirm_before_shared_commit():
    d = two_independent_resource_owners_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, out["trace"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    phase_three = [row["actor"] for row in trace_for(out, "formation_confirm")
                   if row["phase"] == 3 and row["outcome"] == "APPLIED"]
    assert phase_three == ["a", "c"]
    assert trace_for(out, "commit")[0]["outcome"] == "APPLIED"


def test_r1i_one_resource_owner_cannot_confirm_forming_for_another():
    d = two_independent_resource_owners_case(acknowledge_second_owner=False)
    out = simulate(d)
    assert [x["outcome"] for x in trace_for(out, "consent")] == [
        "APPLIED", "APPLIED", "APPLIED"
    ]
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_PRIOR_OWNER_PHASE_CONFIRMATION_MISSING"
    )
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def two_cycle_with_formation_case(*, second_resource_phase=True):
    d = formation_case()
    second = deepcopy(d["events"][0]["work_spec"])
    second.update(
        id="w2", source_revision="d-2", slot_start=32, slot_end=41,
        requires_accepted=["w1"],
    )
    d["general_akis"]["goals"].append({
        "owner": "b", "source_ref": "model://b/goal-w2",
        "revision": "oc-1", "available_at": 16, "expires_at": 50,
        "work": "w2", "work_revision": "d-2",
        "objective": "QUALITY", "priority": 2,
    })
    d["events"].append({
        "at": 16, "action": "request", "actor": "b", "work_spec": second,
    })
    d["events"].extend([
        {"at": phase + 16, "action": "formation_confirm",
         "actor": owner, "work": "w2", "phase": phase,
         "org_revision": "oc-1",
         "formation_source_ref": f"model://{owner}/formation-{phase}"}
        for phase, owner in ((1, "b"), (2, "b"), (3, "a"))
        if second_resource_phase or phase != 3
    ])
    d["events"] += [
        {"at": 20, "action": "offer", "actor": "op", "work": "w2"},
        {"at": 21, "action": "authorize", "actor": "op", "work": "w2"},
        {"at": 22, "action": "consent", "actor": "a", "work": "w2",
         "source_revision": "d-2", "org_revision": "oc-1"},
        {"at": 23, "action": "consent", "actor": "b", "work": "w2",
         "source_revision": "d-2", "org_revision": "oc-1"},
        {"at": 24, "action": "commit", "actor": "op", "work": "w2"},
        {"at": 33, "action": "start", "actor": "a", "work": "w2"},
        {"at": 34, "action": "complete", "actor": "a", "work": "w2",
         "result_ref": "model://w2-result"},
        {"at": 35, "action": "accept", "actor": "b", "work": "w2"},
    ]
    d["model_horizon"] = 45
    return d


def test_r1i_second_independent_work_requires_its_own_formation_confirmations():
    d = two_cycle_with_formation_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, out["trace"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["obligation"] == "FULFILLED"
    assert [row["work"] for row in trace_for(out, "formation_confirm")] == [
        "w1", "w1", "w1", "w2", "w2", "w2"
    ]
    assert out["general_akis_model"]["first_three_formation_model_gate"][
        "original_model_event_confirmations"] == 6
    assert out["general_akis_model"]["first_three_formation_model_gate"][
        "full_eight_author_formation_phases_completed"] is False
    assert out == simulate(deepcopy(d))


def test_r1i_second_cycle_cannot_borrow_first_cycle_resource_confirmation():
    d = two_cycle_with_formation_case(second_resource_phase=False)
    out = simulate(d)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert trace_for(out, "commit")[-1]["reason"] == (
        "FORMATION_PRIOR_OWNER_PHASE_CONFIRMATION_MISSING"
    )
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w2"]["result"] == "NOT_SUBMITTED"
