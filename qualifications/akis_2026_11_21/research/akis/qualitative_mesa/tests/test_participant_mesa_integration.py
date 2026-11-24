"""Requires official Mesa 3.5.2: unskipped execution is a release prerequisite."""
from __future__ import annotations

from copy import deepcopy

import pytest

mesa = pytest.importorskip("mesa", reason="Official Mesa not available: NOT_RUN, never PASS")

from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_rules import fixture


def assumption(subject: str, *, outside="COOPERATION_PREFERRED", willingness="WILLING"):
    return {"subject": subject, "work": "w1", "source_revision": "d-1", "org_revision": "oc-1",
            "willingness": willingness, "outside_option": outside}


def profiles():
    return [assumption("a"), assumption("b")]


def test_owner_resource_loss_and_restoration_recompute_positions_on_mesa_clock():
    scenario = fixture()
    scenario["decision_profiles"] = profiles()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "resource_status", "actor": "a", "resource": "ra", "availability": "UNAVAILABLE"},
        {"at": 4, "action": "resource_status", "actor": "a", "resource": "ra", "availability": "AVAILABLE"},
    ]
    model = OperatorAKISModel(deepcopy(scenario))
    assert isinstance(model, mesa.Model)
    assert len(model.agents) == 3
    result = model.execute()
    observations = [row for row in result["decision_observations"] if row["subject"] == "a"]
    assert [(row["at"], row["assessment"], row["trigger"]) for row in observations] == [
        (1.0, "CURRENT_AUTHORIZATION_MISSING", "offer"),
        (2.0, "REVIEWABLE_NOT_CONSENTED", "authorize"),
        (3.0, "RESOURCE_NOT_AVAILABLE", "resource_status"),
        (4.0, "REVIEWABLE_NOT_CONSENTED", "resource_status"),
    ]
    assert len(result["decision_observations"]) == 8
    assert all(row["effect"] == "NO_AUTOMATIC_CONSENT" for row in result["decision_observations"])
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert result["counts"] == {"applied": 4, "blocked": 0}
    assert set(result["profit"].values()) == {"UNKNOWN"}
    assert simulate(deepcopy(scenario)) == result


def test_independent_outside_option_prevents_false_unanimity():
    scenario = fixture()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["decision_profiles"] = [assumption("a"), assumption("b", outside="OUTSIDE_PREFERRED")]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    result = simulate(scenario)
    latest = {row["subject"]: row["assessment"] for row in result["decision_observations"]}
    assert latest == {"a": "REVIEWABLE_NOT_CONSENTED", "b": "PREFERS_OUTSIDE_OPTION"}
    assert result["works"]["w1"]["consenting_principals"] == []
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_governance_change_invalidates_earlier_profile_without_reinterpreting_rights():
    scenario = fixture()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    scenario["decision_profiles"] = profiles()
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "change_mode", "actor": "FOUNDERS", "expected_revision": "oc-1", "new_revision": "oc-2", "new_mode": "COLLEGIAL", "authorized_by": ["op", "a", "b"]},
        {"at": 4, "action": "authorize", "actor": "COUNCIL", "work": "w1", "votes": {"a": "YES", "b": "YES"}},
    ]
    result = simulate(scenario)
    latest = {row["subject"]: row["assessment"] for row in result["decision_observations"]}
    assert latest == {"a": "PROFILE_REVISION_STALE", "b": "PROFILE_REVISION_STALE"}
    assert result["works"]["w1"]["authorized"] is True
    assert result["works"]["w1"]["consenting_principals"] == []
    assert result["counts"] == {"applied": 4, "blocked": 0}


def test_requested_work_is_evaluated_after_it_enters_dynamic_portfolio():
    scenario = fixture()
    scenario["resources"][0]["availability"] = "AVAILABLE"
    spec = deepcopy(scenario["works"][0])
    scenario["works"] = []
    scenario["decision_profiles"] = profiles()
    scenario["events"] = [
        {"at": 1, "action": "request", "actor": "b", "work_spec": spec},
        {"at": 2, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 3, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    result = simulate(scenario)
    latest = {row["subject"]: row["assessment"] for row in result["decision_observations"]}
    assert latest == {"a": "REVIEWABLE_NOT_CONSENTED", "b": "REVIEWABLE_NOT_CONSENTED"}
    assert result["decision_observations"][0]["assessment"] == "NO_CURRENT_OFFER"
    assert result["works"]["w1"]["requested_at"] == 1
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_invalid_profile_is_normal_input_error_without_model_execution():
    scenario = fixture()
    scenario["decision_profiles"] = [assumption("a", outside="INVENTED_PROFIT")]
    with pytest.raises(InputError, match="INVALID_OUTSIDE_OPTION"):
        simulate(scenario)


def test_preexisting_scenarios_keep_original_result_shape():
    scenario = fixture()
    scenario["events"] = [{"at": 1, "action": "offer", "actor": "op", "work": "w1"}]
    result = simulate(scenario)
    assert "decision_observations" not in result
    assert "decision_observations_truncated" not in result
