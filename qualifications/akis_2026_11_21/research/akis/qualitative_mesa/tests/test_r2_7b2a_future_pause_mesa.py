"""R2.7B2A: FUTURE participation pause may anchor a declared exit/switching
cost, never a legal exit, a cancelled Work, or a newly invented expense.

The only history is the existing QualitativeAKIS.trace participation_status
event and the original economic_claims.resource_uses cost row.
"""
from copy import deepcopy
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_technology import world
from .test_economic_flow import fixture as economic_fixture


def linked_world():
    original = world()
    original["cooperation_links"] = [{
        "id":"network-1",
        "purpose":"joint access to complementary capabilities",
        "coordinator":"op",
        "participants":["a","b","c","op"],
        "works":["w1"],
        "mechanisms":[
            "TRANSACTION_COST","JOINT_PURCHASING","MEMBER_SOURCING",
            "SHARED_MARKETING","SHARED_LOGISTICS",
        ],
        "source_ref":"model://network-1", "source_revision":"nw-r1",
    }]
    return original


def availability_event(at, actor="b", status="PAUSED_NEW_WORK", **updates):
    row = {
        "at":at, "action":"participation_status", "actor":actor,
        "cooperation_link":"network-1",
        "cooperation_source_revision":"nw-r1", "org_revision":"oc-1",
        "new_participation":status, "economic_channel":"TRANSACTION_COST",
        "participation_evidence_ref":f"model://owner-{actor}-{at}",
    }
    row.update(updates)
    return row
from .test_general_system_mesa_integration import design


def contract_events():
    return [
        {"at":1, "action":"offer", "actor":"op", "work":"w1"},
        {"at":2, "action":"authorize", "actor":"op", "work":"w1"},
        *[
            {"at":at, "action":"consent", "actor":owner, "work":"w1",
             "source_revision":"d1", "org_revision":"oc-1"}
            for at, owner in ((3,"a"), (4,"b"), (5,"c"))
        ],
        {"at":6, "action":"commit", "actor":"op", "work":"w1"},
    ]


def case():
    d = linked_world()
    d["model_horizon"] = 10
    d["events"] = contract_events() + [availability_event(7)]
    claims = economic_fixture()
    claims["resource_uses"].append({
        "id":"exit-b", "scenario":"COOPERATION", "owner":"b",
        "amount":"7.25", "bucket":"EXIT", "source":"b1", "work":"w1",
    })
    claims["lifecycle_costs"] = {
        "bindings":[{
            "resource_use_id":"exit-b", "owner":"b", "source":"b1",
            "stage":"RENEWAL_EXIT_AND_SWITCHING", "nature":"TRANSACTION",
        }],
        "scope_proofs":{
            "COOPERATION":{"a":"a1", "b":"b1", "op":"o1"},
            "INDEPENDENT_ALTERNATIVE":{"a":"a1", "b":"b1", "op":"o1"},
        },
        "event_bindings":[{
            "resource_use_id":"exit-b", "work":"w1", "owner":"b",
            "source":"b1", "work_source_revision":"d1",
            "trace_position":6, "at":7, "action":"participation_status",
            "org_revision":"oc-1", "cost_evidence_ref":"model://b/exit-context-cost",
            "cooperation_link":"network-1",
        }],
    }
    d["economic_claims"] = claims
    d["general_akis"] = design()
    return d


def view(d):
    return simulate(d)


def test_original_participant_pause_cost_scoped_but_old_work_and_cash_unchanged():
    d = case()
    out = view(d)
    assert out["counts"] == {"applied":7,"blocked":0}
    assert out["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"
    assert out["trace"][-1]["action"] == "participation_status"
    assert out["trace"][-1]["participation_value"] == "PAUSED_NEW_WORK"
    eco = out["economics"]
    original = eco["lifecycle_resource_costs"]
    scope = original["original_work_event_timing"]
    assert scope["model_future_pause_exit_switching_cost_context_count"] == 1
    assert scope["future_pause_never_certifies_actual_exit_or_old_contract_release"]
    row = scope["by_original_work"]["w1"]["per_original_scenario_owner"][
        "COOPERATION"]["b"][0]
    assert row["source_declared_noncash_original_work_cost"] == "7.25"
    assert row["relation_future_pause_context_only"]
    assert row["future_pause_does_not_prove_legal_exit_switching_or_contract_discharge"]
    assert row["original_accepted_work_obligations_unchanged"]
    assert eco["resource_uses_count"] == 3
    assert eco["consolidated_external_cash_from_claims"]["COOPERATION"] == "270.00"
    assert eco["profit"] == "UNKNOWN"
    shared = out["general_akis_model"]["economic_time_and_cost_feedback"]
    assert shared["original_work_future_pause_exit_cost_context_count"] == 1
    assert shared["future_pause_cannot_certify_legal_withdrawal_or_old_work_discharge"]
    public = json.dumps(out["general_akis_model"], ensure_ascii=False)
    assert "exit-context-cost" not in public
    assert "7.25" not in public
    assert simulate(deepcopy(d)) == out


def test_no_cost_time_binding_does_not_erase_original_resource_or_infer_zero():
    d = case()
    d["economic_claims"]["lifecycle_costs"]["event_bindings"] = []
    out = view(d)
    assert out["economics"]["resource_uses_count"] == 3
    assert out["economics"]["lifecycle_resource_costs"][
        "original_work_event_timing"][
            "model_future_pause_exit_switching_cost_context_count"] == 0
    assert out["economics"]["per_subject"]["b"]["resource_uses_by_bucket"][
        "COOPERATION"]["EXIT"] == "7.25"
    assert out["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"


@pytest.mark.parametrize("change,error",[
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        cooperation_link="not-linked"),"LIFECYCLE_EXIT_ORIGINAL_RELATION_REQUIRED"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].pop(
        "cooperation_link"),"LIFECYCLE_STAGE_HAS_NO_ORIGINAL_WORK_TIME_EVENT"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        owner="a",source="a1"),"LIFECYCLE_TIMED_OWNER_OR_SOURCE_MISMATCH"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        work_source_revision="obsolete"),"LIFECYCLE_TIMED_WORK_REVISION_MISMATCH"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        org_revision="oc-2"),"LIFECYCLE_TIMED_ORG_REVISION_MISMATCH"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        trace_position=0),"LIFECYCLE_EXIT_ORIGINAL_PARTICIPATION_ACTION_REQUIRED"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        action="commit"),"LIFECYCLE_EXIT_ONLY_ORIGINAL_FUTURE_PARTICIPATION_PAUSE"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        cost_evidence_ref="model://op/other-owner"),"LIFECYCLE_TIMED_INDEPENDENT_OWNER_COST_SOURCE_REQUIRED"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        cost_evidence_ref="model://b1"),"LIFECYCLE_TIMED_INDEPENDENT_OWNER_COST_SOURCE_REQUIRED"),
    (lambda d:d["economic_claims"]["resource_uses"][-1].update(
        scenario="INDEPENDENT_ALTERNATIVE"),
        "LIFECYCLE_EXIT_ORIGINAL_COOPERATIVE_OWNER_COST_REQUIRED"),
    (lambda d:d["economic_claims"]["resource_uses"][-1].update(
        bucket="DELIVERY"),"LIFECYCLE_EXIT_ORIGINAL_COOPERATIVE_OWNER_COST_REQUIRED"),
    (lambda d:d["economic_claims"]["resource_uses"][-1].update(
        work=None),"LIFECYCLE_TIMED_COMMON_COST_NOT_ALLOCATED_TO_WORK"),
])
def test_invalid_participation_or_cost_source_rejected_without_new_exit(change,error):
    d=case()
    change(d)
    with pytest.raises(InputError, match=error):
        view(d)


def test_owner_a_pause_does_not_validate_owner_b_exit_expense():
    d = case()
    d["events"][-1] = availability_event(7, actor="a")
    with pytest.raises(InputError, match="LIFECYCLE_EXIT_ORIGINAL_OWNER_PAUSE_AND_REVISION_REQUIRED"):
        view(d)


def test_resume_is_not_legal_exit_or_source_for_exit_cost():
    d = case()
    d["events"][-1] = availability_event(7,status="OPEN_TO_NEW_WORK")
    with pytest.raises(InputError,match="LIFECYCLE_EXIT_ORIGINAL_OWNER_PAUSE_AND_REVISION_REQUIRED"):
        view(d)


def test_blocked_participation_event_not_used_as_exit_cost_source():
    d=case()
    d["events"][-1] = availability_event(7, cooperation_source_revision="bad")
    with pytest.raises(InputError,match="LIFECYCLE_EXIT_APPLIED_PARTICIPATION_PAUSE_REQUIRED"):
        view(d)


def test_future_pause_before_original_contract_cannot_be_exit_on_this_work():
    d = case()
    d["events"] = [availability_event(1)]
    d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(
        trace_position=0,at=1,
    )
    with pytest.raises(InputError,match="LIFECYCLE_EXIT_CANNOT_PRECEDE_ORIGINAL_WORK_COMMITMENT"):
        view(d)


def test_unauthorized_operator_participation_cannot_create_exit_cost_context():
    d=case()
    d["events"][-1] = availability_event(7,actor="op")
    with pytest.raises(InputError,match="LIFECYCLE_EXIT_APPLIED_PARTICIPATION_PAUSE_REQUIRED"):
        view(d)


def test_original_work_consent_not_rewritten_after_later_independent_resume():
    d = case()
    d["events"].append(availability_event(8, status="OPEN_TO_NEW_WORK"))
    out = view(d)
    assert out["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert out["counts"] == {"applied":8,"blocked":0}
    assert out["economics"]["lifecycle_resource_costs"][
        "original_work_event_timing"][
        "model_future_pause_exit_switching_cost_context_count"] == 1
    assert out["cooperation"]["links"][0]["relation_state"] == "ORIGINAL_COMMITMENTS_ACTIVE"


def test_participation_notice_cannot_itself_be_passed_off_as_separate_exit_expense():
    d=case()
    d["events"][-1]["participation_evidence_ref"] = "model://b/same-proof"
    d["economic_claims"]["lifecycle_costs"]["event_bindings"][0][
        "cost_evidence_ref"] = "model://b/same-proof"
    with pytest.raises(
        InputError,
        match="LIFECYCLE_EXIT_COST_PROOF_MUST_DIFFER_FROM_PARTICIPATION_NOTICE",
    ):
        view(d)


def test_original_exit_cost_does_not_create_second_operator_fee_or_result():
    d=case()
    before=deepcopy(d)
    before["economic_claims"]["lifecycle_costs"]["event_bindings"]=[]
    a=view(d)
    b=view(before)
    assert a["economics"]["per_subject"]==b["economics"]["per_subject"]
    assert a["economics"]["consolidated_external_cash_from_claims"]==b["economics"][
        "consolidated_external_cash_from_claims"]
    assert a["works"]==b["works"]
    assert a["trace"]==b["trace"]
    assert a["profit"]==b["profit"]
