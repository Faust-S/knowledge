"""AKIS M2.5: one original trace from cooperative review to new original Work.

All parties, times, sources and money are synthetic. Even completed model
consultation is not an authorization, contract, transfer, Result or new IAM.
"""
from __future__ import annotations

from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS, InputError
from research.akis.qualitative_mesa.cooperation import (
    cooperation_change_reviews, cooperation_system_view
)
from .test_rules import fixture as base
from .test_general_system_mesa_integration import design


def prepare():
    d = base()
    d["resources"][0]["availability"] = "AVAILABLE"
    d["cooperation_links"] = [{
        "id": "net", "purpose": "quality/cost for continued independent works",
        "coordinator": "op", "participants": ["a", "b", "op"],
        "works": ["w1"], "mechanisms": ["TRANSACTION_COST", "SHARED_LOGISTICS"],
        "source_ref": "model://network-original", "source_revision": "n-1",
    }]
    return d


def proposal(at=9, **changes):
    p = {"at": at, "action": "cooperation_change_propose", "actor": "b",
         "cooperation_link": "net", "cooperation_source_revision": "n-1",
         "org_revision": "oc-1", "change_id": "chg-1",
         "change_kind": "REVISE_SHARED_FUNCTION", "economic_channel": "TRANSACTION_COST",
         "change_source_ref": "model://b/proposed-process-change"}
    return p | changes


def reply(actor, at, decision="SUPPORT_MODEL_PROPOSAL", **changes):
    p = {"at": at, "action": "cooperation_change_response", "actor": actor,
         "cooperation_link": "net", "cooperation_source_revision": "n-1",
         "org_revision": "oc-1", "change_id": "chg-1",
         "change_decision": decision,
         "change_source_ref": f"model://{actor}/independent-reply-{at}"}
    return p | changes


def new_work():
    return {
        "id":"w2","customer":"b","resource":"ra",
        "source_revision":"d-2","slot_start":20,"slot_end":30,
        "requires_accepted":["w1"],
    }


def request(at=13, **changes):
    return {
        "at":at,"action":"request","actor":"b","work_spec":new_work(),
        "cooperation_link":"net","cooperation_source_revision":"n-1",
        "change_id":"chg-1",
    } | changes


def accept_first_work():
    return [
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        {"at":3,"action":"consent","actor":"a","work":"w1",
         "source_revision":"d-1","org_revision":"oc-1"},
        {"at":4,"action":"consent","actor":"b","work":"w1",
         "source_revision":"d-1","org_revision":"oc-1"},
        {"at":5,"action":"commit","actor":"op","work":"w1"},
        {"at":6,"action":"start","actor":"a","work":"w1"},
        {"at":7,"action":"complete","actor":"a","work":"w1",
         "result_ref":"model://a/first-execution"},
        {"at":8,"action":"accept","actor":"b","work":"w1"},
    ]


def review_events(support=("a","b","op")):
    return [proposal()] + [
        reply(p,10+i) for i,p in enumerate(support)
    ]


def complete_cycle():
    return accept_first_work() + review_events() + [
        request(),
        {"at":14,"action":"offer","actor":"op","work":"w2"},
        {"at":15,"action":"authorize","actor":"op","work":"w2"},
        {"at":16,"action":"consent","actor":"a","work":"w2",
         "source_revision":"d-2","org_revision":"oc-1"},
        {"at":17,"action":"consent","actor":"b","work":"w2",
         "source_revision":"d-2","org_revision":"oc-1"},
        {"at":18,"action":"commit","actor":"op","work":"w2"},
        {"at":19,"action":"start","actor":"a","work":"w2"},
        {"at":20,"action":"complete","actor":"a","work":"w2",
         "result_ref":"model://a/second-execution"},
        {"at":21,"action":"accept","actor":"b","work":"w2"},
    ]


def apply_sequence(events):
    state = QualitativeAKIS(prepare())
    reports = [state.apply(event,event["at"]) for event in events]
    return state,reports


def test_completed_consultation_can_be_cited_only_as_prior_information_not_consent():
    prior=accept_first_work()+review_events()
    state,reports=apply_sequence(prior)
    assert all(row["outcome"]=="APPLIED" for row in reports)
    consultation=cooperation_change_reviews(state.cooperation_links,state.trace,
                                            current_org_revision="oc-1",
                                            subjects=state.subjects)[0]
    assert consultation["review_status"]=="MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION"
    assert consultation["supporting_model_declarations"]==3
    old_result=state.works["w1"].result
    before=deepcopy(state.works["w1"].consents)
    opening=state.apply(request(),13)
    assert opening["outcome"]=="APPLIED"
    assert opening["request_linked_change_id"]=="chg-1"
    assert opening["request_consultation_source"]=="ORIGINAL_MODEL_TRACE_NO_LEGAL_AUTHORIZATION"
    assert opening["request_original_work_quality_and_responsibility"]=="NOT_VERIFIED"
    assert opening["request_original_work_specific_economics"]=="NOT_VERIFIED"
    assert state.works["w1"].result==old_result=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert state.works["w1"].consents==before
    assert state.works["w2"].consents=={}
    assert state.works["w2"].obligation=="NOT_ACCEPTED"
    assert state.cooperation_links[0].works==("w1","w2")
    assert state.cooperation_links[0].participants==("a","b","op")
    assert state.institution.revision=="oc-1"
    assert not any(ev["action"]=="consent" and ev["work"]=="w2"
                   for ev in state.trace)


@pytest.mark.parametrize("responses,reason",[
    ([], "COOPERATION_CHANGE_INDEPENDENT_CONSULTATION_NOT_COMPLETE"),
    (["a","b"],"COOPERATION_CHANGE_INDEPENDENT_CONSULTATION_NOT_COMPLETE"),
])
def test_no_or_incomplete_independent_consultation_never_certifies_revised_work(responses,reason):
    state,_=apply_sequence(accept_first_work()+review_events(responses))
    res=state.apply(request(),13)
    assert res["outcome"]=="BLOCKED" and res["reason"]==reason
    assert "w2" not in state.works
    assert state.cooperation_links[0].works==("w1",)


def test_explicit_objection_overrides_an_earlier_support_without_rewriting_old_result():
    state,_=apply_sequence(accept_first_work()+review_events())
    assert state.apply(reply("a",at=13,decision="OBJECT_MODEL_PROPOSAL"),13)["outcome"]=="APPLIED"
    result=state.apply(request(at=14),14)
    assert result["reason"]=="COOPERATION_CHANGE_INDEPENDENT_CONSULTATION_NOT_COMPLETE"
    assert "w2" not in state.works
    assert state.works["w1"].result=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("mutate,reason",[
    ({"change_id":"unknown"},"COOPERATION_CHANGE_ORIGINAL_PROPOSAL_REQUIRED"),
    ({"cooperation_link":"absent"},"COOPERATION_CHANGE_LINK_UNKNOWN"),
    ({"cooperation_source_revision":"old"},"COOPERATION_CHANGE_SOURCE_REVISION_STALE"),
    ({"actor":"a"},"ORIGINAL_CUSTOMER_REQUEST_REQUIRED"),
    ({"at":9},"COOPERATION_CHANGE_REQUEST_MUST_FOLLOW_CONSULTATION"),
])
def test_bad_link_rev_owner_or_time_cannot_launder_change_into_work(mutate,reason):
    state,_=apply_sequence(accept_first_work()+review_events())
    result=state.apply(request(**mutate), mutate.get("at",13))
    assert result["outcome"]=="BLOCKED" and result["reason"]==reason
    assert "w2" not in state.works


def test_one_source_review_cannot_be_reused_as_unbounded_future_project_authority():
    state,_=apply_sequence(accept_first_work()+review_events())
    assert state.apply(request(),13)["outcome"]=="APPLIED"
    next_spec=new_work()|{"id":"w3","source_revision":"d-3","slot_start":35,"slot_end":40}
    res=state.apply(request(at=14,work_spec=next_spec),14)
    assert res["reason"]=="COOPERATION_CHANGE_ALREADY_REFERENCED_BY_ORIGINAL_REQUEST"
    assert set(state.works)=={"w1","w2"}


def test_review_of_adding_new_participant_is_not_admission_to_old_relation():
    d=prepare()
    d["subjects"].append({"id":"d","kind":"SME"})
    state=QualitativeAKIS(d)
    for ev in accept_first_work():
        assert state.apply(ev,ev["at"])["outcome"]=="APPLIED"
    p=proposal(change_kind="ADD_FUTURE_PARTICIPANT",proposed_subject="d")
    assert state.apply(p,9)["outcome"]=="APPLIED"
    for at,who in enumerate(("a","b","op","d"),start=10):
        assert state.apply(reply(who,at),at)["outcome"]=="APPLIED"
    res=state.apply(request(at=14),14)
    assert res["reason"]=="COOPERATION_CHANGE_NOT_A_FUTURE_WORK_SCOPE"
    assert "d" not in state.cooperation_links[0].participants
    assert "w2" not in state.works


def test_original_governance_revision_or_member_pause_needs_fresh_review():
    state,_=apply_sequence(accept_first_work()+review_events())
    state.apply({"at":13,"action":"participation_status","actor":"a",
                "cooperation_link":"net","cooperation_source_revision":"n-1",
                "org_revision":"oc-1","new_participation":"PAUSED_NEW_WORK",
                "economic_channel":"TRANSACTION_COST",
                "participation_evidence_ref":"model://a/pause-future"},13)
    assert state.apply(request(at=14),14)["reason"]=="COOPERATION_CHANGE_FUTURE_PARTICIPATION_PAUSED"
    assert "w2" not in state.works
    state2,_=apply_sequence(accept_first_work()+review_events())
    shift={"at":13,"action":"change_mode","actor":"FOUNDERS",
           "authorized_by":["op","a","b"],"expected_revision":"oc-1",
           "new_revision":"oc-2","new_mode":"COLLEGIAL"}
    assert state2.apply(shift,13)["outcome"]=="APPLIED"
    assert state2.apply(request(at=14),14)["reason"]=="COOPERATION_CHANGE_REQUEST_STALE_INSTITUTION_OR_RELATION"
    assert "w2" not in state2.works


def test_native_mesa_preserves_one_trace_through_new_work_and_two_independent_results():
    mesa=pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    d=prepare()
    d["events"]=complete_cycle()
    d["general_akis"]=design()
    d["model_horizon"]=23
    out=simulate(d)
    assert out["counts"]=={"applied":21,"blocked":0}
    assert out["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["consenting_principals"]==["a","b"]
    request_trace=out["trace"][12]
    assert request_trace["action"]=="request"
    assert request_trace["request_linked_change_id"]=="chg-1"
    assert out["cooperation"]["system_projection"]["relations"][0]["components"]["Э"]["profit"]=="NOT_IDENTIFIABLE"
    assert out["general_akis_model"]["legal_consent_created"] is False
    assert out["general_akis_model"]["original_results_and_org_code_unmodified"]
    assert out["profit"]["system_increment"]=="UNKNOWN"
    assert simulate(deepcopy(d))==out


def test_legacy_original_work_request_without_change_reference_remains_separate():
    state,_=apply_sequence(accept_first_work())
    item=request(at=10)
    item.pop("change_id")
    assert state.apply(item,10)["outcome"]=="APPLIED"
    assert "request_linked_change_id" not in state.trace[-1]
    assert state.works["w2"].consents=={}
    assert state.works["w2"].obligation=="NOT_ACCEPTED"
    # Its original scope remains based only on its own customer, not on
    # any hypothetical completed negotiation. No change is claimed.


def test_future_request_depending_on_unaccepted_original_result_cannot_start():
    state=QualitativeAKIS(prepare())
    for event in review_events():
        assert state.apply(event,event["at"])["outcome"]=="APPLIED"
    assert state.apply(request(),13)["outcome"]=="APPLIED"
    assert state.apply({"at":14,"action":"offer","actor":"op","work":"w2"},14)["outcome"]=="APPLIED"
    assert state.apply({"at":15,"action":"authorize","actor":"op","work":"w2"},15)["outcome"]=="APPLIED"
    for at,who in ((16,"a"),(17,"b")):
        assert state.apply({"at":at,"action":"consent","actor":who,
                           "work":"w2","source_revision":"d-2",
                           "org_revision":"oc-1"},at)["outcome"]=="APPLIED"
    assert state.apply({"at":18,"action":"commit","actor":"op","work":"w2"},18)["outcome"]=="APPLIED"
    result=state.apply({"at":19,"action":"start","actor":"a","work":"w2"},19)
    assert result["reason"]=="PORTFOLIO_PREDECESSOR_RESULT_NOT_ACCEPTED"
    assert state.works["w2"].execution=="NOT_STARTED"
