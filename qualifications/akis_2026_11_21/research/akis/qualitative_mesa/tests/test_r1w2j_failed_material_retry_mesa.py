"""R1-W2J: separately approved retry after a failed new material generation."""
from copy import deepcopy
from decimal import Decimal

import pytest

from research.akis.qualitative_mesa.economic_flow import evaluate_economic_claims
from research.akis.qualitative_mesa.work_assurance import (
    correction_resource_claims, current_material_generation,
)
from .test_r1w2i_material_generation_correction_mesa import MaterialCase, strict_world, revoke, world


class RetryCase(MaterialCase):
    def first_start(self):
        self.proposal();self.approve()
        self.start("source","a",50,12000);self.finish("source","a",53)

    def failure(self,prefix="input"):
        self.first_start()
        if prefix=="output":
            self.handoff("input")
            self.start("form","b",60,4500);self.finish("form","b",64)
        self.handoff_event(prefix,"dispatch")
        self.handoff_event(prefix,"receive")
        self.handoff_event(prefix,"quality",quality_quantities=[
            dict(batch=f"{prefix}-2",accepted="1",rejected="1"),
            dict(batch=f"{prefix}-3",accepted="3",rejected="0")])

    def retry_terms(self,ident="material-correction-2",offset=60):
        p=self.terms(ident=ident,offset=offset)
        p["quality_correction_retry_of"]="material-correction-1"
        for r in p["quality_correction_material_revisions"]:
            b=next(b for b in self.w.material_batches if b.key==r["batch"])
            h=next(h for h in self.w.handoffs if h.edge==b.edge)
            if self.w.handoff_states[b.edge]=="NOT_DISPATCHED":
                r["disposition"]="NOT_DISPATCHED_GENERATION_CANCELLED"
                r["disposition_ref"]=f"model://{h.sender}/{ident}-{b.key}-exclude"
        return p

    def retry(self,**changes):
        p=self.retry_terms();p.update(changes)
        self.proposal(**p)
        return self.w.assurance_correction_proposal

    def finish_retry(self):
        self.complete_plan(offset=60)
        self.resubmit("model://a/final-v2")
        self.assess("model://a/final-v2")
        self.action("accept","c")


@pytest.mark.parametrize("step,reason",[
    ("source","QUALITY_CORRECTION_RETRY_NEGATIVE_MATERIAL_ASSESSMENT_REQUIRED"),
    ("dispatch","QUALITY_CORRECTION_RETRY_MATERIAL_IN_TRANSIT"),
    ("receive","QUALITY_CORRECTION_RETRY_ALL_RECEIVED_MATERIAL_ASSESSED_REQUIRED"),
    ("quality","QUALITY_CORRECTION_RETRY_NEGATIVE_MATERIAL_ASSESSMENT_REQUIRED"),
])
def test_retry_requires_closed_negative_custody_evidence(step,reason):
    x=RetryCase();x.first_start()
    for a in ("dispatch","receive","quality"):
        if step=="source":
            break
        x.handoff_event("input",a)
        if a==step:
            break
    before=deepcopy([x.w.assurance_corrections,x.w.operation_states,x.w.material_states,
                     x.s.capacity_ledger.reservations])
    x.action("quality_correction_propose","c",**x.retry_terms(),expected="BLOCKED",reason=reason)
    assert [x.w.assurance_corrections,x.w.operation_states,x.w.material_states,
            x.s.capacity_ledger.reservations]==before


def test_failed_material_candidate_does_not_reopen_without_explicit_new_decision():
    x=RetryCase();x.failure()
    state=x.s.snapshot()["works"]["w1"]["assurance"]["material_retry_candidate"]
    assert state["state"]=="CANDIDATE_REQUIRES_ORIGINAL_SOURCES_CAPACITY_AND_INDEPENDENT_APPROVAL"
    assert state["retry_of"]=="material-correction-1"
    assert state["failed_batches"]==[{
        "batch":"input-2","quality_ref":"model://b/input-material-correction-1-quality",
        "planned_quantity":"2","accepted_quantity":"1","rejected_quantity":"1"}]
    p=x.retry_terms();p.pop("quality_correction_retry_of")
    x.action("quality_correction_propose","c",**p,expected="BLOCKED",
             reason="QUALITY_CORRECTION_ORIGINAL_CUSTOMER_AND_NO_OPEN_ATTEMPT_REQUIRED")
    assert x.w.assurance_corrections[0]["status"]=="IN_PROGRESS"


def test_retry_requires_explicit_exclusion_of_undispatched_generation():
    x=RetryCase();x.failure()
    p=x.retry_terms()
    r=next(r for r in p["quality_correction_material_revisions"] if r["batch"]=="output-2")
    r["disposition"]="EXCLUDED_FROM_NEW_ATTEMPT"
    x.action("quality_correction_propose","c",**p,expected="BLOCKED",
             reason="QUALITY_CORRECTION_PRIOR_MATERIAL_DISPOSITION_REQUIRED")
    assert x.w.material_states["input-2"].rejected==Decimal(1)


def test_retry_proposal_and_missing_vote_preserve_failed_attempt():
    x=RetryCase();x.failure()
    old=deepcopy(x.w.assurance_corrections[0]);capacity=list(x.s.capacity_ledger.reservations)
    materials=deepcopy(x.w.material_states)
    x.retry();x.vote("a");x.vote("c")
    x.apply_plan(expected="BLOCKED",reason="QUALITY_CORRECTION_INDEPENDENT_SUPPORT_REQUIRED")
    assert x.w.assurance_corrections[0]==old
    assert x.w.material_states==materials
    assert x.s.capacity_ledger.reservations==capacity
    x.vote("b");x.apply_plan()
    first=x.w.assurance_corrections[0]
    assert first["status"]=="SUPERSEDED_BY_MATERIAL_RETRY"
    assert first["superseded_by"]=="material-correction-2"
    assert first["operations"]==old["operations"]
    assert first["handoff_events"]==old["handoff_events"]
    assert first["failed_material_snapshot"]["failed_batches"][0]["accepted_quantity"]=="1"
    assert x.s.capacity_ledger.reservations[:len(capacity)]==capacity
    assert all(current_material_generation(x.w,b.key)["prior_generation"]=="material-correction-1"
               for b in x.w.material_batches)
    assert all(st==type(st)() for st in x.w.material_states.values())


def test_cancelled_retry_proposal_does_not_supersede_active_generation():
    x=RetryCase();x.failure();x.retry()
    x.action("quality_correction_cancel","c",**x.common,
             quality_correction_source_ref="model://c/retry-cancel")
    assert x.w.assurance_corrections[-1]["status"]=="CANCELLED"
    assert x.w.assurance_corrections[0]["status"]=="IN_PROGRESS"
    p=x.retry_terms(ident="material-correction-3")
    x.retry(**p);x.approve();x.finish_retry()
    assert x.native()["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("prefix,expected_prior",[
    ("input",Decimal("12000")),("output",Decimal("16500")),
])
def test_successful_retry_preserves_only_started_resource_use_from_failed_attempt(prefix,expected_prior):
    x=RetryCase();x.failure(prefix)
    x.retry();x.approve();x.finish_retry()
    first,second=x.w.assurance_corrections
    assert first["status"]=="SUPERSEDED_BY_MATERIAL_RETRY"
    assert second["status"]=="RESUBMITTED"
    total_prior=sum((Decimal(r["amount"]) for _,r in correction_resource_claims(first)),Decimal(0))
    total_new=sum((Decimal(r["amount"]) for _,r in correction_resource_claims(second)),Decimal(0))
    assert total_prior==expected_prior and total_new==Decimal("18200")
    claims=[(r["terms"]["id"],op,c) for r in x.w.assurance_corrections
            for op,c in correction_resource_claims(r)]
    raw=dict(period="P",currency="RUB",transfers=[],
        sources=[dict(id=f"s-{i}",owner=c["owner"],reference=c["source_ref"],revision="r1")
                 for i,(_,_,c) in enumerate(claims)],
        resource_uses=[dict(id=f"r-{i}",scenario="COOPERATION",owner=c["owner"],amount=c["amount"],
                          bucket="FAILURE",source=f"s-{i}",work="w1")
                       for i,(_,_,c) in enumerate(claims)],
        coverage={"COOPERATION":{},"INDEPENDENT_ALTERNATIVE":{}},outside_feasibility={})
    evidence=evaluate_economic_claims(raw,x.s.subjects,x.s.works,trace=x.s.trace)
    links=evidence["original_work_record_evidence"]["w1"]["quality_correction_resource_uses"]
    assert len(links)==len(claims) and evidence["transfers_count"]==0
    assert all(not row["additional_cash_or_cost_row_created"] for row in links)
    assert len(x.w.material_batches)==4
    assert x.native()["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


def strict_retry_world():
    sample=RetryCase();sample.failure();sample.retry();sample.approve();sample.finish_retry()
    return strict_world(sample)


def test_strict_retry_rechecks_failed_delivery_and_new_sources_at_application():
    x=RetryCase(strict_retry_world());x.failure();x.retry()
    for a in ("a","b","c"):
        x.vote(a)
    prior=deepcopy(x.w.assurance_corrections)
    capacity=list(x.s.capacity_ledger.reservations)
    revoke(x,x.w.material_states["input-2"].quality_ref)
    x.apply_plan(expected="BLOCKED",reason="QUALITY_ORIGINAL_SOURCE_UNAVAILABLE")
    assert x.w.assurance_corrections==prior and x.s.capacity_ledger.reservations==capacity


def test_strict_retry_replays_in_native_mesa_on_same_work():
    x=RetryCase(strict_retry_world());x.failure();x.retry();x.approve();x.finish_retry()
    assert x.native()["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert all(r["source_revision"]=="r1" for row in x.w.assurance_corrections
               for _,r in correction_resource_claims(row))


def test_short_receipt_does_not_erase_unaccounted_dispatched_material():
    x=RetryCase();x.first_start();x.handoff_event("input","dispatch")
    x.handoff_event("input","receive",material_quantities=[
        dict(batch="input-2",quantity="1"),dict(batch="input-3",quantity="3")])
    x.handoff_event("input","quality",quality_quantities=[
        dict(batch="input-2",accepted="0",rejected="1"),
        dict(batch="input-3",accepted="3",rejected="0")])
    before=deepcopy([x.w.material_states,x.w.assurance_corrections,x.s.capacity_ledger.reservations])
    x.action("quality_correction_propose","c",**x.retry_terms(),expected="BLOCKED",
             reason="QUALITY_CORRECTION_RETRY_UNRESOLVED_IN_TRANSIT_QUANTITY")
    assert [x.w.material_states,x.w.assurance_corrections,x.s.capacity_ledger.reservations]==before


def test_running_operation_cannot_be_replaced_by_a_material_retry():
    x=RetryCase();x.proposal();x.approve();x.start("source","a",50,12000)
    x.action("quality_correction_propose","c",**x.retry_terms(),expected="BLOCKED",
             reason="QUALITY_CORRECTION_RETRY_RUNNING_OPERATION")
    assert x.w.operation_states["source"]=="CORRECTION_RUNNING"


def test_retry_capacity_conflict_does_not_supersede_failed_attempt():
    d=world()
    d["works"].append(dict(id="w2",customer="c",resource="rb",source_revision="d2",
                           slot_start=120,slot_end=124))
    x=RetryCase(d);x.failure();x.retry()
    for a in ("a","b","c"):
        x.vote(a)
    for action,actor,kw in [
        ("offer","op",{}),("authorize","op",{}),
        ("consent","b",dict(source_revision="d2",org_revision="oc-1")),
        ("consent","c",dict(source_revision="d2",org_revision="oc-1")),
        ("commit","op",{}),
    ]:
        x.action(action,actor,work="w2",**kw)
    before=deepcopy([x.w.assurance_corrections,x.w.material_states,x.s.capacity_ledger.reservations])
    x.apply_plan(expected="BLOCKED",reason="RESOURCE_CAPACITY_EXCEEDED")
    assert [x.w.assurance_corrections,x.w.material_states,x.s.capacity_ledger.reservations]==before
    assert x.w.assurance_corrections[0]["status"]=="IN_PROGRESS"
