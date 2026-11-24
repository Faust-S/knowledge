"""R1-W2H: dependent original Operation correction with one capacity ledger."""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.economic_flow import evaluate_economic_claims, EconomicInputError
from research.akis.qualitative_mesa.work_assurance import quality_dependency_scope, correction_resource_claims
from .test_technology import op
from .test_work_assurance_mesa import scenario, execution_events, quality_event


def world():
    d = scenario()
    w = d["works"][0]
    w["slot_end"] = 12
    w["operations"] += [op("drill", "ra", 4, 8, ("cut",)),
                        op("polish", "ra", 8, 10)]
    return d


class Case:
    def __init__(self, d=None):
        self.d = world() if d is None else d
        self.s = QualitativeAKIS(self.d)
        self.w = self.s.works["w1"]
        self.events = []
        self.at = 0
        for event in execution_events()[:-1]:
            self.emit(event)
        self.action("start_operation", "a", operation="drill")
        self.action("complete_operation", "a", operation="drill", result_ref="model://a/drill-original")
        self.action("start_operation", "a", operation="polish")
        self.action("complete_operation", "a", operation="polish", result_ref="model://a/polish-original")
        self.action("complete", "a", result_ref="model://final-v1")
        self.emit(quality_event(self.at+1, verdict="DOES_NOT_MEET"))
        self.emit(quality_event(self.at+1, criterion_id="documents"))
        self.action("reject", "c")

    def emit(self, event, expected="APPLIED", reason=None):
        self.at = event["at"]
        self.events.append(deepcopy(event))
        out = self.s.apply(event, self.at)
        assert out["outcome"] == expected, (event, out)
        if reason:
            assert out["reason"] == reason, out
        return out

    def action(self, action, actor, *, at=None, expected="APPLIED", reason=None, work="w1", **kw):
        return self.emit(dict(at=self.at+1 if at is None else at, action=action,
                              actor=actor, work=work, **kw), expected, reason)

    def proposal(self, **kw):
        args = proposal_terms()
        args.update(kw)
        out = self.action("quality_correction_propose", "c", **args)
        self.common = dict(quality_correction_id="dependency-1",
            quality_correction_fingerprint=out["quality_correction_fingerprint"],
            result_ref="model://final-v1", source_revision="d1", org_revision="oc-1")
        return out

    def vote(self, actor, decision="SUPPORT"):
        return self.action("quality_correction_review", actor, **self.common,
             quality_correction_decision=decision,
             quality_correction_source_ref=f"model://{actor}/dependency-vote")

    def approve(self):
        for actor in self.w.assurance_correction_proposal["terms"]["required"]:
            self.vote(actor)
        return self.action("quality_correction_apply", "c", **self.common,
            quality_correction_source_ref="model://c/dependency-apply")

    def start(self, op_id, actor, at, amount, **kw):
        args = dict(self.common, operation=op_id, quality_correction_cost=str(amount),
            quality_correction_source_ref=f"model://{actor}/dependency-start-{op_id}",
            quality_correction_cost_ref=f"model://{actor}/dependency-cost-{op_id}")
        args.update(kw)
        return self.action("quality_correction_start", actor, at=at, **args)

    def finish(self, op_id, actor, at, **kw):
        args = dict(self.common, operation=op_id,
                    quality_correction_source_ref=f"model://{actor}/dependency-done-{op_id}")
        args.update(kw)
        return self.action("quality_correction_complete", actor, at=at, **args)

    def complete_and_accept(self):
        self.start("cut", "a", 30, 2500)
        self.finish("cut", "a", 32)
        self.start("pack", "b", 33, 1300)
        self.start("drill", "a", 34, 900)
        self.finish("drill", "a", 36)
        self.finish("pack", "b", 37)
        self.action("resubmit", "a", result_ref="model://final-v2",
            quality_correction_id=self.common["quality_correction_id"],
            quality_correction_fingerprint=self.common["quality_correction_fingerprint"])
        self.action("accept", "c", expected="BLOCKED", reason="QUALITY_ORIGINAL_ASSESSMENT_MISSING")
        self.emit(quality_event(self.at+1, result_ref="model://final-v2"))
        self.action("accept", "c", expected="BLOCKED", reason="QUALITY_ORIGINAL_ASSESSMENT_MISSING")
        self.emit(quality_event(self.at+1, criterion_id="documents", result_ref="model://final-v2"))
        self.action("accept", "c")

    def native(self):
        self.d["events"] = deepcopy(self.events)
        self.d["model_horizon"] = self.at + 2
        out = simulate(deepcopy(self.d))
        assert out["trace"] == self.s.trace
        return out


def proposal_terms():
    return dict(quality_correction_id="dependency-1", result_ref="model://final-v1",
        source_revision="d1", org_revision="oc-1", quality_correction_valid_until=29,
        quality_correction_currency="RUB", quality_correction_cost="4700",
        quality_correction_source_ref="model://c/dependency-terms",
        quality_correction_plan=[
            dict(operation="cut", slot_start=30, slot_end=32, cost="2500", resource_ref="model://a/cut-plan"),
            dict(operation="pack", slot_start=33, slot_end=37, cost="1300", resource_ref="model://b/pack-plan"),
            dict(operation="drill", slot_start=33, slot_end=36, cost="900", resource_ref="model://a/drill-plan"),
        ])


def test_least_dependency_scope_keeps_independent_completed_operation():
    x = Case()
    before = deepcopy(x.s.snapshot())
    scope = quality_dependency_scope(x.w)
    assert scope["failed_operations"] == ["cut"]
    assert scope["affected_operations"] == ["cut", "drill", "pack"]
    assert scope["unaffected_operations"] == ["polish"]
    assert scope["affected_material_batches"] == []
    assert x.s.snapshot() == before
    assert before["works"]["w1"]["assurance"]["correction_dependency_scope"] == scope


@pytest.mark.parametrize("edit,reason", [
    (lambda p:p["quality_correction_plan"].pop(), "QUALITY_CORRECTION_EXACT_DEPENDENCY_CLOSURE_REQUIRED"),
    (lambda p:p["quality_correction_plan"][2].update(operation="polish"), "QUALITY_CORRECTION_EXACT_DEPENDENCY_CLOSURE_REQUIRED"),
    (lambda p:p["quality_correction_plan"][2].update(operation="pack"), "QUALITY_CORRECTION_EXACT_DEPENDENCY_CLOSURE_REQUIRED"),
    (lambda p:p["quality_correction_plan"][1].update(slot_start=31), "QUALITY_CORRECTION_DEPENDENCY_WINDOW_ORDER_REQUIRED"),
    (lambda p:p.update(quality_correction_cost="4701"), "QUALITY_CORRECTION_PLAN_TOTAL_MISMATCH"),
    (lambda p:p["quality_correction_plan"][1].update(resource_ref="model://a/foreign"), "QUALITY_ORIGINAL_OWNER_SOURCE_REQUIRED"),
])
def test_invalid_dependent_plan_has_no_reservation_or_operation_effect(edit, reason):
    x=Case()
    before=deepcopy([x.s.capacity_ledger.reservations, x.w.operation_states, x.w.operation_evidence])
    p=proposal_terms()
    edit(p)
    x.action("quality_correction_propose", "c", expected="BLOCKED", reason=reason, **p)
    assert [x.s.capacity_ledger.reservations, x.w.operation_states, x.w.operation_evidence] == before
    assert x.w.assurance_correction_proposal is None


def test_missing_vote_and_competing_resource_block_atomic_correction_reservation():
    d=world()
    d["works"].append(dict(id="w2", customer="c", resource="rb", source_revision="d2",
                           slot_start=33, slot_end=37))
    x=Case(d)
    x.proposal()
    before=list(x.s.capacity_ledger.reservations)
    x.action("quality_correction_apply","c",**x.common,
        quality_correction_source_ref="model://c/premature",expected="BLOCKED",
        reason="QUALITY_CORRECTION_INDEPENDENT_SUPPORT_REQUIRED")
    assert x.s.capacity_ledger.reservations==before
    for actor in ("a","b","c"):
        x.vote(actor)
    # The competitor books after the correction proposal and votes.
    for action,actor,kw in [
        ("offer","op",{}),("authorize","op",{}),
        ("consent","b",dict(source_revision="d2",org_revision="oc-1")),
        ("consent","c",dict(source_revision="d2",org_revision="oc-1")),
        ("commit","op",{}),
    ]:
        x.action(action,actor,work="w2",**kw)
    reserved=list(x.s.capacity_ledger.reservations)
    x.action("quality_correction_apply","c",**x.common,
        quality_correction_source_ref="model://c/dependency-apply",expected="BLOCKED",
        reason="RESOURCE_CAPACITY_EXCEEDED")
    assert x.s.capacity_ledger.reservations==reserved
    assert all(v=="COMPLETED" for v in x.w.operation_states.values())
    assert x.w.assurance_corrections==[]


def test_dependent_operation_cannot_start_until_new_predecessor_executes():
    x=Case()
    x.proposal();x.approve()
    x.start("pack","b",33,1300,expected="BLOCKED",
            reason="QUALITY_CORRECTION_PREDECESSOR_INCOMPLETE")
    assert x.w.operation_states["pack"]=="CORRECTION_PLANNED"
    assert list(correction_resource_claims(x.w.assurance_corrections[-1]))==[]
    assert x.w.operation_evidence["pack"]=="model://pack-exec"


def test_same_original_dag_parallel_descendants_execute_and_old_independent_evidence_survives():
    x=Case()
    old_reservations=list(x.s.capacity_ledger.reservations)
    old_operations=x.w.operations
    old_evidence=deepcopy(x.w.operation_evidence)
    x.proposal();x.approve()
    row=x.w.assurance_corrections[-1]
    assert list(correction_resource_claims(row))==[]
    assert x.s.capacity_ledger.reservations[:len(old_reservations)]==old_reservations
    assert len(x.s.capacity_ledger.reservations)==len(old_reservations)+3
    assert x.w.operation_states=={"cut":"CORRECTION_PLANNED","drill":"CORRECTION_PLANNED",
                                  "pack":"CORRECTION_PLANNED","polish":"COMPLETED"}
    x.complete_and_accept()
    assert x.w.operations==old_operations
    assert x.w.operation_evidence["polish"]==old_evidence["polish"]
    assert all(part["original_operation_evidence"]==old_evidence[part["operation"]]
               for part in row["terms"]["plan"])
    assert row["operation_evidence"]=={k:x.w.operation_evidence[k] for k in ("cut","drill","pack")}
    claims=dict(correction_resource_claims(row))
    assert {k:v["amount"] for k,v in claims.items()}=={"cut":"2500.00","drill":"900.00","pack":"1300.00"}
    assert len({v["source_ref"] for v in claims.values()})==3
    assert x.w.result=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    out=x.native()
    assert out["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w1"]["assurance"]["physical_corrections"][0]["status"]=="RESUBMITTED"
    assert len(out["works"]["w1"]["assurance"]["assessment_history"])==4


def test_each_dependent_resource_use_binds_to_single_existing_economic_record():
    x=Case();x.proposal();x.approve();x.complete_and_accept()
    row=x.w.assurance_corrections[-1]
    claims=dict(correction_resource_claims(row))
    sources=[dict(id=f"cost-{k}",owner=v["owner"],reference=v["source_ref"],revision="r1")
             for k,v in claims.items()]
    resources=[dict(id=f"resource-{k}",scenario="COOPERATION",owner=v["owner"],
                    amount=v["amount"],bucket="FAILURE",source=f"cost-{k}",work="w1")
               for k,v in claims.items()]
    raw=dict(period="P",currency="RUB",sources=sources,resource_uses=resources,
             transfers=[],coverage={"COOPERATION":{},"INDEPENDENT_ALTERNATIVE":{}},
             outside_feasibility={})
    out=evaluate_economic_claims(raw,x.s.subjects,x.s.works,trace=x.s.trace)
    linked=out["original_work_record_evidence"]["w1"]["quality_correction_resource_uses"]
    assert out["resource_uses_count"]==3 and out["transfers_count"]==0
    assert {r["operation"]:r["original_resource_use_id"] for r in linked}=={
        "cut":"resource-cut","drill":"resource-drill","pack":"resource-pack"}
    assert all(not r["additional_cash_or_cost_row_created"] for r in linked)
    raw["resource_uses"].append({**resources[0],"id":"duplicate"})
    with pytest.raises(EconomicInputError,match="DUPLICATE_QUALITY_CORRECTION_RESOURCE_USE"):
        evaluate_economic_claims(raw,x.s.subjects,x.s.works,trace=x.s.trace)
