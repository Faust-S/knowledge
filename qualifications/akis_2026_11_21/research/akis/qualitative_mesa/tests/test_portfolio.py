"""Pure AKIS portfolio invariants independent of Mesa installation."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.portfolio import (
    PortfolioInputError, parse_dependencies, validate_dependency_graph,
    readiness, review_cues, portfolio_view,
)


def w(*, needs=(), result="NOT_SUBMITTED"):
    return SimpleNamespace(requires_accepted=tuple(needs), result=result)


def event(action, *, outcome="BLOCKED", reason="DEPENDENCY_AWAITING_ACCEPTANCE", at=1, work="w2"):
    return {"action": action, "outcome": outcome, "reason": reason,
            "at": at, "work": work, "resource": None, "org_revision": "oc-1"}


def test_initial_dependency_requires_original_recipient_acceptance():
    works = {"w1": w(result="SUBMITTED"), "w2": w(needs=("w1",))}
    validate_dependency_graph(works)
    assert readiness(works, "w2")["reason"] == "DEPENDENCY_AWAITING_ACCEPTANCE"
    works["w1"].result = "REJECTED"
    assert readiness(works, "w2")["reason"] == "UPSTREAM_RESULT_REJECTED"
    works["w1"].result = "SUBMITTED"
    assert readiness(works, "w2")["reason"] == "DEPENDENCY_AWAITING_ACCEPTANCE"
    works["w1"].result = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert readiness(works, "w2")["reason"] == "NONE"
    assert readiness(works, "w2")["dependency_status"] == "SATISFIED"


@pytest.mark.parametrize("input_value,reason", [
    (None, "INVALID_DEPENDENCY_LIST"),
    ({}, "INVALID_DEPENDENCY_LIST"),
    (["w1", "w1"], "DUPLICATE_DEPENDENCY"),
    (["w2"], "SELF_DEPENDENCY"),
    ([""], "INVALID_DEPENDENCY_WORK_ID"),
    ([3], "INVALID_DEPENDENCY_WORK_ID"),
    ([["w1"]], "INVALID_DEPENDENCY_WORK_ID"),
])
def test_invalid_links_refused_before_execution(input_value, reason):
    with pytest.raises(PortfolioInputError, match=reason):
        parse_dependencies(input_value, "w2")


def test_unknown_work_and_cycle_do_not_form_a_portfolio():
    with pytest.raises(PortfolioInputError, match="DEPENDENCY_WORK_UNKNOWN"):
        validate_dependency_graph({"w1": w(needs=("no-such-work",))})
    with pytest.raises(PortfolioInputError, match="CYCLIC_WORK_DEPENDENCY"):
        validate_dependency_graph({"w1": w(needs=("w2",)), "w2": w(needs=("w1",))})


def test_independent_works_can_progress_when_other_branch_is_blocked():
    works = {"first": w(result="REJECTED"), "blocked": w(needs=("first",)), "free": w()}
    validate_dependency_graph(works)
    assert readiness(works, "blocked")["dependency_status"] == "BLOCKED"
    assert readiness(works, "free")["dependency_status"] == "SATISFIED"


@pytest.mark.parametrize("reason,signal", [
    ("DEPENDENCY_AWAITING_ACCEPTANCE", "PROCESS_DEPENDENCY_REVIEW"),
    ("UPSTREAM_RESULT_REJECTED", "PROCESS_CORRECTION_REVIEW"),
    ("RESOURCE_ALREADY_COMMITTED", "RESOURCE_PORTFOLIO_REVIEW"),
    ("QUORUM_NOT_MET", "GOVERNANCE_PROCEDURE_REVIEW"),
    ("MODE_NOT_SELECTED", "GOVERNANCE_SOURCE_REVIEW"),
])
def test_blocked_events_are_cues_not_new_authorizations(reason, signal):
    items = review_cues([event("start", reason=reason)])
    assert len(items) == 1 and items[0]["signal"] == signal
    assert items[0]["decision"] == "NOT_AUTOMATIC"
    assert items[0]["causal_attribution"] == "NOT_IDENTIFIABLE"


def test_rejection_is_local_correction_not_automatic_institutional_change():
    cues = review_cues([event("reject", outcome="APPLIED", reason="NONE")])
    assert cues[0]["signal"] == "RESULT_CORRECTION_REVIEW"
    assert cues[0]["decision"] == "NOT_AUTOMATIC"


def test_change_mode_records_event_but_does_not_infer_economic_advantage():
    snap = portfolio_view({"w1": w()}, [event("change_mode", outcome="APPLIED", reason="NONE")])
    assert snap["review_cues"][0]["signal"] == "INSTITUTIONAL_CHANGE_RECORDED"
    assert snap["economic_effect"] == "UNKNOWN"
    assert snap["institutional_change"] == "NO_AUTOMATIC_CHANGE"


def test_rejected_corrections_remain_visible_with_separate_work_status():
    works = {"w1": w(result="REJECTED"), "w2": w(needs=("w1",))}
    trace = [event("reject", outcome="APPLIED", reason="NONE", at=8, work="w1"),
             event("start", reason="UPSTREAM_RESULT_REJECTED", at=9)]
    snap = portfolio_view(works, trace)
    assert snap["dependencies"]["w2"]["rejected"] == ["w1"]
    assert [s["signal"] for s in snap["review_cues"]] == [
        "RESULT_CORRECTION_REVIEW", "PROCESS_CORRECTION_REVIEW"]
    assert all(s["evidence"] == "MODEL_ONLY" for s in snap["review_cues"])
