"""R4: independent buyer's source-pinned response to ONE supplier offer.

The buyer's willingness to negotiate is not a legal acceptance, a contract,
a new original Work, a bank payment or a verified external order.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.economic_outlook import OutlookInputError
from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
from .test_r4_independent_supplier_offer_mesa import (
    OFFER_ID, OFFER_SOURCE, OFFER_REVISION,
    bilateral_case, offer_event, current_owner_review,
)
from .test_r4_independent_external_buyer_demand_mesa import (
    BUYER, BUYER_SOURCE, DEMAND_ID, owner_outlook,
    positions, owner_assessments,
)
from .test_r4_original_buyer_demand_withdrawal_mesa import unused_tick
from .test_r1l_post_result_original_reproduction_mesa import find


BUYER_RESPONSE_ID = "buyer-response-r4-original-001"
BUYER_RESPONSE_SOURCE = "model://x/r4-independent-offer-response"
BUYER_RESPONSE_REVISION = "r4-buyer-response-v1"


def buyer_response_event(d, *, decision="WILLING_TO_NEGOTIATE", at=None):
    original = offer_event(d)
    return {
        "at": unused_tick(d, original["at"] + 1, 89) if at is None else at,
        "action": "outside_buyer_offer_response", "actor": BUYER,
        "outside_demand_id": DEMAND_ID, "outside_offer_id": OFFER_ID,
        "outside_offer_source_revision": OFFER_REVISION,
        "outside_buyer_response_id": BUYER_RESPONSE_ID,
        "outside_buyer_response_decision": decision,
        "outside_buyer_response_source_ref": BUYER_RESPONSE_SOURCE,
        "outside_buyer_response_source_revision": BUYER_RESPONSE_REVISION,
        "outside_buyer_response_valid_until": 150,
    }


def buyer_response_case(*, decision="WILLING_TO_NEGOTIATE", at=None):
    d = bilateral_case()
    d["context_evidence"]["sources"].append({
        "id": BUYER_RESPONSE_SOURCE, "owner": BUYER,
        "revision": BUYER_RESPONSE_REVISION, "status": "CONFIRMED",
        "usable_by": [BUYER, "a"], "core": "corporate",
        "purposes": ["AKIS_EXTERNAL_DEMAND_EVIDENCE"],
        "operations": ["READ"], "valid_from": 0, "valid_until": 160,
    })
    owner_outlook(d)["outside_buyer_response_claim"] = BUYER_RESPONSE_ID
    d["events"].append(buyer_response_event(d, decision=decision, at=at))
    d["events"].sort(key=lambda e: e["at"])
    return d


def response_event(d):
    return next(
        e for e in d["events"] if e["action"] == "outside_buyer_offer_response"
    )


def assert_model_reason(output, reason):
    opinions = owner_assessments(output)
    assert any(row[2] == reason for row in opinions), opinions


def assert_original_history(output):
    assert set(output["works"]) == {"w0", "w1", "w2", "w3"}
    assert [output["works"][w]["result"] for w in ("w1", "w2")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    ] * 2
    assert output["profit"]["system_increment"] == "UNKNOWN"
    assert not any(w.startswith("__akis_outside_candidate__")
                   for w in output["works"])


def test_independent_buyer_willingness_requires_own_source_and_original_offer():
    d = buyer_response_case()
    frozen = deepcopy(d)
    output = simulate(d)
    assert d == frozen
    buyer = find(output, "outside_buyer_offer_response")
    assert len(buyer) == 1
    assert buyer[0]["outcome"] == "APPLIED"
    assert buyer[0]["actor"] == BUYER
    assert buyer[0]["outside_buyer_model_intent_not_legal_acceptance"]
    assert buyer[0]["outside_work_or_money_not_created"]
    assert "COOPERATION_PREFERRED" in positions(output)
    assert output["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert_original_history(output)


def test_seller_cannot_invent_independent_buyer_willingness_in_its_own_outlook():
    d = buyer_response_case()
    d["events"].remove(response_event(d))
    output = simulate(d)
    assert_model_reason(output, "OUTSIDE_BUYER_RESPONSE_INDEPENDENT_EVENT_REQUIRED")
    assert "COOPERATION_PREFERRED" not in positions(output)
    assert_original_history(output)


def test_buyer_can_independently_decline_supplier_model_terms_without_changing_original_Work():
    positive = simulate(buyer_response_case())
    output = simulate(buyer_response_case(decision="DECLINES_OFFER"))
    assert find(output, "outside_buyer_offer_response")[0]["outcome"] == "APPLIED"
    assert_model_reason(output, "OUTSIDE_BUYER_INDEPENDENTLY_DECLINED_OFFER")
    assert "COOPERATION_PREFERRED" not in positions(output)
    assert output["works"] == positive["works"]
    assert_original_history(output)


@pytest.mark.parametrize("change,code", [
    (lambda d: response_event(d).update(actor="a"),
     "OUTSIDE_BUYER_RESPONSE_ORIGINAL_INDEPENDENT_BUYER_ONLY"),
    (lambda d: response_event(d).update(actor="op"),
     "OUTSIDE_BUYER_RESPONSE_ORIGINAL_INDEPENDENT_BUYER_ONLY"),
    (lambda d: response_event(d).update(outside_demand_id="foreign-demand"),
     "OUTSIDE_BUYER_RESPONSE_ORIGINAL_DEMAND_AND_OFFER_REQUIRED"),
    (lambda d: response_event(d).update(outside_offer_id="foreign-offer"),
     "OUTSIDE_BUYER_RESPONSE_ORIGINAL_DEMAND_AND_OFFER_REQUIRED"),
    (lambda d: response_event(d).update(outside_offer_source_revision="stale"),
     "OUTSIDE_BUYER_RESPONSE_OFFER_SOURCE_REVISION_MISMATCH"),
    (lambda d: response_event(d).update(
        outside_buyer_response_source_revision="foreign-revision"),
     "OUTSIDE_BUYER_RESPONSE_OWN_SOURCE_NOT_QUALIFIED"),
    (lambda d: response_event(d).update(
        outside_buyer_response_source_ref="model://a/foreign-buyer"),
     "OUTSIDE_BUYER_RESPONSE_OWN_SOURCE_NOT_QUALIFIED"),
    (lambda d: response_event(d).update(
        outside_buyer_response_source_ref=BUYER_SOURCE),
     "OUTSIDE_BUYER_RESPONSE_SEPARATE_OWNER_EDITION_REQUIRED"),
    (lambda d: response_event(d).update(
        outside_buyer_response_source_ref=OFFER_SOURCE),
     "OUTSIDE_BUYER_RESPONSE_SEPARATE_OWNER_EDITION_REQUIRED"),
    (lambda d: next(e for e in d["context_evidence"]["sources"]
                   if e["id"] == BUYER_RESPONSE_SOURCE).update(
                       status="DISPROVED"),
     "OUTSIDE_BUYER_RESPONSE_OWN_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(e for e in d["context_evidence"]["sources"]
                   if e["id"] == BUYER_RESPONSE_SOURCE).update(
                       usable_by=[BUYER]),
     "OUTSIDE_BUYER_RESPONSE_OWN_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(e for e in d["context_evidence"]["sources"]
                   if e["id"] == BUYER_RESPONSE_SOURCE).update(
                       operations=["SHARE"]),
     "OUTSIDE_BUYER_RESPONSE_OWN_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(e for e in d["context_evidence"]["sources"]
                   if e["id"] == BUYER_RESPONSE_SOURCE).update(
                       valid_until=79),
     "OUTSIDE_BUYER_RESPONSE_OWN_SOURCE_NOT_QUALIFIED"),
    (lambda d: response_event(d).update(
        outside_buyer_response_valid_until=151),
     "OUTSIDE_BUYER_RESPONSE_OFFER_OR_DEMAND_NOT_CURRENT"),
    (lambda d: response_event(d).update(
        outside_buyer_response_valid_until=78),
     "OUTSIDE_BUYER_RESPONSE_TIME_INVALID"),
])
def test_buyer_response_cannot_be_forged_reused_or_outside_source_scope(change, code):
    d = buyer_response_case()
    change(d)
    output = simulate(d)
    evidence = find(output, "outside_buyer_offer_response")[0]
    assert evidence["outcome"] == "BLOCKED"
    assert evidence["reason"] == code
    assert_model_reason(output, "OUTSIDE_BUYER_RESPONSE_INDEPENDENT_EVENT_REQUIRED")
    assert_original_history(output)


def test_response_does_not_precede_original_supplier_offer():
    d = buyer_response_case(at=77)
    output = simulate(d)
    assert find(output, "outside_buyer_offer_response")[0]["reason"] == (
        "OUTSIDE_BUYER_RESPONSE_ORIGINAL_DEMAND_AND_OFFER_REQUIRED"
    )


def test_response_requires_original_applied_offer_not_just_document_reference():
    d = buyer_response_case()
    d["events"].remove(offer_event(d))
    output = simulate(d)
    assert find(output, "outside_buyer_offer_response")[0]["reason"] == (
        "OUTSIDE_BUYER_RESPONSE_ORIGINAL_DEMAND_AND_OFFER_REQUIRED"
    )
    assert_original_history(output)


def test_response_to_already_withdrawn_buyer_demand_is_rejected():
    d = buyer_response_case()
    from .test_r4_original_buyer_demand_withdrawal_mesa import (
        with_buyer_withdrawal, withdrawal_event, WITHDRAW_SOURCE,
    )
    original = with_buyer_withdrawal()
    d["context_evidence"]["sources"].append(
        deepcopy(next(e for e in original["context_evidence"]["sources"]
                      if e["id"] == WITHDRAW_SOURCE))
    )
    withdrawn = deepcopy(withdrawal_event(original))
    withdrawn["at"] = unused_tick(d, offer_event(d)["at"] + 1, 83)
    response_event(d)["at"] = unused_tick(d, withdrawn["at"] + 1, 89)
    d["events"].append(withdrawn)
    d["events"].sort(key=lambda row: row["at"])
    output = simulate(d)
    assert find(output, "outside_demand_withdraw")[0]["outcome"] == "APPLIED"
    assert find(output, "outside_buyer_offer_response")[0]["reason"] == (
        "OUTSIDE_BUYER_RESPONSE_DEMAND_ALREADY_WITHDRAWN"
    )
    assert_original_history(output)


def test_one_independent_buyer_response_per_offer_rejects_second_or_conflicting_decision():
    d = buyer_response_case()
    second = deepcopy(response_event(d))
    second["at"] = unused_tick(d, second["at"] + 1, 90)
    second["outside_buyer_response_id"] = "buyer-response-conflicting-02"
    second["outside_buyer_response_decision"] = "DECLINES_OFFER"
    d["events"].append(second)
    d["events"].sort(key=lambda row: row["at"])
    output = simulate(d)
    responses = find(output, "outside_buyer_offer_response")
    assert [r["outcome"] for r in responses] == ["APPLIED", "BLOCKED"]
    assert responses[-1]["reason"] == (
        "OUTSIDE_BUYER_RESPONSE_ALREADY_RECORDED_FOR_OFFER"
    )
    assert_original_history(output)


def test_model_forecast_can_only_pin_its_own_buyer_response_and_known_offer():
    d = buyer_response_case()
    owner_outlook(d)["outside_buyer_response_claim"] = "unlinked-other-response"
    result = simulate(d)
    assert_model_reason(result, "OUTSIDE_BUYER_RESPONSE_INDEPENDENT_EVENT_REQUIRED")
    assert_original_history(result)


def test_response_claim_without_original_supplier_offer_is_not_a_valid_input():
    d = buyer_response_case()
    owner_outlook(d).pop("outside_offer_claim")
    with pytest.raises(
        OutlookInputError,
        match="OUTLOOK_BUYER_RESPONSE_REQUIRES_ORIGINAL_SUPPLIER_OFFER",
    ):
        OperatorAKISModel(d)


def test_late_revoke_of_buyers_response_source_denies_future_read_only():
    d = buyer_response_case()
    at = unused_tick(d, 95, 110)
    d["events"].append({
        "at": at, "action": "source_update", "actor": BUYER,
        "source": BUYER_RESPONSE_SOURCE,
        "expected_revision": BUYER_RESPONSE_REVISION,
        "new_revision": "buyer-response-revoked-r4-v2",
        "status": "DISPROVED",
    })
    d["events"].sort(key=lambda row: row["at"])
    model = OperatorAKISModel(d)
    output = model.execute()
    assert find(output, "source_update")[0]["outcome"] == "APPLIED"
    assert "COOPERATION_PREFERRED" in positions(output)
    after = current_owner_review(model, at + 1)
    assert after["position"] == "UNKNOWN"
    assert after["reason"] == "OUTSIDE_BUYER_RESPONSE_CURRENT_SOURCE_NO_LONGER_READABLE"
    assert all(output["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1", "w2", "w3"))


def test_original_owner_declines_cooperation_even_with_independent_buyers_willingness():
    d = buyer_response_case()
    change = next(e for e in d["events"]
                  if e["action"] == "interest_update"
                  and e.get("work") == "w3" and e["actor"] == "a")
    change["new_willingness"] = "DECLINES"
    change["new_outside_option"] = "OUTSIDE_PREFERRED"
    out = simulate(d)
    assert find(out, "outside_buyer_offer_response")[0]["outcome"] == "APPLIED"
    assert "COOPERATION_PREFERRED" in positions(out)
    assert find(out, "commit", work="w3")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert all(out["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1", "w2"))


def test_buyer_response_is_not_original_Work_consent_payment_or_external_order():
    baseline = simulate(bilateral_case())
    now = simulate(buyer_response_case())
    assert baseline["works"] == now["works"]
    assert baseline["profit"] == now["profit"]
    assert len(now["works"]) == 4
    assert now["general_akis_model"]["legal_consent_created"] is False
    assert not any(
        str(w).startswith("__akis_outside_candidate__")
        for w in now["works"]
    )
