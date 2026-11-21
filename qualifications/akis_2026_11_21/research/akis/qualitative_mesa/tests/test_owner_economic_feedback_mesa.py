"""M2.3: dated owner-private economics changes research review, never legal Work.

All financial values and sources remain on the owner's private evaluator side.
Only generic REQUEST_INDEPENDENT_EVIDENCE_REVIEW enters shared Mesa choices.
"""
from __future__ import annotations

from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.owner_economic_feedback import (
    OwnerFinanceInputError, parse_owner_finance, private_owner_financial_review,
)
from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from research.akis.qualitative_mesa.economic_flow import evaluate_economic_claims
from .test_liquidity_mesa_integration import case as finance_claims
from .test_rules import fixture as akis_fixture
from .test_general_system_mesa_integration import design


def claim(owner="b", work="w1", start=2, end=5):
    return {
        "owner": owner,
        "work": work,
        "work_source_revision": "d-1",
        "org_revision": "oc-1",
        "source_ref": f"model://{owner}/research-financial-review",
        "cash_source": {"b": "b1", "a": "a1", "op": "o1"}.get(owner, "unqualified"),
        "cash_source_revision": "doc-r1",
        "available_at": start,
        "expires_at": end,
        "cash_scope": "OWNER_PORTFOLIO_NOT_WORK_INCREMENTAL",
    }


def fixture():
    scenario = akis_fixture()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    scenario["economic_claims"] = finance_claims()
    scenario["endogenous_subjects"] = True
    scenario["general_akis"] = design()
    scenario["modern_economy_review"] = True
    scenario["decision_profiles"] = [
        {"subject": who, "work": "w1", "source_revision": "d-1",
         "org_revision": "oc-1", "willingness": "WILLING",
         "outside_option": "COOPERATION_PREFERRED"} for who in ("a", "b")
    ]
    scenario["owner_financial_reviews"] = [claim()]
    scenario["model_horizon"] = 5
    return scenario


def test_source_owner_and_work_are_independent_principals():
    state = QualitativeAKIS(akis_fixture())
    parsed = parse_owner_finance([claim()], state=state, original_money=finance_claims())
    assert len(parsed) == 1 and parsed[0].owner == "b"
    assert parsed[0].work == "w1"
    assert parsed[0].source_ref.startswith("model://b/")
    assert parsed[0].cash_source == "b1"


@pytest.mark.parametrize("edit,reason", [
    ({"owner": "missing"}, "OWNER_FINANCE_UNKNOWN_ORIGINAL_OWNER"),
    ({"owner": "op", "cash_source": "o1", "source_ref": "model://op/review"},
     "OWNER_FINANCE_NOT_ORIGINAL_WORK_PRINCIPAL"),
    ({"work": "missing"}, "OWNER_FINANCE_REQUIRES_EXISTING_ORIGINAL_WORK"),
    ({"work_source_revision": "d-other"}, "OWNER_FINANCE_NOT_ORIGINAL_WORK_PRINCIPAL"),
    ({"source_ref": "model://a/stolen"}, "OWNER_FINANCE_INDEPENDENT_OWNER_SOURCE_REQUIRED"),
    ({"cash_source": "a1"}, "OWNER_FINANCE_CASH_SOURCE_OWNER_OR_REVISION_MISMATCH"),
    ({"cash_source_revision": "doc-r0"}, "OWNER_FINANCE_CASH_SOURCE_OWNER_OR_REVISION_MISMATCH"),
    ({"cash_scope": "WORK_REVENUE"}, "OWNER_FINANCE_CASH_SCOPE_MUST_BE_PORTFOLIO"),
    ({"available_at": True}, "OWNER_FINANCE_SOURCE_TIME_INVALID"),
    ({"expires_at": 1}, "OWNER_FINANCE_SOURCE_TIME_INVALID"),
    ({"requires_accepted_results": [{"work": "unknown", "source_revision": "d-1"}]},
     "OWNER_FINANCE_PREREQUISITE_NOT_ORIGINAL"),
    ({"requires_accepted_results": [{"work": "w1", "source_revision": "d-1"}]},
     "OWNER_FINANCE_PREREQUISITE_NOT_ORIGINAL"),
])
def test_bad_source_or_impersonation_fails_before_mesa(edit, reason):
    item = claim()
    item.update(edit)
    with pytest.raises(OwnerFinanceInputError, match=reason):
        parse_owner_finance([item], state=QualitativeAKIS(akis_fixture()),
                            original_money=finance_claims())


def test_source_windows_cannot_overlap_or_generate_second_ledger():
    state = QualitativeAKIS(akis_fixture())
    with pytest.raises(OwnerFinanceInputError, match="OVERLAPPING_OWNER_FINANCE_SOURCE_WINDOWS"):
        parse_owner_finance([claim(start=2, end=6), claim(start=4, end=8)],
                            state=state, original_money=finance_claims())
    with pytest.raises(OwnerFinanceInputError, match="OWNER_FINANCE_REQUIRES_ORIGINAL_CASH_TIMING"):
        parse_owner_finance([claim()], state=state, original_money={})


def test_private_evidence_is_time_qualified_and_does_not_assume_cash_payment():
    state = QualitativeAKIS(akis_fixture())
    claimed = parse_owner_finance([claim()], state=state, original_money=finance_claims())
    money = evaluate_economic_claims(finance_claims(), state.subjects, state.works)
    assert not private_owner_financial_review(
        claimed, owner="b", work=state.works["w1"], state=state, at=1, economics=money)
    assert private_owner_financial_review(
        claimed, owner="b", work=state.works["w1"], state=state, at=2, economics=money)
    assert not private_owner_financial_review(
        claimed, owner="b", work=state.works["w1"], state=state, at=5, economics=money)
    assert state.trace == [] and state.works["w1"].obligation == "NOT_ACCEPTED"


def test_original_accepted_result_dependency_does_not_mean_payment():
    state_data = akis_fixture()
    state_data["works"].append({
        "id": "w0", "customer": "b", "resource": "ra",
        "source_revision": "prior-1", "slot_start": 12, "slot_end": 15,
    })
    state = QualitativeAKIS(state_data)
    item = claim()
    item["requires_accepted_results"] = [{"work": "w0", "source_revision": "prior-1"}]
    signal = parse_owner_finance([item], state=state, original_money=finance_claims())
    finance = evaluate_economic_claims(finance_claims(), state.subjects, state.works)
    assert private_owner_financial_review(
        signal, owner="b", work=state.works["w1"], state=state, at=2, economics=finance)
    state.works["w0"].result = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert private_owner_financial_review(
        signal, owner="b", work=state.works["w1"], state=state, at=2, economics=finance)
    # Result acceptance removes dependency hold but never signs a payment;
    # the declared b liquidity exposure still requires owner review.
    assert state.trace == []


def test_owner_finance_requires_endogenous_choice_explicit_opt_in():
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    scenario["endogenous_subjects"] = False
    with pytest.raises(InputError, match="OWNER_FINANCE_REVIEW_REQUIRES_ENDOGENOUS_SUBJECTS"):
        simulate(scenario)


def test_native_mesa_source_activation_and_expiry_changes_only_generic_independent_review():
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    output = simulate(scenario)
    observations = [row for row in output["decision_observations"]
                    if row["subject"] == "b" and row["work"] == "w1"]
    changes = [(row["at"], row["endogenous_choice"]["action"])
               for row in observations if "endogenous_choice" in row]
    assert (2.0, "REQUEST_INDEPENDENT_EVIDENCE_REVIEW") in changes
    assert (5.0, "SEEK_ORIGINAL_INDEPENDENT_REVIEW") in changes
    other = [row for row in output["decision_observations"]
             if row["subject"] == "a" and row["at"] == 2.0]
    assert other and other[-1]["endogenous_choice"]["action"] == "SEEK_ORIGINAL_INDEPENDENT_REVIEW"
    e = output["endogenous_subjects"]["read_only_evolution"]
    by_time = {row["at"]: row for row in e}
    assert by_time[2.0]["status"] == "SOURCE_RESOURCE_OR_INSTITUTIONAL_REVIEW_REQUIRED"
    assert by_time[5.0]["status"] == "UNSIGNED_MULTILATERAL_REVIEW_CANDIDATE"
    assert output["counts"] == {"applied": 2, "blocked": 0}
    assert output["works"]["w1"]["consenting_principals"] == []
    assert output["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert len(output["trace"]) == 2
    assert output["general_akis_model"]["economic_time_and_cost_feedback"][
        "private_owner_research_reevaluation"
    ] == "SOURCE_TIMED_GENERIC_REVIEW_ONLY_NO_FINANCIAL_DISCLOSURE"
    assert simulate(deepcopy(scenario)) == output


def test_native_mesa_no_private_source_data_leaks_to_shared_subject_choices():
    from research.akis.qualitative_mesa.mesa_model import simulate
    s = fixture()
    o = simulate(s)
    import json
    shared = json.dumps({
        "decision_observations": o["decision_observations"],
        "endogenous_subjects": o["endogenous_subjects"],
        "general_akis_model": o["general_akis_model"],
    }, ensure_ascii=False)
    for sensitive in (
        "opening_cash", "reserve_cash", "120.00",
        "CASH_SOURCE", "LIQUIDITY_GAP", "source_ref",
        "model://b/research-financial-review", "_private_owner_cash_review_required",
    ):
        assert sensitive not in shared
    assert o["endogenous_subjects"]["private_financial_evidence_boundary"][
        "actual_owner_consent_or_payment_created"
    ] is False


def test_original_consents_and_prior_commitments_not_overruled_by_cash_research():
    from research.akis.qualitative_mesa.mesa_model import simulate
    s = fixture()
    s["events"].extend([
        {"at": 3, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 4, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 5, "action": "commit", "actor": "op", "work": "w1"},
    ])
    result = simulate(s)
    assert result["counts"] == {"applied": 5, "blocked": 0}
    assert result["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert result["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert result["endogenous_subjects"]["last_jointly_observed"][0][
        "original_obligation"
    ] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert all(row["effect"] == "NO_AUTOMATIC_CONSENT"
               for row in result["decision_observations"])


def test_native_mesa_absent_owner_finance_input_keeps_previous_choice_contract():
    from research.akis.qualitative_mesa.mesa_model import simulate
    s=fixture()
    s.pop("owner_financial_reviews")
    previous=simulate(s)
    assert "private_financial_evidence_boundary" not in previous["endogenous_subjects"]
    assert "private_owner_research_reevaluation" not in (
        previous["general_akis_model"]["economic_time_and_cost_feedback"]
    )
    active=simulate(fixture())
    assert previous["works"]==active["works"]
    assert previous["trace"]==active["trace"]
    assert previous["economics"]==active["economics"]
