"""2026 research gate: inherited 2011 motives require current evidence, not profit."""
from __future__ import annotations

from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.modern_economic_evidence import (
    HISTORICAL_MOTIVES, ONBOARDING_CATEGORIES, MODERN_EXPOSURES,
    ModernEconomicEvidenceError, modern_economic_review, review_cost_attribution,
)
from research.akis.qualitative_mesa.economic_flow import (
    EconomicInputError, evaluate_economic_claims,
)
from .test_economic_flow import fixture as money_claims, subject_state, work_state
from .test_rules import fixture as akis_fixture


def original_costs():
    d = money_claims()
    d["modern_cost_bindings"] = [
        {"owner": "a", "category": "training", "resource_use_id": "c2", "source": "a1"},
        {"owner": "op", "category": "agent_identity_authorization_audit",
         "resource_use_id": "c1", "source": "o1"},
    ]
    return d


def test_all_historical_motives_conditional_not_automatically_measured():
    assert len(HISTORICAL_MOTIVES) == len(set(HISTORICAL_MOTIVES)) == 10
    assert len(ONBOARDING_CATEGORIES) == len(set(ONBOARDING_CATEGORIES)) == 9
    assert len(MODERN_EXPOSURES) == len(set(MODERN_EXPOSURES)) == 9
    view = modern_economic_review(subject_state(), economic_view=None)
    assert view["historic_motive_count"] == 10
    assert len(view["motives_2011"]) == 10
    assert all(row["realized_economic_effect"] == "NOT_ESTABLISHED_BY_MOTIVE"
               for row in view["motives_2011"])
    assert view["network_perspective"] == "NOT_IDENTIFIABLE"
    assert view["platform_dependence_and_exit_cost"] == "NOT_ZERO_BY_DEFAULT"
    assert view["competition_market_law"] == "REQUIRES_JURISDICTION_SPECIFIC_EVALUATION"


def test_original_nine_and_new_digital_costs_reference_existing_uses_without_new_money():
    raw = original_costs()
    original = evaluate_economic_claims(money_claims(), subject_state(), work_state())
    extended = evaluate_economic_claims(raw, subject_state(), work_state())
    report = extended["modern_cost_attribution"]
    assert report["distinct_original_resource_use_references"] == 2
    assert report["owners"]["a"]["categories_with_declared_non_cash_use"] == ["training"]
    assert "interview" in report["owners"]["a"]["onboarding_missing_source_coverage"]
    assert "agent_identity_authorization_audit" in report["owners"]["op"]["categories_with_declared_non_cash_use"]
    assert report["no_new_cash_or_resource_use"]
    assert report["no_established_total_onboarding_cost_or_saving"]
    for key in (
        "consolidated_external_cash_from_claims", "consolidated_cash_difference_claimed_scope",
        "resource_uses_count", "internal_transfers_count", "per_subject"
    ):
        assert extended[key] == original[key]


@pytest.mark.parametrize("edit,error", [
    ({"owner": "b"}, "MODERN_ECONOMIC_OWNER_SOURCE_SCOPE_MISMATCH"),
    ({"source": "o1"}, "MODERN_ECONOMIC_OWNER_SOURCE_SCOPE_MISMATCH"),
    ({"category": "automatic_profit"}, "MODERN_ECONOMIC_CATEGORY_UNKNOWN"),
    ({"resource_use_id": "t2"}, "MODERN_ECONOMIC_RESOURCE_NOT_IN_ORIGINAL_LEDGER"),
    ({"resource_use_id": "absent"}, "MODERN_ECONOMIC_RESOURCE_NOT_IN_ORIGINAL_LEDGER"),
    ({"owner": "new_company"}, "MODERN_ECONOMIC_OWNER_UNKNOWN"),
])
def test_disallowed_reassignment_or_unsupported_cost_category(edit, error):
    d = original_costs()
    d["modern_cost_bindings"][0].update(edit)
    with pytest.raises(EconomicInputError, match=error):
        evaluate_economic_claims(d, subject_state(), work_state())


def test_one_resource_use_cannot_be_labeled_twice_for_two_fictitious_savings():
    d = original_costs()
    duplicate = deepcopy(d["modern_cost_bindings"][0])
    duplicate["category"] = "interoperability_and_semantics"
    d["modern_cost_bindings"].append(duplicate)
    with pytest.raises(EconomicInputError, match="DUPLICATE_MODERN_ECONOMIC_RESOURCE_ATTRIBUTION"):
        evaluate_economic_claims(d, subject_state(), work_state())


def test_no_cost_binding_is_not_evidence_of_cost_free_connection():
    d = money_claims()
    d["modern_cost_bindings"] = []
    v = evaluate_economic_claims(d, subject_state(), work_state())
    assert v["modern_cost_attribution"]["owners"] == {}
    assert v["modern_cost_attribution"]["no_established_total_onboarding_cost_or_saving"]
    assert v["modern_cost_attribution"]["distinct_original_resource_use_references"] == 0


def test_non_cooperation_resource_use_cannot_be_recast_as_onboarding_cost():
    d = original_costs()
    for row in d["resource_uses"]:
        if row["id"] == "c2":
            row["scenario"] = "INDEPENDENT_ALTERNATIVE"
    with pytest.raises(EconomicInputError, match="MODERN_ECONOMIC_OWNER_SOURCE_SCOPE_MISMATCH"):
        evaluate_economic_claims(d, subject_state(), work_state())


def test_incomplete_operator_outside_precludes_profit_even_when_cash_received():
    d = original_costs()
    economics = evaluate_economic_claims(d, subject_state(), work_state())
    view = modern_economic_review(subject_state(), economic_view=economics)
    assert view["operator_count"] == 1 and view["firm_count"] == 2
    assert view["per_original_subject"]["op"]["outside_feasibility"] == "UNKNOWN"
    assert view["operator_perspective"] == "SEPARATE_DECLARED_CASH_NOT_PROOF_OF_SUSTAINABILITY"
    assert view["network_perspective"] == "NOT_IDENTIFIABLE"
    assert view["liquidity_proof_from_individual_claims"] == "NOT_ESTABLISHED"
    assert view["real_world_causal_savings"] == "NOT_ESTABLISHED"
    assert view["internal_transfers_added_as_external_value"] is False


def test_complete_declared_external_arithmetic_still_not_real_proven_saving():
    d = original_costs()
    d["outside_feasibility"]["op"] = {
        "state": "FEASIBLE_DECLARED", "source": "o1",
    }
    economics = evaluate_economic_claims(d, subject_state(), work_state())
    v = modern_economic_review(subject_state(), economic_view=economics)
    assert v["network_perspective"] == "DECLARED_EXTERNAL_CASH_ARITHMETIC_ONLY"
    assert economics["economic_value_added"] == "NOT_IDENTIFIABLE"
    assert v["real_world_causal_savings"] == "NOT_ESTABLISHED"


def test_procurement_must_still_pass_independent_competition_check():
    x = modern_economic_review(
        subject_state(), economic_view=None,
        joint_purchasing={
            "proposals": [{"status": "UNIQUE_PROSPECTIVE_GROUP_NOT_CONSENTED"}],
        },
    )
    assert x["joint_purchasing"] == "POSSIBLE_GROUP_REQUIRES_COMPETITION_AND_LEGAL_REVIEW"
    assert x["new_original_events_or_legal_rights"] is False


def test_native_mesa_modern_economic_review_is_opt_in_and_preserves_original_work():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = akis_fixture()
    scenario["modern_economy_review"] = True
    scenario["economic_claims"] = original_costs()
    out = simulate(scenario)
    assert out["modern_economic_review"]["historic_motive_count"] == 10
    assert out["modern_economic_review"]["operator_count"] == 1
    assert out["economics"]["modern_cost_attribution"]["distinct_original_resource_use_references"] == 2
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["modern_economic_review"]["network_perspective"] == "NOT_IDENTIFIABLE"
    assert simulate(deepcopy(scenario)) == out


def test_native_mesa_default_scenario_unchanged_and_rejects_nonboolean_opt_in():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    from research.akis.qualitative_mesa.rules import InputError
    original = akis_fixture()
    assert "modern_economic_review" not in simulate(original)
    modified = deepcopy(original)
    modified["modern_economy_review"] = "yes"
    with pytest.raises(InputError, match="MODERN_ECONOMY_REVIEW_MUST_BE_BOOLEAN"):
        simulate(modified)
