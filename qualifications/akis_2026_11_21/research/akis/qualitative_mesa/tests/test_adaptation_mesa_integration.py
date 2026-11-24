"""Require official Mesa 3.5.2; no interface stand-in is a native PASS."""

from copy import deepcopy
from pathlib import Path
import json

import pytest

mesa = pytest.importorskip("mesa", reason="Official Mesa absent: native acceptance NOT_RUN")

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "portfolio_correction_cascade.json"
ECONOMIC_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "portfolio_economics_unknown.json"


def sample_request():
    return {
        "id": "model-process-review-1", "proposed_by": "op",
        "scope": "SERVICE_ADAPTATION", "work": "w1", "basis_at": 14,
        "org_revision": "oc-1", "hypothesis": "Defect in an upstream result may affect downstream work",
        "alternative_explanation": "The simulated rejection may be unrelated to shared organization",
        "affected_principals": ["a", "b"], "source_ids": [],
    }


def test_original_mesa_cascade_generates_review_without_executing_reorganization():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    data["adaptation_requests"] = [sample_request()]
    result = simulate(deepcopy(data))
    assert result["counts"] == {"applied": 18, "blocked": 5}
    assert result["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["institution"]["revision"] == "oc-1"
    assert result["adaptation"]["governance_revision"] == "oc-1"
    assert result["adaptation"]["proposals"][0]["assessment"] == "REVIEWABLE_AS_HYPOTHESIS"
    assert result["adaptation"]["proposals"][0]["authorized_change"] is False
    assert result["adaptation"]["proposals"][0]["causal_attribution"] == "NOT_IDENTIFIABLE"
    assert any(s["signal"] == "RESULT_CORRECTION_REVIEW" for s in result["adaptation"]["review_opportunities"])
    inquiries = result["adaptation"]["event_inquiries"]
    cues = result["portfolio"]["review_cues"]
    assert len(inquiries) == len(cues)
    assert {(v["basis_at"], v["signal"]) for v in inquiries} == {
        (v["at"], v["signal"]) for v in cues
    }
    assert all(v["observation_kind"] == "SIMULATED_ADAPTATION_INQUIRY" for v in inquiries)
    assert all(v["decision"] == "INQUIRY_ONLY_NOT_PROPOSAL" for v in inquiries)
    assert result["profit"]["operator"] == "UNKNOWN"
    assert simulate(deepcopy(data)) == result


def test_economic_unknown_does_not_propose_institutional_change_by_itself():
    data = json.loads(ECONOMIC_FIXTURE.read_text(encoding="utf-8"))
    result = simulate(data)
    assert result["adaptation"]["proposals"] == []
    assert result["adaptation"]["individual_cash_signals"] == []
    assert result["adaptation"]["operator_reproduction"] == "NOT_IDENTIFIABLE"
    assert result["adaptation"]["decision"] == "NO_AUTOMATIC_ORGANIZATIONAL_CHANGE"
    assert result["economics"]["profit"] == "UNKNOWN"
    assert result["institution"]["revision"] == "oc-1"


def test_explicit_valid_governance_action_not_confused_with_model_review():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    data["adaptation_requests"] = [{**sample_request(), "scope": "INSTITUTIONAL_TRANSFORMATION"}]
    data["events"].append({
        "at": 24, "action": "change_mode", "actor": "FOUNDERS",
        "expected_revision": "oc-1", "new_revision": "oc-2", "new_mode": "COLLEGIAL",
        "authorized_by": ["op", "a", "b"],
    })
    result = simulate(data)
    assert result["institution"]["revision"] == "oc-2"
    request = result["adaptation"]["proposals"][0]
    assert request["authorized_change"] is False
    assert "STALE_ORGANIZATIONAL_CODE" in request["unresolved_flags"]
    assert request["decision_route"]["current_revision"] == "oc-2"
    assert result["works"]["w1"]["obligation"] == "FULFILLED"
    assert result["works"]["w2"]["obligation"] == "FULFILLED"


def test_undocumented_economic_proposal_source_refused_even_after_portfolio_run():
    data = json.loads(ECONOMIC_FIXTURE.read_text(encoding="utf-8"))
    data["adaptation_requests"] = [{**sample_request(), "source_ids": ["nonexistent-ledger"]}]
    with pytest.raises(InputError, match="UNDECLARED_REVIEW_SOURCE"):
        simulate(data)


def test_legacy_scenario_without_economics_or_review_keeps_shape():
    from .test_rules import fixture
    data = fixture()
    data["events"] = [{"at": 1, "action": "offer", "actor": "op", "work": "w1"}]
    result = simulate(data)
    assert "adaptation" not in result
    assert "economics" not in result
    assert "portfolio" not in result
