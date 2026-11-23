"""R4 original independent buyer/supplier two-source pre-contract comparison.

The two independent statements are MODEL evidence in ONE original Mesa.
The seller's offered terms do not replace buyer agreement, original consent,
Work, Result, bank payment or documentary authentication in the real world.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.economic_outlook import choose_outlook
from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
from .test_r4_independent_external_buyer_demand_mesa import (
    BUYER, BUYER_SOURCE, DEMAND_ID, REVISION, independent_buyer_case,
    demand_event, owner_outlook, positions, owner_assessments,
)
from .test_r4_original_buyer_demand_withdrawal_mesa import (
    with_buyer_withdrawal, unused_tick, withdrawal_event,
)
from .test_r1l_post_result_original_reproduction_mesa import find


OFFER_ID = "supplier-offer-r4-01"
OFFER_SOURCE = "model://a/original-r4-supplier-offer"
OFFER_REVISION = "supplier-offer-r4-v1"


def supplier_source():
    return {
        "id": OFFER_SOURCE, "owner": "a", "revision": OFFER_REVISION,
        "status": "CONFIRMED", "usable_by": ["a", "x"],
        "core": "corporate", "purposes": ["AKIS_EXTERNAL_DEMAND_EVIDENCE"],
        "operations": ["READ"], "valid_from": 0, "valid_until": 160,
    }


def supplier_offer_event(d):
    e = demand_event(d)
    return {
        "at": unused_tick(d, 79, 83),
        "action": "outside_supplier_offer", "actor": "a",
        "outside_demand_id": DEMAND_ID, "outside_offer_id": OFFER_ID,
        "outside_offer_source_ref": OFFER_SOURCE,
        "outside_offer_source_revision": OFFER_REVISION,
        "outside_offer_price": "900.00",
        "outside_offer_currency": e["outside_currency"],
        "outside_offer_resource": e["outside_resource"],
        "outside_offer_units": e["outside_units"],
        "outside_offer_slot_start": e["outside_slot_start"],
        "outside_offer_slot_end": e["outside_slot_end"],
        "outside_offer_deliverable": e["outside_deliverable"],
        "outside_offer_quality_basis": e["outside_quality_basis"],
        "outside_offer_valid_until": 150,
    }


def bilateral_case():
    d = independent_buyer_case()
    d["context_evidence"]["sources"].append(supplier_source())
    owner_outlook(d)["outside_offer_claim"] = OFFER_ID
    d["events"].append(supplier_offer_event(d))
    d["events"].sort(key=lambda row: row["at"])
    return d


def offer_event(d):
    return next(row for row in d["events"]
                if row["action"] == "outside_supplier_offer")


def owner_reason(out, reason):
    rows = owner_assessments(out)
    assert any(row[2] == reason for row in rows), rows


def current_owner_review(model, at):
    state = model.qualitative
    return choose_outlook(
        model.economic_outlooks, owner="a", work=state.works["w3"],
        org_revision=state.institution.revision,
        links=state.cooperation_links, at=float(at),
        works=state.works, context_basis=state.context_basis,
        owner_core="corporate", capacity_ledger=state.capacity_ledger,
        resource_owners=state.resources,
        resource_availability=state.resource_availability,
        original_trace=state.trace, subjects=state.subjects,
    )


def test_original_bilateral_source_evidence_supports_private_model_comparison_not_contract():
    d = bilateral_case()
    frozen = deepcopy(d)
    out = simulate(d)
    assert d == frozen
    offer = find(out, "outside_supplier_offer")
    assert len(offer) == 1
    assert offer[0]["outcome"] == "APPLIED"
    assert offer[0]["outside_offer_independent_model_response_not_accepted_contract"]
    assert offer[0]["outside_work_or_money_not_created"]
    assert "COOPERATION_PREFERRED" in positions(out)
    assert set(out["works"]) == {"w0", "w1", "w2", "w3"}
    assert all(out["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1", "w2", "w3"))
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert not any(str(w).startswith("__akis_outside_candidate__")
                   for w in out["works"])


def test_seller_economic_claim_cannot_replace_seller_own_original_offer():
    d = bilateral_case()
    d["events"].remove(offer_event(d))
    out = simulate(d)
    owner_reason(out, "OUTSIDE_OFFER_APPLIED_INDEPENDENT_RESPONSE_REQUIRED")
    assert "COOPERATION_PREFERRED" not in positions(out)
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("change,blocked", [
    (lambda d: offer_event(d).update(actor=BUYER),
     "OUTSIDE_OFFER_ORIGINAL_INDEPENDENT_PARTIES_REQUIRED"),
    (lambda d: offer_event(d).update(outside_demand_id="buyer-nonexistent"),
     "OUTSIDE_OFFER_APPLIED_BUYER_DEMAND_REQUIRED"),
    (lambda d: offer_event(d).update(outside_offer_source_ref="model://a/unknown"),
     "OUTSIDE_OFFER_SELLER_SOURCE_NOT_QUALIFIED"),
    (lambda d: offer_event(d).update(outside_offer_source_revision="stale"),
     "OUTSIDE_OFFER_SELLER_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(x for x in d["context_evidence"]["sources"]
                    if x["id"] == OFFER_SOURCE).update(status="DISPROVED"),
     "OUTSIDE_OFFER_SELLER_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(x for x in d["context_evidence"]["sources"]
                    if x["id"] == OFFER_SOURCE).update(usable_by=["a"]),
     "OUTSIDE_OFFER_SELLER_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(x for x in d["context_evidence"]["sources"]
                    if x["id"] == OFFER_SOURCE).update(operations=["SHARE"]),
     "OUTSIDE_OFFER_SELLER_SOURCE_NOT_QUALIFIED"),
    (lambda d: offer_event(d).update(outside_offer_resource="imaginary"),
     "OUTSIDE_OFFER_ORIGINAL_SELLER_RESOURCE_REQUIRED"),
    (lambda d: offer_event(d).update(outside_offer_units=2),
     "OUTSIDE_OFFER_BUYER_TERMS_NOT_COMPARABLE"),
    (lambda d: offer_event(d).update(outside_offer_slot_end=121),
     "OUTSIDE_OFFER_BUYER_TERMS_NOT_COMPARABLE"),
    (lambda d: offer_event(d).update(outside_offer_deliverable="different-part"),
     "OUTSIDE_OFFER_BUYER_TERMS_NOT_COMPARABLE"),
    (lambda d: offer_event(d).update(outside_offer_quality_basis="different-basis"),
     "OUTSIDE_OFFER_BUYER_TERMS_NOT_COMPARABLE"),
    (lambda d: offer_event(d).update(outside_offer_currency="USD"),
     "OUTSIDE_OFFER_BUYER_TERMS_NOT_COMPARABLE"),
    (lambda d: offer_event(d).update(outside_offer_price="1200.00"),
     "OUTSIDE_OFFER_BUYER_TERMS_NOT_COMPARABLE"),
])
def test_forged_stale_foreign_or_noncomparable_supplier_offer_is_blocked(
        change, blocked):
    d = bilateral_case()
    change(d)
    result = simulate(d)
    record = find(result, "outside_supplier_offer")[0]
    assert record["outcome"] == "BLOCKED"
    assert record["reason"] == blocked
    owner_reason(result, "OUTSIDE_OFFER_APPLIED_INDEPENDENT_RESPONSE_REQUIRED")
    assert result["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("change,code", [
    (lambda d: offer_event(d).update(outside_offer_units=True),
     "OUTSIDE_OFFER_UNITS_OR_HORIZON_INVALID"),
    (lambda d: offer_event(d).update(outside_offer_slot_start=120),
     "OUTSIDE_OFFER_UNITS_OR_HORIZON_INVALID"),
    (lambda d: offer_event(d).update(outside_offer_price="0.00"),
     "OUTSIDE_OFFER_PRICE_OR_CURRENCY_INVALID"),
    (lambda d: offer_event(d).update(outside_offer_price="100.000"),
     "OUTSIDE_OFFER_PRICE_OR_CURRENCY_INVALID"),
    (lambda d: offer_event(d).update(outside_offer_valid_until=78),
     "OUTSIDE_OFFER_TIME_INVALID"),
])
def test_supplier_offer_malformed_quantities_and_price_rejected(change, code):
    d = bilateral_case()
    change(d)
    out = simulate(d)
    assert find(out, "outside_supplier_offer")[0]["reason"] == code
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_supplier_private_forecast_must_match_its_own_document_not_just_buyer_ceiling():
    d = bilateral_case()
    owner_outlook(d)["cash"]["INDEPENDENT_ALTERNATIVE"]["external_sales"] = "800.00"
    out = simulate(d)
    assert find(out, "outside_supplier_offer")[0]["outcome"] == "APPLIED"
    owner_reason(out, "OUTSIDE_OFFER_SELLER_DOCUMENT_NOT_COMPARABLE")
    assert "COOPERATION_PREFERRED" not in positions(out)


def test_independent_buyer_withdrawal_prevents_reuse_of_applied_supplier_offer():
    d = with_buyer_withdrawal()
    d["context_evidence"]["sources"].append(supplier_source())
    owner_outlook(d)["outside_offer_claim"] = OFFER_ID
    e = supplier_offer_event(d)
    e["at"] = unused_tick(d, 80, 84)
    d["events"].append(e)
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert find(out, "outside_demand_withdraw")[0]["outcome"] == "APPLIED"
    assert find(out, "outside_supplier_offer")[0]["outcome"] == "BLOCKED"
    assert find(out, "outside_supplier_offer")[0]["reason"] == (
        "OUTSIDE_OFFER_BUYER_DEMAND_WITHDRAWN"
    )
    owner_reason(out, "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER")
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_supplier_offer_is_not_an_independent_buyer_consent_to_original_work():
    d = bilateral_case()
    profile = next(row for row in d["events"] if row["action"] == "interest_update"
                   and row.get("work") == "w3" and row["actor"] == "a")
    profile["new_willingness"] = "DECLINES"
    profile["new_outside_option"] = "OUTSIDE_PREFERRED"
    out = simulate(d)
    assert find(out, "outside_supplier_offer")[0]["outcome"] == "APPLIED"
    assert "COOPERATION_PREFERRED" in positions(out)
    assert find(out, "commit", work="w3")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert all(out["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1","w2"))


def test_duplicated_supplier_offer_id_is_rejected_in_one_original_trace():
    d = bilateral_case()
    duplicate = deepcopy(offer_event(d))
    duplicate["at"] = unused_tick(d, duplicate["at"]+1, 85)
    d["events"].append(duplicate)
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert [(row["outcome"], row["reason"])
            for row in find(out, "outside_supplier_offer")] == [
        ("APPLIED", "NONE"),
        ("BLOCKED", "OUTSIDE_OFFER_DUPLICATE_ORIGINAL_ID")
    ]
    assert "COOPERATION_PREFERRED" in positions(out)


def test_seller_source_revocation_blocks_future_read_without_reopening_result():
    d = bilateral_case()
    at = unused_tick(d, 95, 110)
    d["events"].append({
        "at": at, "action": "source_update", "actor": "a",
        "source": OFFER_SOURCE, "expected_revision": OFFER_REVISION,
        "new_revision": "seller-offer-r4-revoked", "status": "DISPROVED",
    })
    d["events"].sort(key=lambda row: row["at"])
    model = OperatorAKISModel(d)
    out = model.execute()
    assert find(out, "source_update")[0]["outcome"] == "APPLIED"
    assert any(row[0] == "COOPERATION_PREFERRED"
               for row in [(pos, reason) for _,pos,reason in owner_assessments(out)])
    review = current_owner_review(model, at+1)
    assert review["position"] == "UNKNOWN"
    assert review["reason"] == "OUTSIDE_OFFER_CURRENT_SELLER_SOURCE_NO_LONGER_READABLE"
    assert all(out["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1","w2","w3"))


def test_supplier_accepted_model_document_cannot_create_money_or_outside_work():
    base = simulate(independent_buyer_case())
    out = simulate(bilateral_case())
    assert base["works"] == out["works"]
    assert base["profit"] == out["profit"]
    assert len(out["works"]) == 4
    assert not any(w.startswith("__akis_outside_candidate__") for w in out["works"])
