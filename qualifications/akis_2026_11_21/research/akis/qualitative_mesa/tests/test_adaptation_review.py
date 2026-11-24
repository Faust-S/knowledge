"""Non-binding endogenous cues and explicitly proposed adaptation requests."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.adaptation_review import (
    AdaptationInputError, inquiry_from_applied_event, parse_review_requests, review_adaptation,
)
from research.akis.qualitative_mesa.economic_flow import evaluate_economic_claims
from .test_economic_flow import fixture as econ_fixture, subject_state, work_state


def state():
    return SimpleNamespace(
        institution=SimpleNamespace(operator="op", founders=("op", "a", "b"), revision="oc-1", mode="SOLE"),
        subjects={"op": SimpleNamespace(active=True), "a": SimpleNamespace(active=True), "b": SimpleNamespace(active=True)},
        works={"w1": SimpleNamespace(customer="b", resource="ra", obligation="ACCEPTED_BY_ORIGINAL_PRINCIPALS", result="REJECTED")},
        resources={"ra": "a"},
        trace=[
            {"at": 4, "action": "start", "actor": "a", "work": "w1", "reason": "RESOURCE_NOT_AVAILABLE", "outcome": "BLOCKED", "org_revision": "oc-1"},
            {"at": 7, "action": "reject", "actor": "b", "work": "w1", "reason": "NONE", "outcome": "APPLIED", "org_revision": "oc-1"},
        ],
    )


def request(**kwargs):
    obj = {
        "id": "review-1", "proposed_by": "op", "scope": "SERVICE_ADAPTATION",
        "work": "w1", "basis_at": 7, "org_revision": "oc-1",
        "hypothesis": "Insufficient qualification may cause repeated rejection",
        "alternative_explanation": "One-off upstream input mistake",
        "affected_principals": ["a", "b"], "source_ids": [],
    }
    obj.update(kwargs)
    return obj


def portfolio():
    return {"review_cues": [
        {"at": 4, "signal": "RESOURCE_CAPABILITY_REVIEW", "work": "w1", "resource": "ra"},
        {"at": 7, "signal": "RESULT_CORRECTION_REVIEW", "work": "w1", "resource": None},
    ]}


def test_reviewable_hypothesis_creates_no_right_or_automatic_change():
    s = state()
    snapshot = deepcopy(s)
    result = review_adaptation(s, parse_review_requests([request()], s.subjects), portfolio=portfolio())
    p = result["proposals"][0]
    assert p["assessment"] == "REVIEWABLE_AS_HYPOTHESIS"
    assert p["decision_route"]["route"] == "OPERATOR_AND_AFFECTED_ORIGINAL_PRINCIPALS"
    assert p["decision_route"]["required_roles"] == ["a", "b", "op"]
    assert p["authorized_change"] is False
    assert result["decision"] == "NO_AUTOMATIC_ORGANIZATIONAL_CHANGE"
    assert result["system_additionality"] == "NOT_IDENTIFIABLE"
    assert s == snapshot


def test_counterexplanation_and_original_rights_are_not_optional_proofs():
    s = state()
    req = request(alternative_explanation=None, affected_principals=["a"])
    result = review_adaptation(s, parse_review_requests([req], s.subjects), portfolio=portfolio())
    assert result["proposals"][0]["unresolved_flags"] == [
        "ALTERNATIVE_EXPLANATION_MISSING", "ORIGINAL_PRINCIPALS_NOT_LISTED"]


def test_stale_revision_does_not_create_authority_to_change_code():
    s = state()
    req = request(scope="INSTITUTIONAL_TRANSFORMATION", org_revision="oc-0")
    p = review_adaptation(s, parse_review_requests([req], s.subjects), portfolio=portfolio())["proposals"][0]
    assert "STALE_ORGANIZATIONAL_CODE" in p["unresolved_flags"]
    assert p["decision_route"]["required_roles"] == ["a", "b", "op"]
    assert p["decision_route"]["existing_transition"] == "change_mode"
    assert p["authorized_change"] is False
    assert s.institution.revision == "oc-1"


def test_institutional_scope_names_code_owners_before_rights_review():
    s = state()
    req = request(scope="INSTITUTIONAL_TRANSFORMATION", affected_principals=["a", "b"])
    p = review_adaptation(s, parse_review_requests([req], s.subjects), portfolio=portfolio())["proposals"][0]
    assert p["unresolved_flags"] == ["CODE_OWNERS_NOT_LISTED"]
    assert p["authorized_change"] is False


def test_no_affected_parties_cannot_be_treated_as_review_ready():
    s = state()
    req = request(scope="SCOPE_REDUCTION", affected_principals=[], work=None)
    p = review_adaptation(s, parse_review_requests([req], s.subjects), portfolio=portfolio())["proposals"][0]
    assert "AFFECTED_PRINCIPALS_NOT_DECLARED" in p["unresolved_flags"]
    assert p["authorized_change"] is False


def test_wrong_basis_is_not_promoted_into_causal_evidence():
    s = state()
    req = request(basis_at=11)
    p = review_adaptation(s, parse_review_requests([req], s.subjects), portfolio=portfolio())["proposals"][0]
    assert p["unresolved_flags"] == ["BASIS_EVENT_UNKNOWN"]
    assert p["causal_attribution"] == "NOT_IDENTIFIABLE"


def test_unrelated_work_trace_does_not_correlate_as_hard_evidence():
    s = state()
    req = request(basis_at=7, work="other")
    p = review_adaptation(s, parse_review_requests([req], s.subjects), portfolio=portfolio())["proposals"][0]
    assert set(p["unresolved_flags"]) == {"UNKNOWN_REVIEW_WORK", "BASIS_WRONG_WORK"}


def test_risk_cues_are_inquiries_and_never_executable_organizational_orders():
    s = state()
    out = review_adaptation(s, [], portfolio=portfolio())
    assert len(out["review_opportunities"]) == 2
    assert all(r["status"] == "INQUIRY_ONLY_NOT_PROPOSAL" for r in out["review_opportunities"])
    assert out["proposals"] == []


def test_negative_declared_cash_flow_is_not_negative_profit_or_disadvantage():
    s = state()
    economics = evaluate_economic_claims(econ_fixture(), subject_state(), work_state())
    # Adjust a declared alternative to produce negative arithmetic for a subject.
    economics["per_subject"]["a"]["cash_difference_cooperation_minus_outside"] = "-10.00"
    out = review_adaptation(s, [], economics=economics)
    assert out["individual_cash_signals"] == [{
        "kind": "NEGATIVE_DECLARED_CASH_DIFFERENCE", "subject": "a", "scope": "INDIVIDUAL_CASH_ONLY",
        "basis": "DECLARED_UNVERIFIED", "no_inference": ["NOT_PROFIT", "NOT_CAUSAL", "NOT_INDIVIDUAL_CONSENT"]}]
    assert out["operator_reproduction"] == "NOT_IDENTIFIABLE"
    assert out["system_additionality"] == "NOT_IDENTIFIABLE"


def test_cash_signal_requires_comparable_declared_scope_not_unlisted_zero():
    s = state()
    econ = evaluate_economic_claims(econ_fixture(), subject_state(), work_state())
    econ["per_subject"]["a"]["cash_comparison"] = "NOT_IDENTIFIABLE"
    econ["per_subject"]["a"]["cash_difference_cooperation_minus_outside"] = "-1000.00"
    assert review_adaptation(s, [], economics=econ)["individual_cash_signals"] == []


def test_source_claim_owned_by_an_unrelated_principal_is_not_read_permission():
    s = state()
    econ = evaluate_economic_claims(econ_fixture(), subject_state(), work_state())
    req = request(source_ids=["o1"], proposed_by="a", affected_principals=["a", "b"])
    p = review_adaptation(s, parse_review_requests([req], s.subjects), portfolio=portfolio(), economics=econ)["proposals"][0]
    assert p["unresolved_flags"] == ["SOURCE_OWNER_OUTSIDE_DECLARED_SCOPE"]
    assert p["authorized_change"] is False
    assert "reference" not in p


def test_unknown_source_fails_without_silently_approving_claim():
    s = state()
    req = request(source_ids=["no-source"])
    with pytest.raises(AdaptationInputError, match="UNDECLARED_REVIEW_SOURCE"):
        review_adaptation(s, parse_review_requests([req], s.subjects))


@pytest.mark.parametrize("changes,error", [
    ({"id": ""}, "INVALID_REVIEW_ID"),
    ({"scope": "GOVERNANCE_OPTIMIZATION"}, "UNKNOWN_REVIEW_SCOPE"),
    ({"basis_at": True}, "INVALID_BASIS_TIME"),
    ({"source_ids": ["x", "x"]}, "DUPLICATE_REVIEW_SOURCE"),
    ({"proposed_by": "nobody"}, "UNKNOWN_REVIEW_PROPOSER"),
    ({"affected_principals": ["x"]}, "INVALID_AFFECTED_PRINCIPALS"),
    ({"affected_principals": ["a", "a"]}, "INVALID_AFFECTED_PRINCIPALS"),
    ({"alternative_explanation": []}, "INVALID_ALTERNATIVE_EXPLANATION"),
])
def test_invalid_review_input_fails_closed(changes, error):
    s = state()
    with pytest.raises(AdaptationInputError, match=error):
        parse_review_requests([request(**changes)], s.subjects)


def test_duplicate_requests_rejected_even_when_substantively_similar():
    s = state()
    with pytest.raises(AdaptationInputError, match="DUPLICATE_REVIEW_ID"):
        parse_review_requests([request(), request(scope="LOCAL_CORRECTION")], s.subjects)


def test_repetition_is_deterministic_without_mutating_state_or_money():
    s = state()
    economy = evaluate_economic_claims(econ_fixture(), subject_state(), work_state())
    reqs = parse_review_requests([request()], s.subjects)
    result = review_adaptation(s, reqs, portfolio=portfolio(), economics=economy)
    assert result == review_adaptation(deepcopy(s), deepcopy(reqs), portfolio=deepcopy(portfolio()), economics=deepcopy(economy))


def test_event_inquiry_preserves_symbolic_time_without_hypothesis_promotion():
    event = state().trace[0]
    inquiry = inquiry_from_applied_event(event)
    assert inquiry == {
        "basis_at": 4, "signal": "RESOURCE_CAPABILITY_REVIEW", "work": "w1",
        "resource": None, "org_revision": "oc-1", "basis": "RESOURCE_NOT_AVAILABLE",
        "causal_attribution": "NOT_IDENTIFIABLE", "evidence": "MODEL_ONLY",
        "decision": "INQUIRY_ONLY_NOT_PROPOSAL",
    }


def test_successful_ordinary_work_event_creates_no_adaptation_event():
    event = {"at": 5, "action": "consent", "work": "w1", "resource": None,
             "org_revision": "oc-1", "outcome": "APPLIED", "reason": "NONE"}
    assert inquiry_from_applied_event(event) is None
