"""R2.5: Work/Result -> original conditional terms -> original cash clock.

Only one Mesa event trace and one already-declared transfer ledger are used.
"""
from copy import deepcopy
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_rules import fixture as akis_fixture
from .test_liquidity_mesa_integration import case as cash_fixture
from .test_general_system_mesa_integration import design


def terms(condition="ON_CUSTOMER_ACCEPTANCE", due_at=10, **changes):
    return {
        "transfer_id": "t2", "condition": condition, "due_at": due_at,
        "work_source_revision": "d-1", "org_revision": "oc-1",
        "owner_sources": {"b": "b1", "op": "o1"},
        **changes,
    }


def scenario(*, accepted=True):
    d = akis_fixture()
    d["model_horizon"] = 10
    d["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 4, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 5, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 6, "action": "start", "actor": "a", "work": "w1"},
        {"at": 7, "action": "complete", "actor": "a", "work": "w1",
         "result_ref": "model://result-v1"},
    ]
    if accepted:
        d["events"].append({"at": 8, "action": "accept", "actor": "b", "work": "w1"})
    cash = cash_fixture()
    # Only t2 receives work-conditional terms; other original transfers remain
    # unchanged monetary rows, with no unsupported Work entitlement inferred.
    for row in cash["transfers"]:
        if row["id"] != "t2":
            row["work"] = None
    cash["cash_timing"]["transfer_windows"][1].update({"at": 9, "late_at": 9})
    cash["work_payment_conditions"] = [terms()]
    d["economic_claims"] = cash
    return d


def view(d):
    return simulate(d)["economics"]["work_payment_causality"]


def test_original_acceptance_creates_only_declared_conditional_sequence_not_cash():
    d = scenario()
    out = simulate(d)
    p = out["economics"]["work_payment_causality"]
    assert p["status"] == "DECLARED_CAUSAL_PAYMENT_ORDER_ONLY_NOT_SETTLEMENT"
    assert p["source_declared_consistent_count"] == 1
    row = p["bindings"][0]
    assert row["original_condition_at"] == 8
    assert row["original_due_at"] == 10
    assert row["same_original_transfer_expected_posting_at"] == 9
    assert row["customer_accepted_current_result_version"]
    assert not row["original_transfer_amount_posted_or_collected_in_bank"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"] == "270.00"
    baseline = deepcopy(d)
    del baseline["economic_claims"]["work_payment_conditions"]
    before = simulate(baseline)
    assert {k:v for k,v in out["economics"].items() if k != "work_payment_causality"} == before["economics"]
    assert simulate(deepcopy(d)) == out


def test_submission_or_wrong_customer_acceptance_not_automatically_payment_entitlement():
    d = scenario(accepted=False)
    p = view(d)
    assert p["bindings"][0]["status"] == "ORIGINAL_CONDITIONAL_TRIGGER_NOT_APPLIED"
    assert p["unobserved_trigger_count"] == 1
    d["events"].append({"at": 8, "action": "accept", "actor": "op", "work": "w1"})
    o = simulate(d)
    assert o["trace"][-1]["reason"] == "ORIGINAL_CUSTOMER_RESULT_DECISION_REQUIRED"
    assert o["economics"]["work_payment_causality"]["unobserved_trigger_count"] == 1


def test_original_commit_can_trigger_explicit_advance_but_does_not_accept_result():
    d = scenario(accepted=False)
    d["events"] = d["events"][:5]
    d["economic_claims"]["work_payment_conditions"] = [terms("ON_ORIGINAL_COMMIT", 10)]
    p = view(d)
    assert p["source_declared_consistent_count"] == 1
    assert p["bindings"][0]["original_condition_at"] == 5
    assert p["bindings"][0]["current_original_result"] == "NOT_SUBMITTED"
    assert p["bindings"][0]["customer_accepted_current_result_version"] is False


@pytest.mark.parametrize("update,expected", [
    ({"due_at": 7}, "DECLARED_DUE_PRECEDES_APPLIED_CONDITION"),
    ({"due_at": 8}, "CASH_FORECAST_AFTER_DECLARED_DUE_WITHOUT_AMENDMENT"),
])
def test_inconsistent_original_due_does_not_make_payment_legal(update, expected):
    d = scenario()
    d["economic_claims"]["work_payment_conditions"][0].update(update)
    assert view(d)["bindings"][0]["status"] == expected


def test_early_model_posting_is_not_payment_trigger():
    d = scenario()
    d["economic_claims"]["cash_timing"]["transfer_windows"][1]["at"] = 7
    p = view(d)
    assert p["bindings"][0]["status"] == "CASH_FORECAST_PRECEDES_APPLIED_CONDITION"
    assert p["source_declared_consistent_count"] == 0


def test_same_tick_condition_and_posting_order_not_assumed():
    d = scenario()
    d["economic_claims"]["cash_timing"]["transfer_windows"][1]["at"] = 8
    assert view(d)["bindings"][0]["status"] == "SAME_TICK_CONDITION_AND_POSTING_ORDER_UNVERIFIED"


def test_declared_late_posting_does_not_amend_original_due():
    d = scenario()
    d["economic_claims"]["cash_timing"]["transfer_windows"][1]["late_at"] = 10
    p = view(d)
    assert p["bindings"][0]["status"] == "MODEL_ORIGINAL_TRIGGER_DUE_AND_POSTING_ORDER_CONSISTENT"
    d["economic_claims"]["cash_timing"]["horizon_end"] = 11
    d["economic_claims"]["cash_timing"]["transfer_windows"][1]["late_at"] = 11
    p = view(d)
    assert p["bindings"][0]["late_hypothesis_after_original_due"] is True
    assert p["original_due_is_not_replaced_by_late_cash_hypothesis"] is True


def test_missing_window_or_missing_terms_fails_closed_without_new_money():
    d = scenario()
    d["economic_claims"]["cash_timing"]["transfer_windows"].pop(1)
    assert view(d)["bindings"][0]["status"] == "ORIGINAL_CASH_POSTING_WINDOW_NOT_DECLARED"
    d = scenario()
    d["economic_claims"]["work_payment_conditions"] = []
    p = view(d)
    assert p["status"] == "INCOMPLETE_ORIGINAL_WORK_PAYMENT_TERMS"
    assert p["missing_original_work_transfer_ids"] == ["t2"]
    assert p["missing_terms_are_unknown_not_zero"]


@pytest.mark.parametrize("change,reason", [
    (lambda d:d["work_payment_conditions"].append(deepcopy(d["work_payment_conditions"][0])),
     "DUPLICATE_WORK_PAYMENT_CONDITION"),
    (lambda d:d["work_payment_conditions"][0].update({"transfer_id":"t5"}),
     "PAYMENT_CONDITION_REQUIRES_ORIGINAL_COOPERATIVE_WORK_TRANSFER"),
    (lambda d:d["work_payment_conditions"][0].update({"due_at":True}),
     "INVALID_ORIGINAL_PAYMENT_DUE_TIME"),
    (lambda d:d["work_payment_conditions"][0].update({"due_at":11}),
     "INVALID_ORIGINAL_PAYMENT_DUE_TIME"),
    (lambda d:d["work_payment_conditions"][0].update({"condition":"AUTOMATIC_PAYMENT"}),
     "UNSUPPORTED_WORK_PAYMENT_CONDITION"),
    (lambda d:d["work_payment_conditions"][0].update({"work_source_revision":"obsolete"}),
     "PAYMENT_CONDITION_WORK_REVISION_MISMATCH"),
    (lambda d:d["work_payment_conditions"][0].update({"org_revision":"oc-other"}),
     "PAYMENT_CONDITION_COMMITMENT_REVISION_MISMATCH"),
    (lambda d:d["work_payment_conditions"][0].update({"owner_sources":{"b":"b1"}}),
     "PAYMENT_TERMS_BOTH_ORIGINAL_PARTIES_REQUIRED"),
    (lambda d:d["work_payment_conditions"][0].update({"owner_sources":{"b":"a1","op":"o1"}}),
     "PAYMENT_TERMS_ORIGINAL_OWNER_SOURCE_REQUIRED"),
    (lambda d:d["work_payment_conditions"][0].update({"owner_sources":{"b":"b1","op":"b1"}}),
     "PAYMENT_TERMS_ORIGINAL_OWNER_SOURCE_REQUIRED"),
    (lambda d:d.pop("cash_timing"),
     "WORK_PAYMENT_CONDITIONS_REQUIRE_CASH_TIMING"),
])
def test_false_sources_rights_and_times_are_rejected(change, reason):
    d = scenario()
    change(d["economic_claims"])
    with pytest.raises(InputError, match=reason):
        simulate(d)


def test_original_work_terms_incomplete_if_a_second_payment_is_not_bound():
    d = scenario()
    d["economic_claims"]["transfers"][2]["work"] = "w1"
    p = view(d)
    assert p["original_work_transfer_without_terms_count"] == 1
    assert p["missing_original_work_transfer_ids"] == ["t3"]


def test_shared_nine_component_model_does_not_publish_private_payment_terms():
    d = scenario()
    d["general_akis"] = design()
    out = simulate(d)
    shared = out["general_akis_model"]
    p = shared["economic_time_and_cost_feedback"]
    assert p["work_payment_condition_bound_count"] == 1
    assert p["work_payment_condition_consistent_count"] == 1
    assert p["work_payment_original_due_dates_redisclosed"] is False
    assert p["work_payment_reported_as_bank_settlement"] is False
    raw = json.dumps(shared, ensure_ascii=False)
    assert "original_due_at" not in raw
    assert "owner_sources" not in raw
    assert "same_original_transfer_expected_posting_at" not in raw
    assert out["economics"]["work_payment_causality"]["real_contract_legal_enforceability_and_payment_verified"] is False
