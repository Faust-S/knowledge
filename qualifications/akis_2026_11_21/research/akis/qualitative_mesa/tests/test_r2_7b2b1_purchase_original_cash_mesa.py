"""R2.7B2B1: supplier quantity tier matches EXISTING Work cash/resource records.

These are only source-declared prices. No bank payment, goods delivery,
owner joint-buying consent, operator profit, or full net savings is inferred.
"""
from copy import deepcopy
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_joint_purchasing_mesa_integration import scenario
from .test_general_system_mesa_integration import design


OWNERS = ("a", "b", "c")
QUANTITIES = {"a": 12, "b": 8, "c": 5}


def original_case():
    d = scenario()
    d["general_akis"] = design()
    sources = [
        {"id": f"{owner}-money", "owner": owner,
         "reference": f"model://{owner}/original-economic-source",
         "revision": "doc-1"}
        for owner in (*OWNERS, "op")
    ]
    transfers = []
    resources = []
    bindings = []
    for owner, quantity in QUANTITIES.items():
        for scenario_key, label, unit_price in (
            ("COOPERATION", "coop", 80),
            ("INDEPENDENT_ALTERNATIVE", "outside", 100),
        ):
            work = f"w-{owner}"
            transfer = f"{label}-purchase-{owner}"
            resource = f"{label}-goods-{owner}"
            transfers.append({
                "id": transfer, "scenario": scenario_key, "payer": owner,
                "payee": "EXTERNAL", "amount": f"{quantity*unit_price:.2f}",
                "source": f"{owner}-money", "work": work,
            })
            resources.append({
                "id": resource, "scenario": scenario_key, "owner": owner,
                "amount": "1.00", "bucket": "DELIVERY",
                "source": f"{owner}-money", "work": work,
            })
        bindings.append({
            "owner": owner, "work": f"w-{owner}",
            "work_source_revision": f"r-{owner}",
            "owner_reconciliation_ref": f"model://{owner}/quote-cash-proof-1",
            "cooperation_external_transfer_id": f"coop-purchase-{owner}",
            "outside_external_transfer_id": f"outside-purchase-{owner}",
            "cooperation_resource_use_id": f"coop-goods-{owner}",
            "outside_resource_use_id": f"outside-goods-{owner}",
        })
    d["economic_claims"] = {
        "period": "2026-11", "currency": "RUB",
        "sources": sources,
        "transfers": transfers, "resource_uses": resources,
        "coverage": {
            key: {owner: f"{owner}-money" for owner in (*OWNERS, "op")}
            for key in ("COOPERATION", "INDEPENDENT_ALTERNATIVE")
        },
        "outside_feasibility": {
            owner: {
                "state": "FEASIBLE_DECLARED" if owner in OWNERS else "UNKNOWN",
                "source": f"{owner}-money",
            }
            for owner in (*OWNERS, "op")
        },
        "joint_purchasing_original_cash_bindings": [{
            "plan": "p1",
            "supplier_source_ref": "model://supplier/offer-1",
            "quote_at": 5,
            "buyer_bindings": bindings,
        }],
    }
    return d


def out(d):
    return simulate(d)


def price_view(d):
    return out(d)["economics"]["joint_purchasing_original_cash_linkage"]


def test_original_supplier_price_buyer_cash_and_noncash_same_ledger():
    d = original_case()
    result = out(d)
    econ = result["economics"]
    review = econ["joint_purchasing_original_cash_linkage"]
    assert review["original_matched_plan_count"] == 1
    assert review["original_incomplete_plan_count"] == 0
    assert review["unreviewed_purchasing_plan_count"] == 0
    assert review["source_declared_existing_original_transfer_count"] == 6
    assert review["source_declared_existing_original_resource_use_count"] == 6
    plan = review["plans"][0]
    assert plan["status"] == (
        "ORIGINAL_SUPPLIER_PRICE_AND_OWNER_CASH_ROWS_SOURCE_MATCHED_MODEL_ONLY"
    )
    assert plan["declared_model_group_quantity_units"] == 25
    assert plan["declared_model_tier_minimum_quantity"] == 20
    assert plan["group_original_supplier_external_cash_cooperation"] == "2000.00"
    assert plan["group_original_supplier_external_cash_independent"] == "2500.00"
    assert plan["group_independent_minus_cooperation_supplier_price_claim_only"] == "500.00"
    assert plan["original_buyer_private_model_views"]["a"][
        "independent_minus_cooperation_purchase_price_only"] == "240.00"
    assert not plan["full_ancillary_and_operator_purchase_costs_reconciled"]
    assert not plan["actual_external_bank_settlement_proven"]
    assert not plan["original_work_results_or_supplier_delivery_accepted_proven"]
    assert not plan["full_network_economic_gain_or_profits_proven"]
    assert econ["transfers_count"] == 6
    assert econ["resource_uses_count"] == 6
    assert econ["consolidated_external_cash_from_claims"] == {
        "COOPERATION": "-2000.00",
        "INDEPENDENT_ALTERNATIVE": "-2500.00",
    }
    assert not econ["resource_costs_additive_to_cash"]
    assert econ["profit"] == "UNKNOWN"
    assert result["cooperation"]["joint_purchasing_model"]["prospective_only"]
    assert result["profit"]["system_increment"] == "UNKNOWN"
    assert all(v["obligation"] == "NOT_ACCEPTED" for v in result["works"].values())
    shared = result["general_akis_model"]["joint_purchasing_original_price_feedback"]
    assert shared["model_only_source_matched_original_plan_count"] == 1
    assert shared["original_existing_transfer_reference_count"] == 6
    assert not shared["private_owner_quantities_prices_sources_and_supplier_quotes_redisclosed"]
    public = json.dumps(result["general_akis_model"], ensure_ascii=False)
    assert "quote-cash-proof" not in public
    assert "2500.00" not in public
    assert "model://supplier/offer-1" not in public
    assert result == out(deepcopy(d))


def test_missing_original_buyer_never_implies_zero_or_valid_network_discount():
    d = original_case()
    d["economic_claims"]["joint_purchasing_original_cash_bindings"][0][
        "buyer_bindings"].pop()
    plan = price_view(d)["plans"][0]
    assert plan["status"] == "PURCHASE_ORIGINAL_OWNER_PRICE_SCOPE_INCOMPLETE"
    assert plan["missing_original_buyer_count"] == 1
    assert plan["group_independent_minus_cooperation_supplier_price_claim_only"] is None
    assert plan["group_original_supplier_external_cash_cooperation"] is None


@pytest.mark.parametrize("change,error", [
    (lambda d: d["economic_claims"]["joint_purchasing_original_cash_bindings"][0].update(
        supplier_source_ref="model://supplier/impostor"),
     "PURCHASE_ORIGINAL_SUPPLIER_QUOTE_SOURCE_MISMATCH"),
    (lambda d: d["economic_claims"]["joint_purchasing_original_cash_bindings"][0].update(
        quote_at=20), "PURCHASE_ORIGINAL_SUPPLIER_QUOTE_EXPIRED"),
    (lambda d: d["economic_claims"].update(period="2026-12"),
     "PURCHASE_ORIGINAL_PERIOD_CURRENCY_MISMATCH"),
    (lambda d: d["joint_purchasing_proposals"][0].update(capacity_units=24),
     "PURCHASE_ORIGINAL_GROUP_CAPACITY_EXCEEDED"),
    (lambda d: d["economic_claims"]["transfers"][0].update(amount="959.99"),
     "PURCHASE_ORIGINAL_UNIT_PRICE_CASH_MISMATCH"),
    (lambda d: d["economic_claims"]["transfers"][0].update(payer="op",source="op-money"),
     "PURCHASE_ORIGINAL_EXTERNAL_BUYER_PAYMENT_SCOPE"),
    (lambda d: d["economic_claims"]["transfers"][0].update(
        payee="b",source="a-money"), "PURCHASE_ORIGINAL_EXTERNAL_BUYER_PAYMENT_SCOPE"),
    (lambda d: d["economic_claims"]["resource_uses"][0].update(bucket="EXIT"),
     "PURCHASE_ORIGINAL_BUYER_RESOURCE_SCOPE"),
    (lambda d: d["economic_claims"]["resource_uses"][0].update(work="w-b"),
     "PURCHASE_ORIGINAL_BUYER_RESOURCE_SCOPE"),
    (lambda d: d["economic_claims"]["joint_purchasing_original_cash_bindings"][0][
        "buyer_bindings"][0].update(work_source_revision="bad"),
     "PURCHASE_ORIGINAL_BUYER_WORK_SCOPE_MISMATCH"),
    (lambda d: d["economic_claims"]["joint_purchasing_original_cash_bindings"][0][
        "buyer_bindings"][0].update(owner_reconciliation_ref="model://b/borrowed"),
     "PURCHASE_ORIGINAL_INDEPENDENT_OWNER_PROOF_REQUIRED"),
    (lambda d: d["economic_claims"]["joint_purchasing_original_cash_bindings"][0][
        "buyer_bindings"][1].update(
        cooperation_external_transfer_id="coop-purchase-a"),
     "PURCHASE_ORIGINAL_CASH_OR_RESOURCE_REUSED"),
    (lambda d: d["economic_claims"]["joint_purchasing_original_cash_bindings"][0][
        "buyer_bindings"][0].update(
        cooperation_resource_use_id="outside-goods-a"),
     "PURCHASE_ORIGINAL_BUYER_RESOURCE_SCOPE"),
    (lambda d: d["economic_claims"]["joint_purchasing_original_cash_bindings"][0][
        "buyer_bindings"][0].update(
        outside_external_transfer_id="coop-purchase-a"),
     "PURCHASE_ORIGINAL_CASH_OR_RESOURCE_REUSED"),
    (lambda d: d["economic_claims"]["joint_purchasing_original_cash_bindings"][0][
        "buyer_bindings"][0].update(
        outside_resource_use_id="missing"),
     "PURCHASE_ORIGINAL_CASH_AND_RESOURCE_REQUIRED"),
])
def test_original_purchasing_source_and_price_fail_closed(change,error):
    d = original_case()
    change(d)
    with pytest.raises(InputError,match=error):
        out(d)


def test_independent_alternative_not_feasible_blocks_price_advantage_claim():
    d = original_case()
    d["economic_claims"]["outside_feasibility"]["b"]["state"] = "UNKNOWN"
    plan = price_view(d)["plans"][0]
    assert plan["status"] == "PURCHASE_ORIGINAL_OWNER_PRICE_SCOPE_INCOMPLETE"
    assert plan["original_owner_outside_or_coverage_unknown_count"] == 1
    assert plan["group_independent_minus_cooperation_supplier_price_claim_only"] is None
    assert plan["original_buyer_private_model_views"]["b"][
        "independent_minus_cooperation_purchase_price_only"] is None


def test_original_quote_sign_reversal_is_not_real_gain_or_payment():
    d = original_case()
    for buyer in d["joint_purchasing_proposals"][0]["buyers"]:
        buyer["outside_unit_cash"] = "70.00"
    for transfer in d["economic_claims"]["transfers"]:
        if transfer["scenario"] == "INDEPENDENT_ALTERNATIVE":
            owner = transfer["payer"]
            transfer["amount"] = f"{QUANTITIES[owner] * 70:.2f}"
    res = out(d)
    row = res["economics"]["joint_purchasing_original_cash_linkage"]["plans"][0]
    assert row["group_independent_minus_cooperation_supplier_price_claim_only"] == "-250.00"
    assert res["economics"]["profit"] == "UNKNOWN"
    assert not row["actual_external_bank_settlement_proven"]


def test_existing_supplier_quote_can_match_old_price_but_not_certify_delivery():
    d = original_case()
    d["model_horizon"] = 25  # source ended at tick 20; 5 was earlier
    res = out(d)
    price = res["economics"]["joint_purchasing_original_cash_linkage"]["plans"][0]
    assert price["status"].endswith("MODEL_ONLY")
    assert price["original_work_results_or_supplier_delivery_accepted_proven"] is False
    assert res["cooperation"]["joint_purchasing_model"]["proposals"][0][
        "status"] == "SOURCE_NOT_CURRENT"


def test_full_original_purchase_price_rows_do_not_qualify_ancillary_costs():
    d = original_case()
    d["joint_purchasing_proposals"][0]["shared_costs"]["operator_fee_cash"] = "50000.00"
    res = out(d)
    price = res["economics"]["joint_purchasing_original_cash_linkage"]["plans"][0]
    assert price["group_independent_minus_cooperation_supplier_price_claim_only"] == "500.00"
    assert not price["full_ancillary_and_operator_purchase_costs_reconciled"]
    assert not price["full_network_economic_gain_or_profits_proven"]
    assert res["cooperation"]["joint_purchasing_model"]["proposals"][0][
        "status"] == "NO_VOLUNTARILY_VIABLE_GROUP"


def test_no_cash_bindings_preserves_old_prospective_purchasing_behavior():
    d = original_case()
    del d["economic_claims"]["joint_purchasing_original_cash_bindings"]
    original = out(d)
    assert "joint_purchasing_original_cash_linkage" not in original["economics"]
    assert "joint_purchasing_original_price_feedback" not in original["general_akis_model"]
    assert original["cooperation"]["joint_purchasing_model"]["prospective_only"]
    assert original["economics"]["profit"] == "UNKNOWN"


def test_unknown_plan_or_duplicate_economic_annotations_are_rejected():
    d = original_case()
    d["economic_claims"]["joint_purchasing_original_cash_bindings"][0]["plan"] = "missing"
    with pytest.raises(InputError,match="PURCHASE_ORIGINAL_PLAN_MISSING_OR_DUPLICATE"):
        out(d)
    d = original_case()
    duplicated = deepcopy(
        d["economic_claims"]["joint_purchasing_original_cash_bindings"][0]
    )
    d["economic_claims"]["joint_purchasing_original_cash_bindings"].append(duplicated)
    with pytest.raises(InputError,match="PURCHASE_ORIGINAL_PLAN_MISSING_OR_DUPLICATE"):
        out(d)
