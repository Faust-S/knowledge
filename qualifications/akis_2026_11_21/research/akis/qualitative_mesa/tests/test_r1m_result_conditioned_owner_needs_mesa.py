"""R1-M: a NEW owner goal is originated AFTER the original Result
and that owner's independent economic/participation assessment.

This is partial result-conditioned owner agency, not proof of
fully endogenous demand or an automatically created original Work.
"""
from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1l_post_result_original_reproduction_mesa import (
    two_cycle_lifecycle_case, find,
)
from .test_r1_formation_original_gates_mesa import trace_for


def result_goal_case(*, include_need=True, source_expiry=90):
    d = two_cycle_lifecycle_case()
    general = d["general_akis"]
    general["enforce_model_result_conditioned_goals"] = True
    # R1-M MUST NOT borrow a projected pre-existing goal for second Work.
    general["goals"] = [g for g in general["goals"] if g["work"] != "w2"]
    request = next(e for e in d["events"]
                   if e["action"] == "request" and e["at"] == 34)
    request["emergent_goal_source_ref"] = "model://b/w2-created-after-result"
    if include_need:
        d["events"].append({
            "at": 32, "action": "need_emerge", "actor": "b", "work": "w2",
            "work_source_revision": "d-2", "org_revision": "oc-1",
            "goal_source_ref": "model://b/w2-created-after-result",
            "goal_expires_at": source_expiry,
            "goal_objective": "RESILIENCE", "goal_priority": 2,
            "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
            "pilot_work": "w1", "pilot_result_ref": "model://w1-result",
            "pilot_decision_at": 29,
        })
    d["events"].sort(key=lambda x: x["at"])
    return d


def test_r1m_new_goal_is_original_owner_action_only_after_accepted_result():
    d = result_goal_case()
    copy = deepcopy(d)
    out = simulate(d)
    assert d == copy
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e["reason"]) for e in out["trace"]
        if e["outcome"] == "BLOCKED"
    ]
    goal = find(out, "need_emerge")[0]
    assert goal["outcome"] == "APPLIED"
    assert goal["actor"] == "b"
    assert goal["at"] > find(out, "accept", work="w1")[0]["at"]
    assert goal["at"] > find(out, "participation_status", actor="b")[-1]["at"]
    assert goal["model_only_owner_need_not_original_work"] is True
    assert goal["goal_objective"] == "RESILIENCE"
    request = find(out, "request", work="w2")[0]
    assert request["outcome"] == "APPLIED"
    assert request["at"] > goal["at"]
    assert request["need_source_belongs_to_prior_original_result"] is True
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    gate = out["general_akis_model"]["result_conditioned_owner_goals"]
    assert gate["opted_in"] is True
    assert gate["owner_origination_events"] == 1
    assert gate["new_original_works_created_by_goal_event"] is False
    assert gate["whole_system_endogenous_need_dynamics_complete"] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


def test_r1m_no_owner_origin_event_cannot_use_second_work_static_plan():
    d = result_goal_case(include_need=False)
    out = simulate(d)
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_EMERGENT_ORIGINAL_OWNER_GOAL_EVENT_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "w2" not in out["works"]


@pytest.mark.parametrize("mutation,reason", [
    (lambda e: e.update(
        actor="a", goal_source_ref="model://a/foreign-owner-goal"),
     "FORMATION_EMERGENT_CUSTOMER_ACCEPTED_PILOT_REQUIRED"),
    (lambda e: e.update(org_revision="oc-0"),
     "FORMATION_EMERGENT_ORG_REVISION_STALE"),
    (lambda e: e.update(work_source_revision="d-old"),
     None),
    (lambda e: e.update(goal_source_ref="model://op/forged"),
     "FORMATION_EMERGENT_OWNER_GOAL_SOURCE_REQUIRED"),
    (lambda e: e.update(goal_priority=0),
     "FORMATION_EMERGENT_GOAL_PRIORITY_INVALID"),
    (lambda e: e.update(goal_objective="GUARANTEED_PROFIT"),
     "FORMATION_EMERGENT_GOAL_OBJECTIVE_UNKNOWN"),
    (lambda e: e.update(pilot_result_ref="model://forged-result"),
     "FORMATION_EMERGENT_PILOT_RESULT_REVISION_MISMATCH"),
    (lambda e: e.update(pilot_decision_at=28),
     "FORMATION_EMERGENT_PILOT_ACCEPTANCE_TIME_MISMATCH"),
    (lambda e: e.update(cooperation_source_revision="bad-revision"),
     "FORMATION_EMERGENT_ORIGINAL_RELATION_REQUIRED"),
])
def test_r1m_wrong_owner_source_revision_or_pilot_cannot_generate_need(mutation, reason):
    d = result_goal_case()
    need = next(e for e in d["events"] if e["action"] == "need_emerge")
    mutation(need)
    out = simulate(d)
    if reason is None:
        assert find(out, "need_emerge")[0]["outcome"] == "APPLIED"
        assert find(out, "request", work="w2")[0]["reason"] == (
            "FORMATION_EMERGENT_ORIGINAL_OWNER_GOAL_EVENT_REQUIRED"
        )
    else:
        assert find(out, "need_emerge")[0]["reason"] == reason
        assert find(out, "request", work="w2")[0]["outcome"] == "BLOCKED"
    assert "w2" not in out["works"]


def test_r1m_owner_need_source_expired_at_next_request_blocks_old_goal():
    d = result_goal_case(source_expiry=34)
    out = simulate(d)
    assert find(out, "need_emerge")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_EMERGENT_ORIGINAL_GOAL_EXPIRED"
    )
    assert "w2" not in out["works"]


def test_r1m_after_owner_revises_future_position_prior_need_no_longer_current():
    d = result_goal_case()
    before = next(e for e in d["events"]
                  if e["action"] == "participation_status" and e["actor"] == "b")
    new = deepcopy(before)
    new.update(at=33, evaluation_verdict="ADVERSE_DECLARED",
               participation_evidence_ref="model://b/updated-owner-position")
    d["events"].append(new)
    d["events"].sort(key=lambda x: x["at"])
    out = simulate(d)
    assert find(out, "need_emerge")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_EMERGENT_OWNER_POSITION_CHANGED_AFTER_GOAL"
    )
    assert "w2" not in out["works"]


def test_r1m_duplicate_goal_for_same_work_cannot_rewrite_first_original_evidence():
    d = result_goal_case()
    first = next(e for e in d["events"] if e["action"] == "need_emerge")
    extra = deepcopy(first)
    extra["at"] = 33
    extra["goal_source_ref"] = "model://b/second-source"
    d["events"].append(extra)
    d["events"].sort(key=lambda x: x["at"])
    out = simulate(d)
    assert [x["outcome"] for x in find(out, "need_emerge")] == [
        "APPLIED", "BLOCKED"
    ]
    assert find(out, "need_emerge")[-1]["reason"] == (
        "FORMATION_EMERGENT_TARGET_ALREADY_CLAIMED"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1m_declaration_without_matching_new_owner_request_stays_nonoperative():
    d = result_goal_case()
    next(e for e in d["events"] if e["action"] == "request"
         and e["at"] == 34)["emergent_goal_source_ref"] = "model://b/not-originated"
    out = simulate(d)
    assert find(out, "need_emerge")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_EMERGENT_ORIGINAL_OWNER_GOAL_EVENT_REQUIRED"
    )
    assert "w2" not in out["works"]
    assert out["works"]["w1"]["obligation"] == "FULFILLED"


def test_r1m_rejected_original_pilot_result_cannot_cause_accepted_successor_need():
    d = result_goal_case()
    next(e for e in d["events"] if e["action"] == "accept"
         and e["work"] == "w1")["action"] = "reject"
    out = simulate(d)
    assert find(out, "need_emerge")[0]["reason"] == (
        "FORMATION_EMERGENT_CUSTOMER_ACCEPTED_PILOT_REQUIRED"
    )
    assert "w2" not in out["works"]
    assert out["works"]["w1"]["result"] == "REJECTED"


def test_r1m_opt_out_does_not_turn_needs_into_automatic_work():
    d = result_goal_case()
    d["general_akis"]["enforce_model_result_conditioned_goals"] = False
    d["general_akis"]["goals"].append({
        "owner": "b", "source_ref": "model://b/legacy-static-w2",
        "revision": "oc-1", "available_at": 30, "expires_at": 90,
        "work": "w2", "work_revision": "d-2",
        "objective": "RESILIENCE", "priority": 2,
    })
    out = simulate(d)
    assert find(out, "need_emerge")[0]["reason"] == (
        "FORMATION_EMERGENT_NEED_POLICY_NOT_CONFIGURED"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["result_conditioned_owner_goals"][
        "opted_in"] is False


def test_r1m_endogenous_gate_requires_original_eight_phase_lifecycle():
    d = result_goal_case()
    d["general_akis"]["enforce_model_formation_lifecycle"] = False
    with pytest.raises(ValueError, match="FORMATION_EMERGENT_NEED_REQUIRES_RESULT_LIFECYCLE"):
        simulate(d)
