"""Pure, locally runnable logic: Mesa-specific reaction tests are separate."""
from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.participant_response import (
    ProfileInputError, assess_principal, parse_profiles,
)


def position(subject="a", work="w1", willingness="WILLING", outside="COOPERATION_PREFERRED", rev="oc-1"):
    return {"subject": subject, "work": work, "source_revision": "d-1", "org_revision": rev,
            "willingness": willingness, "outside_option": outside}


def environment(*, resource="AVAILABLE", admitted=True, mode="SOLE", active=True, status="OFFERED", obligation="NOT_ACCEPTED", revision="oc-1"):
    return SimpleNamespace(
        institution=SimpleNamespace(mode=mode, revision=revision),
        resources={"ra": "a"}, resource_availability={"ra": resource},
        resource_availability_origin={"ra": "MODEL_INPUT"},
        subjects={"a": SimpleNamespace(active=active), "b": SimpleNamespace(active=True)},
        works={"w1": SimpleNamespace(resource="ra", customer="b", proposal=status,
                                     obligation=obligation, admitted=admitted,
                                     authorization_org_revision="oc-1", source_revision="d-1")},
    )


def response(*, data=None, subject="a", **kwargs):
    state = environment(**kwargs)
    profiles = parse_profiles(data if data is not None else [position()], state.subjects)
    return assess_principal(state, profiles, subject, "w1")


def test_yes_with_known_outside_option_is_reviewable_but_not_consent():
    r = response()
    assert r["assessment"] == "REVIEWABLE_NOT_CONSENTED"
    assert r["effect"] == "NO_AUTOMATIC_CONSENT"
    assert r["evidence"] == "MODEL_ONLY"


def test_no_unilateral_consent_when_other_principal_is_not_described():
    assert response(subject="b")["assessment"] == "INTEREST_UNKNOWN"


@pytest.mark.parametrize("resource,expected", [
    ("UNKNOWN", "RESOURCE_READINESS_UNKNOWN"),
    ("UNAVAILABLE", "RESOURCE_NOT_AVAILABLE"),
    ("AVAILABLE", "REVIEWABLE_NOT_CONSENTED"),
])
def test_owner_resource_state_changes_assessment_without_new_consent(resource, expected):
    assert response(resource=resource)["assessment"] == expected


def test_distinct_outside_alternatives_affect_individual_choices():
    profiles = [position("a"), position("b", outside="OUTSIDE_PREFERRED")]
    assert response(data=profiles)["assessment"] == "REVIEWABLE_NOT_CONSENTED"
    assert response(data=profiles, subject="b")["assessment"] == "PREFERS_OUTSIDE_OPTION"


@pytest.mark.parametrize("data,code", [
    ([position(willingness="DECLINES")], "INDEPENDENT_DECLINE"),
    ([position(willingness="UNKNOWN")], "INTEREST_UNKNOWN"),
    ([position(outside="UNKNOWN")], "OUTSIDE_OPTION_UNKNOWN"),
    ([position(rev="oc-0")], "PROFILE_REVISION_STALE"),
])
def test_refusal_uncertainty_and_stale_source(data, code):
    assert response(data=data)["assessment"] == code


@pytest.mark.parametrize("state_options,code", [
    ({"admitted": False}, "CURRENT_AUTHORIZATION_MISSING"),
    ({"mode": "UNSELECTED"}, "MODE_NOT_SELECTED"),
    ({"revision": "oc-2"}, "PROFILE_REVISION_STALE"),
    ({"active": False}, "PARTICIPANT_INACTIVE"),
    ({"status": "REQUESTED"}, "NO_CURRENT_OFFER"),
    ({"obligation": "ACCEPTED_BY_ORIGINAL_PRINCIPALS"}, "OBLIGATION_ALREADY_COMMITTED"),
])
def test_governance_request_and_commitment_change_reaction(state_options, code):
    assert response(**state_options)["assessment"] == code


def test_legacy_assumed_availability_does_not_become_qualified_readiness():
    state = environment()
    state.resource_availability_origin["ra"] = "LEGACY_FIXTURE_DEFAULT"
    profiles = parse_profiles([position()], state.subjects)
    assert assess_principal(state, profiles, "a", "w1")["assessment"] == "RESOURCE_READINESS_UNSUPPORTED"
    state.resource_availability_origin["ra"] = "MODEL_EVENT"
    assert assess_principal(state, profiles, "a", "w1")["assessment"] == "REVIEWABLE_NOT_CONSENTED"


def test_missing_work_does_not_conjure_a_demand():
    state = environment()
    profiles = parse_profiles([position()], state.subjects)
    assert assess_principal(state, profiles, "a", "missing")["assessment"] == "WORK_UNKNOWN"


def test_unrelated_subject_does_not_acquire_a_right():
    state = environment()
    state.subjects["c"] = SimpleNamespace(active=True)
    profiles = parse_profiles([position("c")], state.subjects)
    assert assess_principal(state, profiles, "c", "w1")["assessment"] == "NOT_ORIGINAL_PRINCIPAL"


@pytest.mark.parametrize("bad,error", [
    (None, "INVALID_DECISION_PROFILE_COUNT"),
    ({}, "INVALID_DECISION_PROFILE_COUNT"),
    ([position(), position()], "DUPLICATE_DECISION_PROFILE"),
    ([position(subject="other")], "UNKNOWN_DECISION_SUBJECT"),
    ([{**position(), "willingness": "YES"}], "INVALID_WILLINGNESS"),
    ([{**position(), "outside_option": "BETTER_THAN_MARKET"}], "INVALID_OUTSIDE_OPTION"),
    ([{**position(), "extra": "ignored"}], "INVALID_DECISION_PROFILE_FIELDS"),
])
def test_invalid_assumptions_rejected(bad, error):
    with pytest.raises(ProfileInputError, match=error):
        parse_profiles(bad, environment().subjects)


def test_independent_repetition_is_deterministic():
    state = environment()
    profiles = parse_profiles([position(), position(subject="b", outside="OUTSIDE_PREFERRED")], state.subjects)
    assert assess_principal(state, profiles, "a", "w1") == assess_principal(deepcopy(state), deepcopy(profiles), "a", "w1")


def test_latest_source_revisioned_interest_from_original_trace_only():
    state=environment()
    state.trace=[
        {"at":2,"action":"interest_update","outcome":"APPLIED","actor":"a","work":"w1",
         "org_revision":"oc-1","interest_source_revision":"d-1",
         "interest_willingness":"DECLINES","interest_outside_option":"OUTSIDE_PREFERRED"},
        {"at":3,"action":"interest_update","outcome":"BLOCKED","actor":"a","work":"w1",
         "org_revision":"oc-1","interest_source_revision":"d-1",
         "interest_willingness":"WILLING","interest_outside_option":"COOPERATION_PREFERRED"},
    ]
    assert assess_principal(state, {}, "a", "w1")["assessment"]=="INDEPENDENT_DECLINE"
    assert assess_principal(state, {}, "b", "w1")["assessment"]=="INTEREST_UNKNOWN"
    state.trace.append({
        "at":4,"action":"interest_update","outcome":"APPLIED","actor":"a","work":"w1",
        "org_revision":"oc-1","interest_source_revision":"d-1",
        "interest_willingness":"WILLING","interest_outside_option":"COOPERATION_PREFERRED"})
    assert assess_principal(state, {}, "a", "w1")["assessment"]=="REVIEWABLE_NOT_CONSENTED"
    state.institution.revision="oc-2"
    assert assess_principal(state, {}, "a", "w1")["assessment"]=="INTEREST_UNKNOWN"
    assert state.works["w1"].obligation=="NOT_ACCEPTED"



def test_time_qualified_cash_position_refines_only_unknown_owner_alternative():
    state = environment()
    positive = parse_profiles([position(outside="UNKNOWN")], state.subjects)
    assert assess_principal(state, positive, "a", "w1")["assessment"] == "OUTSIDE_OPTION_UNKNOWN"
    assert assess_principal(state, positive, "a", "w1",
                            modeled_outside_position="COOPERATION_PREFERRED")["assessment"] == "REVIEWABLE_NOT_CONSENTED"
    assert assess_principal(state, positive, "a", "w1",
                            modeled_outside_position="OUTSIDE_PREFERRED")["assessment"] == "PREFERS_OUTSIDE_OPTION"
    explicit = parse_profiles([position(outside="OUTSIDE_PREFERRED")], state.subjects)
    assert assess_principal(state, explicit, "a", "w1",
                            modeled_outside_position="COOPERATION_PREFERRED")["assessment"] == "PREFERS_OUTSIDE_OPTION"
    refusal = parse_profiles([position(willingness="DECLINES", outside="UNKNOWN")], state.subjects)
    assert assess_principal(state, refusal, "a", "w1",
                            modeled_outside_position="COOPERATION_PREFERRED")["assessment"] == "INDEPENDENT_DECLINE"
    state.trace = [
        {"action": "interest_update", "outcome": "APPLIED", "actor": "a",
         "work": "w1", "org_revision": "oc-1", "interest_source_revision": "d-1",
         "interest_willingness": "WILLING", "interest_outside_option": "UNKNOWN"},
    ]
    assert assess_principal(state, {}, "a", "w1",
                            modeled_outside_position="COOPERATION_PREFERRED")["assessment"] == "REVIEWABLE_NOT_CONSENTED"
    state.trace.append({
        "action": "interest_update", "outcome": "APPLIED", "actor": "a",
        "work": "w1", "org_revision": "oc-1", "interest_source_revision": "d-1",
        "interest_willingness": "DECLINES", "interest_outside_option": "OUTSIDE_PREFERRED",
    })
    assert assess_principal(state, {}, "a", "w1",
                            modeled_outside_position="COOPERATION_PREFERRED")["assessment"] == "INDEPENDENT_DECLINE"
