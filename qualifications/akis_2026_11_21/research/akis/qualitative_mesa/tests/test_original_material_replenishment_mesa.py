"""Original material replenishment through the same Work and handoff edge."""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from .test_material import material_world, qualify_start, shipment, receiving, qualification
from .test_handoff import transfer
from .test_technology import act


def initial_shortfall():
    s = QualitativeAKIS(material_world())
    qualify_start(s)
    assert shipment(s)["outcome"] == "APPLIED"
    assert receiving(s, amount="11.25")["outcome"] == "APPLIED"
    assert qualification(s, good="11.00", bad="0.25")["outcome"] == "APPLIED"
    return s


def supplemental(s, at=13, qty="1.50", round_number=2, owner="a",
                 ref="model://a/supplement-2", source="model://a/supplement-source-2"):
    return transfer(s, at, "handoff_dispatch", owner, ref,
                    material_replenishment_round=round_number,
                    material_replenishment_source_ref=source,
                    material_quantities=[{"batch": "batch-a", "quantity": qty}])


def receipt(s, at=14, qty="1.50", round_number=2, dispatch="model://a/supplement-2"):
    return transfer(s, at, "handoff_receive", "b", f"model://b/supplement-receipt-{round_number}",
                    material_replenishment_round=round_number, dispatch_ref=dispatch,
                    material_quantities=[{"batch": "batch-a", "quantity": qty}])


def inspect(s, at=15, good="1.50", bad="0", round_number=2):
    return transfer(s, at, "handoff_quality", "b", f"model://b/supplement-quality-{round_number}",
                    material_replenishment_round=round_number,
                    receipt_ref=f"model://b/supplement-receipt-{round_number}",
                    quality_quantities=[{"batch": "batch-a", "accepted": good, "rejected": bad}])


def batch(s):
    return s.snapshot()["works"]["w1"]["technology"]["materials"]["batches"][0]


def test_original_supplement_recovers_shortfall_without_erasing_prior_material_loss():
    s = initial_shortfall()
    reservations = deepcopy(s.capacity_ledger.reservations)
    assert act(s, 12, "start_operation", "b", operation="pack")["reason"] == "MATERIAL_QUANTITY_SHORT"
    assert supplemental(s)["outcome"] == "APPLIED"
    assert act(s, 14, "start_operation", "b", operation="pack")["reason"] == "HANDOFF_RECEIPT_NOT_DECLARED"
    assert receipt(s, at=15)["outcome"] == "APPLIED"
    assert act(s, 16, "start_operation", "b", operation="pack")["reason"] == "MATERIAL_QUALITY_NOT_ASSESSED"
    assert inspect(s, at=17)["outcome"] == "APPLIED"
    assert act(s, 18, "start_operation", "b", operation="pack")["outcome"] == "APPLIED"
    assert act(s, 19, "complete_operation", "b", operation="pack",
               result_ref="model://pack")["outcome"] == "APPLIED"
    assert act(s, 20, "complete", "a", result_ref="model://whole")["outcome"] == "APPLIED"
    assert act(s, 21, "accept", "c")["outcome"] == "APPLIED"
    row = batch(s)
    assert row["dispatched_quantity"] == "14.00"
    assert row["received_quantity"] == "12.75"
    assert row["accepted_quantity"] == "12.50"
    assert row["rejected_quantity"] == "0.25"
    assert row["unreceived_quantity"] == "1.25"
    assert row["unassessed_quantity"] == "0.00"
    assert row["readiness"] == "ACCEPTED_MODEL_CLAIM"
    assert row["material_round_count"] == 2
    assert row["original_material_rounds"][0]["dispatch_ref"] == "model://dispatch"
    assert row["original_material_rounds"][0]["accepted"] == "11.00"
    assert row["original_material_rounds"][1]["replenishment_source_ref"] == "model://a/supplement-source-2"
    assert reservations == s.capacity_ledger.reservations
    assert s.works["w1"].operation_evidence["cut"] == "model://cut-operation"
    assert s.works["w1"].result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("kwargs,reason", [
    ({"qty": "1.51"}, "MATERIAL_QUANTITY_EXCEEDS_DECLARATION"),
    ({"qty": "0"}, "MATERIAL_REPLENISHMENT_POSITIVE_SHORTFALL_REQUIRED"),
    ({"round_number": 3}, "MATERIAL_REPLENISHMENT_QUALIFIED_SHORTFALL_REQUIRED"),
    ({"owner": "op"}, "HANDOFF_ORIGINAL_SENDER_REQUIRED"),
    ({"source": "model://b/foreign"}, "MATERIAL_REPLENISHMENT_NEW_ORIGINAL_SENDER_SOURCE_REQUIRED"),
    ({"ref": "model://dispatch"}, "NEW_MODEL_ONLY_HANDOFF_EVIDENCE_REQUIRED"),
])
def test_original_replenishment_invalid_dispatch_does_not_archive_or_change_material(kwargs, reason):
    s = initial_shortfall()
    before = batch(s)
    assert supplemental(s, **kwargs)["reason"] == reason
    assert batch(s) == before


def test_original_replenishment_requires_fresh_receipt_and_quality_for_current_round():
    s = initial_shortfall()
    supplemental(s)
    before = batch(s)
    assert receiving(s, at=14)["reason"] == "MATERIAL_REPLENISHMENT_CURRENT_ROUND_REQUIRED"
    assert receipt(s, at=15, dispatch="model://dispatch")["reason"] == "HANDOFF_DISPATCH_REFERENCE_MISMATCH"
    assert batch(s) == before
    assert receipt(s, at=16)["outcome"] == "APPLIED"
    assert qualification(s, at=17)["reason"] == "MATERIAL_REPLENISHMENT_CURRENT_ROUND_REQUIRED"
    assert inspect(s, at=18, good="1.25", bad="0.25")["outcome"] == "APPLIED"
    assert act(s, 19, "start_operation", "b", operation="pack")["reason"] == "MATERIAL_QUALITY_INSUFFICIENT"
    assert supplemental(s, at=20, qty="0.25", round_number=3,
                        ref="model://a/supplement-3",
                        source="model://a/supplement-source-3")["outcome"] == "APPLIED"
    assert receipt(s, at=21, qty="0.25", round_number=3,
                   dispatch="model://a/supplement-3")["outcome"] == "APPLIED"
    assert inspect(s, at=22, good="0.25", round_number=3)["outcome"] == "APPLIED"
    row = batch(s)
    assert row["material_round_count"] == 3
    assert row["accepted_quantity"] == "12.50"
    assert row["rejected_quantity"] == "0.50"
    assert row["unreceived_quantity"] == "1.25"
    assert act(s, 23, "start_operation", "b", operation="pack")["outcome"] == "APPLIED"


def test_no_supplement_when_original_material_already_qualified_or_uninspected():
    s = QualitativeAKIS(material_world())
    qualify_start(s)
    shipment(s)
    receiving(s)
    assert supplemental(s, at=11)["reason"] == "MATERIAL_REPLENISHMENT_QUALIFIED_SHORTFALL_REQUIRED"
    qualification(s, at=12)
    assert supplemental(s, at=13)["reason"] == "MATERIAL_REPLENISHMENT_QUALIFIED_SHORTFALL_REQUIRED"
    assert batch(s)["accepted_quantity"] == "12.50"


def test_native_mesa_executes_original_material_rounds_in_one_work():
    from research.akis.qualitative_mesa.mesa_model import simulate
    from .test_material import material_world
    s = initial_shortfall()
    supplemental(s)
    receipt(s)
    inspect(s)
    act(s, 16, "start_operation", "b", operation="pack")
    act(s, 17, "complete_operation", "b", operation="pack", result_ref="model://pack")
    act(s, 18, "complete", "a", result_ref="model://whole")
    act(s, 19, "accept", "c")
    # Build a native input from the same explicit owner declarations,
    # rather than deriving an input from an already-produced trace.
    d = material_world()
    d["model_horizon"] = 24
    d["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        *[{"at": at, "action": "consent", "actor": owner, "work": "w1",
           "source_revision": "d1", "org_revision": "oc-1"} for at, owner in
          ((3, "a"), (4, "b"), (5, "c"))],
        {"at": 6, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 7, "action": "start_operation", "actor": "a", "work": "w1", "operation": "cut"},
        {"at": 8, "action": "complete_operation", "actor": "a", "work": "w1", "operation": "cut",
         "result_ref": "model://cut-operation"},
    ]
    edge = {"work": "w1", "from_operation": "cut", "to_operation": "pack",
            "source_revision": "d1", "org_revision": "oc-1"}
    for at, action, actor, ref, fields in (
        (9, "handoff_dispatch", "a", "model://dispatch",
         {"material_quantities": [{"batch": "batch-a", "quantity": "12.50"}]}),
        (10, "handoff_receive", "b", "model://receipt",
         {"dispatch_ref": "model://dispatch", "material_quantities": [{"batch": "batch-a", "quantity": "11.25"}]}),
        (11, "handoff_quality", "b", "model://quality",
         {"receipt_ref": "model://receipt", "quality_quantities": [{"batch": "batch-a", "accepted": "11.00", "rejected": "0.25"}]}),
        (13, "handoff_dispatch", "a", "model://a/supplement-2",
         {"material_replenishment_round": 2, "material_replenishment_source_ref": "model://a/supplement-source-2",
          "material_quantities": [{"batch": "batch-a", "quantity": "1.50"}]}),
        (14, "handoff_receive", "b", "model://b/supplement-receipt-2",
         {"material_replenishment_round": 2, "dispatch_ref": "model://a/supplement-2",
          "material_quantities": [{"batch": "batch-a", "quantity": "1.50"}]}),
        (15, "handoff_quality", "b", "model://b/supplement-quality-2",
         {"material_replenishment_round": 2, "receipt_ref": "model://b/supplement-receipt-2",
          "quality_quantities": [{"batch": "batch-a", "accepted": "1.50", "rejected": "0"}]}),
    ):
        d["events"].append({"at": at, "action": action, "actor": actor,
                            "result_ref": ref, **edge, **fields})
    d["events"].extend([
        {"at": 16, "action": "start_operation", "actor": "b", "work": "w1", "operation": "pack"},
        {"at": 17, "action": "complete_operation", "actor": "b", "work": "w1", "operation": "pack",
         "result_ref": "model://pack"},
        {"at": 18, "action": "complete", "actor": "a", "work": "w1", "result_ref": "model://whole"},
        {"at": 19, "action": "accept", "actor": "c", "work": "w1"},
    ])
    before = deepcopy(d)
    out = simulate(d)
    assert before == d
    assert out["counts"]["blocked"] == 0
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w1"]["technology"]["materials"]["batches"][0] == batch(s)
    assert len([e for e in out["trace"] if e.get("material_replenishment_round") == 2]) == 3
    assert simulate(deepcopy(d)) == out


def test_replenishment_round_null_is_not_a_first_round_or_implicit_permission():
    s = QualitativeAKIS(material_world())
    qualify_start(s)
    before = batch(s)
    assert transfer(s, 9, "handoff_dispatch", "a", "model://bad",
                    material_replenishment_round=None,
                    material_quantities=[{"batch": "batch-a", "quantity": "12.50"}])["reason"] == (
                        "MATERIAL_REPLENISHMENT_ROUND_INVALID")
    assert before == batch(s)


def test_replenishment_of_one_lot_preserves_other_qualified_lot_and_is_atomic():
    d = material_world()
    second = dict(deepcopy(d["works"][0]["material_batches"][0]),
                  id="batch-b", planned_quantity="5", origin_ref="model://origin-lot-b")
    d["works"][0]["material_batches"].append(second)
    s = QualitativeAKIS(d)
    qualify_start(s)
    def quantity(a, b):
        return [{"batch": "batch-a", "quantity": a}, {"batch": "batch-b", "quantity": b}]
    assert transfer(s, 9, "handoff_dispatch", "a", "model://dispatch",
                    material_quantities=quantity("12.50", "5"))["outcome"] == "APPLIED"
    assert transfer(s, 10, "handoff_receive", "b", "model://receipt",
                    dispatch_ref="model://dispatch", material_quantities=quantity("11.25", "5"))["outcome"] == "APPLIED"
    assert transfer(s, 11, "handoff_quality", "b", "model://quality", receipt_ref="model://receipt",
                    quality_quantities=[{"batch": "batch-a", "accepted": "11", "rejected": "0.25"},
                                        {"batch": "batch-b", "accepted": "5", "rejected": "0"}])["outcome"] == "APPLIED"
    before = deepcopy(s.snapshot()["works"]["w1"]["technology"]["materials"])
    kwargs = {"material_replenishment_round": 2,
              "material_replenishment_source_ref": "model://a/supplement-source-2"}
    assert transfer(s, 12, "handoff_dispatch", "a", "model://a/supplement-2",
                    material_quantities=quantity("1.50", "0.01"), **kwargs)["reason"] == (
                        "MATERIAL_QUANTITY_EXCEEDS_DECLARATION")
    assert before == s.snapshot()["works"]["w1"]["technology"]["materials"]
    assert transfer(s, 13, "handoff_dispatch", "a", "model://a/supplement-2",
                    material_quantities=quantity("1.50", "0"), **kwargs)["outcome"] == "APPLIED"
    assert transfer(s, 14, "handoff_receive", "b", "model://b/supplement-receipt",
                    dispatch_ref="model://a/supplement-2", material_replenishment_round=2,
                    material_quantities=quantity("1.50", "0"))["outcome"] == "APPLIED"
    assert transfer(s, 15, "handoff_quality", "b", "model://b/supplement-quality",
                    receipt_ref="model://b/supplement-receipt", material_replenishment_round=2,
                    quality_quantities=[{"batch": "batch-a", "accepted": "1.50", "rejected": "0"},
                                        {"batch": "batch-b", "accepted": "0", "rejected": "0"}])["outcome"] == "APPLIED"
    rows = s.snapshot()["works"]["w1"]["technology"]["materials"]["batches"]
    assert [(row["batch"], row["accepted_quantity"]) for row in rows] == [
        ("batch-a", "12.50"), ("batch-b", "5")]
    assert rows[1]["dispatched_quantity"] == "5"
    assert act(s, 16, "start_operation", "b", operation="pack")["outcome"] == "APPLIED"


def material_finance_portfolio(*, supplement=True, seller_cost="60.00",
                               buyer_cost="15.00", declared=True):
    """One original technology and portfolio. Replenishment from own stock.

    Both prospective histories have exactly the same original material
    requirement, quality standard, order terms, reservation and useful
    final result. Only independent handoff observations and exclusive
    costs of the extra handling/stock use differ.
    """
    from .test_r3_r4_original_multi_order_portfolio_mesa import finance_portfolio, _event
    from .test_r1t3_original_technology_route_mesa import bind_commercial_terms
    from .test_r1u4_strict_original_source_rights_mesa import _original_rights
    from research.akis.qualitative_mesa.technology import technology_route_fingerprint

    d = finance_portfolio()["coproduction"]
    d["material_strict"] = True
    money = d["economic_claims"]
    events = d["events"]
    request = _event(d, "request", "w3")["work_spec"]
    request["material_batches"] = [{
        "id": "original-w3-components", "from_operation": "stage-a", "to_operation": "stage-c",
        "material_id": "component-stock", "planned_quantity": "12.50", "unit": "kg",
        "declared_title_holder": "b", "origin_source_owner": "a",
        "origin_ref": "model://a/original-w3-components", "quality_spec_owner": "b",
        "quality_spec_ref": "model://b/original-w3-material-spec",
    }]
    proposal = _event(d, "technology_route_propose")
    proposal["technology_route_work_spec"] = deepcopy(request)
    digest = technology_route_fingerprint(request)
    for ev in events:
        if ev.get("technology_route_id") == proposal["technology_route_id"]:
            ev["technology_route_fingerprint"] = digest
    terms = deepcopy(proposal["technology_route_commercial_terms"])
    terms["route_fingerprint"] = digest
    bind_commercial_terms(d, terms)

    dispatch = _event(d, "handoff_dispatch", "w3")
    received = _event(d, "handoff_receive", "w3")
    start = next(e for e in events if e.get("work") == "w3" and
                 e["action"] == "start_operation" and e["operation"] == "stage-c")
    occupied = {e["at"] for e in events}
    free = [i for i in range(received["at"]+1, start["at"]) if i not in occupied]
    assert len(free) >= 4, free
    initial_quality_at, dispatch_at, receipt_at, quality_at = free[:4]
    batch = "original-w3-components"
    dispatch["material_quantities"] = [{"batch": batch, "quantity": "12.50"}]
    received["material_quantities"] = [{"batch": batch, "quantity": (
        "11.25" if supplement else "12.50")}]
    edge = {"work": "w3", "from_operation": "stage-a", "to_operation": "stage-c",
            "source_revision": "d-3", "org_revision": "oc-1"}
    first_quality = {"at": initial_quality_at, "action": "handoff_quality", "actor": "b",
                     "result_ref": "model://b/w3-initial-material-inspection",
                     "receipt_ref": received["result_ref"], **edge,
                     "quality_quantities": [{"batch": batch,
                         "accepted": "11.00" if supplement else "12.50",
                         "rejected": "0.25" if supplement else "0"}]}
    more = [
        {"at": dispatch_at, "action": "handoff_dispatch", "actor": "a", **edge,
         "result_ref": "model://a/w3-extra-dispatch", "material_replenishment_round": 2,
         "material_replenishment_source_ref": "model://a/w3-extra-stock-source",
         "material_quantities": [{"batch": batch, "quantity": "1.50"}]},
        {"at": receipt_at, "action": "handoff_receive", "actor": "b", **edge,
         "result_ref": "model://b/w3-extra-receipt", "material_replenishment_round": 2,
         "dispatch_ref": "model://a/w3-extra-dispatch",
         "material_quantities": [{"batch": batch, "quantity": "1.50"}]},
        {"at": quality_at, "action": "handoff_quality", "actor": "b", **edge,
         "result_ref": "model://b/w3-extra-inspection", "material_replenishment_round": 2,
         "receipt_ref": "model://b/w3-extra-receipt",
         "quality_quantities": [{"batch": batch, "accepted": "1.50", "rejected": "0"}]},
    ]
    events.append(first_quality)
    if supplement:
        events.extend(more)
    events.sort(key=lambda row: row["at"])
    # New original inspection permission within the existing strict KPB.
    # Original handoff dispatch/receipt rights already exist unchanged.
    rights = {"events": [deepcopy(first_quality)]}
    _original_rights(rights)
    for source in rights["context_evidence"]["sources"]:
        source["valid_until"] = d["model_horizon"]+1
    for name in ("sources", "requirements", "decision_requirements"):
        d["context_evidence"][name].extend(rights["context_evidence"][name])

    value = next(row for row in money["recipient_use_value_evidence"] if row["work"] == "w3")
    for owner, name, amount, event, stage, nature in (
        ("a", "stock-and-dispatch", seller_cost, more[0], "PRODUCTION_COORDINATION", "DIRECT_RESOURCE"),
        ("b", "repeat-inspection", buyer_cost, more[2], "MONITORING_AND_QUALITY", "TRANSACTION"),
    ):
        rid = f"w3-original-supplement-{name}"
        proof = f"model://{owner}/{rid}-cost"
        d["context_evidence"]["sources"].append({
            "id": proof, "owner": owner, "revision": "material-cost-v1", "status": "CONFIRMED",
            "usable_by": [owner], "core": "corporate", "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
            "operations": ["READ"], "valid_from": event["at"], "valid_until": d["model_horizon"]+1,
        })
        if not supplement or not declared:
            continue
        source = money["coverage"]["COOPERATION"][owner]
        money["resource_uses"].append({"id": rid, "scenario": "COOPERATION", "work": "w3",
            "owner": owner, "source": source, "amount": amount, "bucket": "FAILURE"})
        money["lifecycle_costs"]["bindings"].append({"resource_use_id": rid, "owner": owner,
            "source": source, "stage": stage, "nature": nature})
        money["lifecycle_costs"]["event_bindings"].append({"resource_use_id": rid, "work": "w3",
            "owner": owner, "source": source, "work_source_revision": "d-3", "trace_position": 0,
            "at": event["at"], "action": event["action"], "org_revision": "oc-1",
            "cost_evidence_ref": proof, "cost_evidence_revision": "material-cost-v1"})
        money["market_order_economics"]["owner_scopes"][owner]["resource_use_ids"].append(rid)
        money["portfolio_scope_evidence"]["owner_scopes"][owner]["resource_use_ids"].append(rid)
        if owner == "b":
            value["resource_use_ids"].append(rid)
    for row in money["lifecycle_costs"]["event_bindings"]:
        row["trace_position"] = next(i for i, ev in enumerate(events) if ev["at"] == row["at"])
    return d


def observed_material_finance(doc):
    from research.akis.qualitative_mesa.mesa_model import simulate
    out = simulate(doc)
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e["reason"]) for e in out["trace"] if e["outcome"] == "BLOCKED"]
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    r = out["economics"]["original_portfolio_economics"]
    assert r["status"] == "MODEL_ORIGINAL_MULTI_ORDER_PORTFOLIO_ECONOMICS", r
    return out, r["local_research_only"]["activity_efficiency"]


@pytest.mark.parametrize("seller,buyer,total,net", [
    ("60.00", "15.00", "75.00", "990.00"),
    ("0.00", "0.00", "0.00", "1065.00"),
    ("1000.00", "100.00", "1100.00", "-35.00"),
])
def test_original_material_replenishment_preserves_result_value_but_adds_declared_exclusive_cost(
        seller, buyer, total, net):
    from decimal import Decimal
    _, before = observed_material_finance(material_finance_portfolio(supplement=False))
    doc = material_finance_portfolio(seller_cost=seller, buyer_cost=buyer)
    frozen = deepcopy(doc)
    out, after = observed_material_finance(doc)
    assert doc == frozen
    assert before["consolidated"]["gross_incremental_recipient_use_value"] == (
        after["consolidated"]["gross_incremental_recipient_use_value"]) == "2200.00"
    assert after["consolidated"]["model_economic_contribution"] == net
    assert before["reserved_capacity_unit_ticks_by_resource"] == after["reserved_capacity_unit_ticks_by_resource"]
    assert before["internal_transfer_turnover_not_system_output"] == after["internal_transfer_turnover_not_system_output"]
    assert before["per_original_work"]["w3"]["request_to_accept_model_ticks"] == (
        after["per_original_work"]["w3"]["request_to_accept_model_ticks"])
    for owner, cost in (("a", seller), ("b", buyer)):
        assert Decimal(after["per_original_owner"][owner]["model_cash_resource_balance"]) == (
            Decimal(before["per_original_owner"][owner]["model_cash_resource_balance"])-Decimal(cost))
    material = after["per_original_work"]["w3"]["original_material_replenishment"]
    assert material["separately_declared_supplementary_handoff_resource_cost"] == total
    assert material["supplementary_handoff_original_cost_row_count"] == 2
    assert material["original_applied_supplementary_dispatch_count"] == 1
    assert material["original_applied_supplementary_inspection_count"] == 1
    row = material["per_original_batch"]["original-w3-components"]
    assert row["planned_quantity"] == row["cumulative_accepted_quantity"] == "12.50"
    assert row["cumulative_dispatched_quantity"] == "14.00"
    assert row["cumulative_received_quantity"] == "12.75"
    assert row["cumulative_rejected_quantity"] == "0.25"
    assert row["cumulative_unreceived_quantity"] == "1.25"
    assert row["qualified_quantity_to_dispatched_ratio"] == "0.8929"
    assert out["economics"]["profit"] == "UNKNOWN"


def test_original_material_replenishment_missing_cost_is_not_a_zero_measurement():
    _, report = observed_material_finance(material_finance_portfolio(declared=False))
    material = report["per_original_work"]["w3"]["original_material_replenishment"]
    assert material["separately_declared_supplementary_handoff_resource_cost"] is None
    assert material["supplementary_handoff_original_cost_row_count"] == 0
