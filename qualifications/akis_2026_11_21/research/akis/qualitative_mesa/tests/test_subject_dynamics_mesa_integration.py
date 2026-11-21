"""M1 endogenous principal choice: pure reasoning and native Mesa causal path."""
from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.subject_dynamics import (
    choose_model_action, cooperative_choice_state,
)
from .test_rules import fixture


def test_owner_decline_beats_cooperation_and_never_grants_consents():
    for reason in ("INDEPENDENT_DECLINE", "PREFERS_OUTSIDE_OPTION"):
        out = choose_model_action({"assessment": reason}, configuration="operator")
        assert out["action"] == "DECLINE_NEW_OPPORTUNITY"
        assert out["effect_on_original_rights"] == "NONE"
        assert out["actual_subject_statement"] == "NOT_OBSERVED"


def test_all_six_configurations_have_distinct_research_limitations():
    actions = {key: choose_model_action({"assessment": "REVIEWABLE_NOT_CONSENTED"},
                                         configuration=key)["action"]
               for key in ("operator", "inter", "intra", "sector", "macro", "trace")}
    assert len(set(actions.values())) == 6
    assert all(actions[x].startswith("AWAIT_") for x in ("intra", "sector", "macro", "trace"))


def test_prior_obligation_and_dependent_result_override_new_participation():
    assert choose_model_action({"assessment": "OBLIGATION_ALREADY_COMMITTED"},
                               configuration="macro")["action"] == "HONOR_PRIOR_OBLIGATION"
    assert choose_model_action({"assessment": "REVIEWABLE_NOT_CONSENTED",
                                "execution_gate": "AWAIT_ACCEPTED_RESULT"},
                               configuration="inter")["action"] == "WAIT_FOR_ORIGINAL_PREREQUISITE_RESULT"


def test_collective_candidate_requires_current_independent_principals():
    work = SimpleNamespace(customer="b", resource_requirements=["ra"],
                           source_revision="d-1", obligation="NOT_ACCEPTED",
                           result="NOT_SUBMITTED")
    state = SimpleNamespace(works={"w1": work},
                            capacity_ledger=SimpleNamespace(original_owners=lambda x: {"a"}),
                            institution=SimpleNamespace(revision="oc-1"))
    def row(action):
        return {"action": action, "at": 2.0, "source_trace_position": 1,
                "outlook_epoch": 0, "source_revision": "d-1", "org_revision": "oc-1"}
    positions = {"a": {"w1": row("SEEK_ORIGINAL_INDEPENDENT_REVIEW")},
                 "b": {"w1": row("SEEK_ORIGINAL_INDEPENDENT_REVIEW")}}
    view = cooperative_choice_state(state, positions, "w1",
                                    at=2.0, trace_position=1, outlook_epoch=0)
    assert view["status"] == "UNSIGNED_MULTILATERAL_REVIEW_CANDIDATE"
    positions["b"]["w1"] = row("DECLINE_NEW_OPPORTUNITY")
    view = cooperative_choice_state(state, positions, "w1",
                                    at=2.0, trace_position=1, outlook_epoch=0)
    assert view["status"] == "INDEPENDENT_REFUSAL_PREVENTS_REVIEW_CONSENSUS"
    positions["b"]["w1"]["outlook_epoch"] = 1
    assert cooperative_choice_state(state, positions, "w1",
                                    at=2.0, trace_position=1, outlook_epoch=0)["status"] == "WAIT_FOR_ALL_CURRENT_INDEPENDENT_CHOICES"
    work.obligation = "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert cooperative_choice_state(state, {}, "w1",
                                    at=3.0, trace_position=2, outlook_epoch=0)["status"] == "PRIOR_ORIGINAL_OBLIGATION_PRESERVED"


def _profile(owner, outside="COOPERATION_PREFERRED"):
    return {"subject": owner, "work": "w1", "source_revision": "d-1",
            "org_revision": "oc-1", "willingness": "WILLING", "outside_option": outside}


def test_native_mesa_endogenous_owner_changes_follow_same_clock_and_leave_trace():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["endogenous_subjects"] = True
    scenario["decision_profiles"] = [_profile("a"), _profile("b")]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "resource_status", "actor": "a", "resource": "ra", "availability": "UNAVAILABLE"},
        {"at": 4, "action": "resource_status", "actor": "a", "resource": "ra", "availability": "AVAILABLE"},
    ]
    result = simulate(scenario)
    assert result["counts"] == {"applied": 4, "blocked": 0}
    assert len(result["trace"]) == 4
    assert result["works"]["w1"]["consenting_principals"] == []
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    decisions = result["endogenous_subjects"]["read_only_evolution"]
    statuses = {row["at"]: row["status"] for row in decisions}
    assert statuses[2.0] == "UNSIGNED_MULTILATERAL_REVIEW_CANDIDATE"
    assert statuses[3.0] == "SOURCE_RESOURCE_OR_INSTITUTIONAL_REVIEW_REQUIRED"
    assert statuses[4.0] == "UNSIGNED_MULTILATERAL_REVIEW_CANDIDATE"
    assert result["endogenous_subjects"]["new_original_events_created"] is False
    assert simulate(deepcopy(scenario)) == result


def test_native_mesa_declining_principal_prevents_unsigned_candidate():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["endogenous_subjects"] = True
    scenario["decision_profiles"] = [_profile("a"), _profile("b", "OUTSIDE_PREFERRED")]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    out = simulate(scenario)
    assert out["endogenous_subjects"]["last_jointly_observed"][0]["status"] == "INDEPENDENT_REFUSAL_PREVENTS_REVIEW_CONSENSUS"
    assert out["works"]["w1"]["consenting_principals"] == []
    assert len(out["trace"]) == 2


def test_native_mesa_acceptance_preserves_prior_obligation_in_endogenous_view():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    scenario["endogenous_subjects"] = True
    # The shared fixture does not contain an executed Work by default.
    # Acceptance must come only from original Work actions, not the
    # model-generated independent agent choice.
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 4, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 5, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 6, "action": "start", "actor": "a", "work": "w1"},
        {"at": 7, "action": "complete", "actor": "a", "work": "w1",
         "result_ref": "model://accepted-w1"},
        {"at": 8, "action": "accept", "actor": "b", "work": "w1"},
    ]
    out = simulate(scenario)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["endogenous_subjects"]["last_jointly_observed"][0]["status"] == "PRIOR_ORIGINAL_OBLIGATION_PRESERVED"
    assert out["counts"] == {"applied": 8, "blocked": 0}


def test_invalid_opt_in_fails_closed():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = fixture()
    scenario["endogenous_subjects"] = "yes"
    from research.akis.qualitative_mesa.rules import InputError
    with pytest.raises(InputError, match="ENDOGENOUS_SUBJECTS_MUST_BE_BOOLEAN"):
        simulate(scenario)
