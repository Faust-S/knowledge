"""R2: allocate *existing* owner cash/resource records to original Works.

No second ledger, no invented economic events, no implied profitability.
"""
from copy import deepcopy

import pytest
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_work_counterfactual_mesa import counterfactual_case


def shared_cost_case():
    d = counterfactual_case()
    money = d["economic_claims"]
    money["transfers"].append({
        "id": "t-shared", "scenario": "COOPERATION", "payer": "op",
        "payee": "EXTERNAL", "amount": "12.00", "source": "o1", "work": None,
    })
    money["resource_uses"].append({
        "id": "c-shared", "scenario": "COOPERATION", "owner": "op",
        "amount": "6.00", "bucket": "COORDINATION", "source": "o1", "work": None,
    })
    money["lifecycle_costs"]["bindings"].append({
        "resource_use_id": "c-shared", "owner": "op", "source": "o1",
        "stage": "PRODUCTION_COORDINATION", "nature": "TRANSACTION",
    })
    money["common_allocations"] = [
        {
            "record_id": rid, "record_type": kind, "scenario": "COOPERATION",
            "work": "w2", "owner": "op", "amount": amount,
            "source": "o1", "source_revision": "doc-r1",
            "driver_ref": "model://op/allocation-basis-1",
        }
        for rid, kind, amount in (
            ("t-shared", "TRANSFER", "12.00"),
            ("c-shared", "RESOURCE_USE", "6.00"),
        )
    ]
    return d


def test_complete_original_common_allocation_qualifies_same_work_and_network():
    d = shared_cost_case()
    out = simulate(d)
    view = out["work_counterfactual_dynamics"]["works"][0]
    assert view["status"] == "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
    assert view["network_declared_external_cash_difference"] == "113.00"
    op = view["per_original_owner"]["op"]
    assert op["declared_work_cash_difference_cooperation_minus_alternative"] == "28.00"
    assert op["declared_work_noncash_cost_difference_separate_from_cash"] == "21.00"
    s = view["per_scenario"]["COOPERATION"]["owners"]["op"]
    assert s["unallocated_common_cash_count"] == 0
    assert s["unallocated_common_cost_count"] == 0
    assert s["original_work_cash_from_existing_transfers"] == "28.00"
    assert s["original_work_noncash_resource_uses"] == "21.00"
    assert s["allocated_original_common_cash_row_count"] == 1
    assert s["allocated_original_common_noncash_row_count"] == 1
    assert s["declared_lifecycle_stage_costs"]["PRODUCTION_COORDINATION"] == "6.00"
    allocation = out["economics"]["common_work_allocations"]
    assert allocation["new_cash_or_cost_records_created"] == 0
    assert allocation["model_only_no_real_cost_driver_verified"]
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"] == "258.00"
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["work_counterfactual_dynamics"]["causal_transaction_savings"] == "NOT_IDENTIFIABLE"
    assert simulate(deepcopy(d)) == out


def test_no_allocation_keeps_previous_common_cost_block():
    d=shared_cost_case()
    d["economic_claims"].pop("common_allocations")
    out=simulate(d)["work_counterfactual_dynamics"]["works"][0]
    assert out["status"]=="COUNTERFACTUAL_WORK_SCOPE_NOT_QUALIFIED"
    assert out["network_declared_external_cash_difference"] is None


def test_partial_allocation_is_not_complete_or_assumed_zero():
    d=shared_cost_case()
    d["economic_claims"]["common_allocations"][0]["amount"]="10.00"
    out=simulate(d)
    work=out["work_counterfactual_dynamics"]["works"][0]
    assert work["status"]=="COUNTERFACTUAL_WORK_SCOPE_NOT_QUALIFIED"
    assert "COMMON_CASH_FLOW_NOT_ATTRIBUTED_TO_WORK" in work["per_scenario"]["COOPERATION"]["owners"]["op"]["reasons"]
    assert out["economics"]["common_work_allocations"]["unallocated_remainders"]["t-shared"] == "2.00"
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"] == "258.00"


def test_split_original_record_into_two_work_slices_without_duplicate_cash():
    d=shared_cost_case()
    d["economic_claims"]["common_allocations"][0]["amount"]="8.00"
    d["economic_claims"]["common_allocations"].append({
        **d["economic_claims"]["common_allocations"][0],
        "work":"w1","amount":"4.00",
    })
    out=simulate(d)
    view=out["work_counterfactual_dynamics"]["works"][0]
    assert view["status"]=="DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
    assert view["network_declared_external_cash_difference"]=="117.00"
    assert view["per_original_owner"]["op"]["declared_work_cash_difference_cooperation_minus_alternative"]=="32.00"
    alloc=out["economics"]["common_work_allocations"]
    assert alloc["unallocated_remainders"]["t-shared"]=="0.00"
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"]=="258.00"


@pytest.mark.parametrize("mod",[
    lambda d:d["economic_claims"]["common_allocations"][0].update(amount="12.01"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(amount="-1.00"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(owner="b"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(source="b1"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(source_revision="old"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(record_id="t2"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(record_type="RESOURCE_USE"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(work="not-a-work"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(driver_ref="model://b/foreign"),
    lambda d:d["economic_claims"]["common_allocations"][0].update(scenario="INDEPENDENT_ALTERNATIVE"),
    lambda d:d["economic_claims"]["common_allocations"].append(
        deepcopy(d["economic_claims"]["common_allocations"][0])),
])
def test_unsupported_or_unauthorized_allocation_fails_closed(mod):
    d=shared_cost_case()
    mod(d)
    with pytest.raises(ValueError,match="COMMON_ALLOCATION"):
        simulate(d)


def test_internal_transfer_cannot_be_allocated_without_both_original_parties():
    d=shared_cost_case()
    transfer=next(x for x in d["economic_claims"]["transfers"] if x["id"]=="t2")
    transfer["work"]=None
    d["economic_claims"]["common_allocations"].append({
        "record_id":"t2","record_type":"TRANSFER","scenario":"COOPERATION",
        "work":"w2","owner":"b","amount":"120.00","source":"b1",
        "source_revision":"doc-r1","driver_ref":"model://b/driver",
    })
    with pytest.raises(ValueError,match="COMMON_ALLOCATION"):
        simulate(d)
