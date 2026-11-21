"""Real Mesa tests. They must run on Mesa 3.5.2; never replace it with a mock in CI."""

from copy import deepcopy

import pytest

mesa = pytest.importorskip("mesa", reason="Mesa 3.5.2 unavailable in this environment")

from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
from .test_rules import fixture


def test_mesa_uses_real_agent_objects_and_single_scheduler():
    data = fixture()
    data["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "consent", "actor": "a", "work": "w1", "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 4, "action": "consent", "actor": "b", "work": "w1", "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 5, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 6, "action": "start", "actor": "a", "work": "w1"},
        {"at": 7, "action": "complete", "actor": "a", "work": "w1", "result_ref": "model://s1"},
        {"at": 8, "action": "accept", "actor": "b", "work": "w1"},
    ]
    model = OperatorAKISModel(deepcopy(data))
    assert isinstance(model, mesa.Model)
    assert len(model.agents) == 3
    result = model.execute()
    assert result["counts"] == {"applied": 8, "blocked": 0}
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert [row["at"] for row in result["trace"]] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert simulate(deepcopy(data)) == result


def test_mesa_quorum_prevents_execution():
    data = fixture("COLLEGIAL")
    data["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "COUNCIL", "work": "w1", "votes": {"a": "YES"}},
        {"at": 3, "action": "commit", "actor": "op", "work": "w1"},
    ]
    result = simulate(data)
    assert [x["reason"] for x in result["trace"]] == ["NONE", "QUORUM_NOT_MET", "NO_AUTHORIZED_UNCOMMITTED_PROPOSAL"]
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
