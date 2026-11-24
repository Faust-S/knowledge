"""R1-W2F: one native Work, immutable negative acts, separate causal routes."""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.capacity import ResourceNeed
from research.akis.qualitative_mesa.economic_flow import (
    EconomicInputError, evaluate_economic_claims,
)
from .test_work_assurance_mesa import scenario, quality_event, execution_events


def send(s, at, action, actor, **kw):
    return s.apply(dict(at=at, action=action, actor=actor, work="w1", **kw), at)


def check(s, at, action, actor, **kw):
    row = send(s, at, action, actor, **kw)
    assert row["outcome"] == "APPLIED", row
    return row


def run_initial(d=None, *, fail="documents", reject=True):
    d = scenario() if d is None else d
    s = QualitativeAKIS(d)
    for event in execution_events():
        row = s.apply(event, event["at"])
        assert row["outcome"] == "APPLIED", row
    for i, key in enumerate(("fit", "documents"), 12):
        event = quality_event(i, criterion_id=key, verdict=(
            "DOES_NOT_MEET" if key == fail else "MEETS_DECLARED_REQUIREMENT"))
        assert s.apply(event, i)["outcome"] == "APPLIED"
    if reject:
        check(s, 14, "reject", "c")
    return s


def terms(**changes):
    return dict(
        operation="pack", quality_correction_id="correction-1",
        result_ref="model://final-v1", source_revision="d1", org_revision="oc-1",
        quality_correction_slot_start=24, quality_correction_slot_end=26,
        quality_correction_valid_until=23,
        quality_correction_source_ref="model://c/correction-proposal",
        quality_correction_resource_ref="model://b/correction-resources",
        quality_correction_cost="4500", quality_correction_currency="RUB",
        **changes,
    )


def propose(s, at=15, **changes):
    args = terms()
    args.update(changes)
    row = check(s, at, "quality_correction_propose", "c", **args)
    return row["quality_correction_fingerprint"]


def fields(digest, **changes):
    args = dict(quality_correction_id="correction-1",
                quality_correction_fingerprint=digest,
                result_ref="model://final-v1",
                source_revision="d1", org_revision="oc-1")
    args.update(changes)
    return args


def review(s, at, owner, digest, decision="SUPPORT", **changes):
    args = fields(digest, quality_correction_decision=decision,
                  quality_correction_source_ref=f"model://{owner}/correction-vote")
    args.update(changes)
    return send(s, at, "quality_correction_review", owner, **args)


def approve(s, digest, at=19):
    for i, owner in enumerate(("a", "b", "c"), 16):
        row = review(s, i, owner, digest)
        assert row["outcome"] == "APPLIED", row
    return check(s, at, "quality_correction_apply", "c",
                 **fields(digest, quality_correction_source_ref="model://c/correction-apply"))


def start(s, digest, at=24, **changes):
    args = fields(digest, quality_correction_source_ref="model://b/correction-start",
                  quality_correction_cost_ref="model://b/correction-cost-actual",
                  quality_correction_cost="4500")
    args.update(changes)
    return send(s, at, "quality_correction_start", "b", **args)


def finish(s, digest, at=26):
    return send(s, at, "quality_correction_complete", "b",
                **fields(digest, quality_correction_source_ref="model://b/correction-done"))


def resubmit(s, digest, at=27):
    return send(s, at, "resubmit", "a", result_ref="model://final-v2",
                quality_correction_id="correction-1",
                quality_correction_fingerprint=digest)


def physical_ready(d=None):
    s = run_initial(d)
    digest = propose(s)
    approve(s, digest)
    return s, digest


def test_same_result_explicit_measurement_correction_preserves_original_act():
    s = run_initial(reject=False)
    w = s.works["w1"]
    reservations = list(s.capacity_ledger.reservations)
    operation_evidence = dict(w.operation_evidence)
    negative = deepcopy(w.assurance_reviews["documents"])
    assert send(s, 14, "accept", "c")["reason"] == "QUALITY_DECLARED_CRITERION_FAILED"
    bad = quality_event(15, criterion_id="documents")
    assert s.apply(bad, 15)["reason"] == "QUALITY_EXPLICIT_REASSESSMENT_REQUIRED"
    assert w.assurance_reviews["documents"] == negative
    event = quality_event(16, criterion_id="documents",
        quality_reassessment_of=negative["model_ref"],
        quality_reassessment_reason="MEASUREMENT_ERROR",
        quality_reassessment_ref="model://c/calibration-error")
    assert s.apply(event, 16)["outcome"] == "APPLIED"
    check(s, 17, "accept", "c")
    assert w.result_ref == "model://final-v1"
    assert w.assurance_review_history[1]["verdict"] == "DOES_NOT_MEET"
    assert w.assurance_review_history[-1]["reassessment"]["of"] == negative["model_ref"]
    assert w.assurance_review_history[-1]["reassessment"]["physical_reexecution"] is False
    assert not w.assurance_corrections
    assert s.capacity_ledger.reservations == reservations
    assert w.operation_evidence == operation_evidence


@pytest.mark.parametrize("change,reason", [
    ({"quality_reassessment_of": "model://c/wrong-act"},
     "QUALITY_REASSESSMENT_ORIGINAL_ACT_AND_REASON_REQUIRED"),
    ({"quality_reassessment_reason": "PHYSICAL_REWORK"},
     "QUALITY_REASSESSMENT_ORIGINAL_ACT_AND_REASON_REQUIRED"),
    ({"quality_reassessment_ref": "model://b/foreign"},
     "QUALITY_ORIGINAL_OWNER_SOURCE_REQUIRED"),
    ({"quality_reassessment_ref": "model://c/inspected-documents-13"},
     "QUALITY_REASSESSMENT_NEW_ERROR_SOURCE_REQUIRED"),
])
def test_reassessment_requires_current_act_and_own_distinct_error_source(change, reason):
    s = run_initial(reject=False)
    w = s.works["w1"]
    old = deepcopy(w.assurance_reviews)
    args = dict(criterion_id="documents",
                quality_reassessment_of=w.assurance_reviews["documents"]["model_ref"],
                quality_reassessment_reason="TRANSCRIPTION_ERROR",
                quality_reassessment_ref="model://c/new-error")
    args.update(change)
    event = quality_event(14, **args)
    assert s.apply(event, 14)["reason"] == reason
    assert w.assurance_reviews == old
    assert len(w.assurance_review_history) == 2


def test_intermediate_operation_cannot_be_silently_reworked_after_downstream_execution():
    s = run_initial(fail="fit")
    before = list(s.capacity_ledger.reservations)
    args = terms()
    args["operation"] = "cut"
    assert send(s, 15, "quality_correction_propose", "c", **args)["reason"] == (
        "QUALITY_CORRECTION_TERMINAL_SINGLE_RESOURCE_OPERATION_REQUIRED")
    assert send(s, 16, "resubmit", "a", result_ref="model://final-v2")["reason"] == (
        "QUALITY_FAILED_RESULT_REQUIRES_EXECUTED_CORRECTION")
    assert s.capacity_ledger.reservations == before
    assert s.works["w1"].assurance_correction_proposal is None


def test_missing_support_and_objection_never_reserve_or_create_resource_claim():
    s = run_initial()
    w = s.works["w1"]
    before = list(s.capacity_ledger.reservations)
    digest = propose(s)
    assert send(s, 16, "quality_correction_apply", "c",
                **fields(digest, quality_correction_source_ref="model://c/early"))["reason"] == (
        "QUALITY_CORRECTION_INDEPENDENT_SUPPORT_REQUIRED")
    assert review(s, 17, "a", digest)["outcome"] == "APPLIED"
    assert review(s, 18, "b", digest, decision="OBJECT")["outcome"] == "APPLIED"
    assert review(s, 19, "c", digest)["outcome"] == "APPLIED"
    assert review(s, 20, "b", digest)["reason"] == "QUALITY_CORRECTION_INDEPENDENT_REVIEW_REQUIRED"
    assert send(s, 21, "quality_correction_apply", "c",
                **fields(digest, quality_correction_source_ref="model://c/apply"))["reason"] == (
        "QUALITY_CORRECTION_INDEPENDENT_SUPPORT_REQUIRED")
    check(s, 22, "quality_correction_cancel", "c",
          **fields(digest, quality_correction_source_ref="model://c/cancel"))
    assert w.assurance_corrections[-1]["votes"]["b"]["decision"] == "OBJECT"
    assert not w.assurance_corrections[-1].get("additional_resource_use_claim")
    assert s.capacity_ledger.reservations == before


def test_capacity_conflict_blocks_correction_without_rewriting_original_reservation():
    d = scenario()
    d["works"].append(dict(id="w2", customer="c", resource="rb", source_revision="d2",
                            slot_start=24, slot_end=26))
    s = run_initial(d)
    for t, action, actor, kw in [
        (15, "offer", "op", {}), (16, "authorize", "op", {}),
        (17, "consent", "b", dict(source_revision="d2", org_revision="oc-1")),
        (18, "consent", "c", dict(source_revision="d2", org_revision="oc-1")),
        (19, "commit", "op", {}),
    ]:
        result = s.apply(dict(at=t, action=action, actor=actor, work="w2", **kw), t)
        assert result["outcome"] == "APPLIED", result
    before = list(s.capacity_ledger.reservations)
    assert send(s, 20, "quality_correction_propose", "c", **terms())["reason"] == (
        "RESOURCE_CAPACITY_EXCEEDED")
    assert s.capacity_ledger.reservations == before


def test_physical_correction_executes_same_terminal_operation_and_new_result_requires_all_acts():
    s, digest = physical_ready()
    w = s.works["w1"]
    assert len(s.capacity_ledger.reservations) == 3
    assert w.operation_states["pack"] == "CORRECTION_PLANNED"
    assert w.operation_evidence["pack"] == "model://pack-exec"
    assert not w.assurance_corrections[-1].get("additional_resource_use_claim")
    assert finish(s, digest, at=21)["outcome"] == "BLOCKED"
    assert start(s, digest, at=22)["outcome"] == "BLOCKED"
    assert start(s, digest, at=24, quality_correction_cost="4501")["reason"] == (
        "QUALITY_CORRECTION_COST_DIFFERS_FROM_AGREED_CLAIM")
    assert start(s, digest, at=24)["outcome"] == "APPLIED"
    assert start(s, digest, at=25)["outcome"] == "BLOCKED"
    assert finish(s, digest)["outcome"] == "APPLIED"
    claim = w.assurance_corrections[-1]["additional_resource_use_claim"]
    assert claim["amount"] == "4500.00" and claim["owner"] == "b"
    assert claim["bank_payment_proved"] is False
    assert resubmit(s, digest)["outcome"] == "APPLIED"
    assert send(s, 28, "accept", "c")["reason"] == "QUALITY_ORIGINAL_ASSESSMENT_MISSING"
    assert s.apply(quality_event(29, result_ref="model://final-v2"),29)["outcome"] == "APPLIED"
    assert send(s, 30, "accept", "c")["reason"] == "QUALITY_ORIGINAL_ASSESSMENT_MISSING"
    assert s.apply(quality_event(31, criterion_id="documents", result_ref="model://final-v2"),31)["outcome"] == "APPLIED"
    check(s, 32, "accept", "c")
    assert list(s.works) == ["w1"]
    assert w.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert w.assurance_review_history[1]["verdict"] == "DOES_NOT_MEET"
    assert w.assurance_corrections[0]["terms"]["original_operation_evidence"] == "model://pack-exec"
    assert w.operation_evidence["pack"] == "model://b/correction-done"
    assert len(w.assurance_review_history) == 4
    assert len(w.assurance_corrections) == 1


def test_resource_unavailability_after_approval_prevents_start_without_claim():
    s,digest = physical_ready()
    w=s.works["w1"]
    check(s, 20, "resource_status", "b", resource="rb", availability="UNAVAILABLE")
    assert start(s, digest)["reason"] == "RESOURCE_NOT_AVAILABLE"
    assert w.operation_states["pack"] == "CORRECTION_PLANNED"
    assert not w.assurance_corrections[-1].get("additional_resource_use_claim")


def test_economic_record_link_is_existing_source_not_additional_charge():
    s,digest = physical_ready()
    assert start(s,digest)["outcome"] == "APPLIED"
    econ = dict(period="model-period", currency="RUB", sources=[
        dict(id="repair-cost", owner="b", reference="model://b/correction-cost-actual", revision="r1")
    ], transfers=[], resource_uses=[], coverage={"COOPERATION": {}, "INDEPENDENT_ALTERNATIVE": {}},
        outside_feasibility={})
    def report(raw):
        return evaluate_economic_claims(raw,s.subjects,s.works)
    out=report(econ)
    claim=out["original_work_record_evidence"]["w1"]["quality_correction_resource_uses"][0]
    assert claim["state"] == "UNLINKED_RESOURCE_USE_CLAIM"
    assert out["resource_uses_count"] == 0 and out["transfers_count"] == 0
    econ["resource_uses"].append(dict(id="actual-correction", scenario="COOPERATION", owner="b",
        amount="4500", bucket="FAILURE", source="repair-cost", work="w1"))
    out=report(econ)
    claim=out["original_work_record_evidence"]["w1"]["quality_correction_resource_uses"][0]
    assert claim["state"] == "BOUND_EXISTING_RESOURCE_USE"
    assert claim["original_resource_use_id"] == "actual-correction"
    assert claim["additional_cash_or_cost_row_created"] is False
    assert out["resource_uses_count"] == 1 and out["transfers_count"] == 0
    econ["resource_uses"].append({**econ["resource_uses"][0], "id": "duplicate-correction"})
    with pytest.raises(EconomicInputError,match="DUPLICATE_QUALITY_CORRECTION_RESOURCE_USE"):
        report(econ)


def test_native_mesa_clock_runs_agreed_physical_correction():
    from research.akis.qualitative_mesa.mesa_model import simulate
    s=run_initial()
    digest=propose(s)
    events=execution_events()+[
        quality_event(12),quality_event(13,criterion_id="documents",verdict="DOES_NOT_MEET"),
        dict(at=14,action="reject",actor="c",work="w1"),
        dict(at=15,action="quality_correction_propose",actor="c",work="w1",**terms()),
        *[dict(at=i,action="quality_correction_review",actor=owner,work="w1",
              **fields(digest,quality_correction_decision="SUPPORT",
                       quality_correction_source_ref=f"model://{owner}/correction-vote"))
          for i,owner in enumerate(("a","b","c"),16)],
        dict(at=19,action="quality_correction_apply",actor="c",work="w1",
             **fields(digest,quality_correction_source_ref="model://c/correction-apply")),
        dict(at=24,action="quality_correction_start",actor="b",work="w1",
             **fields(digest,quality_correction_source_ref="model://b/correction-start",
                      quality_correction_cost_ref="model://b/correction-cost-actual",quality_correction_cost="4500")),
        dict(at=26,action="quality_correction_complete",actor="b",work="w1",
             **fields(digest,quality_correction_source_ref="model://b/correction-done")),
        dict(at=27,action="resubmit",actor="a",work="w1",result_ref="model://final-v2",
             quality_correction_id="correction-1",quality_correction_fingerprint=digest),
        quality_event(28,result_ref="model://final-v2"),
        quality_event(29,criterion_id="documents",result_ref="model://final-v2"),
        dict(at=30,action="accept",actor="c",work="w1"),
    ]
    d=scenario()
    d["events"]=events
    d["model_horizon"]=32
    out=simulate(d)
    assert out["counts"]=={"applied":len(events),"blocked":0}, out["trace"]
    assert out["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w1"]["assurance"]["physical_corrections"][0]["status"]=="RESUBMITTED"
    assert out["works"]["w1"]["assurance"]["assessment_history"][1]["verdict"]=="DOES_NOT_MEET"
    assert simulate(deepcopy(d))==out


def strict_case():
    d=scenario()
    actions={
        "authorize", "consent", "commit", "start_operation", "complete_operation",
        "complete", "assess_result_quality", "resubmit", "accept",
        "quality_correction_propose", "quality_correction_review", "quality_correction_apply",
        "quality_correction_start", "quality_correction_complete", "quality_correction_cancel",
    }
    principals=["op","a","b","c"]
    sources=[
        dict(id=f"model://op/right-{a}", owner="op", revision="right-r1",
             status="CONFIRMED", usable_by=principals, valid_until=100)
        for a in sorted(actions)
    ]
    refs={
        "c": ["criterion-fit", "criterion-documents", "inspected-fit-12",
              "inspected-documents-13", "correction-proposal", "correction-vote",
              "correction-apply", "inspected-fit-28", "inspected-documents-29",
              "inspected-documents-16", "calibration-error"],
        "a": ["correction-vote"],
        "b": ["correction-resources", "correction-vote", "correction-start",
              "correction-cost-actual", "correction-done"],
    }
    for owner, names in refs.items():
        sources.extend(dict(id=f"model://{owner}/{name}",owner=owner,revision="r1",
                            status="CONFIRMED",usable_by=[owner],valid_until=100)
                       for name in names)
    d["context_evidence"]={
        "strict":True, "sources":sources,
        "requirements":[
            dict(work="w1",action=a,sources=[f"model://op/right-{a}"],
                 expected_revisions=["right-r1"]) for a in sorted(actions)
        ],
    }
    return d


def test_strict_kpb_revoked_vote_source_blocks_application_without_reservation():
    s=run_initial(strict_case())
    digest=propose(s)
    for i,owner in enumerate(("a","b","c"),16):
        assert review(s,i,owner,digest)["outcome"]=="APPLIED"
    row=s.apply(dict(at=19,action="source_update",actor="b",
        source="model://b/correction-vote",new_revision="r2",status="DISPROVED",
        usable_by=["b"]),19)
    assert row["outcome"]=="APPLIED",row
    before=list(s.capacity_ledger.reservations)
    result=send(s,20,"quality_correction_apply","c",
                **fields(digest,quality_correction_source_ref="model://c/correction-apply"))
    assert result["reason"]=="QUALITY_ORIGINAL_SOURCE_UNAVAILABLE",result
    assert s.capacity_ledger.reservations==before
    assert s.works["w1"].assurance_corrections==[]


def test_strict_kpb_full_correction_and_acceptance_rechecks_new_evidence():
    s,digest=physical_ready(strict_case())
    assert start(s,digest)["outcome"]=="APPLIED"
    assert finish(s,digest)["outcome"]=="APPLIED"
    assert resubmit(s,digest)["outcome"]=="APPLIED"
    assert s.apply(quality_event(28,result_ref="model://final-v2"),28)["outcome"]=="APPLIED"
    assert s.apply(quality_event(29,criterion_id="documents",result_ref="model://final-v2"),29)["outcome"]=="APPLIED"
    assert send(s,30,"accept","c")["outcome"]=="APPLIED"
    assert s.works["w1"].assurance_corrections[0]["additional_resource_use_claim"]["source_revision"]=="r1"


def test_strict_reassessment_is_not_accepted_after_error_source_revocation():
    s=run_initial(strict_case(),reject=False)
    old=s.works["w1"].assurance_reviews["documents"]["model_ref"]
    event=quality_event(16,criterion_id="documents",quality_reassessment_of=old,
                        quality_reassessment_reason="MEASUREMENT_ERROR",
                        quality_reassessment_ref="model://c/calibration-error")
    assert s.apply(event,16)["outcome"]=="APPLIED"
    row=s.apply(dict(at=17,action="source_update",actor="c",
        source="model://c/calibration-error",new_revision="r2",status="DISPROVED",
        usable_by=["c"]),17)
    assert row["outcome"]=="APPLIED",row
    assert send(s,18,"accept","c")["reason"]=="QUALITY_ORIGINAL_SOURCE_UNAVAILABLE"
    assert s.works["w1"].result=="SUBMITTED"
