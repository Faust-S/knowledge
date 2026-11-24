"""Additional regression checks around incomplete and cyclic portfolios."""
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.portfolio import (
    PortfolioInputError, parse_dependencies, readiness,
    validate_dependency_graph, portfolio_view,
)


def w(*, requires=(), result="NOT_SUBMITTED"):
    return SimpleNamespace(requires_accepted=tuple(requires), result=result)


def test_many_to_one_dependency_waits_for_every_original_acceptance():
    d={"a":w(result="ACCEPTED_BY_ORIGINAL_RECIPIENT"),"b":w(result="SUBMITTED"),"c":w(requires=("a","b"))}
    assert readiness(d,"c")["unmet"]==["b"]
    d["b"].result="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert readiness(d,"c")["reason"]=="NONE"


def test_deep_chain_detects_loop_without_topological_guess():
    d={"a":w(requires=("b",)),"b":w(requires=("c",)),"c":w(requires=("a",))}
    with pytest.raises(PortfolioInputError,match="CYCLIC_WORK_DEPENDENCY"):
        validate_dependency_graph(d)


def test_deterministic_view_does_not_rewrite_work_state():
    d={"a":w(result="REJECTED"),"b":w(requires=("a",))}
    original=d["a"].result
    first=portfolio_view(d,[])
    assert first==portfolio_view(d,[])
    assert d["a"].result==original
    assert first["institutional_change"]=="NO_AUTOMATIC_CHANGE"


def test_parse_does_not_normalize_away_ambiguity():
    assert parse_dependencies([],"w2")==()
    assert parse_dependencies(["a","b"],"w3")==('a','b')
    with pytest.raises(PortfolioInputError,match="DUPLICATE_DEPENDENCY"):
        parse_dependencies(["same", "same"],"w3")


def test_principal_assessment_tracks_execution_gate_without_assigning_consent():
    from research.akis.qualitative_mesa.participant_response import assess_principal, parse_profiles
    d = {"a":w(result="REJECTED"),"b":w(requires=("a",))}
    d["a"].resource="r"
    d["a"].customer="customer"
    d["a"].obligation="FULFILLED"
    d["b"].resource="r"
    d["b"].customer="customer"
    d["b"].proposal="OFFERED"
    d["b"].obligation="ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    d["b"].admitted=True
    d["b"].source_revision="d-2"
    d["b"].authorization_org_revision="oc-1"
    state=SimpleNamespace(
        works=d, resources={"r":"supplier"},
        subjects={"customer":SimpleNamespace(active=True),"supplier":SimpleNamespace(active=True)},
        institution=SimpleNamespace(mode="SOLE",revision="oc-1"),
        resource_availability={"r":"AVAILABLE"},resource_availability_origin={"r":"MODEL_INPUT"},
    )
    result=assess_principal(state,{},"supplier","b")
    assert result["assessment"]=="OBLIGATION_ALREADY_COMMITTED"
    assert result["execution_gate"]=="UPSTREAM_RESULT_REJECTED"
    d["a"].result="SUBMITTED"
    assert assess_principal(state,{},"supplier","b")["execution_gate"]=="DEPENDENCY_AWAITING_ACCEPTANCE"
    d["a"].result="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert assess_principal(state,{},"supplier","b")["execution_gate"]=="NONE"
    assert "execution_gate" not in assess_principal(state,{},"supplier","a")
