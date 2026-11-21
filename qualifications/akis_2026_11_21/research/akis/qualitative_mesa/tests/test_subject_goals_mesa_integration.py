"""AKIS M1.2: source-qualified, non-cardinal multi-goal decisions.

No synthetic monetary advantage, contract, authenticated consent or agency grant.
"""
from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
import pytest

from research.akis.qualitative_mesa.subject_goals import (
    GoalInputError, compare_objectives, evaluate_subject_goals, parse_subject_goals,
)
from research.akis.qualitative_mesa.context_basis import ContextBlocked
from research.akis.qualitative_mesa.rules import InputError
from .test_rules import fixture


def claim(owner="a", start=2, end=4, objectives=None, *, work="w1"):
    return {
        "owner": owner, "work": work, "work_source_revision": "d-1",
        "org_revision": "oc-1", "source_ref": f"model://{owner}/goals-{start}",
        "available_at": start, "expires_at": end,
        "objectives": objectives or {
            "quality": "EQUIVALENT", "liquidity": "COOPERATION_BETTER",
        },
    }


@pytest.mark.parametrize("values,comparison", [
    (("COOPERATION_BETTER", "EQUIVALENT"), "COOPERATION_DOMINATES_DECLARED_CRITERIA"),
    (("OUTSIDE_BETTER", "EQUIVALENT"), "OUTSIDE_DOMINATES_DECLARED_CRITERIA"),
    (("COOPERATION_BETTER", "OUTSIDE_BETTER"), "INCOMPARABLE_OBJECTIVES"),
    (("COOPERATION_BETTER", "UNKNOWN"), "INCOMPLETE_OBJECTIVE_EVIDENCE"),
    (("EQUIVALENT", "EQUIVALENT"), "NO_STRICT_OBJECTIVE_PREFERENCE"),
])
def test_unweighted_pareto_partial_order(values, comparison):
    assert compare_objectives((("quality", values[0]), ("liquidity", values[1]))) == comparison


@pytest.mark.parametrize("change,reason", [
    ({"owner": "outsider"}, "GOAL_OWNER_UNKNOWN"),
    ({"source_ref": "model://other/not-original"}, "OWNER_SCOPED_GOAL_SOURCE_REQUIRED"),
    ({"objectives": {"imaginary_utility": "COOPERATION_BETTER"}}, "UNKNOWN_GOAL_CRITERION_OR_COMPARISON"),
    ({"objectives": {"quality": "PROFIT_GUARANTEED"}}, "UNKNOWN_GOAL_CRITERION_OR_COMPARISON"),
    ({"expires_at": 2}, "INVALID_GOAL_SOURCE_WINDOW"),
    ({"available_at": True}, "INVALID_GOAL_SOURCE_WINDOW"),
    ({"requires_accepted_results": [{"work": "w1", "source_revision": "d-1"}]},
     "INVALID_GOAL_RESULT_REFERENCE"),
])
def test_invalid_principal_claim_is_not_a_choice(change, reason):
    record = claim()
    record.update(change)
    works = {"w1": object(), "prior": object()}
    with pytest.raises(GoalInputError, match=reason):
        parse_subject_goals([record], {"a": object(), "b": object()}, works)


def test_overlapping_owner_sources_are_rejected_not_silently_ranked():
    with pytest.raises(GoalInputError, match="OVERLAPPING_OWNER_GOAL_WINDOWS"):
        parse_subject_goals([claim(start=2, end=5), claim(start=4, end=6)],
                            {"a": object()}, {"w1": object()})


def test_owner_goal_scoping_version_time_and_privacy():
    work = SimpleNamespace(key="w1", source_revision="d-1", result="NOT_SUBMITTED")
    goals = parse_subject_goals([claim()], {"a": object()}, {"w1": work})
    def evaluate(time, rev="oc-1", owners=None):
        return evaluate_subject_goals(goals, owner="a", work=work,
                                      org_revision=rev, at=time, works={"w1": work},
                                      original_owners=owners or {"a", "b"})
    assert evaluate(1)["reason"] == "GOAL_SOURCE_NOT_YET_AVAILABLE"
    assert evaluate(2)["position"] == "COOPERATION_PREFERRED"
    assert evaluate(2)["private_objectives"] == "NOT_REDISCLOSED"
    assert "objectives" not in evaluate(2)
    assert evaluate(4)["reason"] == "GOAL_SOURCE_EXPIRED"
    assert evaluate(3, "oc-2")["reason"] == "STALE_GOAL_SOURCE_OR_ORG_REVISION"
    assert evaluate_subject_goals(goals, owner="a", work=work, org_revision="oc-1",
                                  at=2, works={"w1": work},
                                  original_owners={"b"})["reason"] == "GOAL_NOT_ORIGINAL_PRINCIPAL"


def test_goal_requires_real_original_model_result_not_merely_reported_learning():
    prior = SimpleNamespace(key="old", source_revision="p-1", result="NOT_SUBMITTED")
    work = SimpleNamespace(key="w1", source_revision="d-1", result="NOT_SUBMITTED")
    c = claim()
    c["requires_accepted_results"] = [{"work": "old", "source_revision": "p-1"}]
    works = {"w1": work, "old": prior}
    goals = parse_subject_goals([c], {"a": object()}, works)
    def evaluate():
        return evaluate_subject_goals(goals, owner="a", work=work,
                                      org_revision="oc-1", at=2, works=works)
    assert evaluate()["reason"] == "DEPENDENT_ORIGINAL_RESULT_NOT_ACCEPTED"
    prior.result = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert evaluate()["position"] == "COOPERATION_PREFERRED"
    prior.source_revision = "p-2"
    assert evaluate()["reason"] == "DEPENDENT_ORIGINAL_RESULT_NOT_ACCEPTED"
    prior.source_revision = "p-1"
    prior.result = "REJECTED"
    assert evaluate()["reason"] == "DEPENDENT_ORIGINAL_RESULT_NOT_ACCEPTED"


def test_strict_context_does_not_implicitly_authorize_goal_claims():
    class DeniedContext:
        strict = True
        def assert_allowed(self, work, action, actor, at):
            assert (work, action, actor, at) == ("w1", "interest_update", "a", 2)
            raise ContextBlocked("CONTEXT_USE_NOT_PERMITTED")
    work = SimpleNamespace(key="w1", source_revision="d-1", result="NOT_SUBMITTED")
    goals = parse_subject_goals([claim()], {"a": object()}, {"w1": work})
    result = evaluate_subject_goals(
        goals, owner="a", work=work, org_revision="oc-1", at=2,
        works={"w1": work}, context_basis=DeniedContext(),
    )
    assert result["position"] == "UNKNOWN"
    assert result["reason"] == "GOAL_CONTEXT_CONTEXT_USE_NOT_PERMITTED"


def _profile(subject, outside="UNKNOWN"):
    return {"subject": subject, "work": "w1", "source_revision": "d-1",
            "org_revision": "oc-1", "willingness": "WILLING", "outside_option": outside}


def test_goal_input_requires_explicit_endogenous_mode():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    scenario["subject_goals"] = [claim()]
    with pytest.raises(InputError, match="SUBJECT_GOALS_REQUIRE_ENDOGENOUS_SUBJECTS"):
        simulate(scenario)


def test_native_mesa_goal_conflict_then_comparative_evidence_change_and_expiry():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["endogenous_subjects"] = True
    scenario["decision_profiles"] = [_profile("a"), _profile("b")]
    scenario["subject_goals"] = [
        claim("a", 2, 4, {
            "economic_surplus": "COOPERATION_BETTER",
            "liquidity": "OUTSIDE_BETTER",
        }),
        claim("a", 4, 6, {
            "economic_surplus": "COOPERATION_BETTER",
            "liquidity": "EQUIVALENT",
        }),
        claim("b", 2, 6, {"quality": "COOPERATION_BETTER"}),
    ]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    scenario["model_horizon"] = 6
    result = simulate(scenario)
    phases = {row["at"]: row["status"]
              for row in result["endogenous_subjects"]["read_only_evolution"]}
    assert phases[2.0] == "SOURCE_RESOURCE_OR_INSTITUTIONAL_REVIEW_REQUIRED"
    assert phases[4.0] == "UNSIGNED_MULTILATERAL_REVIEW_CANDIDATE"
    assert phases[6.0] == "SOURCE_RESOURCE_OR_INSTITUTIONAL_REVIEW_REQUIRED"
    observations = [row for row in result["decision_observations"] if row["subject"] == "a"]
    assert any(row.get("endogenous_choice", {}).get("action")
               == "REQUEST_OWNER_MULTI_OBJECTIVE_TRADEOFF_REVIEW" for row in observations)
    assert any(row.get("goal_comparison") == "COOPERATION_DOMINATES_DECLARED_CRITERIA"
               for row in observations)
    assert all(row.get("goal_private_objectives", "NOT_REDISCLOSED")
               == "NOT_REDISCLOSED" for row in observations)
    assert result["counts"] == {"applied": 2, "blocked": 0}
    assert result["works"]["w1"]["consenting_principals"] == []
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert len(result["trace"]) == 2
    assert simulate(deepcopy(scenario)) == result


def test_explicit_original_owner_outside_preference_is_not_overruled():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["endogenous_subjects"] = True
    scenario["decision_profiles"] = [_profile("a"), _profile("b", "OUTSIDE_PREFERRED")]
    scenario["subject_goals"] = [
        claim("a", 2, 5, {"quality": "COOPERATION_BETTER"}),
        claim("b", 2, 5, {"quality": "COOPERATION_BETTER"}),
    ]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    out = simulate(scenario)
    assert out["endogenous_subjects"]["last_jointly_observed"][0]["status"] == (
        "INDEPENDENT_REFUSAL_PREVENTS_REVIEW_CONSENSUS"
    )
    assert out["works"]["w1"]["consenting_principals"] == []
    assert out["endogenous_subjects"]["new_original_events_created"] is False
