"""R2.7B2B2: one purchasing money ledger, full source-claimed ancillary scopes.

A fee paid by buyers to the operator is an INTERNAL transfer, not network
external expense. Actual supplier delivery, real money and legal rights remain
unverified by these original model claims.
"""
from copy import deepcopy
from decimal import Decimal
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_r2_7b2b1_purchase_original_cash_mesa import (
    original_case, OWNERS, QUANTITIES,
)


def full_case():
    d = original_case()
    plan = d["joint_purchasing_proposals"][0]
    money = d["economic_claims"]
    direct = {
        "a": {
            "outside_transaction_cash": "40.00",
            "cooperation_transaction_cash": "10.00",
            "switching_cash": "8.00",
        },
        "b": {
            "outside_marketing_cash": "15.00",
            "cooperation_marketing_cash": "5.00",
        },
        "c": {
            "outside_logistics_cash": "25.00",
            "cooperation_logistics_cash": "20.00",
        },
    }
    allocated = {"a": "153.60", "b": "102.40", "c": "64.00"}
    buyers = []
    for source in plan["buyers"]:
        owner = source["owner"]
        name = f"{owner}-money"
        work = f"w-{owner}"
        category_bindings = {}
        for category in (
            "outside_transaction_cash", "outside_marketing_cash",
            "outside_logistics_cash", "cooperation_transaction_cash",
            "cooperation_marketing_cash", "cooperation_logistics_cash",
            "switching_cash",
        ):
            amount = direct[owner].get(category, "0.00")
            source[category] = amount
            if amount == "0.00":
                category_bindings[category] = {
                    "declared_zero_source_ref": f"model://{owner}/zero-{category}"
                }
                continue
            sc = ("INDEPENDENT_ALTERNATIVE" if category.startswith("outside_")
                  else "COOPERATION")
            cash_id = f"cost-cash-{owner}-{category}"
            resource_id = f"cost-resource-{owner}-{category}"
            bucket = ("EXIT" if category == "switching_cash"
                      else "DELIVERY" if category.endswith("_logistics_cash")
                      else "COORDINATION")
            money["transfers"].append({
                "id": cash_id, "scenario": sc, "payer": owner, "payee": "EXTERNAL",
                "amount": amount, "source": name, "work": work,
            })
            money["resource_uses"].append({
                "id": resource_id, "scenario": sc, "owner": owner,
                "amount": "1.00", "bucket": bucket,
                "source": name, "work": work,
            })
            category_bindings[category] = {
                "original_transfer_id": cash_id,
                "original_resource_use_id": resource_id,
            }
        money["transfers"].append({
            "id": f"reimbursement-{owner}", "scenario": "COOPERATION",
            "payer": owner, "payee": "op", "amount": allocated[owner],
            "source": name, "work": work,
        })
        buyers.append({
            "owner": owner, "work": work,
            "work_source_revision": f"r-{owner}",
            "category_bindings": category_bindings,
            "shared_reimbursement": {
                "original_transfer_id": f"reimbursement-{owner}"
            },
        })
    operator_shared = {}
    for cat, bucket in (
        ("transaction_cash", "COORDINATION"),
        ("marketing_cash", "COORDINATION"),
        ("logistics_cash", "DELIVERY"),
    ):
        identifier = f"operator-{cat}"
        amount = plan["shared_costs"][cat]
        money["transfers"].append({
            "id": f"{identifier}-cash", "scenario": "COOPERATION",
            "payer": "op", "payee": "EXTERNAL", "amount": amount,
            "source": "op-money", "work": None,
        })
        money["resource_uses"].append({
            "id": f"{identifier}-resource", "scenario": "COOPERATION",
            "owner": "op", "amount": "1.00", "bucket": bucket,
            "source": "op-money", "work": None,
        })
        operator_shared[cat] = {
            "original_transfer_id": f"{identifier}-cash",
            "original_resource_use_id": f"{identifier}-resource",
        }
    money["joint_purchasing_ancillary_original_bindings"] = [{
        "plan": "p1", "buyer_ancillary": buyers,
        "operator_shared_costs": {
            "owner": "op", "category_bindings": operator_shared,
        },
    }]
    return d


def inspect(d):
    return simulate(d)


def ancillary(d):
    return inspect(d)["economics"]["joint_purchasing_ancillary_original_cash"]["plans"][0]


def test_all_original_shared_fee_external_and_owner_costs_conserve_network():
    d = full_case()
    out = inspect(d)
    row = out["economics"]["joint_purchasing_ancillary_original_cash"]["plans"][0]
    assert row["status"] == (
        "MODEL_ORIGINAL_PURCHASE_ANCILLARY_AND_OPERATOR_CASH_SCOPE_RECONCILED"
    )
    assert row["buyer_count_with_owner_cash_sources"] == 3
    assert row["missing_original_buyer_count"] == 0
    assert row["missing_operator_source_categories"] == []
    assert row["unmapped_original_purchase_scope_transfer_count"] == 0
    assert row["original_network_outside_minus_cooperation_external_cash_model_scope"] == "257.00"
    assert row["original_buyer_outside_minus_cooperation_net_cash_model_scope"] == "217.00"
    assert row["operator_internal_fee_contribution_model_only"] == "40.00"
    assert row["operator_fee_is_internal_network_not_external_value"]
    assert row["original_buyer_private_model_views"]["a"][
        "model_independent_minus_cooperation_buyer_cash_scope"] == "108.40"
    assert row["original_buyer_private_model_views"]["b"][
        "model_independent_minus_cooperation_buyer_cash_scope"] == "67.60"
    assert row["original_buyer_private_model_views"]["c"][
        "model_independent_minus_cooperation_buyer_cash_scope"] == "41.00"
    econ = out["economics"]
    assert econ["consolidated_external_cash_from_claims"] == {
        "COOPERATION": "-2323.00",
        "INDEPENDENT_ALTERNATIVE": "-2580.00",
    }
    assert econ["internal_transfers_count"]["COOPERATION"] == 3
    assert econ["transfers_count"] == 19
    assert econ["resource_uses_count"] == 16
    assert not econ["resource_costs_additive_to_cash"]
    assert econ["profit"] == "UNKNOWN"
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert all(v["obligation"] == "NOT_ACCEPTED" for v in out["works"].values())
    shared = out["general_akis_model"]["joint_purchasing_original_ancillary_feedback"]
    assert shared["source_declared_complete_ancillary_plan_count"] == 1
    assert shared["original_existing_cash_reference_count"] == 19
    assert shared["original_existing_resource_reference_count"] == 16
    assert not shared["private_costs_owner_prices_cash_and_sources_redisclosed"]
    common = json.dumps(out["general_akis_model"], ensure_ascii=False)
    assert "257.00" not in common
    assert "model://a/zero-" not in common
    assert "operator-internal" not in common
    assert inspect(deepcopy(d)) == out


def test_internal_operator_fee_changes_buyer_positions_but_not_network_cash():
    d = full_case()
    d["joint_purchasing_proposals"][0]["shared_costs"]["operator_fee_cash"] = "600.00"
    allocated = {"a": "422.40", "b": "281.60", "c": "176.00"}
    for transfer in d["economic_claims"]["transfers"]:
        if transfer["id"].startswith("reimbursement-"):
            transfer["amount"] = allocated[transfer["payer"]]
    out = inspect(d)
    row = out["economics"]["joint_purchasing_ancillary_original_cash"]["plans"][0]
    assert row["original_network_outside_minus_cooperation_external_cash_model_scope"] == "257.00"
    assert row["original_buyer_outside_minus_cooperation_net_cash_model_scope"] == "-343.00"
    assert row["operator_internal_fee_contribution_model_only"] == "600.00"
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"] == "-2323.00"
    assert out["cooperation"]["joint_purchasing_model"]["proposals"][0][
        "status"] == "NO_VOLUNTARILY_VIABLE_GROUP"
    assert not row["actual_operator_profit_or_liquidity_proven"]


def test_ancillary_costs_can_reverse_positive_purchase_price_comparison():
    d = full_case()
    a = next(b for b in d["joint_purchasing_proposals"][0]["buyers"]
             if b["owner"] == "a")
    a["cooperation_transaction_cash"] = "510.00"
    cash = next(t for t in d["economic_claims"]["transfers"]
                if t["id"] == "cost-cash-a-cooperation_transaction_cash")
    cash["amount"] = "510.00"
    out = inspect(d)
    row = out["economics"]["joint_purchasing_ancillary_original_cash"]["plans"][0]
    price = out["economics"]["joint_purchasing_original_cash_linkage"]["plans"][0]
    assert price["group_independent_minus_cooperation_supplier_price_claim_only"] == "500.00"
    assert row["original_network_outside_minus_cooperation_external_cash_model_scope"] == "-243.00"
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["cooperation"]["joint_purchasing_model"]["proposals"][0][
        "status"] == "NO_VOLUNTARILY_VIABLE_GROUP"


def test_missing_buyer_cost_source_keeps_unknown_not_zero():
    d = full_case()
    first = d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][1]["category_bindings"]
    del first["outside_marketing_cash"]
    row = ancillary(d)
    assert row["status"] == "PURCHASE_ANCILLARY_ORIGINAL_CASH_SCOPE_INCOMPLETE"
    assert row["original_network_outside_minus_cooperation_external_cash_model_scope"] is None
    assert row["operator_internal_fee_contribution_model_only"] is None
    assert row["original_buyer_private_model_views"]["b"][
        "missing_ancillary_source_categories"] == ["outside_marketing_cash"]


def test_missing_operator_external_shared_cost_source_blocks_network_scope():
    d = full_case()
    categories = d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "operator_shared_costs"]["category_bindings"]
    del categories["marketing_cash"]
    row = ancillary(d)
    assert row["status"] == "PURCHASE_ANCILLARY_ORIGINAL_CASH_SCOPE_INCOMPLETE"
    assert row["missing_operator_source_categories"] == ["marketing_cash"]
    assert row["original_network_outside_minus_cooperation_external_cash_model_scope"] is None


def test_other_original_work_purchase_cost_prevents_fake_full_scope():
    d = full_case()
    d["economic_claims"]["transfers"].append({
        "id": "unallocated-buyer-cost", "scenario": "COOPERATION",
        "payer": "a", "payee": "EXTERNAL", "amount": "100.00",
        "source": "a-money", "work": "w-a",
    })
    row = ancillary(d)
    assert row["unmapped_original_purchase_scope_transfer_count"] == 1
    assert row["original_network_outside_minus_cooperation_external_cash_model_scope"] is None
    assert row["status"] == "PURCHASE_ANCILLARY_ORIGINAL_CASH_SCOPE_INCOMPLETE"


@pytest.mark.parametrize("modify,reason", [
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][0]["category_bindings"].update(
        outside_transaction_cash={
            "original_transfer_id": "coop-purchase-a",
            "original_resource_use_id": "cost-resource-a-outside_transaction_cash"
        }),
     "PURCHASE_ANCILLARY_ORIGINAL_TRANSFER_REUSED"),
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][0]["category_bindings"].update(
        cooperation_transaction_cash={"declared_zero_source_ref": "model://a/false-zero"}),
     "PURCHASE_ANCILLARY_ORIGINAL_PAYMENT_FIELDS_INVALID"),
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][0]["category_bindings"].update(
        outside_marketing_cash={"declared_zero_source_ref": "model://op/fake-zero"}),
     "PURCHASE_ANCILLARY_OWNER_ZERO_SOURCE_INVALID"),
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][0]["category_bindings"].update(
        outside_marketing_cash={
            "declared_zero_source_ref": "model://a/zero-cooperation_marketing_cash",
        }),
     "PURCHASE_ANCILLARY_OWNER_ZERO_SOURCE_INVALID"),
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][0].update(work="w-b"),
     "PURCHASE_ANCILLARY_ORIGINAL_WORK_OWNER_MISMATCH"),
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][0].update(work_source_revision="fake"),
     "PURCHASE_ANCILLARY_ORIGINAL_WORK_OWNER_MISMATCH"),
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][0]["shared_reimbursement"].update(
        original_transfer_id="coop-purchase-a"),
     "PURCHASE_ANCILLARY_ORIGINAL_TRANSFER_REUSED"),
    (lambda d: next(t for t in d["economic_claims"]["transfers"]
                    if t["id"] == "reimbursement-a").update(
        payee="EXTERNAL"),
     "PURCHASE_ANCILLARY_ORIGINAL_CASH_SCOPE_MISMATCH"),
    (lambda d: next(t for t in d["economic_claims"]["transfers"]
                    if t["id"] == "reimbursement-a").update(
        amount="153.59"),
     "PURCHASE_ANCILLARY_ORIGINAL_CASH_AMOUNT_MISMATCH"),
    (lambda d: next(t for t in d["economic_claims"]["transfers"]
                    if t["id"] == "operator-transaction_cash-cash").update(
        payer="b", source="b-money"),
     "PURCHASE_ANCILLARY_ORIGINAL_CASH_SCOPE_MISMATCH"),
    (lambda d: next(r for r in d["economic_claims"]["resource_uses"]
                    if r["id"] == "operator-marketing_cash-resource").update(
        owner="a", source="a-money"),
     "PURCHASE_ANCILLARY_ORIGINAL_RESOURCE_SCOPE_MISMATCH"),
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "operator_shared_costs"].update(owner="a"),
     "PURCHASE_ANCILLARY_OPERATOR_NOT_ORIGINAL_COORDINATOR"),
    (lambda d: d["economic_claims"]["joint_purchasing_ancillary_original_bindings"][0][
        "buyer_ancillary"][0]["category_bindings"].update(
        cooperation_transaction_cash={
            "original_transfer_id": "does-not-exist",
            "original_resource_use_id": "cost-resource-a-cooperation_transaction_cash",
        }),
     "PURCHASE_ANCILLARY_ORIGINAL_TRANSFER_MISSING"),
])
def test_ancillary_original_money_source_and_operator_scopes_fail_closed(modify,reason):
    d = full_case()
    modify(d)
    with pytest.raises(InputError,match=reason):
        inspect(d)


def test_no_ancillary_bindings_retains_original_price_only_model():
    d = full_case()
    del d["economic_claims"]["joint_purchasing_ancillary_original_bindings"]
    out = inspect(d)
    assert "joint_purchasing_ancillary_original_cash" not in out["economics"]
    assert "joint_purchasing_original_ancillary_feedback" not in out["general_akis_model"]
    assert out["economics"]["joint_purchasing_original_cash_linkage"][
        "original_matched_plan_count"] == 1


def test_ancillary_without_original_purchase_quote_is_invalid():
    d = full_case()
    del d["economic_claims"]["joint_purchasing_original_cash_bindings"]
    with pytest.raises(InputError,match="PURCHASE_ANCILLARY_REQUIRES_ORIGINAL_PURCHASE_PRICE_REFERENCES"):
        inspect(d)


def test_missing_original_supplier_price_owner_reference_blocks_ancillary_math():
    d = full_case()
    d["economic_claims"]["joint_purchasing_original_cash_bindings"][0][
        "buyer_bindings"].pop()
    row = ancillary(d)
    assert row["status"] == "PURCHASE_ANCILLARY_PRICE_SCOPE_INCOMPLETE"
    assert row["network_original_sourced_cash_difference"] is None


def test_no_cash_schedule_means_payment_reserve_and_bank_authentication_unknown():
    d = full_case()
    out = inspect(d)
    row = out["economics"]["joint_purchasing_ancillary_original_cash"]["plans"][0]
    assert not row["actual_operator_profit_or_liquidity_proven"]
    assert row["original_due_dates_and_same_tick_cash_order_not_inferred"]
    assert row["model_cash_source_arithmetic_not_real_caused_savings"]
    assert "cash_timing" not in out["economics"]


def test_operator_positive_cash_scope_still_has_earlier_original_liquidity_shortfall():
    d = full_case()
    owners = (*OWNERS, "op")
    d["economic_claims"]["cash_timing"] = {
        "horizon_end": 10,
        "owner_positions": [{
            "owner": owner, "source": f"{owner}-money",
            "opening_cash": "10000.00" if owner != "op" else "0.00",
            "reserve_cash": "0.00",
        } for owner in owners],
        "transfer_windows": [{
            "transfer_id": transfer["id"],
            "at": (2 if transfer["payer"] == "op"
                   and transfer["payee"] == "EXTERNAL"
                   else 7 if transfer["payee"] == "op"
                   else 5),
            "owner_sources": {
                owner: f"{owner}-money"
                for owner in (transfer["payer"], transfer["payee"])
                if owner != "EXTERNAL"
            },
        } for transfer in d["economic_claims"]["transfers"]],
    }
    out = inspect(d)
    econ = out["economics"]
    row = econ["joint_purchasing_ancillary_original_cash"]["plans"][0]
    assert row["operator_internal_fee_contribution_model_only"] == "40.00"
    assert row["original_network_outside_minus_cooperation_external_cash_model_scope"] == "257.00"
    assert row["original_full_transfer_timing_sources_declared"] is True
    assert row["coordinator_original_cooperative_due_stress"] == (
        "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    )
    assert row["original_buyer_private_model_views"]["a"][
        "existing_original_owner_private_liquidity_status"] != "NOT_QUALIFIED"
    assert econ["cash_timing"]["missing_transfer_window_count"] == 0
    assert not row["actual_operator_profit_or_liquidity_proven"]
    assert econ["cash_timing"]["no_invented_credit_or_finance_cost"]
    assert out["general_akis_model"]["joint_purchasing_original_ancillary_feedback"][
        "real_profit_or_liquidity_authenticated"] is False
    assert "coordinator_original_cooperative_due_stress" not in json.dumps(
        out["general_akis_model"]
    )
