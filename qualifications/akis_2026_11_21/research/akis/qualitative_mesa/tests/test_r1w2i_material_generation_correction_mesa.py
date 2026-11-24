"""R1-W2I: new material generation on the original Work and Handoff DAG."""
from copy import deepcopy
from decimal import Decimal

import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.work_assurance import (
    quality_dependency_scope, correction_resource_claims, current_material_generation,
)
from .test_technology import world as technology_world, op
from .test_work_assurance_mesa import criterion, execution_events, quality_event
from .test_r1w2h_dependent_correction_mesa import Case


def world():
    d=technology_world()
    d["handoff_strict"]=True
    d["material_strict"]=True
    w=d["works"][0]
    w["slot_end"]=14
    w["operations"]=[
        op("source","ra",0,4), op("form","rb",4,8,("source",)),
        op("finish","ra",8,12,("form",)), op("independent","ra",12,14),
    ]
    w["assurance_criteria"]=[
        criterion("fit","form","b"),
        criterion("documents","finish","a",dimension="DOCUMENTATION"),
    ]
    w["material_batches"]=[
        dict(id=f"{prefix}-{qty}",from_operation=up,to_operation=down,
             material_id=f"{prefix}-material",planned_quantity=str(qty),unit="unit",
             declared_title_holder=sender,origin_source_owner=sender,
             origin_ref=f"model://{sender}/{prefix}-{qty}-origin",
             quality_spec_owner="c",quality_spec_ref=f"model://c/{prefix}-{qty}-spec")
        for prefix,up,down,sender in (
            ("input","source","form","a"),("output","form","finish","b"))
        for qty in (2,3)
    ]
    return d


class MaterialCase(Case):
    def __init__(self,d=None):
        self.d=world() if d is None else d
        self.s=QualitativeAKIS(self.d)
        self.w=self.s.works["w1"]
        self.events=[]
        self.at=0
        for e in execution_events()[:6]:
            self.emit(e)
        self.original_operation("source","a")
        self.handoff("input",new=False)
        self.original_operation("form","b")
        self.handoff("output",new=False)
        self.original_operation("finish","a")
        self.original_operation("independent","a")
        self.action("complete","a",result_ref="model://a/final-v1")
        self.emit(quality_event(self.at+1,verdict="DOES_NOT_MEET",result_ref="model://a/final-v1"))
        self.emit(quality_event(self.at+1,criterion_id="documents",result_ref="model://a/final-v1"))
        self.action("reject","c")

    def original_operation(self,key,actor):
        self.action("start_operation",actor,operation=key)
        self.action("complete_operation",actor,operation=key,result_ref=f"model://{actor}/{key}-original")

    def handoff_event(self,prefix,step,new=True,**changes):
        up,down,sender,receiver={
            "input":("source","form","a","b"),
            "output":("form","finish","b","a"),
        }[prefix]
        name=self.common["quality_correction_id"] if new else "original"
        actor=sender if step=="dispatch" else receiver
        args=dict(from_operation=up,to_operation=down,source_revision="d1",
                  org_revision="oc-1",result_ref=f"model://{actor}/{prefix}-{name}-{step}")
        if new:
            args.update({k:v for k,v in self.common.items()
                         if k in ("quality_correction_id","quality_correction_fingerprint")})
        if step in ("dispatch","receive"):
            args["material_quantities"]=[dict(batch=f"{prefix}-{n}",quantity=str(n)) for n in (2,3)]
        if step=="receive":
            args["dispatch_ref"]=f"model://{sender}/{prefix}-{name}-dispatch"
        if step=="quality":
            args["receipt_ref"]=f"model://{receiver}/{prefix}-{name}-receive"
            args["quality_quantities"]=[dict(batch=f"{prefix}-{n}",accepted=str(n),rejected="0") for n in (2,3)]
        args.update(changes)
        return self.action(f"handoff_{step}",actor,**args)

    def handoff(self,prefix,new=True):
        for step in ("dispatch","receive","quality"):
            self.handoff_event(prefix,step,new=new)

    def terms(self,*,ident="material-correction-1",offset=0):
        revisions=[]
        for b in self.w.material_batches:
            h=next(h for h in self.w.handoffs if h.edge==b.edge)
            st=self.w.material_states[b.key]
            revisions.append(dict(batch=b.key,prior_receipt_ref=st.receipt_ref,
                prior_quality_ref=st.quality_ref,disposition="EXCLUDED_FROM_NEW_ATTEMPT",
                disposition_ref=f"model://{h.receiver}/{ident}-{b.key}-exclude",
                replacement_origin_ref=f"model://{b.origin_source_owner}/{ident}-{b.key}-origin"))
        return dict(quality_correction_id=ident,result_ref=self.w.result_ref,
            source_revision="d1",org_revision="oc-1",quality_correction_valid_until=49+offset,
            quality_correction_currency="RUB",quality_correction_cost="18200",
            quality_correction_source_ref=f"model://c/{ident}-terms",
            quality_correction_expand_inputs=True,quality_correction_material_revisions=revisions,
            quality_correction_plan=[
                dict(operation=key,slot_start=start+offset,slot_end=end+offset,cost=cost,
                     resource_ref=f"model://{owner}/{ident}-{key}-plan")
                for key,start,end,cost,owner in (
                    ("source",50,53,"12000","a"),("form",60,64,"4500","b"),
                    ("finish",70,74,"1700","a"))
            ])

    def proposal(self,**kw):
        args=self.terms()
        args.update(kw)
        out=self.action("quality_correction_propose","c",**args)
        self.common=dict(quality_correction_id=args["quality_correction_id"],
            quality_correction_fingerprint=out["quality_correction_fingerprint"],
            result_ref=self.w.result_ref,source_revision="d1",org_revision="oc-1")
        return out

    def vote(self,actor,decision="SUPPORT"):
        ident=self.common["quality_correction_id"]
        return self.action("quality_correction_review",actor,**self.common,
             quality_correction_decision=decision,
             quality_correction_source_ref=f"model://{actor}/{ident}-vote")

    def apply_plan(self,**kw):
        ident=self.common["quality_correction_id"]
        return self.action("quality_correction_apply","c",**self.common,
            quality_correction_source_ref=f"model://c/{ident}-apply",**kw)

    def approve(self):
        for actor in self.w.assurance_correction_proposal["terms"]["required"]:
            self.vote(actor)
        return self.apply_plan()

    def start(self,op_id,actor,at,amount,**kw):
        ident=self.common["quality_correction_id"]
        return super().start(op_id,actor,at,amount,
            quality_correction_source_ref=f"model://{actor}/{ident}-start-{op_id}",
            quality_correction_cost_ref=f"model://{actor}/{ident}-cost-{op_id}",**kw)

    def finish(self,op_id,actor,at,**kw):
        ident=self.common["quality_correction_id"]
        return super().finish(op_id,actor,at,
            quality_correction_source_ref=f"model://{actor}/{ident}-done-{op_id}",**kw)

    def complete_plan(self,offset=0,**changes):
        self.start("source","a",50+offset,12000)
        self.finish("source","a",53+offset)
        self.handoff("input")
        self.start("form","b",60+offset,4500)
        self.finish("form","b",64+offset)
        self.handoff("output")
        self.start("finish","a",70+offset,1700)
        self.finish("finish","a",74+offset)

    def resubmit(self,ref):
        self.action("resubmit","a",result_ref=ref,
            quality_correction_id=self.common["quality_correction_id"],
            quality_correction_fingerprint=self.common["quality_correction_fingerprint"])

    def assess(self,ref,verdict="MEETS_DECLARED_REQUIREMENT"):
        self.emit(quality_event(self.at+1,verdict=verdict,result_ref=ref))
        self.emit(quality_event(self.at+1,criterion_id="documents",result_ref=ref))


def test_boundary_input_reproduction_requires_explicit_scope_expansion():
    x=MaterialCase()
    scope=quality_dependency_scope(x.w)
    assert scope["affected_operations"]==["finish","form"]
    assert scope["boundary_inputs"]==[["source","form"]]
    assert quality_dependency_scope(x.w,expand_inputs=True)["additional_input_operations"]==["source"]
    before=deepcopy(x.s.snapshot())
    view=before["works"]["w1"]["assurance"]
    assert view["correction_dependency_scope"]==scope
    expanded=view["correction_dependency_scope_with_input_reproduction"]
    assert expanded["unaffected_operations"]==["independent"]
    assert expanded["affected_operations"]==["finish","form","source"]
    p=x.terms();p["quality_correction_expand_inputs"]=False
    x.action("quality_correction_propose","c",expected="BLOCKED",
             reason="QUALITY_CORRECTION_BOUNDARY_INPUT_REPRODUCTION_REQUIRED",**p)
    assert x.w.assurance_correction_proposal is None
    assert x.s.snapshot()["capacity"]==before["capacity"]


@pytest.mark.parametrize("edit,reason",[
    (lambda p:p["quality_correction_material_revisions"].pop(),
     "QUALITY_CORRECTION_EXACT_MATERIAL_GENERATIONS_REQUIRED"),
    (lambda p:p["quality_correction_material_revisions"][0].update(prior_receipt_ref="model://a/false"),
     "QUALITY_CORRECTION_ORIGINAL_MATERIAL_CUSTODY_REQUIRED"),
    (lambda p:p["quality_correction_material_revisions"][0].update(prior_quality_ref="model://a/false"),
     "QUALITY_CORRECTION_ORIGINAL_MATERIAL_CUSTODY_REQUIRED"),
    (lambda p:p["quality_correction_material_revisions"][0].update(disposition="REUSE_WITHOUT_REVIEW"),
     "QUALITY_CORRECTION_PRIOR_MATERIAL_DISPOSITION_REQUIRED"),
    (lambda p:p["quality_correction_material_revisions"][0].update(replacement_origin_ref="model://c/foreign"),
     "QUALITY_ORIGINAL_OWNER_SOURCE_REQUIRED"),
    (lambda p:p["quality_correction_material_revisions"][1].update(
         replacement_origin_ref=p["quality_correction_material_revisions"][0]["replacement_origin_ref"]),
     "QUALITY_CORRECTION_DISTINCT_SOURCES_REQUIRED"),
])
def test_exact_new_material_generation_terms_are_atomic(edit,reason):
    x=MaterialCase()
    before=deepcopy([x.w.material_states,x.w.handoff_states,x.s.capacity_ledger.reservations])
    p=x.terms();edit(p)
    x.action("quality_correction_propose","c",expected="BLOCKED",reason=reason,**p)
    assert x.w.assurance_correction_proposal is None
    assert [x.w.material_states,x.w.handoff_states,x.s.capacity_ledger.reservations]==before


def test_material_generation_application_requires_all_votes_and_does_not_infer_delivery():
    x=MaterialCase()
    before=deepcopy([x.w.material_states,x.w.handoff_states,x.w.material_batches])
    x.proposal()
    x.vote("a");x.vote("b")
    x.apply_plan(expected="BLOCKED",reason="QUALITY_CORRECTION_INDEPENDENT_SUPPORT_REQUIRED")
    assert [x.w.material_states,x.w.handoff_states,x.w.material_batches]==before
    x.vote("c");x.apply_plan()
    assert x.w.material_batches==before[2]
    assert all(st.received is None and st.accepted is None for st in x.w.material_states.values())
    assert set(x.w.handoff_states.values())=={"NOT_DISPATCHED"}
    row=x.w.assurance_corrections[-1]
    assert len(row["terms"]["materials_before"])==4
    assert all(m["accepted_quantity"]==m["planned_quantity"] for m in row["terms"]["materials_before"])
    assert list(correction_resource_claims(row))==[]
    assert row["handoff_events"]==[]
    assert all(current_material_generation(x.w,b.key)["prior_generation"]=="ORIGINAL"
               for b in x.w.material_batches)


def test_new_receipt_and_quality_are_required_before_dependent_operation():
    x=MaterialCase();x.proposal();x.approve()
    x.start("source","a",50,12000);x.finish("source","a",53)
    x.start("form","b",60,4500,expected="BLOCKED",
            reason="QUALITY_CORRECTION_NEW_HANDOFF_RECEIPT_REQUIRED")
    assert set(dict(correction_resource_claims(x.w.assurance_corrections[-1])))=={"source"}


def test_rejected_new_material_is_not_automatically_reused():
    x=MaterialCase();x.proposal();x.approve()
    x.start("source","a",50,12000);x.finish("source","a",53)
    x.handoff_event("input","dispatch");x.handoff_event("input","receive")
    x.handoff_event("input","quality",quality_quantities=[
        dict(batch="input-2",accepted="1",rejected="1"),dict(batch="input-3",accepted="3",rejected="0")])
    x.start("form","b",60,4500,expected="BLOCKED",reason="MATERIAL_QUALITY_INSUFFICIENT")
    assert x.w.material_states["input-2"].accepted==Decimal(1)
    assert x.w.material_states["input-2"].rejected==Decimal(1)
    assert x.w.operation_states["form"]=="CORRECTION_PLANNED"
    assert set(dict(correction_resource_claims(x.w.assurance_corrections[-1])))=={"source"}


def test_handoff_must_bind_to_active_generation_and_use_fresh_sources():
    x=MaterialCase();x.proposal();x.approve()
    x.start("source","a",50,12000);x.finish("source","a",53)
    x.handoff_event("input","dispatch",new=False,expected="BLOCKED",
                   reason="QUALITY_CORRECTION_HANDOFF_ACTIVE_GENERATION_REQUIRED")
    x.handoff_event("input","dispatch",result_ref="model://a/input-original-dispatch",
                   expected="BLOCKED",reason="QUALITY_CORRECTION_SOURCE_ALREADY_USED")
    assert all(st.dispatched is None for st in x.w.material_states.values())
    x.handoff_event("input","dispatch")
    x.handoff_event("input","receive",dispatch_ref="model://a/input-original-dispatch",
                   expected="BLOCKED",reason="HANDOFF_DISPATCH_REFERENCE_MISMATCH")
    assert x.w.material_states["input-2"].received is None
    x.handoff_event("input","receive");x.handoff_event("input","quality")
    x.start("form","b",60,4500)


def test_complete_material_chain_preserves_original_declarations_and_prior_evidence():
    x=MaterialCase()
    declarations=deepcopy(x.w.material_batches)
    old_independent=x.w.operation_evidence["independent"]
    original_capacity=list(x.s.capacity_ledger.reservations)
    x.proposal();x.approve();x.complete_plan()
    row=x.w.assurance_corrections[-1]
    assert len(row["handoff_events"])==6
    assert all(m["accepted_quantity"]==m["planned_quantity"] for m in row["materials_after"])
    assert len(row["terms"]["material_revisions"])==4
    assert x.w.material_batches==declarations
    assert x.w.operation_evidence["independent"]==old_independent
    assert len(x.s.capacity_ledger.reservations)==len(original_capacity)+3
    assert x.s.capacity_ledger.reservations[:len(original_capacity)]==original_capacity
    assert {key:r["amount"] for key,r in correction_resource_claims(row)}=={
        "source":"12000.00","form":"4500.00","finish":"1700.00"}
    x.resubmit("model://a/final-v2")
    x.action("accept","c",expected="BLOCKED",reason="QUALITY_ORIGINAL_ASSESSMENT_MISSING")
    x.assess("model://a/final-v2")
    x.action("accept","c")
    out=x.native()
    w=out["works"]["w1"]
    assert w["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert len(w["assurance"]["assessment_history"])==4
    assert len(w["technology"]["materials"]["batches"])==4
    assert all(b["correction_generation"]["correction_id"]=="material-correction-1"
               and b["accepted_quantity"]==b["planned_quantity"] for b in w["technology"]["materials"]["batches"])
    assert all(e["quality_correction_handoff_generation"]=="material-correction-1"
               for e in out["trace"] if e.get("quality_correction_handoff_generation"))


def test_second_material_generation_preserves_both_old_generations():
    x=MaterialCase();x.proposal();x.approve();x.complete_plan()
    x.resubmit("model://a/final-v2")
    x.assess("model://a/final-v2",verdict="DOES_NOT_MEET");x.action("reject","c")
    first=deepcopy(x.w.assurance_corrections[0])
    x.proposal(**x.terms(ident="material-correction-2",offset=60));x.approve()
    assert all(current_material_generation(x.w,b.key)["prior_generation"]=="material-correction-1"
               for b in x.w.material_batches)
    assert x.w.assurance_corrections[0]==first
    x.complete_plan(offset=60);x.resubmit("model://a/final-v3")
    x.assess("model://a/final-v3");x.action("accept","c")
    out=x.native()
    assert out["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert len(out["works"]["w1"]["assurance"]["physical_corrections"])==2
    assert x.w.assurance_corrections[0]==first
