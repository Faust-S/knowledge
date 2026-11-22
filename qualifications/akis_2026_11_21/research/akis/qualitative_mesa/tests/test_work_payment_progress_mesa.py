"""R2.6: original Work payment terms, two-party claims, and due stress.

No new economic_cash transfer, bank settlement fact, legal amendment, or
operator privilege. The existing R2.3/R2.4 cash conservation remains mandatory.
"""
from copy import deepcopy
from decimal import Decimal
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_work_payment_causal_mesa import scenario
from .test_general_system_mesa_integration import design


def payment(ident="s1", amount="90.00", at=9, **other):
    return {"id":ident, "transfer_id":"t2", "at":at, "amount":amount,
            "owner_sources":{"b":"b-pay","op":"op-pay"},
            "evidence_refs":{"b":f"model://b/pay-{ident}",
                             "op":f"model://op/pay-{ident}"}, **other}


def amendment(ident="a1", **other):
    return {"id":ident, "transfer_id":"t2", "agreed_at":9,
            "prior_due_at":10, "new_due_at":12,
            "work_source_revision":"d-1", "org_revision":"oc-1",
            "owner_sources":{"b":"b-change","op":"op-change"},
            "evidence_refs":{"b":f"model://b/change-{ident}",
                             "op":f"model://op/change-{ident}"}, **other}


def case():
    d=scenario()
    cash=d["economic_claims"]
    cash["sources"].extend([
        {"id":id, "owner":owner, "reference":f"model://{owner}/source-{id}",
         "revision":"new-evidence-r1"}
        for id,owner in [("b-pay","b"),("op-pay","op"),
                         ("b-change","b"),("op-change","op")]
    ])
    cash["cash_timing"]["horizon_end"]=12
    cash["cash_timing"]["transfer_windows"][1].update({"at":10,"late_at":10})
    d["model_horizon"]=12
    return d


def view(d):
    return simulate(d)["economics"]


def test_partial_original_claim_retains_one_transfer_and_changes_only_conditional_posting():
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[payment()]
    e=view(d)
    p=e["work_payment_causality"]
    item=p["bindings"][0]["settlement_progress"]
    assert item["status"]=="PARTIALLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT"
    assert item["source_claimed_eligible_amount"]=="90.00"
    assert item["unconfirmed_remainder_not_actual_bank_debt"]=="30.00"
    assert e["transfers_count"]==7
    assert e["consolidated_external_cash_from_claims"]["COOPERATION"]=="270.00"
    joint=e["cash_timing"]["joint_network_settlement"]["scenarios"]["COOPERATION"]
    assert joint["claim_adjusted_original_money_conserved_per_tick"]
    assert joint["claim_adjusted_splits_original_transfer_not_new_money"]
    assert not joint["claim_adjusted_bank_payment_verified"]
    own=joint["per_original_owner_private_research_projection"]
    for owner in own:
        assert own[owner]["claim_adjusted_expected"]["end_of_horizon_cash_from_declared_transfers"]==own[owner]["expected"]["end_of_horizon_cash_from_declared_transfers"]
    assert p["settlement_progress"]["source_claimed_partial_transfer_count"]==1
    assert simulate(deepcopy(d))==simulate(d)


def test_partial_claim_can_change_same_tick_owner_cash_risk_without_creating_money():
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[payment()]
    d["economic_claims"]["cash_timing"]["transfer_windows"][2]["at"]=9
    d["economic_claims"]["cash_timing"]["transfer_windows"][3]["at"]=9
    e=view(d)["cash_timing"]["joint_network_settlement"]["scenarios"]["COOPERATION"]
    op=e["per_original_owner_private_research_projection"]["op"]
    assert op["expected"]["status"]=="SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    assert op["claim_adjusted_expected"]["status"]=="SAME_TICK_SETTLEMENT_ORDER_NOT_QUALIFIED"
    assert e["claim_adjusted_original_money_conserved_per_tick"]


def test_two_independent_partial_reports_match_full_original_but_not_bank_settlement():
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[
        payment(amount="70.00",at=9),
        payment("s2",amount="50.00",at=10,
                owner_sources={"b":"b-pay","op":"op-pay"}),
    ]
    e=view(d)
    p=e["work_payment_causality"]
    assert p["settlement_progress"]["source_claimed_full_transfer_count"]==1
    assert p["bindings"][0]["settlement_progress"]["unconfirmed_remainder_not_actual_bank_debt"]=="0.00"
    assert not p["settlement_progress"]["actual_bank_payment_verified"]
    assert not e["cash_timing"]["joint_network_settlement"]["scenarios"]["COOPERATION"]["claim_adjusted_bank_payment_verified"]


def test_no_payment_report_is_not_evidence_of_nonpayment():
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[]
    p=view(d)["work_payment_causality"]["bindings"][0]["settlement_progress"]
    assert p["status"]=="NO_PAYMENT_SOURCE_CLAIM_DOES_NOT_PROVE_UNPAID"
    assert p["unreported_payment_is_not_zero_actual_payment"]
    assert "claim_adjusted_expected" not in view(d)["cash_timing"]["joint_network_settlement"]["scenarios"]["COOPERATION"]["per_original_owner_private_research_projection"]["b"]


def test_payment_before_original_acceptance_cannot_update_cash_as_eligible_claim():
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[payment(at=7)]
    p=view(d)
    assert p["work_payment_causality"]["bindings"][0]["settlement_progress"]["status"]=="PAYMENT_CLAIMS_CAUSALLY_INCONSISTENT"
    assert p["work_payment_causality"]["status"]=="PAYMENT_PROGRESS_EVIDENCE_OR_AMENDMENT_CONFLICT"
    assert "claim_adjusted_expected" not in p["cash_timing"]["joint_network_settlement"]["scenarios"]["COOPERATION"]["per_original_owner_private_research_projection"]["b"]


def test_same_tick_acceptance_and_payment_not_assumed_qualified():
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[payment(at=8)]
    p=view(d)["work_payment_causality"]
    assert p["bindings"][0]["settlement_progress"]["private_model_evidence"][0]["causal_status"]=="PAYMENT_CLAIM_SAME_TICK_CAUSAL_ORDER_UNQUALIFIED"
    assert p["settlement_progress"]["causal_conflict_transfer_count"]==1


def test_asserted_late_payment_does_not_revise_contractual_due_or_invent_financing_cost():
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[payment(at=11)]
    e=view(d)
    p=e["work_payment_causality"]["bindings"][0]
    assert p["original_due_at"]==10
    assert p["settlement_progress"]["late_against_model_declared_due_event_count"]==1
    assert e["profit"]=="UNKNOWN"
    assert e["resource_uses_count"]==2
    assert e["cash_timing"]["joint_network_settlement"]["bank_settlement_or_legal_extension_verified"] is False


def test_pre_due_bilateral_amendment_only_declares_model_revised_due():
    d=case()
    d["economic_claims"]["work_payment_due_amendments"]=[amendment()]
    d["economic_claims"]["cash_timing"]["transfer_windows"][1]["at"]=11
    e=view(d)
    b=e["work_payment_causality"]["bindings"][0]
    assert b["original_due_at"]==10
    assert b["source_declared_revised_due_at"]==12
    assert b["status"]=="MODEL_REVISED_DUE_FORECAST_CONSISTENT_NOT_LEGAL"
    assert e["work_payment_causality"]["source_declared_consistent_count"]==1
    assert not e["work_payment_causality"]["settlement_progress"]["legal_revision_of_due_date_verified"]
    # The original due survives the proposed amendment in owner's R2.3 stress.
    stressed=e["cash_timing"]["per_original_owner_private_research_projection"]["b"]["scenario_paths"]["COOPERATION"]
    assert Decimal(stressed["declared_late_case"]["minimum_before_unverified_same_tick_inflows"]) <= Decimal(stressed["expected"]["minimum_before_unverified_same_tick_inflows"])


def test_retroactive_amendment_is_visible_not_accepted_to_relax_obligations():
    d=case()
    d["economic_claims"]["work_payment_due_amendments"]=[
        amendment(agreed_at=11,new_due_at=12)]
    d["economic_claims"]["cash_timing"]["transfer_windows"][1]["at"]=11
    p=view(d)["work_payment_causality"]
    assert p["bindings"][0]["model_amendment_status"]=="RETROACTIVE_DUE_AMENDMENT_NOT_QUALIFIED"
    assert p["bindings"][0]["status"]=="CASH_FORECAST_AFTER_DECLARED_DUE_WITHOUT_AMENDMENT"
    assert p["settlement_progress"]["retroactive_or_inconsistent_amendment_count"]==1


def test_model_claims_and_amendments_do_not_change_original_amounts_or_outside_alternative():
    d=case()
    baseline=view(deepcopy(d))
    d["economic_claims"]["work_payment_settlement_claims"]=[payment()]
    d["economic_claims"]["work_payment_due_amendments"]=[amendment()]
    e=view(d)
    assert e["per_subject"]==baseline["per_subject"]
    assert e["consolidated_external_cash_from_claims"]==baseline["consolidated_external_cash_from_claims"]
    assert e["resource_uses_count"]==baseline["resource_uses_count"]
    assert e["cash_timing"]["joint_network_settlement"]["scenarios"]["INDEPENDENT_ALTERNATIVE"]["expected_original_external_cash_delta"]==baseline["cash_timing"]["joint_network_settlement"]["scenarios"]["INDEPENDENT_ALTERNATIVE"]["expected_original_external_cash_delta"]


@pytest.mark.parametrize("mod,reason",[
    (lambda d:d["work_payment_settlement_claims"].append(payment("s2",amount="40.00")),"PAYMENT_SETTLEMENT_EXCEEDS_ORIGINAL_TRANSFER"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"amount":"0.00"}),"PAYMENT_SETTLEMENT_AMOUNT_MUST_BE_POSITIVE"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"amount":"NaN"}),"INVALID_EXACT_AMOUNT"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"at":True}),"INVALID_PAYMENT_PROGRESS_MODEL_TIME"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"at":13}),"INVALID_PAYMENT_PROGRESS_MODEL_TIME"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"owner_sources":{"b":"b-pay"}}),"PAYMENT_PROGRESS_BOTH_INDEPENDENT_OWNER_SOURCES_REQUIRED"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"owner_sources":{"b":"b-pay","op":"b-pay"}}),"PAYMENT_PROGRESS_OWNER_SOURCE_INVALID"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"owner_sources":{"b":"b1","op":"o1"}}),"PAYMENT_PROGRESS_MUST_HAVE_NEW_EVENT_SOURCE"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"evidence_refs":{"b":"model://op/x","op":"model://op/y"}}),"PAYMENT_PROGRESS_INDEPENDENT_EVENT_REFERENCE_REQUIRED"),
    (lambda d:d["work_payment_settlement_claims"].append(payment()),"DUPLICATE_PAYMENT_EVIDENCE_EVENT_ID"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"transfer_id":"t5"}),"PAYMENT_SETTLEMENT_NOT_IN_ORIGINAL_WORK_TERMS"),
    (lambda d:d["work_payment_settlement_claims"][0].update({"evidence_refs":{"b":"model://b/source-b-pay","op":"model://op/pay-s1"}}),"PAYMENT_PROGRESS_EVENT_REFERENCE_NOT_UNIQUE"),
])
def test_payment_evidence_invalid_sources_times_amount_or_duplicates_fail_closed(mod,reason):
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[payment()]
    mod(d["economic_claims"])
    with pytest.raises(InputError,match=reason):
        simulate(d)


@pytest.mark.parametrize("mod,reason",[
    (lambda d:d["work_payment_due_amendments"][0].update({"prior_due_at":9}),"PAYMENT_AMENDMENT_PRIOR_DUE_MISMATCH"),
    (lambda d:d["work_payment_due_amendments"][0].update({"org_revision":"stale"}),"PAYMENT_AMENDMENT_WORK_OR_ORG_REVISION_MISMATCH"),
    (lambda d:d["work_payment_due_amendments"][0].update({"owner_sources":{"op":"op-change"}}),"PAYMENT_PROGRESS_BOTH_INDEPENDENT_OWNER_SOURCES_REQUIRED"),
    (lambda d:d["work_payment_due_amendments"][0].update({"owner_sources":{"b":"b1","op":"op-change"}}),"PAYMENT_PROGRESS_MUST_HAVE_NEW_EVENT_SOURCE"),
    (lambda d:d["work_payment_due_amendments"].append(amendment()),"DUPLICATE_PAYMENT_EVIDENCE_EVENT_ID"),
])
def test_amendment_not_original_source_or_wrong_revision_rejected(mod,reason):
    d=case()
    d["economic_claims"]["work_payment_due_amendments"]=[amendment()]
    mod(d["economic_claims"])
    with pytest.raises(InputError,match=reason):
        simulate(d)


def test_progress_without_original_terms_is_rejected():
    d=case()
    del d["economic_claims"]["work_payment_conditions"]
    d["economic_claims"]["work_payment_settlement_claims"]=[payment()]
    with pytest.raises(InputError,match="PAYMENT_PROGRESS_REQUIRES_ORIGINAL_WORK_TERMS"):
        simulate(d)


def test_evidence_order_is_not_accounting_order():
    d=case()
    d["economic_claims"]["work_payment_settlement_claims"]=[
        payment("s2",amount="30.00",at=10),payment("s1",amount="90.00",at=9)]
    first=simulate(d)
    d["economic_claims"]["work_payment_settlement_claims"].reverse()
    second=simulate(d)
    assert first==second


def test_shared_nine_component_projection_contains_counts_not_owner_amounts_or_dates():
    d=case()
    d["general_akis"]=design()
    d["economic_claims"]["work_payment_settlement_claims"]=[payment()]
    d["economic_claims"]["work_payment_due_amendments"]=[amendment()]
    output=simulate(d)
    general=output["general_akis_model"]
    status=general["economic_time_and_cost_feedback"]
    assert status["payment_model_partially_matched_transfer_count"]==1
    assert status["payment_original_due_amendment_declared_count"]==1
    assert status["private_payment_dates_amounts_and_source_ids_redisclosed"] is False
    raw=json.dumps(general,ensure_ascii=False)
    for private_field in ("source_claimed_eligible_amount","original_transfer_claim_amount",
                          "model_amendment_at","unconfirmed_remainder_not_actual_bank_debt"):
        assert private_field not in raw
    assert not output["economics"]["work_payment_causality"]["settlement_progress"]["actual_bank_payment_verified"]
