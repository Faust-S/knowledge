"""Technology as an optional component of the SAME operator AKIS (MODEL_ONLY)."""
from __future__ import annotations

from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from research.akis.qualitative_mesa.capacity import CapacityLedger, ResourceNeed, Reservation, parse_resource_capacity, CapacityBlocked
from research.akis.qualitative_mesa.technology import parse_operations, TechnologyInputError
from .test_rules import fixture


def op(oid, primary, start, end, predecessors=(), units=1):
    return {
        "id": oid, "primary_resource": primary,
        "requires_completed": list(predecessors),
        "resource_requirements": [{"resource": primary, "units": units}],
        "slot_start": start, "slot_end": end,
    }


def world(*, stage2_start=4, late_calendar=False):
    d = fixture()
    d["subjects"].append({"id": "c", "kind": "SME"})
    d["resources"] = [
        {"id": "ra", "owner": "a", "availability": "AVAILABLE", "capacity_units": 1,
         "capacity_unit": "machine", "site": "site-a"},
        {"id": "rb", "owner": "b", "availability": "AVAILABLE", "capacity_units": 1,
         "capacity_unit": "team", "site": "site-b"},
    ]
    if late_calendar:
        d["resources"][1]["calendar"] = {"revision":"cal-1","source":"model://b-initial",
            "windows":[{"start":0,"end":8,"units":1}]}
    d["capacity_strict"] = True
    d["works"] = [{
        "id": "w1", "customer": "c", "resource": "ra", "source_revision": "d1",
        "slot_start": 0, "slot_end": 8,
        "operations": [op("cut", "ra", 0, 4), op("pack", "rb", stage2_start, 8, ("cut",))],
    }]
    return d


def act(s, t, action, actor, work="w1", **kw):
    return s.apply({"at":t,"action":action,"actor":actor,"work":work,**kw},t)


def signed(s):
    assert act(s,1,"offer","op")["outcome"]=="APPLIED"
    assert act(s,2,"authorize","op")["outcome"]=="APPLIED"
    for t,owner in [(3,"a"),(4,"b"),(5,"c")]:
        assert act(s,t,"consent",owner,source_revision="d1",org_revision="oc-1")["outcome"]=="APPLIED"
    assert act(s,6,"commit","op")["outcome"]=="APPLIED"


def test_original_resource_owners_consent_and_atomic_stage_slots():
    s=QualitativeAKIS(world())
    for t,action,actor in [(1,"offer","op"),(2,"authorize","op")]:
        act(s,t,action,actor)
    act(s,3,"consent","a",source_revision="d1",org_revision="oc-1")
    act(s,4,"consent","c",source_revision="d1",org_revision="oc-1")
    assert act(s,5,"commit","op")["reason"]=="INDEPENDENT_ACCEPTANCE_MISSING"
    assert s.capacity_ledger.reservations==[]
    act(s,6,"consent","b",source_revision="d1",org_revision="oc-1")
    assert act(s,7,"commit","op")["outcome"]=="APPLIED"
    assert {(r.resource,r.start,r.end) for r in s.capacity_ledger.reservations}=={
        ("ra",0,4),("rb",4,8)}
    assert s.works["w1"].resource_requirements==(ResourceNeed("ra",1),ResourceNeed("rb",1))


def test_sequential_operations_free_machine_for_independent_work():
    d=world()
    d["works"].append({"id":"w2","customer":"c","resource":"ra","source_revision":"d2",
                       "slot_start":4,"slot_end":8})
    s=QualitativeAKIS(d)
    signed(s)
    for t,action,actor,kwargs in [
        (7,"offer","op",{}),(8,"authorize","op",{}),
        (9,"consent","a",{"source_revision":"d2","org_revision":"oc-1"}),
        (10,"consent","c",{"source_revision":"d2","org_revision":"oc-1"}),
        (11,"commit","op",{})]:
        result=act(s,t,action,actor,work="w2",**kwargs)
        assert result["outcome"]=="APPLIED",result
    assert {(r.work,r.resource,r.start,r.end) for r in s.capacity_ledger.reservations}=={
        ("w1","ra",0,4),("w1","rb",4,8),("w2","ra",4,8)}
    assert s.snapshot()["profit"]["system_increment"]=="UNKNOWN"


def test_operation_owner_and_predecessor_required_without_auto_result():
    s=QualitativeAKIS(world())
    signed(s)
    assert act(s,7,"start","a")["reason"]=="OPERATION_START_REQUIRED"
    assert act(s,8,"start_operation","b",operation="cut")["reason"]=="ORIGINAL_OPERATION_PERFORMER_REQUIRED"
    assert act(s,9,"start_operation","b",operation="pack")["reason"]=="OPERATION_PREDECESSOR_INCOMPLETE"
    assert act(s,10,"start_operation","a",operation="cut")["outcome"]=="APPLIED"
    assert act(s,11,"complete","a",result_ref="model://whole")["reason"]=="TECHNOLOGY_OPERATIONS_INCOMPLETE"
    assert act(s,12,"complete_operation","a",operation="cut",result_ref="model://cut")["outcome"]=="APPLIED"
    assert act(s,13,"start_operation","b",operation="pack")["outcome"]=="APPLIED"
    assert act(s,14,"complete_operation","b",operation="pack",result_ref="model://cut")["reason"]=="NEW_MODEL_ONLY_OPERATION_EVIDENCE_REQUIRED"
    assert act(s,15,"complete_operation","b",operation="pack",result_ref="model://pack")["outcome"]=="APPLIED"
    assert act(s,16,"complete","a",result_ref="model://cut")["reason"]=="OPERATION_EVIDENCE_IS_NOT_WORK_RESULT"
    assert act(s,17,"complete","a",result_ref="model://whole")["outcome"]=="APPLIED"
    assert s.works["w1"].result=="SUBMITTED"
    assert act(s,18,"accept","b")["reason"]=="ORIGINAL_CUSTOMER_RESULT_DECISION_REQUIRED"
    assert act(s,19,"accept","c")["outcome"]=="APPLIED"
    snapshot=s.snapshot()["works"]["w1"]["technology"]
    assert [x["execution"] for x in snapshot["operations"]]==["COMPLETED","COMPLETED"]
    assert snapshot["physical_productivity"]=="NOT_IDENTIFIABLE"


def test_atomic_multi_operation_plan_checks_parallel_aggregate():
    d=world()
    d["works"][0]["operations"]=[op("a1","ra",0,4),op("a2","ra",1,3)]
    s=QualitativeAKIS(d)
    act(s,1,"offer","op");act(s,2,"authorize","op")
    for t,owner in [(3,"a"),(4,"c")]:
        act(s,t,"consent",owner,source_revision="d1",org_revision="oc-1")
    assert act(s,5,"commit","op")["reason"]=="RESOURCE_CAPACITY_EXCEEDED"
    assert s.capacity_ledger.reservations==[]
    assert s.works["w1"].obligation=="NOT_ACCEPTED"


def test_future_calendar_risk_does_not_block_earlier_stage():
    s=QualitativeAKIS(world(late_calendar=True))
    signed(s)
    changed={"revision":"cal-2","source":"model://b-closure",
             "windows":[{"start":0,"end":4,"units":1},{"start":4,"end":8,"units":0}]}
    assert s.apply({"at":7,"actor":"b","action":"resource_calendar_update","resource":"rb",
                    "expected_calendar_revision":"cal-1","calendar":changed},7)["outcome"]=="APPLIED"
    assert act(s,8,"start_operation","a",operation="cut")["outcome"]=="APPLIED"
    assert act(s,9,"complete_operation","a",operation="cut",result_ref="model://cut")["outcome"]=="APPLIED"
    blocked=act(s,10,"start_operation","b",operation="pack")
    assert blocked["reason"]=="RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT"
    assert blocked["blocking_resource"]=="rb"
    assert s.works["w1"].obligation=="ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    restored={"revision":"cal-3","source":"model://b-restored",
              "windows":[{"start":0,"end":8,"units":1}]}
    s.apply({"at":11,"actor":"b","action":"resource_calendar_update","resource":"rb",
             "expected_calendar_revision":"cal-2","calendar":restored},11)
    assert act(s,12,"start_operation","b",operation="pack")["outcome"]=="APPLIED"


@pytest.mark.parametrize("bad,reason",[
    ([op("cut","ra",0,4),op("cut","rb",4,8)],"DUPLICATE_OPERATION"),
    ([op("cut","ra",0,4,("pack",)),op("pack","rb",4,8,("cut",))],"CYCLIC_OPERATION_DEPENDENCY"),
    ([op("cut","ra",0,5),op("pack","rb",4,8,("cut",))],"OPERATION_PLAN_PRECEDENCE_CONFLICT"),
    ([op("cut","ra",0,4),op("pack","rb",4,8,("unknown",))],"UNKNOWN_OPERATION_PREDECESSOR"),
    ([op("cut","rb",0,4)],"WORK_PRIMARY_MUST_BE_IN_OPERATIONS"),
    ([op("cut","ra",0,9)],"INVALID_OPERATION_SLOT"),
    ([op("cut","ra",0,4,units=True)],"INVALID_REQUIRED_RESOURCE_UNITS"),
    ([],"INVALID_OPERATION_LIST"),
])
def test_invalid_technologies_fail_at_input(bad,reason):
    d=world();d["works"][0]["operations"]=bad
    with pytest.raises(InputError,match=reason):QualitativeAKIS(d)


def test_technology_explicit_summary_must_match_derived_owners():
    d=world();d["works"][0]["resource_requirements"]=[{"resource":"ra","units":1}]
    with pytest.raises(InputError,match="TECHNOLOGY_RESOURCE_SUMMARY_MISMATCH"):
        QualitativeAKIS(d)


def test_legacy_work_still_uses_whole_work_booking():
    d=world();del d["works"][0]["operations"]
    d["works"][0]["resource_requirements"]=[{"resource":"ra","units":1},{"resource":"rb","units":1}]
    s=QualitativeAKIS(d);signed(s)
    assert {(r.resource,r.start,r.end) for r in s.capacity_ledger.reservations}=={
        ("ra",0,8),("rb",0,8)}
    assert "technology" not in s.snapshot()["works"]["w1"]


def test_no_direct_technology_actions_without_declared_operations():
    d=world();del d["works"][0]["operations"]
    d["works"][0]["resource_requirements"]=[{"resource":"ra","units":1},{"resource":"rb","units":1}]
    s=QualitativeAKIS(d);signed(s)
    assert act(s,7,"start_operation","a",operation="cut")["reason"]=="TECHNOLOGY_NOT_DECLARED"
    assert act(s,8,"complete_operation","a",operation="cut",result_ref="model://cut")["reason"]=="TECHNOLOGY_NOT_DECLARED"


def test_initial_source_rights_strict_cannot_be_bypassed_with_operation_actions():
    d=world();d["context_evidence"]={"strict":True,"sources":[],"requirements":[]}
    s=QualitativeAKIS(d)
    assert act(s,1,"start_operation","a",operation="cut")["reason"]=="CONTEXT_REQUIREMENT_MISSING"
    assert s.works["w1"].operation_states["cut"]=="NOT_STARTED"


def test_mesa_technology_reactions_native():
    pytest.importorskip("mesa",reason="Only native Mesa 3.5.2 qualifies this integration")
    from research.akis.qualitative_mesa.mesa_model import simulate
    d=world();d["events"]=[
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        *[{"at":i+3,"action":"consent","actor":owner,"work":"w1","source_revision":"d1","org_revision":"oc-1"}
          for i,owner in enumerate(("a","b","c"))],
        {"at":6,"action":"commit","actor":"op","work":"w1"},
        {"at":7,"action":"start_operation","actor":"a","work":"w1","operation":"cut"},
        {"at":8,"action":"complete_operation","actor":"a","work":"w1","operation":"cut","result_ref":"model://cut"},
        {"at":9,"action":"start_operation","actor":"b","work":"w1","operation":"pack"},
        {"at":10,"action":"complete_operation","actor":"b","work":"w1","operation":"pack","result_ref":"model://pack"},
        {"at":11,"action":"complete","actor":"a","work":"w1","result_ref":"model://w1"},
        {"at":12,"action":"accept","actor":"c","work":"w1"},
    ]
    result=simulate(d)
    assert result["counts"]=={"applied":12,"blocked":0}
    assert result["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert [o["execution"] for o in result["works"]["w1"]["technology"]["operations"]]==["COMPLETED","COMPLETED"]
    assert result["profit"]["operator"]=="UNKNOWN"


def test_complete_rework_cannot_relabel_operation_evidence_as_original_result():
    s=QualitativeAKIS(world());signed(s)
    for t,action,actor,opid,ref in [(7,"start_operation","a","cut",None),
            (8,"complete_operation","a","cut","model://cut"),
            (9,"start_operation","b","pack",None),
            (10,"complete_operation","b","pack","model://pack")]:
        kw={"operation":opid}
        if ref:kw["result_ref"]=ref
        assert act(s,t,action,actor,**kw)["outcome"]=="APPLIED"
    act(s,11,"complete","a",result_ref="model://old-whole")
    act(s,12,"reject","c")
    assert act(s,13,"resubmit","a",result_ref="model://cut")["reason"]=="OPERATION_EVIDENCE_IS_NOT_WORK_RESULT"
    assert s.works["w1"].result=="REJECTED"
    assert act(s,14,"resubmit","a",result_ref="model://revised-whole")["outcome"]=="APPLIED"
    assert act(s,15,"accept","c")["outcome"]=="APPLIED"


def test_work_previously_accepted_risk_is_not_mistaken_for_open_stage():
    s=QualitativeAKIS(world(late_calendar=True));signed(s)
    assert act(s,7,"start_operation","a",operation="cut")["outcome"]=="APPLIED"
    assert act(s,8,"complete_operation","a",operation="cut",result_ref="model://cut")["outcome"]=="APPLIED"
    assert act(s,9,"start_operation","b",operation="pack")["outcome"]=="APPLIED"
    assert act(s,10,"complete_operation","b",operation="pack",result_ref="model://pack")["outcome"]=="APPLIED"
    act(s,11,"complete","a",result_ref="model://whole")
    act(s,12,"accept","c")
    changed={"revision":"cal-2","source":"model://changed",
             "windows":[{"start":0,"end":4,"units":1},{"start":4,"end":8,"units":0}]}
    s.apply({"at":13,"actor":"b","action":"resource_calendar_update","resource":"rb",
             "expected_calendar_revision":"cal-1","calendar":changed},13)
    assert s.snapshot()["capacity"]["reservation_risks"]==[]
    assert s.capacity_ledger.planned_window_risk([ResourceNeed("rb",1)],4,8,outstanding=set()) is None


def test_full_technology_fixture_is_replayable_with_one_original_result():
    from pathlib import Path
    import json
    p=Path(__file__).resolve().parents[1]/"fixtures/technology_cooperation_model_only.json"
    data=json.loads(p.read_text())
    s=QualitativeAKIS(data)
    for e in s.events:s.apply(e,e["at"])
    out=s.snapshot()
    assert out["counts"]=={"applied":20,"blocked":2}
    assert [x["reason"] for x in out["trace"] if x["outcome"]=="BLOCKED"]==[
        "OPERATION_PREDECESSOR_INCOMPLETE","TECHNOLOGY_OPERATIONS_INCOMPLETE"]
    assert all(out["works"][w]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT" for w in ("w1","w2"))
    assert len(out["capacity"]["reservations"])==3
    assert set(out["profit"].values())=={"UNKNOWN"}


def test_capacity_plan_matches_independent_timepoint_oracle():
    """Algorithmic check only; random quantities are not economic observations."""
    from random import Random
    rng=Random(20261121)
    specs={k:parse_resource_capacity({"id":k,"owner":"a", "capacity_units":cap,
                                     "capacity_unit":"synthetic_units"})
           for k,cap in [("r1",2),("r2",1)]}
    for _ in range(120):
        count=rng.randint(1,6)
        plan=[]
        for __ in range(count):
            a=rng.randint(0,5);b=rng.randint(a+1,7)
            plan.append(Reservation(rng.choice(["r1","r2"]),"w",a,b,rng.randint(1,2)))
        expected=all(sum(p.units for p in plan if p.resource==res and p.start<=t<p.end)
                     <=specs[res].units for res in specs for t in range(7))
        ledger=CapacityLedger(specs)
        if expected:
            ledger.reserve_plan("w",plan)
            assert ledger.reservations==plan
        else:
            with pytest.raises(CapacityBlocked,match="RESOURCE_CAPACITY_EXCEEDED"):
                ledger.reserve_plan("w",plan)
            assert ledger.reservations==[]


def test_plan_preview_has_no_side_effects_and_duplicate_commits_are_rejected():
    ledger=CapacityLedger({"r":parse_resource_capacity({"id":"r","owner":"a",
        "capacity_units":2,"capacity_unit":"units"})})
    planned=[Reservation("r","w1",1,3,1),Reservation("r","w1",3,5,1)]
    assert ledger.preview_plan("w1",planned) is None
    assert ledger.reservations==[]
    ledger.reserve_plan("w1",planned)
    with pytest.raises(CapacityBlocked,match="WORK_ALREADY_RESERVED"):
        ledger.reserve_plan("w1",planned)
    assert len(ledger.reservations)==2
