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


def bilateral_internal_case():
    """Both ORIGINAL parties independently source the same pre-existing transfer."""
    d = shared_cost_case()
    transfer = next(t for t in d["economic_claims"]["transfers"] if t["id"] == "t2")
    assert (transfer["payer"], transfer["payee"], transfer["amount"]) == (
        "b", "op", "120.00"
    )
    transfer["work"] = None
    for owner, proof in (("b", "b1"), ("op", "o1")):
        d["economic_claims"]["common_allocations"].append({
            "record_id": "t2", "record_type": "TRANSFER",
            "scenario": "COOPERATION", "work": "w2",
            "owner": owner, "amount": "120.00", "source": proof,
            "source_revision": "doc-r1",
            "driver_ref": f"model://{owner}/independent-original-allocation",
        })
    return d


def test_two_original_parties_can_attribute_existing_internal_transfer_without_new_network_money():
    d=bilateral_internal_case()
    before=deepcopy(d)
    result=simulate(d)
    assert d == before
    work=result["work_counterfactual_dynamics"]["works"][0]
    assert work["status"]=="DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
    assert work["network_declared_external_cash_difference"]=="113.00"
    assert work["per_original_owner"]["b"]["declared_work_cash_difference_cooperation_minus_alternative"]=="15.00"
    assert work["per_original_owner"]["op"]["declared_work_cash_difference_cooperation_minus_alternative"]=="28.00"
    assert work["per_scenario"]["COOPERATION"]["original_work_internal_transfer_count"] == 2
    assert work["per_scenario"]["COOPERATION"]["owners"]["op"]["allocated_original_common_cash_row_count"] == 1
    assert work["per_scenario"]["COOPERATION"]["owners"]["b"]["allocated_original_common_cash_row_count"] == 1
    info=result["economics"]["common_work_allocations"]
    assert info["model_bilateral_internal_transfer_slices"] == 1
    assert info["unallocated_remainders"]["t2"] == "0.00"
    assert len(info["by_original_record"]["t2"][0]["original_party_source_claims"]) == 2
    assert info["real_dual_signatures_verified"] is False
    assert info["new_cash_or_cost_records_created"] == 0
    assert result["economics"]["internal_transfers_count"]["COOPERATION"] == 2
    assert result["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"] == "258.00"
    assert result["economics"]["profit"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == result


@pytest.mark.parametrize("mutate,reason",[
    (lambda d:d["economic_claims"]["common_allocations"].pop(),
     "COMMON_ALLOCATION_INTERNAL_TRANSFER_REQUIRES_BOTH_PRINCIPALS"),
    (lambda d:d["economic_claims"]["common_allocations"][-1].update(amount="119.00"),
     "COMMON_ALLOCATION_INTERNAL_PARTY_AMOUNT_MISMATCH"),
    (lambda d:d["economic_claims"]["common_allocations"][-1].update(owner="b"),
     "COMMON_ALLOCATION_DUPLICATE_ORIGINAL_PARTY"),
    (lambda d:d["economic_claims"]["common_allocations"][-1].update(source="b1"),
     "COMMON_ALLOCATION_OWNER_SOURCE_REVISION_MISMATCH"),
    (lambda d:d["economic_claims"]["common_allocations"][-1].update(source_revision="doc-old"),
     "COMMON_ALLOCATION_OWNER_SOURCE_REVISION_MISMATCH"),
    (lambda d:d["economic_claims"]["common_allocations"][-1].update(driver_ref="model://b/forged"),
     "COMMON_ALLOCATION_OWNER_DRIVER_SOURCE_MISMATCH"),
    (lambda d:d["economic_claims"]["common_allocations"][-1].update(work="w1"),
     "COMMON_ALLOCATION_INTERNAL_TRANSFER_REQUIRES_BOTH_PRINCIPALS"),
    (lambda d:d["economic_claims"]["common_allocations"][-1].update(amount="120.01"),
     "COMMON_ALLOCATION_INTERNAL_PARTY_AMOUNT_MISMATCH"),
    (lambda d:d["economic_claims"]["common_allocations"][-1].update(scenario="INDEPENDENT_ALTERNATIVE"),
     "COMMON_ALLOCATION_ONLY_ORIGINAL_COMMON_ROW"),
])
def test_internal_original_payment_allocation_requires_matching_independent_sources(mutate, reason):
    d=bilateral_internal_case()
    mutate(d)
    with pytest.raises(ValueError, match=reason):
        simulate(d)


def test_bilateral_internal_splits_across_two_work_ids_count_only_once_per_original_payment():
    d=bilateral_internal_case()
    for original in d["economic_claims"]["common_allocations"][-2:]:
        original["amount"] = "90.00"
    for original in deepcopy(d["economic_claims"]["common_allocations"][-2:]):
        original["work"] = "w1"
        original["amount"] = "30.00"
        d["economic_claims"]["common_allocations"].append(original)
    out=simulate(d)
    assert out["economics"]["common_work_allocations"]["unallocated_remainders"]["t2"]=="0.00"
    assert out["economics"]["common_work_allocations"]["model_bilateral_internal_transfer_slices"]==2
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"]=="258.00"
    w2=out["work_counterfactual_dynamics"]["works"][0]
    assert w2["network_declared_external_cash_difference"]=="113.00"
    # Each side sees only its share: 30 of the same 120 was assigned elsewhere.
    assert w2["per_original_owner"]["b"]["declared_work_cash_difference_cooperation_minus_alternative"]=="45.00"
    assert w2["per_original_owner"]["op"]["declared_work_cash_difference_cooperation_minus_alternative"]=="-2.00"
    assert out["economics"]["profit"]=="UNKNOWN"


def test_incomplete_matching_bilateral_slices_do_not_qualify_a_complete_work_economy():
    d=bilateral_internal_case()
    for claim in d["economic_claims"]["common_allocations"][-2:]:
        claim["amount"]="119.00"
    out=simulate(d)
    row=out["work_counterfactual_dynamics"]["works"][0]
    assert row["status"]=="COUNTERFACTUAL_WORK_SCOPE_NOT_QUALIFIED"
    assert row["network_declared_external_cash_difference"] is None
    assert "COMMON_CASH_FLOW_NOT_ATTRIBUTED_TO_WORK" in row["per_scenario"]["COOPERATION"]["owners"]["op"]["reasons"]
    assert out["economics"]["common_work_allocations"]["unallocated_remainders"]["t2"]=="1.00"
