"""R4: independent outsider buyer-demand signal in ONE ORIGINAL Mesa trace.

A seller's economic outlook must not fabricate a customer. Only the buyer
may author a source-qualified model request, which is checked again at each
decision. None of these events creates another Work, payment, or contract.
"""
from copy import deepcopy
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.outside_demand import (
    OutsideDemandBlocked,
)
from research.akis.qualitative_mesa.tests.test_r3r4_original_owner_outside_capacity_mesa import (
    probed, owner_assessments,
)
from research.akis.qualitative_mesa.tests.test_r1l_post_result_original_reproduction_mesa import (
    find,
)


BUYER = "x"
BUYER_SOURCE = "model://x/independent-r4-outside-customer-need"
DEMAND_ID = "buyer-outside-demand-r4-01"
REVISION = "buyer-demand-r4-1"


def independent_buyer_case():
    d = probed()
    d["subjects"].append({"id": BUYER, "kind": "SME"})
    d["context_evidence"]["sources"].append({
        "id": BUYER_SOURCE,
        "owner": BUYER,
        "revision": REVISION,
        "status": "CONFIRMED",
        "usable_by": ["x", "a"],
        "core": "corporate",
        "purposes": ["AKIS_EXTERNAL_DEMAND_EVIDENCE"],
        "operations": ["READ"],
        "valid_from": 0,
        "valid_until": 160,
    })
    owner = next(row for row in d["economic_outlooks"]
                 if row["owner"] == "a")
    owner["outside_demand_claim"] = {
        "signal_id": DEMAND_ID,
        "deliverable": "outside-comparable-machining",
        "quality_basis": "outside-source-declared-quality-v1",
    }
    owner["cash"]["INDEPENDENT_ALTERNATIVE"]["external_sales"] = "900.00"
    assert all(event["at"] != 78 for event in d["events"])
    d["events"].append({
        "at": 78,
        "action": "outside_demand_signal",
        "actor": BUYER,
        "outside_demand_id": DEMAND_ID,
        "outside_supplier": "a",
        "outside_relation": "l1",
        "outside_relation_revision": "rel-1",
        "outside_candidate_work": "w3",
        "outside_work_revision": "d-3",
        "outside_resource": "ra",
        "outside_units": 1,
        "outside_slot_start": 106,
        "outside_slot_end": 120,
        "outside_deliverable": "outside-comparable-machining",
        "outside_quality_basis": "outside-source-declared-quality-v1",
        "outside_currency": "RUB",
        "outside_price_ceiling": "1000.00",
        "outside_demand_source_ref": BUYER_SOURCE,
        "outside_demand_source_revision": REVISION,
        "outside_demand_valid_until": 150,
    })
    d["events"].sort(key=lambda row: row["at"])
    return d


def demand_event(d):
    return next(row for row in d["events"]
                if row["action"] == "outside_demand_signal")


def owner_outlook(d):
    return next(row for row in d["economic_outlooks"]
                if row["owner"] == "a")


def has_reason(out, code):
    rows = owner_assessments(out)
    assert any(item[2] == code for item in rows), rows


def positions(out):
    return [item[1] for item in owner_assessments(out)]


def test_independent_external_buyer_source_can_support_nonbinding_model_choice():
    d = independent_buyer_case()
    before = deepcopy(d)
    out = simulate(d)
    assert d == before
    signal = find(out, "outside_demand_signal")
    assert len(signal) == 1
    assert signal[0]["actor"] == BUYER
    assert signal[0]["outcome"] == "APPLIED"
    assert signal[0]["model_buyer_source_not_real_offer_or_contract"]
    assert signal[0]["outside_work_or_money_not_created"]
    assert any(x == "COOPERATION_PREFERRED" for x in positions(out))
    assert out["counts"]["blocked"] == 0
    assert all(
        out["works"][key]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        for key in ("w1", "w2", "w3")
    )
    assert len(out["works"]) == 3
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_seller_forecast_alone_does_not_create_any_independent_buyer_demand():
    d = independent_buyer_case()
    d["events"].remove(demand_event(d))
    out = simulate(d)
    has_reason(out, "OUTSIDE_DEMAND_INDEPENDENT_ORIGINAL_BUYER_SIGNAL_REQUIRED")
    assert "COOPERATION_PREFERRED" not in positions(out)
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("mutation,blocked", [
    (lambda d: demand_event(d).update(actor="a"),
     "OUTSIDE_DEMAND_INDEPENDENT_ACTIVE_BUYER_REQUIRED"),
    (lambda d: demand_event(d).update(actor="op"),
     "OUTSIDE_DEMAND_INDEPENDENT_ACTIVE_BUYER_REQUIRED"),
    (lambda d: demand_event(d).update(outside_supplier="x"),
     "OUTSIDE_DEMAND_INDEPENDENT_ACTIVE_BUYER_REQUIRED"),
    (lambda d: demand_event(d).update(outside_relation="unknown"),
     "OUTSIDE_DEMAND_BUYER_NOT_EXTERNAL_TO_COOPERATION"),
    (lambda d: demand_event(d).update(outside_resource="missing"),
     "OUTSIDE_DEMAND_ORIGINAL_SUPPLIER_RESOURCE_REQUIRED"),
    (lambda d: demand_event(d).update(outside_demand_source_ref="model://a/fake"),
     "OUTSIDE_DEMAND_BUYER_SOURCE_NOT_QUALIFIED"),
    (lambda d: demand_event(d).update(outside_demand_source_revision="stale"),
     "OUTSIDE_DEMAND_BUYER_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(row for row in d["context_evidence"]["sources"]
                    if row["id"] == BUYER_SOURCE).update(
                        usable_by=["x"]),
     "OUTSIDE_DEMAND_BUYER_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(row for row in d["context_evidence"]["sources"]
                    if row["id"] == BUYER_SOURCE).update(
                        operations=["SHARE"]),
     "OUTSIDE_DEMAND_BUYER_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(row for row in d["context_evidence"]["sources"]
                    if row["id"] == BUYER_SOURCE).update(status="DISPROVED"),
     "OUTSIDE_DEMAND_BUYER_SOURCE_NOT_QUALIFIED"),
])
def test_forged_buyer_wrong_scope_stale_or_revoked_original_signal_is_blocked(
        mutation, blocked):
    d = independent_buyer_case()
    mutation(d)
    out = simulate(d)
    signal = find(out, "outside_demand_signal")[0]
    assert signal["outcome"] == "BLOCKED"
    assert signal["reason"] == blocked
    has_reason(out, "OUTSIDE_DEMAND_INDEPENDENT_ORIGINAL_BUYER_SIGNAL_REQUIRED")
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("field,replacement,reason", [
    ("outside_candidate_work", "w2",
     "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"),
    ("outside_work_revision", "d-4",
     "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"),
    ("outside_deliverable", "different-product",
     "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"),
    ("outside_quality_basis", "lower-quality",
     "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"),
    ("outside_units", 2,
     "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"),
    ("outside_slot_start", 108,
     "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"),
    ("outside_slot_end", 121,
     "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"),
    ("outside_currency", "USD",
     "OUTSIDE_DEMAND_PRICE_CEILING_OR_CURRENCY_NOT_COMPARABLE"),
    ("outside_price_ceiling", "500.00",
     "OUTSIDE_DEMAND_PRICE_CEILING_OR_CURRENCY_NOT_COMPARABLE"),
])
def test_buyer_source_exists_but_noncomparable_terms_cannot_justify_outside_price(
        field, replacement, reason):
    d = independent_buyer_case()
    demand_event(d)[field] = replacement
    out = simulate(d)
    assert find(out, "outside_demand_signal")[0]["outcome"] == "APPLIED"
    has_reason(out, reason)
    assert "COOPERATION_PREFERRED" not in positions(out)
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_independent_buyer_source_later_revocation_blocks_new_model_read_not_old_result():
    d = independent_buyer_case()
    d["events"].append({
        "at": 96, "action": "source_update", "actor": BUYER,
        "source": BUYER_SOURCE, "status": "DISPROVED",
        "expected_revision": REVISION, "new_revision": "buyer-demand-r4-2",
    })
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert find(out, "source_update")[0]["outcome"] == "APPLIED"
    series = owner_assessments(out)
    assert any(t < 96 and p == "COOPERATION_PREFERRED"
               for t,p,_ in series)
    assert any(t >= 96 and reason == "OUTSIDE_DEMAND_CURRENT_BUYER_SOURCE_NO_LONGER_READABLE"
               for t,_,reason in series)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_independent_buyer_demand_expires_without_authenticating_future_sale():
    d = independent_buyer_case()
    demand_event(d)["outside_demand_valid_until"] = 81
    out = simulate(d)
    assert find(out, "outside_demand_signal")[0]["outcome"] == "APPLIED"
    has_reason(out, "OUTSIDE_DEMAND_NOT_PRIOR_OR_CURRENT")
    assert all(position != "COOPERATION_PREFERRED"
               for position in positions(out))


def test_duplicate_buyer_signal_does_not_replace_first_in_original_trace():
    d = independent_buyer_case()
    duplicate = deepcopy(demand_event(d))
    duplicate["at"] = 79
    d["events"].append(duplicate)
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert [(row["outcome"], row.get("reason"))
            for row in find(out, "outside_demand_signal")] == [
        ("APPLIED", None),
        ("BLOCKED", "OUTSIDE_DEMAND_DUPLICATE_ORIGINAL_SIGNAL"),
    ]
    assert "COOPERATION_PREFERRED" in positions(out)
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_owner_forecast_must_explicitly_reference_actual_buyer_signal():
    d = independent_buyer_case()
    owner_outlook(d)["outside_demand_claim"]["signal_id"] = "nonexistent"
    out = simulate(d)
    has_reason(out, "OUTSIDE_DEMAND_INDEPENDENT_ORIGINAL_BUYER_SIGNAL_REQUIRED")
    assert "COOPERATION_PREFERRED" not in positions(out)


def test_r4_external_buyer_not_member_of_original_cooperation():
    d = independent_buyer_case()
    d["cooperation_links"][0]["participants"].append(BUYER)
    out = simulate(d)
    signal = find(out, "outside_demand_signal")[0]
    assert signal["outcome"] == "BLOCKED"
    assert signal["reason"] == "OUTSIDE_DEMAND_BUYER_NOT_EXTERNAL_TO_COOPERATION"


def test_independent_buyer_demand_does_not_override_original_owner_refusal():
    d = independent_buyer_case()
    interest = next(e for e in d["events"]
                    if e["action"] == "interest_update"
                    and e.get("work") == "w3" and e["actor"] == "a")
    interest["new_willingness"] = "DECLINES"
    interest["new_outside_option"] = "OUTSIDE_PREFERRED"
    out = simulate(d)
    assert "COOPERATION_PREFERRED" in positions(out)
    assert find(out, "commit", work="w3")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert all(out["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1", "w2"))


def test_r4_independent_demand_never_creates_work_bank_transfer_or_consent():
    baseline = simulate(independent_buyer_case())
    public = {
        "work_count": len(baseline["works"]),
        "profit": baseline["profit"]["system_increment"],
        "demand_applied": any(
            row["action"] == "outside_demand_signal"
            and row["outcome"] == "APPLIED"
            for row in baseline["trace"]
        ),
        "no_external_result": not any(
            str(key).startswith("__akis_outside_candidate__")
            for key in baseline["works"]
        ),
    }
    assert public == {
        "work_count": 3, "profit": "UNKNOWN",
        "demand_applied": True, "no_external_result": True,
    }
    # No model report should publish exact source IDs or buyer amount.
    summaries = json.dumps([
        {"position": p, "reason": reason}
        for _,p,reason in owner_assessments(baseline)
    ])
    assert BUYER_SOURCE not in summaries
    assert "1000.00" not in summaries
