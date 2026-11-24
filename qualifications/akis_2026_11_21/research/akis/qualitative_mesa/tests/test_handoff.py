"""MODEL_ONLY custody acknowledgements between independent production stages."""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.handoff import declare_handoffs, handoffs_view
from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from research.akis.qualitative_mesa.tests.test_technology import world, signed, act, op


def site_world():
    data = world()
    data["handoff_strict"] = True
    return data


def transfer(s, at, action, actor, ref, from_op="cut", to_op="pack", **kwargs):
    return act(s, at, action, actor, from_operation=from_op, to_operation=to_op,
               result_ref=ref, source_revision="d1", org_revision="oc-1", **kwargs)


def test_site_and_owner_based_requirements_no_fabricated_duration():
    s = QualitativeAKIS(site_world())
    h = s.works["w1"].handoffs
    assert len(h) == 1
    assert (h[0].sender,h[0].receiver,h[0].source_site,h[0].destination_site)==(
        "a","b","site-a","site-b")
    view=s.snapshot()["works"]["w1"]["technology"]["handoffs"]
    assert view["physical_delivery"] == "NOT_OBSERVED"
    assert view["transport_duration"] == "NOT_IDENTIFIABLE"
    assert view["transport_cost"] == "NOT_IDENTIFIABLE"
    assert view["required_edges"][0]["state"] == "NOT_DISPATCHED"


def test_transfer_does_not_waive_accepted_obligation_and_independent_receipt():
    s=QualitativeAKIS(site_world())
    signed(s)
    assert act(s,7,"start_operation","a",operation="cut")["outcome"]=="APPLIED"
    assert act(s,8,"complete_operation","a",operation="cut",result_ref="model://cut")["outcome"]=="APPLIED"
    assert act(s,9,"start_operation","b",operation="pack")["reason"]=="HANDOFF_RECEIPT_NOT_DECLARED"
    assert transfer(s,10,"handoff_receive","b","model://receipt",dispatch_ref="model://dispatch")["reason"]=="HANDOFF_DISPATCH_REQUIRED"
    assert transfer(s,11,"handoff_dispatch","op","model://dispatch")["reason"]=="HANDOFF_ORIGINAL_SENDER_REQUIRED"
    assert transfer(s,12,"handoff_dispatch","a","model://cut")["reason"]=="NEW_MODEL_ONLY_HANDOFF_EVIDENCE_REQUIRED"
    assert transfer(s,13,"handoff_dispatch","a","model://dispatch")["outcome"]=="APPLIED"
    assert transfer(s,14,"handoff_receive","a","model://receipt",dispatch_ref="model://dispatch")["reason"]=="HANDOFF_ORIGINAL_RECEIVER_REQUIRED"
    assert transfer(s,15,"handoff_receive","b","model://receipt",dispatch_ref="model://wrong")["reason"]=="HANDOFF_DISPATCH_REFERENCE_MISMATCH"
    assert transfer(s,16,"handoff_receive","b","model://receipt",dispatch_ref="model://dispatch")["outcome"]=="APPLIED"
    assert act(s,17,"start_operation","b",operation="pack")["outcome"]=="APPLIED"
    assert act(s,18,"complete_operation","b",operation="pack",result_ref="model://pack")["outcome"]=="APPLIED"
    assert act(s,19,"complete","a",result_ref="model://receipt")["reason"]=="OPERATION_EVIDENCE_IS_NOT_WORK_RESULT"
    assert act(s,20,"complete","a",result_ref="model://whole")["outcome"]=="APPLIED"
    assert act(s,21,"accept","c")["outcome"]=="APPLIED"
    assert s.works["w1"].result=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert s.works["w1"].obligation=="FULFILLED"
    v=s.snapshot()["works"]["w1"]["technology"]["handoffs"]["required_edges"][0]
    assert v["state"]=="RECEIVED"
    assert v["dispatch_ref"]=="model://dispatch"
    assert v["receipt_ref"]=="model://receipt"
    assert s.snapshot()["counts"]=={"applied":14,"blocked":7}


def test_repeated_assertions_are_not_accepted_as_new_handoffs():
    s=QualitativeAKIS(site_world()); signed(s)
    act(s,7,"start_operation","a",operation="cut")
    act(s,8,"complete_operation","a",operation="cut",result_ref="model://cut")
    assert transfer(s,9,"handoff_dispatch","a","model://dispatch")["outcome"]=="APPLIED"
    assert transfer(s,10,"handoff_dispatch","a","model://later")["reason"]=="HANDOFF_DISPATCH_ALREADY_DECLARED"
    assert transfer(s,11,"handoff_receive","b","model://dispatch",dispatch_ref="model://dispatch")["reason"]=="NEW_MODEL_ONLY_HANDOFF_EVIDENCE_REQUIRED"
    assert transfer(s,12,"handoff_receive","b","model://receipt",dispatch_ref="model://dispatch")["outcome"]=="APPLIED"
    assert transfer(s,13,"handoff_receive","b","model://later",dispatch_ref="model://dispatch")["reason"]=="HANDOFF_DISPATCH_REQUIRED"


@pytest.mark.parametrize("mutation,reason",[
    (lambda d:d["resources"][0].pop("site"),"HANDOFF_SITE_UNDECLARED"),
    (lambda d:d.update(handoff_strict=None),"HANDOFF_STRICT_MUST_BE_BOOLEAN"),
    (lambda d:d["resources"][1].update(site=None),"HANDOFF_SITE_UNDECLARED"),
])
def test_strict_handoff_inputs_not_silently_assumed(mutation,reason):
    d=site_world(); mutation(d)
    with pytest.raises(InputError,match=reason):QualitativeAKIS(d)


def test_same_owner_same_site_needs_no_extra_receipt():
    d=site_world();d["works"][0]["operations"]=[op("cut","ra",0,4),op("finish","ra",4,8,("cut",))]
    s=QualitativeAKIS(d)
    assert s.works["w1"].handoffs==()
    for i,a,by in [(1,"offer","op"),(2,"authorize","op")]:act(s,i,a,by)
    for i,by in [(3,"a"),(4,"c")]:act(s,i,"consent",by,source_revision="d1",org_revision="oc-1")
    assert act(s,5,"commit","op")["outcome"]=="APPLIED"
    act(s,6,"start_operation","a",operation="cut")
    act(s,7,"complete_operation","a",operation="cut",result_ref="model://cut")
    assert act(s,8,"start_operation","a",operation="finish")["outcome"]=="APPLIED"


def test_different_owners_same_site_still_requires_custody():
    d=site_world();d["resources"][1]["site"]="site-a"
    s=QualitativeAKIS(d);signed(s)
    act(s,7,"start_operation","a",operation="cut")
    act(s,8,"complete_operation","a",operation="cut",result_ref="model://cut")
    assert act(s,9,"start_operation","b",operation="pack")["reason"]=="HANDOFF_RECEIPT_NOT_DECLARED"


def test_stale_obligation_revision_cannot_dispatch():
    s=QualitativeAKIS(site_world()); signed(s)
    act(s,7,"start_operation","a",operation="cut")
    act(s,8,"complete_operation","a",operation="cut",result_ref="model://cut")
    assert act(s,9,"handoff_dispatch","a",from_operation="cut",to_operation="pack",
               result_ref="model://dispatch",source_revision="old",org_revision="oc-1")["reason"]=="HANDOFF_ORIGINAL_OBLIGATION_REVISION_REQUIRED"
    assert s.works["w1"].handoff_states[("cut","pack")] == "NOT_DISPATCHED"


def test_transfer_actions_not_available_without_opt_in():
    s=QualitativeAKIS(world());signed(s)
    assert transfer(s,7,"handoff_dispatch","a","model://dispatch")["reason"]=="HANDOFF_NOT_CONFIGURED"


def test_kpb_strict_remains_owner_scoped_for_handoffs():
    d=site_world();d["context_evidence"]={"strict":True,"sources":[],"requirements":[]}
    s=QualitativeAKIS(d)
    assert transfer(s,7,"handoff_dispatch","a","model://dispatch")["reason"]=="CONTEXT_REQUIREMENT_MISSING"
    assert s.works["w1"].handoff_states[("cut","pack")] == "NOT_DISPATCHED"


def test_mesa_handoff_event_flow_native():
    pytest.importorskip("mesa",reason="Only official native Mesa 3.5.2 qualifies")
    from research.akis.qualitative_mesa.mesa_model import simulate
    s=site_world()
    s["events"]=[
      *[{"at":i,"action":a,"actor":by,"work":"w1"} for i,a,by in ((1,"offer","op"),(2,"authorize","op"))],
      *[{"at":i,"action":"consent","actor":by,"work":"w1","source_revision":"d1","org_revision":"oc-1"}
        for i,by in ((3,"a"),(4,"b"),(5,"c"))],
      {"at":6,"action":"commit","actor":"op","work":"w1"},
      {"at":7,"action":"start_operation","actor":"a","work":"w1","operation":"cut"},
      {"at":8,"action":"complete_operation","actor":"a","work":"w1","operation":"cut","result_ref":"model://cut"},
      {"at":9,"action":"handoff_dispatch","actor":"a","work":"w1","from_operation":"cut","to_operation":"pack","source_revision":"d1","org_revision":"oc-1","result_ref":"model://dispatch"},
      {"at":10,"action":"handoff_receive","actor":"b","work":"w1","from_operation":"cut","to_operation":"pack","source_revision":"d1","org_revision":"oc-1","dispatch_ref":"model://dispatch","result_ref":"model://receipt"},
      {"at":11,"action":"start_operation","actor":"b","work":"w1","operation":"pack"},
      {"at":12,"action":"complete_operation","actor":"b","work":"w1","operation":"pack","result_ref":"model://pack"},
    ]
    d=simulate(s)
    assert d["counts"]=={"applied":12,"blocked":0}
    assert d["works"]["w1"]["technology"]["handoffs"]["required_edges"][0]["state"]=="RECEIVED"


def test_two_upstream_handoffs_require_two_distinct_receipts():
    d=site_world()
    d["resources"][0]["capacity_units"]=2
    d["works"][0]["operations"]=[
        op("cut","ra",0,3),op("mold","ra",0,3),
        op("pack","rb",3,8,("cut","mold")),
    ]
    s=QualitativeAKIS(d);signed(s)
    assert len(s.works["w1"].handoffs)==2
    for i,oid in ((7,"cut"),(8,"mold")):
        assert act(s,i,"start_operation","a",operation=oid)["outcome"]=="APPLIED"
        assert act(s,i+2,"complete_operation","a",operation=oid,result_ref=f"model://{oid}")["outcome"]=="APPLIED"
    assert transfer(s,11,"handoff_dispatch","a","model://dispatch-cut")["outcome"]=="APPLIED"
    assert transfer(s,12,"handoff_receive","b","model://receipt-cut",dispatch_ref="model://dispatch-cut")["outcome"]=="APPLIED"
    assert act(s,13,"start_operation","b",operation="pack")["reason"]=="HANDOFF_RECEIPT_NOT_DECLARED"
    assert transfer(s,14,"handoff_dispatch","a","model://dispatch-mold",from_op="mold")["outcome"]=="APPLIED"
    assert transfer(s,15,"handoff_receive","b","model://receipt-mold",from_op="mold",dispatch_ref="model://dispatch-mold")["outcome"]=="APPLIED"
    assert act(s,16,"start_operation","b",operation="pack")["outcome"]=="APPLIED"


def test_same_owner_other_site_requires_explicit_transfer():
    d=site_world()
    d["resources"][1]["owner"]="a"
    s=QualitativeAKIS(d)
    assert len(s.works["w1"].handoffs)==1
    assert s.works["w1"].handoffs[0].sender==s.works["w1"].handoffs[0].receiver=="a"


def test_uploaded_fixture_is_replayable_with_original_rules():
    import json
    from pathlib import Path
    path=Path(__file__).parents[1]/"fixtures"/"cross_owner_handoff_model_only.json"
    scenario=json.loads(path.read_text(encoding="utf-8"))
    s=QualitativeAKIS(scenario)
    for row in scenario["events"]:
        s.apply(row,row["at"])
    out=s.snapshot()
    assert out["counts"]=={"applied":14,"blocked":7}
    assert out["works"]["w1"]["technology"]["handoffs"]["physical_delivery"]=="NOT_OBSERVED"
    assert out["works"]["w1"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
