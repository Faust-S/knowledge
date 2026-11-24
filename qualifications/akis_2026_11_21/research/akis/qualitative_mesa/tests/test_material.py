"""Material batch qualification through the ORIGINAL qualitative AKIS event path.

Declared quantities and source links are research-only; no authenticated originals.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from research.akis.qualitative_mesa.tests.test_handoff import site_world, transfer
from research.akis.qualitative_mesa.tests.test_technology import signed, act


def material_world():
    scenario = site_world()
    scenario["material_strict"] = True
    scenario["works"][0]["material_batches"] = [{
        "id": "batch-a", "from_operation": "cut", "to_operation": "pack",
        "material_id": "cut-parts", "planned_quantity": "12.50",
        "unit": "kg", "declared_title_holder": "c",
        "origin_source_owner": "a", "origin_ref": "model://origin-lot-a",
        "quality_spec_owner": "c", "quality_spec_ref": "model://customer-spec",
    }]
    return scenario


def qualify_start(s):
    signed(s)
    assert act(s, 7, "start_operation", "a", operation="cut")["outcome"] == "APPLIED"
    assert act(s, 8, "complete_operation", "a", operation="cut",
               result_ref="model://cut-operation")["outcome"] == "APPLIED"


def shipment(s, at=9, amount="12.50", **kwargs):
    return transfer(s, at, "handoff_dispatch", "a", "model://dispatch",
                    material_quantities=[{"batch": "batch-a", "quantity": amount}], **kwargs)


def receiving(s, at=10, amount="12.50", **kwargs):
    return transfer(s, at, "handoff_receive", "b", "model://receipt",
                    dispatch_ref="model://dispatch",
                    material_quantities=[{"batch": "batch-a", "quantity": amount}], **kwargs)


def qualification(s, at=11, good="12.50", bad="0", **kwargs):
    return transfer(s, at, "handoff_quality", "b", "model://quality",
                    receipt_ref="model://receipt",
                    quality_quantities=[{"batch": "batch-a",
                                         "accepted": good, "rejected": bad}], **kwargs)


def test_material_qualified_original_path_one_result():
    s = QualitativeAKIS(material_world())
    qualify_start(s)
    assert shipment(s)["outcome"] == "APPLIED"
    assert receiving(s)["outcome"] == "APPLIED"
    assert act(s, 11, "start_operation", "b", operation="pack")["reason"] == "MATERIAL_QUALITY_NOT_ASSESSED"
    assert qualification(s, at=12)["outcome"] == "APPLIED"
    assert act(s, 13, "start_operation", "b", operation="pack")["outcome"] == "APPLIED"
    assert act(s, 14, "complete_operation", "b", operation="pack",
               result_ref="model://pack-operation")["outcome"] == "APPLIED"
    assert act(s, 15, "complete", "a", result_ref="model://whole-result")["outcome"] == "APPLIED"
    assert act(s, 16, "accept", "c")["outcome"] == "APPLIED"
    view = s.snapshot()["works"]["w1"]
    assert view["result_ref"] == "model://whole-result"
    assert view["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    row = view["technology"]["materials"]["batches"][0]
    assert row["declared_title_holder"] == "c"
    assert row["accepted_quantity"] == "12.50"
    assert row["readiness"] == "ACCEPTED_MODEL_CLAIM"
    assert view["technology"]["materials"]["physical_proof"] == "NOT_AUTHENTICATED"
    assert s.snapshot()["profit"]["system_increment"] == "UNKNOWN"


def test_partial_receipt_and_quality_do_not_disappear():
    s = QualitativeAKIS(material_world()); qualify_start(s)
    assert shipment(s)["outcome"] == "APPLIED"
    assert receiving(s, amount="11.25")["outcome"] == "APPLIED"
    assert qualification(s, good="11.00", bad="0.25")["outcome"] == "APPLIED"
    assert act(s, 12, "start_operation", "b", operation="pack")["reason"] == "MATERIAL_QUANTITY_SHORT"
    row = s.snapshot()["works"]["w1"]["technology"]["materials"]["batches"][0]
    assert row["unreceived_quantity"] == "1.25"
    assert row["unassessed_quantity"] == "0.00"
    assert s.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert s.works["w1"].result == "NOT_SUBMITTED"


def test_rejected_quality_blocks_start_even_with_full_receipt():
    s = QualitativeAKIS(material_world()); qualify_start(s)
    shipment(s); receiving(s)
    assert qualification(s, good="12", bad="0.50")["outcome"] == "APPLIED"
    assert act(s, 12, "start_operation", "b", operation="pack")["reason"] == "MATERIAL_QUALITY_INSUFFICIENT"


def test_receiving_by_operator_or_quality_by_sender_is_not_permitted():
    s = QualitativeAKIS(material_world()); qualify_start(s); shipment(s)
    assert transfer(s, 10, "handoff_receive", "op", "model://wrong",
                    dispatch_ref="model://dispatch",
                    material_quantities=[{"batch":"batch-a","quantity":"12.50"}])["reason"] == "HANDOFF_ORIGINAL_RECEIVER_REQUIRED"
    assert receiving(s, at=11)["outcome"] == "APPLIED"
    assert transfer(s, 12, "handoff_quality", "a", "model://wrong-quality",
                    receipt_ref="model://receipt",
                    quality_quantities=[{"batch":"batch-a","accepted":"12.50","rejected":"0"}])["reason"] == "MATERIAL_ORIGINAL_RECEIVER_REQUIRED"
    assert qualification(s, at=13)["outcome"] == "APPLIED"


def test_overclaimed_quantity_never_mutates_batch():
    s = QualitativeAKIS(material_world()); qualify_start(s)
    assert shipment(s, amount="12.51")["reason"] == "MATERIAL_QUANTITY_EXCEEDS_DECLARATION"
    state = s.works["w1"].material_states["batch-a"]
    assert state.dispatched is None
    assert shipment(s, at=10)["outcome"] == "APPLIED"
    assert receiving(s, at=11, amount="12.51")["reason"] == "MATERIAL_QUANTITY_EXCEEDS_DECLARATION"
    assert state.received is None


def test_reported_external_time_remains_unverified_and_ordered():
    s = QualitativeAKIS(material_world()); qualify_start(s)
    assert shipment(s, reported_actual_at="2026-11-21T10:00:00+03:00",
                    reported_external_ref="urn:ship:one")["outcome"] == "APPLIED"
    assert receiving(s, reported_actual_at="2026-11-21T06:00:00Z",
                     reported_external_ref="urn:receipt:wrong")["reason"] == "MATERIAL_REPORTED_TIME_CONTRADICTION"
    assert s.works["w1"].material_states["batch-a"].received is None
    assert receiving(s, at=11, reported_actual_at="2026-11-21T08:00:00Z",
                     reported_external_ref="urn:receipt:second")["outcome"] == "APPLIED"
    row = s.snapshot()["works"]["w1"]["technology"]["materials"]["batches"][0]
    assert row["receipt_report"]["source_verification"] == "EXTERNAL_CLAIM_UNVERIFIED"


@pytest.mark.parametrize("mutation,reason", [
    (lambda d: d.pop("handoff_strict"), "MATERIAL_REQUIRES_HANDOFF_STRICT"),
    (lambda d: d["works"][0].pop("material_batches"), "MATERIAL_BATCH_DECLARATION_REQUIRED"),
    (lambda d: d["works"][0]["material_batches"][0].update(planned_quantity=2), "INVALID_MATERIAL_QUANTITY"),
    (lambda d: d["works"][0]["material_batches"][0].update(declared_title_holder="op"),
     "MATERIAL_ORIGINAL_PARTY_REQUIRED"),
    (lambda d: d["works"][0]["material_batches"][0].update(from_operation="missing"),
     "MATERIAL_EDGE_NOT_REQUIRED"),
])
def test_declared_materials_fail_closed(mutation, reason):
    d = material_world(); mutation(d)
    with pytest.raises(InputError, match=reason):
        QualitativeAKIS(d)


def test_mesa_native_material_events():
    pytest.importorskip("mesa", reason="Native Mesa 3.5.2 required")
    from research.akis.qualitative_mesa.mesa_model import simulate
    d = material_world()
    d["events"] = [
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        *[{"at":i,"action":"consent","actor":actor,"work":"w1",
           "source_revision":"d1","org_revision":"oc-1"} for i,actor in
          ((3,"a"),(4,"b"),(5,"c"))],
        {"at":6,"action":"commit","actor":"op","work":"w1"},
        {"at":7,"action":"start_operation","actor":"a","work":"w1","operation":"cut"},
        {"at":8,"action":"complete_operation","actor":"a","work":"w1",
         "operation":"cut","result_ref":"model://cut"},
        {"at":9,"action":"handoff_dispatch","actor":"a","work":"w1",
         "source_revision":"d1","org_revision":"oc-1","from_operation":"cut",
         "to_operation":"pack","result_ref":"model://dispatch",
         "material_quantities":[{"batch":"batch-a","quantity":"12.50"}]},
        {"at":10,"action":"handoff_receive","actor":"b","work":"w1",
         "source_revision":"d1","org_revision":"oc-1","from_operation":"cut",
         "to_operation":"pack","result_ref":"model://receipt","dispatch_ref":"model://dispatch",
         "material_quantities":[{"batch":"batch-a","quantity":"12.50"}]},
        {"at":11,"action":"handoff_quality","actor":"b","work":"w1",
         "source_revision":"d1","org_revision":"oc-1","from_operation":"cut",
         "to_operation":"pack","result_ref":"model://quality","receipt_ref":"model://receipt",
         "quality_quantities":[{"batch":"batch-a","accepted":"12.50","rejected":"0"}]},
        {"at":12,"action":"start_operation","actor":"b","work":"w1","operation":"pack"},
    ]
    result = simulate(d)
    assert result["counts"] == {"applied":12,"blocked":0}
    assert result["works"]["w1"]["technology"]["materials"]["batches"][0]["accepted_quantity"] == "12.50"
