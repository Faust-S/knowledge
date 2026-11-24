"""R4 original external-buyer Work uses original R2 payment machinery.

One transfer within the original modeled subject boundary. Two independent
owner statements annotate it, not actual bank settlement or external income.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_r4_original_outside_work_mesa import (
    original_outside_work_case, OUTSIDE, ACCEPTED, BUYER, OFFER_SOURCE, find,
)
from .test_r4_independent_supplier_offer_mesa import OFFER_REVISION
from .test_r1u4_strict_original_source_rights_mesa import e


TRANSFER = "outside-work-purchase"
OWNERS = ("a", BUYER)


def economic_case():
    d = original_outside_work_case()
    ctx = d["context_evidence"]["sources"]
    sources = []

    def economic_source(owner, key, ref, revision, start=0):
        sources.append(dict(id=key, owner=owner, reference=ref, revision=revision))
        ctx.append(dict(
            id=ref, owner=owner, revision=revision, status="CONFIRMED",
            usable_by=[owner], core="operator" if owner == "op" else "corporate",
            purposes=["AKIS_ECONOMIC_WORK_EVIDENCE"], operations=["READ"],
            valid_from=start, valid_until=160,
        ))

    for owner in ("op", "a", "b", BUYER):
        economic_source(owner, f"money-{owner}", f"model://{owner}/outside-order-terms",
                        "terms-v1")
    for owner in OWNERS:
        economic_source(owner, f"receipt-{owner}", f"model://{owner}/outside-payment-source",
                        "receipt-v1")
    owner_sources = {owner: f"money-{owner}" for owner in OWNERS}
    # x is outside l1 but remains an ORIGINAL subject of the same modeled
    # system. Its purchase is an internal transfer at THAT system boundary.
    d["economic_claims"] = money = {
        "period": "THIRD_ORIGINAL_WORK", "currency": "RUB",
        "sources": sources,
        "transfers": [dict(id=TRANSFER, scenario="COOPERATION", payer=BUYER,
                           payee="a", amount="900.00", source=f"money-{BUYER}",
                           work=OUTSIDE)],
        "resource_uses": [],
        "coverage": {"COOPERATION": {
            owner: f"money-{owner}" for owner in ("op", "a", "b", BUYER)
        }, "INDEPENDENT_ALTERNATIVE": {}},
        "outside_feasibility": {},
        "cash_timing": {
            "horizon_end": 134,
            "owner_positions": [
                dict(owner=owner, source=f"money-{owner}",
                     opening_cash="2000.00", reserve_cash="0.00")
                for owner in ("op", "a", "b", BUYER)
            ],
            "transfer_windows": [
                dict(transfer_id=TRANSFER, at=112, late_at=125,
                     owner_sources=deepcopy(owner_sources))
            ],
        },
        "work_payment_conditions": [dict(
            transfer_id=TRANSFER, condition="ON_CUSTOMER_ACCEPTANCE",
            due_at=125, work_source_revision="outside-d1", org_revision="oc-1",
            owner_sources=deepcopy(owner_sources),
        )],
        "work_payment_settlement_claims": [],
    }
    for n, (at, amount) in enumerate(((111, "350.00"), (112, "550.00")), 1):
        refs = {owner: f"model://{owner}/outside-payment-part-{n}" for owner in OWNERS}
        money["work_payment_settlement_claims"].append(dict(
            id=f"outside-payment-part-{n}", transfer_id=TRANSFER,
            at=at, amount=amount,
            owner_sources={owner: f"receipt-{owner}" for owner in OWNERS},
            evidence_refs=refs,
            evidence_revisions={owner: "statement-v1" for owner in OWNERS},
            owner_attestations={owner: dict(reported_at=at, reported_amount=amount)
                                for owner in OWNERS},
        ))
        for owner, ref in refs.items():
            ctx.append(dict(
                id=ref, owner=owner, revision="statement-v1", status="CONFIRMED",
                usable_by=[owner], core="corporate",
                purposes=["AKIS_ECONOMIC_WORK_EVIDENCE"], operations=["READ"],
                valid_from=at, valid_until=160,
            ))
    d["strict_economic_source_work"] = OUTSIDE
    return d


def test_original_outside_result_and_independent_payment_statements_are_one_original_transfer():
    d = economic_case()
    frozen = deepcopy(d)
    out = simulate(d)
    assert frozen == d
    assert out["counts"]["blocked"] == 0, out["trace"]
    assert out["works"][OUTSIDE]["result"] == ACCEPTED
    economics = out["economics"]
    strict = economics["original_strict_context_source_qualification"]
    assert strict["outside_work_original_offer_purchase_transfer_price_matched"]
    assert strict["source_scoped_original_payment_event_count"] == 2
    assert strict["source_scoped_independent_payment_owner_witness_count"] == 4
    binding = economics["work_payment_causality"]["bindings"][0]
    assert binding["original_condition_at"] == 109
    assert binding["settlement_progress"]["status"] == (
        "FULLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT")
    assert economics["transfers_count"] == 1
    assert economics["internal_transfers_count"]["COOPERATION"] == 1
    assert economics["consolidated_external_cash_from_claims"]["COOPERATION"] == "0.00"
    assert economics["economic_value_added"] == "NOT_IDENTIFIABLE"
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_original_outside_work_not_accepted_cannot_qualify_payment_claim():
    d = economic_case()
    d["events"] = [row for row in d["events"]
                   if not (row["action"] == "accept" and row.get("work") == OUTSIDE)]
    out = simulate(d)
    assert out["works"][OUTSIDE]["result"] == "SUBMITTED"
    p = out["economics"]["work_payment_causality"]
    assert p["bindings"][0]["settlement_progress"]["status"] == (
        "PAYMENT_CLAIMS_CAUSALLY_INCONSISTENT")
    assert p["settlement_progress"]["actual_bank_payment_verified"] is False


@pytest.mark.parametrize("edit,reason", [
    (lambda d: d["economic_claims"]["transfers"][0].update(amount="1000.00"),
     "OUTSIDE_WORK_ORIGINAL_PURCHASE_PRICE_MISMATCH"),
    (lambda d: d["economic_claims"].update(currency="USD"),
     "OUTSIDE_WORK_ORIGINAL_PURCHASE_PRICE_MISMATCH"),
    (lambda d: d["economic_claims"]["transfers"].append({
        **d["economic_claims"]["transfers"][0], "id": "duplicate-purchase"}),
     "OUTSIDE_WORK_SINGLE_ORIGINAL_PURCHASE_TRANSFER_REQUIRED"),
    (lambda d: d["economic_claims"]["work_payment_conditions"].clear(),
     "OUTSIDE_WORK_ORIGINAL_PURCHASE_TERMS_REQUIRED"),
    (lambda d: d["economic_claims"]["work_payment_settlement_claims"][0][
        "owner_attestations"][BUYER].update(reported_amount="349.00"),
     "ORIGINAL_PAYMENT_OWNER_REPORTS_CONFLICT"),
])
def test_original_outside_work_money_cannot_be_changed_or_duplicated_by_forecast(edit, reason):
    d = economic_case()
    edit(d)
    model = OperatorAKISModel(d)
    with pytest.raises(InputError, match=reason):
        model.execute()
    assert model.qualitative.works[OUTSIDE].result == ACCEPTED


def test_late_offer_source_revocation_blocks_new_price_read_but_not_original_result():
    d = economic_case()
    d["events"].append(e(
        130, "source_update", "a", source=OFFER_SOURCE,
        expected_revision=OFFER_REVISION, new_revision="revoked-offer-v2",
        status="DISPROVED",
    ))
    model = OperatorAKISModel(d)
    with pytest.raises(InputError, match="OUTSIDE_WORK_ORIGINAL_OFFER_PRICE_SOURCE_NOT_READABLE"):
        model.execute()
    assert model.qualitative.works[OUTSIDE].result == ACCEPTED
