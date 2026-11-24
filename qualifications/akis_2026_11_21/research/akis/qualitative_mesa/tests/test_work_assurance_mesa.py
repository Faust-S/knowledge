"""M3: original Work quality requirements -> independent model recipient decision.

No legally validated standards, real measurement, source identity, payment,
operator consent or future capability gain is inferred from synthetic events.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from .test_technology import world, signed, act
from .test_general_system_mesa_integration import design


def criterion(ident, operation, owner, *, dimension="DELIVERABLE_CONFORMITY"):
    return {
        "id": ident, "dimension": dimension, "operation": operation,
        "responsible_owner": owner, "assessor": "c",
        "method": "FUNCTIONAL_TEST" if operation == "cut" else "DOCUMENT_REVIEW",
        "source_ref": f"model://c/criterion-{ident}",
        "source_revision": "d1",
    }


def scenario():
    d = world()
    d["works"][0]["assurance_criteria"] = [
        criterion("fit", "cut", "a"),
        criterion("documents", "pack", "b", dimension="DOCUMENTATION"),
    ]
    return d


def quality_event(at, criterion_id="fit", verdict="MEETS_DECLARED_REQUIREMENT",
                  result_ref="model://final-v1", **changes):
    return {
        "at": at, "action": "assess_result_quality", "actor": "c", "work": "w1",
        "criterion": criterion_id, "quality_verdict": verdict,
        "quality_evidence_ref": f"model://c/inspected-{criterion_id}-{at}",
        "result_ref": result_ref, "source_revision": "d1", "org_revision": "oc-1",
        **changes,
    }


def execution_events():
    return [
        {"at":1, "action":"offer", "actor":"op", "work":"w1"},
        {"at":2, "action":"authorize", "actor":"op", "work":"w1"},
        *[
            {"at":at, "action":"consent", "actor":owner, "work":"w1",
             "source_revision":"d1", "org_revision":"oc-1"}
            for at, owner in ((3,"a"),(4,"b"),(5,"c"))
        ],
        {"at":6, "action":"commit", "actor":"op", "work":"w1"},
        {"at":7, "action":"start_operation", "actor":"a", "work":"w1", "operation":"cut"},
        {"at":8, "action":"complete_operation", "actor":"a", "work":"w1",
         "operation":"cut", "result_ref":"model://cut-exec"},
        {"at":9, "action":"start_operation", "actor":"b", "work":"w1", "operation":"pack"},
        {"at":10, "action":"complete_operation", "actor":"b", "work":"w1",
         "operation":"pack", "result_ref":"model://pack-exec"},
        {"at":11, "action":"complete", "actor":"a", "work":"w1",
         "result_ref":"model://final-v1"},
    ]


def apply_sequence(d, events):
    state=QualitativeAKIS(d)
    outcomes=[state.apply(e,e["at"]) for e in events]
    return state,outcomes


@pytest.mark.parametrize("edit,error", [
    ({"responsible_owner":"b"}, "QUALITY_RESPONSIBLE_ORIGINAL_OWNER_REQUIRED"),
    ({"assessor":"a"}, "QUALITY_RECIPIENT_ASSESSOR_REQUIRED"),
    ({"source_ref":"model://a/foreign-spec"}, "QUALITY_RECIPIENT_SOURCE_REQUIRED"),
    ({"source_revision":"d0"}, "QUALITY_WORK_SOURCE_REVISION_MISMATCH"),
    ({"operation":"unknown"}, "QUALITY_ORIGINAL_OPERATION_REQUIRED"),
    ({"dimension":"UNIVERSAL_LEGAL_CERTIFICATE"}, "QUALITY_DIMENSION_INVALID"),
    ({"method":"AUTO_PROVEN"}, "QUALITY_VERIFICATION_METHOD_INVALID"),
])
def test_input_must_be_original_work_scoped_and_not_imply_corporate_source_grants(edit,error):
    d=scenario()
    d["works"][0]["assurance_criteria"][0].update(edit)
    with pytest.raises(InputError, match=error):
        QualitativeAKIS(d)


def test_undeclared_or_duplicate_criterion_rejected_before_work_creation():
    d=scenario()
    d["works"][0]["assurance_criteria"].append(
        deepcopy(d["works"][0]["assurance_criteria"][0]))
    with pytest.raises(InputError,match="QUALITY_CRITERION_DUPLICATE"):
        QualitativeAKIS(d)
    d=scenario()
    d["works"][0]["assurance_criteria"]=[]
    with pytest.raises(InputError,match="QUALITY_CRITERIA_REQUIRED_NONEMPTY_LIST"):
        QualitativeAKIS(d)


def test_explicit_quality_evidence_required_after_executed_operations_before_accept():
    s,outcomes=apply_sequence(scenario(),execution_events())
    assert all(x["outcome"]=="APPLIED" for x in outcomes)
    assert act(s,12,"accept","c")["reason"]=="QUALITY_ORIGINAL_ASSESSMENT_MISSING"
    assert s.works["w1"].result=="SUBMITTED"
    assert s.works["w1"].obligation=="ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert s.apply(quality_event(13),13)["outcome"]=="APPLIED"
    assert act(s,14,"accept","c")["reason"]=="QUALITY_ORIGINAL_ASSESSMENT_MISSING"
    assert s.apply(quality_event(15,criterion_id="documents"),15)["outcome"]=="APPLIED"
    assert act(s,16,"accept","c")["outcome"]=="APPLIED"
    result=s.snapshot()["works"]["w1"]
    assert result["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["obligation"]=="FULFILLED"
    assert result["assurance"]["required_count"]==2
    assert result["assurance"]["model_reported_met_count"]==2
    assert result["assurance"]["current_result_quality_gate"]=="NONE"
    assert not result["assurance"]["criteria"][0]["legal_liability_created"]
    assert result["assurance"]["additional_transaction_cost_or_competence_effect"]=="NOT_IDENTIFIABLE"
    assert len([r for r in s.trace if r["action"]=="assess_result_quality"
                and r["outcome"]=="APPLIED"])==2
    assert s.snapshot()["profit"]["system_increment"]=="UNKNOWN"


@pytest.mark.parametrize("change,reason", [
    ({"actor":"b"}, "QUALITY_ORIGINAL_RECIPIENT_REQUIRED"),
    ({"source_revision":"d-old"}, "QUALITY_WORK_SOURCE_REVISION_STALE"),
    ({"org_revision":"oc-0"}, "QUALITY_ORIGINAL_COMMITMENT_CODE_REQUIRED"),
    ({"result_ref":"model://other-result"}, "QUALITY_SUBMITTED_RESULT_REVISION_MISMATCH"),
    ({"quality_verdict":"AUTO_CONSENT"}, "QUALITY_ASSESSMENT_VERDICT_INVALID"),
    ({"quality_evidence_ref":"model://a/foreign-review"}, "QUALITY_INDEPENDENT_MODEL_EVIDENCE_REQUIRED"),
    ({"quality_evidence_ref":"model://final-v1"}, "QUALITY_INDEPENDENT_MODEL_EVIDENCE_REQUIRED"),
])
def test_assessment_cannot_claim_foreign_rights_or_other_result(change,reason):
    s,_=apply_sequence(scenario(),execution_events())
    res=s.apply(quality_event(12,**change),12)
    assert res["outcome"]=="BLOCKED" and res["reason"]==reason
    assert s.works["w1"].assurance_reviews=={}
    assert s.works["w1"].result=="SUBMITTED"


def test_failed_quality_and_rejected_result_require_executed_correction_before_resubmit():
    s,_=apply_sequence(scenario(),execution_events())
    assert s.apply(quality_event(12,verdict="DOES_NOT_MEET"),12)["outcome"]=="APPLIED"
    assert s.apply(quality_event(13,criterion_id="documents"),13)["outcome"]=="APPLIED"
    assert act(s,14,"accept","c")["reason"]=="QUALITY_DECLARED_CRITERION_FAILED"
    assert act(s,15,"reject","c")["outcome"]=="APPLIED"
    assert s.works["w1"].result=="REJECTED"
    before=deepcopy(s.works["w1"].assurance_reviews)
    assert act(s,16,"resubmit","a",result_ref="model://final-v2")["reason"] == (
        "QUALITY_FAILED_RESULT_REQUIRES_EXECUTED_CORRECTION")
    assert s.works["w1"].result_ref=="model://final-v1"
    assert s.works["w1"].assurance_reviews==before
    assert len(s.works["w1"].assurance_review_history)==2


def test_quality_evidence_reference_cannot_be_reused_or_precede_result():
    s=QualitativeAKIS(scenario())
    assert s.apply(quality_event(1),1)["reason"]=="QUALITY_SUBMITTED_RESULT_REQUIRED"
    for e in execution_events():
        s.apply(e,e["at"])
    first=quality_event(12)
    assert s.apply(first,12)["outcome"]=="APPLIED"
    conflict=quality_event(13,criterion_id="documents",
                           quality_evidence_ref=first["quality_evidence_ref"])
    assert s.apply(conflict,13)["reason"]=="QUALITY_UNIQUE_EVIDENCE_REQUIRED"
    assert set(s.works["w1"].assurance_reviews)=={"fit"}


def test_original_quality_commitment_code_keeps_priority_after_later_org_mode_change():
    s,_=apply_sequence(scenario(),execution_events())
    # A historical obligation is not silently rewritten by later mode change.
    old_code=s.works["w1"].commitment_org_revision
    assert old_code=="oc-1"
    shift={"at":12, "action":"change_mode", "actor":"FOUNDERS",
           "expected_revision":"oc-1", "new_revision":"oc-2",
           "new_mode":"COLLEGIAL", "authorized_by":["op","a","b"]}
    assert s.apply(shift,12)["outcome"]=="APPLIED"
    assert s.apply(quality_event(13),13)["outcome"]=="APPLIED"
    assert s.apply(quality_event(14,criterion_id="documents"),14)["outcome"]=="APPLIED"
    assert act(s,15,"accept","c")["outcome"]=="APPLIED"
    assert s.works["w1"].commitment_org_revision=="oc-1"
    assert s.institution.revision=="oc-2"


def test_legacy_work_without_criteria_keeps_separate_customer_acceptance():
    d=world()
    s,_=apply_sequence(d,execution_events())
    assert act(s,12,"accept","c")["outcome"]=="APPLIED"
    assert "assurance" not in s.snapshot()["works"]["w1"]
    assert s.snapshot()["profit"]["system_increment"]=="UNKNOWN"


def test_native_mesa_work_quality_changes_result_acceptance_and_same_original_trace():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    d=scenario()
    d["events"]=execution_events()+[
        quality_event(12),quality_event(13,criterion_id="documents"),
        {"at":14,"action":"accept","actor":"c","work":"w1"},
    ]
    d["model_horizon"]=16
    d["general_akis"]=design()
    out=simulate(d)
    assert out["counts"]=={"applied":14,"blocked":0}
    assert out["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w1"]["assurance"]["model_reported_met_count"]==2
    assert out["general_akis_model"]["legal_consent_created"] is False
    assert out["works"]["w1"]["assurance"]["independent_real_quality_certification"]=="NOT_ESTABLISHED"
    assert out["profit"]["system_increment"]=="UNKNOWN"
    assert simulate(deepcopy(d))==out


def test_qualified_quality_source_after_original_source_update_but_never_auto_consent():
    d=scenario()
    d["context_evidence"]={
        "strict":False,
        "sources":[{
            "id":"qa-c", "owner":"c", "revision":"r0",
            "status":"UNKNOWN", "usable_by":["c"],
            "core":"corporate","purposes":["acceptance-review"],
            "operations":["ACCEPT"],"valid_from":0,
        }],
        "requirements":[{
            "work":"w1","action":"assess_result_quality",
            "sources":["qa-c"],"expected_revisions":["r1"],
            "core":"corporate","purpose":"acceptance-review","operation":"ACCEPT",
        }],
    }
    state,_=apply_sequence(d,execution_events())
    denied=state.apply(quality_event(12),12)
    assert denied["reason"]=="CONTEXT_REVISION_STALE"
    assert state.works["w1"].assurance_reviews=={}
    update={"at":13,"action":"source_update","actor":"c",
            "source":"qa-c","new_revision":"r1",
            "status":"CONFIRMED","usable_by":["c"]}
    assert state.apply(update,13)["outcome"]=="APPLIED"
    assert state.apply(quality_event(14),14)["outcome"]=="APPLIED"
    assert state.apply(quality_event(15,criterion_id="documents"),15)["outcome"]=="APPLIED"
    assert state.works["w1"].result=="SUBMITTED"
    assert act(state,16,"accept","c")["outcome"]=="APPLIED"
    assert state.snapshot()["works"]["w1"]["assurance"]["model_reported_met_count"]==2
    assert state.snapshot()["institution"]["revision"]=="oc-1"
    assert state.trace[-4]["action"]=="source_update"


def test_native_mesa_quality_and_original_owner_cost_records_share_one_economic_ledger():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    from .test_economic_flow import fixture as economy_fixture, source
    d=scenario()
    d["events"]=execution_events()+[
        quality_event(12), quality_event(13,criterion_id="documents"),
        {"at":14,"action":"accept","actor":"c","work":"w1"},
    ]
    d["model_horizon"]=16
    d["general_akis"]=design()
    d["cooperation_links"]=[{
        "id":"quality-net","purpose":"cross-owner execution with accepted quality",
        "coordinator":"op","participants":["a","b","c","op"],
        "works":["w1"],"mechanisms":["TRANSACTION_COST"],
        "source_ref":"model://quality-relation", "source_revision":"net-r1",
    }]
    econ=economy_fixture()
    econ["sources"].append(source("c1","c"))
    econ["coverage"]["COOPERATION"]["c"]="c1"
    econ["coverage"]["INDEPENDENT_ALTERNATIVE"]["c"]="c1"
    econ["outside_feasibility"]["c"]={"state":"UNKNOWN","source":"c1"}
    # This amount is an arbitrary synthetic source claim, NOT actual
    # inspection spending or additional cost created by quality attestation.
    econ["resource_uses"].append({
        "id":"quality-review-cost", "scenario":"COOPERATION",
        "owner":"c", "amount":"8.00", "bucket":"COORDINATION",
        "source":"c1", "work":"w1",
    })
    d["economic_claims"]=econ
    out=simulate(d)
    work=out["economics"]["original_work_record_evidence"]["w1"]
    assert work["original_result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert work["existing_noncash_resource_use_rows"]["COOPERATION"]==1
    assert work["existing_transfer_rows"]["COOPERATION"]==4
    assert work["original_model_quality_criteria_count"]==2
    assert work["original_model_quality_gate"]=="NONE"
    assert work["work_specific_alternative_scope"]=="NOT_QUALIFIED"
    assert work["quality_check_and_rework_cost_completeness"]=="NOT_QUALIFIED"
    assert work["economic_benefit_due_to_accepted_result"]=="NOT_IDENTIFIABLE"
    assert out["economics"]["resource_costs_additive_to_cash"] is False
    assert out["economics"]["profit"]=="UNKNOWN"
    assert out["economics"]["economic_value_added"]=="NOT_IDENTIFIABLE"
    relation=out["cooperation"]["system_projection"]["relations"][0]
    assert relation["components"]["П"]["quality_scoped_original_work_count"]==1
    assert relation["components"]["П"]["quality_criteria_declared"]==2
    assert relation["components"]["КЖ"]["work_quality_acceptance_evidence"]["w1"][
        "accepted_with_all_declared_model_quality"
    ] is True
    assert relation["components"]["Э"][
        "quality_acceptance_not_proof_of_transaction_savings"
    ] is True
    assert relation["components"]["ЖЦ"][
        "accepted_model_quality_is_not_verified_learning_or_reusable_capability"
    ] is True
    assert out["general_akis_model"]["work_quality_feedback"][
        "model_recipient_attested_met_count"
    ]==2
    assert out["general_akis_model"]["work_quality_feedback"][
        "causal_transaction_cost_reduction"
    ]=="NOT_IDENTIFIABLE"
    assert out["counts"]=={"applied":14,"blocked":0}
    assert simulate(deepcopy(d))==out


def test_unscoped_economic_cost_rows_not_redistributed_to_a_work_by_result_acceptance():
    from research.akis.qualitative_mesa.economic_flow import evaluate_economic_claims
    from .test_economic_flow import fixture as economy_fixture, work_state, subject_state
    d=economy_fixture()
    result=evaluate_economic_claims(d,subject_state(),work_state())
    work=result["original_work_record_evidence"]["w1"]
    assert work["existing_noncash_resource_use_rows"]["COOPERATION"]==0
    assert work["existing_transfer_rows"]["COOPERATION"]==4
    assert result["resource_uses_count"]==2
    assert work["economic_benefit_due_to_accepted_result"]=="NOT_IDENTIFIABLE"
    assert result["profit"]=="UNKNOWN"


def test_original_quality_source_revocation_before_acceptance_invalidates_prior_model_assessments():
    d=scenario()
    d["context_evidence"]={
        "strict":False,
        "sources":[{
            "id":"qa-c", "owner":"c", "revision":"r1",
            "status":"CONFIRMED", "usable_by":["c"],
            "core":"corporate", "purposes":["acceptance-review"],
            "operations":["ACCEPT"], "valid_from":0,
        }],
        "requirements":[{
            "work":"w1","action":"assess_result_quality",
            "sources":["qa-c"], "expected_revisions":["r1"],
            "core":"corporate", "purpose":"acceptance-review", "operation":"ACCEPT",
        }],
    }
    state,_=apply_sequence(d,execution_events())
    assert state.apply(quality_event(12),12)["outcome"]=="APPLIED"
    assert state.apply(quality_event(13,criterion_id="documents"),13)["outcome"]=="APPLIED"
    revoked={
        "at":14,"action":"source_update","actor":"c",
        "source":"qa-c", "new_revision":"r2",
        "status":"CONFIRMED", "usable_by":["c"],
    }
    assert state.apply(revoked,14)["outcome"]=="APPLIED"
    blocked=act(state,15,"accept","c")
    assert blocked["outcome"]=="BLOCKED"
    assert blocked["reason"]=="CONTEXT_REVISION_STALE"
    assert state.works["w1"].result=="SUBMITTED"
    assert state.works["w1"].obligation=="ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert len(state.works["w1"].assurance_reviews)==2
    # A later source revision cannot retroactively make previously accepted
    # original Result invalid: historical acceptance survives when earlier.
    earlier=QualitativeAKIS(d)
    for event in execution_events():
        earlier.apply(event,event["at"])
    earlier.apply(quality_event(12),12)
    earlier.apply(quality_event(13,criterion_id="documents"),13)
    assert act(earlier,14,"accept","c")["outcome"]=="APPLIED"
    assert earlier.apply({**revoked,"at":15},15)["outcome"]=="APPLIED"
    assert earlier.works["w1"].result=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_native_quality_gate_defers_predeclared_future_need_until_original_quality_result_accepted():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    from .test_future_need_mesa_integration import future
    d=scenario()
    d["events"]=execution_events()+[
        quality_event(12),
        quality_event(13,criterion_id="documents"),
        {"at":14,"action":"accept","actor":"c","work":"w1"},
    ]
    d["future_need_signals"]=[
        future(owner="c",ident="follow-on",work_id="w2",
               start=0,end=20,slot_start=10,slot_end=16,
               resource="ra",prereq=[{"work":"w1","source_revision":"d1"}])
    ]
    d["model_horizon"]=18
    out=simulate(d)
    timeline={row["at"]:row["projection"]["needs"][0]["status"]
              for row in out["future_need_dynamics"]["read_only_evolution"]}
    assert timeline[0.0]=="FUTURE_NEED_AWAIT_ORIGINAL_ACCEPTED_RESULT"
    assert timeline[14.0]=="SOURCE_ACTIVE_FOR_RESEARCH"
    assert out["future_need_dynamics"]["current"]["needs"][0]["status"]=="SOURCE_ACTIVE_FOR_RESEARCH"
    assert "w2" not in out["works"]
    assert out["future_need_dynamics"]["no_automatic_original_request_or_contract"]
    assert out["works"]["w1"]["assurance"]["model_reported_met_count"]==2
    assert out["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["counts"]=={"applied":14,"blocked":0}
    reject=deepcopy(d)
    reject["events"][-1]["action"]="reject"
    bad=simulate(reject)
    assert bad["works"]["w1"]["result"]=="REJECTED"
    assert bad["future_need_dynamics"]["current"]["needs"][0][
        "status"
    ]=="FUTURE_NEED_AWAIT_ORIGINAL_ACCEPTED_RESULT"
    assert "w2" not in bad["works"]
    assert bad["counts"]=={"applied":14,"blocked":0}
