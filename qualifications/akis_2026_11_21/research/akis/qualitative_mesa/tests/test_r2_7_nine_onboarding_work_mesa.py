"""R2.7: all nine original doctoral connection-cost channels in one original Work.

Alternative, operator, owner and network share one existing economic ledger;
missing channel source means UNKNOWN, not cost-free participation.
"""
from copy import deepcopy
from decimal import Decimal
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from research.akis.qualitative_mesa.modern_economic_evidence import (
    ONBOARDING_CATEGORIES,
)
from .test_work_counterfactual_mesa import counterfactual_case


def nine_case():
    d = counterfactual_case()
    cash = d["economic_claims"]
    zero_source = {"a": "a1", "b": "b1", "c": "customer-proof", "op": "o1"}
    for scenario in ("COOPERATION", "INDEPENDENT_ALTERNATIVE"):
        for category in ONBOARDING_CATEGORIES:
            if scenario == "COOPERATION" and category == "human_reviewer_training":
                # Existing original operator cost c1 of 15.00 (do not add it).
                continue
            suffix = "coop" if scenario == "COOPERATION" else "outside"
            rid = f"r-{suffix}-{category}"
            amount = "1.00" if scenario == "COOPERATION" else "4.00"
            cash["resource_uses"].append({
                "id": rid, "scenario": scenario, "owner": "op",
                "amount": amount, "bucket": "PARTICIPANT_CONNECT",
                "source": "o1", "work": "w2",
            })
            cash["lifecycle_costs"]["bindings"].append({
                "resource_use_id": rid, "owner": "op", "source": "o1",
                "stage": "ONBOARDING_AND_INTEGRATION",
                "nature": "TRANSACTION",
            })
            classification = {
                "owner": "op", "category": category,
                "resource_use_id": rid, "source": "o1",
            }
            if scenario == "INDEPENDENT_ALTERNATIVE":
                classification["scenario"] = scenario
            cash["modern_cost_bindings"].append(classification)
    scope = d["work_counterfactuals"][0]["owner_scope"]
    scope["INDEPENDENT_ALTERNATIVE"]["op"]["declared_zero_noncash"] = False
    d["work_counterfactuals"][0]["onboarding_zero_proofs"] = {
        scenario: {
            owner: {category: zero_source[owner] for category in ONBOARDING_CATEGORIES}
            for owner in ("a", "b", "c")
        }
        for scenario in ("COOPERATION", "INDEPENDENT_ALTERNATIVE")
    }
    return d


def assess(d):
    return simulate(d)["work_counterfactual_dynamics"]["works"][0]


def test_nine_exact_author_categories_work_operator_and_network_reconcile():
    d = nine_case()
    out = simulate(d)
    w = out["work_counterfactual_dynamics"]["works"][0]
    assert out["counts"]["blocked"] == 0
    assert w["status"] == "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
    assert w["nine_onboarding_model_comparability"] == (
        "SOURCE_DECLARED_NINE_AUTHOR_COST_ARITHMETIC_ONLY"
    )
    assert w["nine_onboarding_complete_original_owner_count"] == 4
    assert w["network_nine_onboarding_noncash_difference_outside_minus_cooperation"] == "13.00"
    assert w["operator_nine_onboarding_noncash_difference_outside_minus_cooperation"] == "13.00"
    op = w["per_original_owner"]["op"]
    assert op["nine_onboarding_independent_minus_cooperation_noncash_total"] == "13.00"
    details = op["nine_onboarding_independent_minus_cooperation_noncash_by_category"]
    assert len(details) == 9
    assert details["human_reviewer_training"] == "-11.00"
    assert details["interview"] == "3.00"
    assert w["per_scenario"]["COOPERATION"]["owners"]["op"][
        "onboarding_nine_original_noncash_total_separate_from_cash"] == "23.00"
    assert w["per_scenario"]["INDEPENDENT_ALTERNATIVE"]["owners"]["op"][
        "onboarding_nine_original_noncash_total_separate_from_cash"] == "36.00"
    assert w["network_declared_external_cash_difference"] == "125.00"
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"] == "270.00"
    assert out["economics"]["profit"] == "UNKNOWN"
    summary = out["general_akis_model"]["work_counterfactual_feedback"]
    assert summary["source_declared_nine_onboarding_comparable_work_count"] == 1
    assert not summary["owner_private_nine_costs_and_zero_sources_redisclosed"]
    shared = json.dumps(out["general_akis_model"], ensure_ascii=False)
    assert "network_nine_onboarding_noncash_difference_outside_minus_cooperation" not in shared
    assert "onboarding_nine_original_noncash_total_separate_from_cash" not in shared
    assert simulate(deepcopy(d)) == out


def test_missing_category_zero_attestation_never_becomes_free_participation():
    d = nine_case()
    del d["work_counterfactuals"][0]["onboarding_zero_proofs"]["COOPERATION"]["b"]["interview"]
    w = assess(d)
    assert w["status"] == "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
    assert w["nine_onboarding_model_comparability"] == "NOT_IDENTIFIABLE_FROM_COMPLETE_ORIGINAL_OWNER_SOURCES"
    assert w["network_nine_onboarding_noncash_difference_outside_minus_cooperation"] is None
    b = w["per_scenario"]["COOPERATION"]["owners"]["b"]
    assert b["onboarding_nine_unknown_category_count"] == 1
    assert "interview" in b["onboarding_nine_missing_category_proofs"]
    assert b["onboarding_nine_author_category_costs"]["interview"]["noncash_original_resource_cost"] is None


def test_no_new_proofs_does_not_change_previous_arithmetic_eligibility():
    d = counterfactual_case()
    w = assess(d)
    assert w["status"] == "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
    assert w["nine_onboarding_model_comparability"] == "NOT_IDENTIFIABLE_FROM_COMPLETE_ORIGINAL_OWNER_SOURCES"
    assert w["network_declared_external_cash_difference"] == "125.00"
    assert w["operator_nine_onboarding_noncash_difference_outside_minus_cooperation"] is None


def test_original_nine_costs_can_reverse_sign_without_making_a_real_profit_claim():
    d = nine_case()
    alt = d["economic_claims"]["resource_uses"]
    for record in alt:
        if record["scenario"] == "INDEPENDENT_ALTERNATIVE" and record["id"].startswith("r-outside-"):
            record["amount"] = "0.25"
    w = assess(d)
    assert w["operator_nine_onboarding_noncash_difference_outside_minus_cooperation"] == "-20.75"
    assert w["network_declared_external_cash_difference"] == "125.00"
    assert w["real_profit_and_causal_competence_gain"] == "NOT_ESTABLISHED"


def test_absent_exact_author_category_with_original_onboarding_expense_blocks_scope():
    d = nine_case()
    rows = d["economic_claims"]["modern_cost_bindings"]
    rows[:] = [r for r in rows if r["resource_use_id"] != "r-outside-interview"]
    w = assess(d)
    op = w["per_scenario"]["INDEPENDENT_ALTERNATIVE"]["owners"]["op"]
    assert "ORIGINAL_ONBOARDING_USES_WITHOUT_EXACT_NINE_CATEGORY" in op["reasons"]
    assert op["onboarding_nine_original_noncash_total_separate_from_cash"] is None
    assert w["nine_onboarding_model_comparability"] == "NOT_IDENTIFIABLE_FROM_COMPLETE_ORIGINAL_OWNER_SOURCES"


def test_legacy_tag_cannot_fake_author_doctoral_cost():
    d = nine_case()
    match = next(r for r in d["economic_claims"]["modern_cost_bindings"]
                 if r["resource_use_id"] == "r-coop-interview")
    match["category"] = "training"
    w = assess(d)
    owner = w["per_scenario"]["COOPERATION"]["owners"]["op"]
    assert "HISTORICAL_LEGACY_TAG_IS_NOT_EXACT_AUTHOR_COST" in owner["reasons"]
    assert "interview" in owner["onboarding_nine_missing_category_proofs"]
    assert w["nine_onboarding_model_comparability"] == "NOT_IDENTIFIABLE_FROM_COMPLETE_ORIGINAL_OWNER_SOURCES"


def test_invalid_independent_resource_use_scenario_tag_never_recast_as_cooperation():
    d = nine_case()
    match = next(r for r in d["economic_claims"]["modern_cost_bindings"]
                 if r["resource_use_id"] == "r-outside-interview")
    match["scenario"] = "COOPERATION"
    with pytest.raises(InputError, match="MODERN_ECONOMIC_OWNER_SOURCE_SCOPE_MISMATCH"):
        simulate(d)


@pytest.mark.parametrize("alter,reason", [
    (lambda d:d["work_counterfactuals"][0]["onboarding_zero_proofs"]["COOPERATION"]["op"].update(
         {"human_reviewer_training": "o1"}),
     "COUNTERFACTUAL_NINE_ZERO_CONTRADICTS_ORIGINAL_USE"),
    (lambda d:d["work_counterfactuals"][0]["onboarding_zero_proofs"]["COOPERATION"]["b"].update(
         {"interview": "a1"}),
     "COUNTERFACTUAL_NINE_ZERO_OWNER_SOURCE_INVALID"),
    (lambda d:d["work_counterfactuals"][0]["onboarding_zero_proofs"]["COOPERATION"]["a"].update(
         {"fabricated_author_category": "a1"}),
     "COUNTERFACTUAL_NINE_ZERO_CATEGORY_INVALID"),
    (lambda d:d["work_counterfactuals"][0]["onboarding_zero_proofs"]["COOPERATION"].update(
         {"absent_firm": {"interview": "a1"}}),
     "COUNTERFACTUAL_NINE_ZERO_OWNER_INVALID"),
    (lambda d:d["work_counterfactuals"][0]["onboarding_zero_proofs"]["COOPERATION"]["b"].update(
         {"testing": None}),
     "COUNTERFACTUAL_NINE_ZERO_OWNER_SOURCE_INVALID"),
])
def test_source_zero_cannot_hide_nonzero_cost_or_impersonate_other_principal(alter,reason):
    d = nine_case()
    d["work_counterfactuals"][0]["onboarding_zero_proofs"]["COOPERATION"]["op"] = {}
    alter(d)
    with pytest.raises(InputError, match=reason):
        simulate(d)


def test_quality_rejection_holds_nine_comparison_despite_complete_cost_sources():
    d = nine_case()
    d["work_counterfactuals"][0]["equivalence"]["quality"] = False
    w = assess(d)
    assert "COMPARABLE_QUANTITY_QUALITY_RISK_SCOPE_NOT_DECLARED" in w["global_reasons"]
    assert w["network_nine_onboarding_noncash_difference_outside_minus_cooperation"] is None
    assert w["network_declared_external_cash_difference"] is None


def test_independent_outside_feasibility_required_for_all_nine_cost_comparison():
    d = nine_case()
    d["economic_claims"]["outside_feasibility"]["op"]["state"] = "UNKNOWN"
    w = assess(d)
    assert w["per_original_owner"]["op"]["nine_onboarding_independent_minus_cooperation_noncash_total"] is None
    assert w["network_nine_onboarding_noncash_difference_outside_minus_cooperation"] is None


def test_lifecycle_stage_and_author_nine_cost_do_not_create_two_resource_charges():
    d = nine_case()
    out = simulate(d)
    op = out["work_counterfactual_dynamics"]["works"][0]["per_scenario"]["COOPERATION"]["owners"]["op"]
    assert Decimal(op["declared_lifecycle_stage_costs"]["ONBOARDING_AND_INTEGRATION"]) == Decimal("23.00")
    assert Decimal(op["onboarding_nine_original_noncash_total_separate_from_cash"]) == Decimal("23.00")
    assert out["economics"]["resource_costs_additive_to_cash"] is False
    assert out["economics"]["lifecycle_resource_costs"]["same_resource_may_be_tagged_elsewhere_but_not_added_again"]
    assert out["economics"]["resource_uses_count"] == 19
