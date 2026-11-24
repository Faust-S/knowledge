"""Integration/regression for causally linked works in one AKIS model.

Without installed Mesa, pure source-rule tests still run on the project's source tree.
Native scheduler tests require the genuine pinned mesa==3.5.2 package.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest

from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from .test_rules import fixture

SCENARIO = Path(__file__).resolve().parents[1] / "fixtures" / "portfolio_correction_cascade.json"


def case():
    return json.loads(SCENARIO.read_text(encoding="utf-8"))


def test_cascade_cannot_start_before_original_acceptance_and_can_resume_after_repair():
    raw = case()
    raw.pop("decision_profiles")  # qualitative rule loop without the Mesa adapter
    state = QualitativeAKIS(raw)
    for ev in state.events:
        state.apply(ev, ev["at"])
    result = state.snapshot()
    blocked = [(row["at"], row["reason"]) for row in result["trace"] if row["outcome"] == "BLOCKED"]
    assert blocked == [
        (6, "DEPENDENCY_AWAITING_ACCEPTANCE"),
        (15, "UPSTREAM_RESULT_REJECTED"),
        (16, "CORRECTION_OWNER_OR_REJECTED_RESULT_REQUIRED"),
        (17, "NEW_MODEL_ONLY_EVIDENCE_REQUIRED"),
        (19, "DEPENDENCY_AWAITING_ACCEPTANCE"),
    ]
    assert result["counts"] == {"applied": 18, "blocked": 5}
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["portfolio"]["dependencies"]["w2"]["dependency_status"] == "SATISFIED"
    assert result["portfolio"]["institutional_change"] == "NO_AUTOMATIC_CHANGE"
    assert result["portfolio"]["economic_effect"] == "UNKNOWN"
    assert [row["transition"] for row in result["result_history"]["w1"]] == [
        "complete", "reject", "resubmit", "accept"]
    assert result["result_history"]["w1"][0]["model_ref"] == "model://first"
    assert result["result_history"]["w1"][2]["model_ref"] == "model://revised"
    assert result["evidence"] == "MODEL_ONLY"
    assert set(result["profit"].values()) == {"UNKNOWN"}


def test_missing_dependency_and_cyclic_processes_rejected_before_scheduling():
    d = fixture()
    d["works"][0]["requires_accepted"] = ["missing"]
    with pytest.raises(InputError, match="DEPENDENCY_WORK_UNKNOWN"):
        QualitativeAKIS(d)
    d["works"][0]["requires_accepted"] = ["w2"]
    d["works"].append({"id": "w2", "customer": "b", "resource": "ra", "source_revision": "d-2", "slot_start": 11,
                      "slot_end": 12, "requires_accepted": ["w1"]})
    with pytest.raises(InputError, match="CYCLIC_WORK_DEPENDENCY"):
        QualitativeAKIS(d)


def test_unrelated_portfolio_work_uses_original_execution_route():
    d = fixture()
    d["portfolio_review"] = True
    state = QualitativeAKIS(d)
    assert state.works["w1"].requires_accepted == ()
    state.apply({"actor": "op", "action": "offer", "work": "w1"}, 1)
    assert state.snapshot()["portfolio"]["dependencies"]["w1"]["reason"] == "NONE"


def test_old_result_shape_preserved_if_portfolio_not_requested():
    state = QualitativeAKIS(fixture())
    assert "portfolio" not in state.snapshot()
    assert "result_history" not in state.snapshot()


def test_native_mesa_cascade_and_subject_reactions_follow_original_acceptance():
    mesa = pytest.importorskip("mesa", reason="Mesa 3.5.2 unavailable: NOT_RUN")
    from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
    model = OperatorAKISModel(case())
    assert isinstance(model, mesa.Model)
    result = model.execute()
    assert result["counts"] == {"applied": 18, "blocked": 5}
    observations = [o for o in result["decision_observations"] if o["work"] == "w2" and o["subject"] == "c"]
    assert any(o.get("execution_gate") == "UPSTREAM_RESULT_REJECTED" and o["trigger"] == "reject" for o in observations)
    assert any(o.get("execution_gate") == "DEPENDENCY_AWAITING_ACCEPTANCE" and o["trigger"] == "resubmit" for o in observations)
    assert any(o.get("execution_gate") == "NONE" and o["trigger"] == "accept" for o in observations)
    assert all(o["effect"] == "NO_AUTOMATIC_CONSENT" for o in observations)
    assert result["portfolio"]["institutional_change"] == "NO_AUTOMATIC_CHANGE"
    assert simulate(deepcopy(case())) == result
