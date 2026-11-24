"""Native Mesa qualification of the optional source-declared economic contour.

All figures in isolated unit tests are arithmetic inputs, never field data.
Native tests are NOT_RUN when the real Mesa package is absent.
"""
from copy import deepcopy
import json
from pathlib import Path

import pytest

mesa = pytest.importorskip("mesa", reason="Official mesa==3.5.2 not installed: NOT_RUN")
from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_rules import fixture
from .test_economic_flow import fixture as money_claims


def test_native_economics_does_not_create_new_consent_or_profit():
    d = fixture()
    d["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
    ]
    d["economic_claims"] = money_claims()
    model = OperatorAKISModel(deepcopy(d))
    assert isinstance(model, mesa.Model)
    out = model.execute()
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["economics"]["economic_interest"] == "NOT_IDENTIFIABLE"
    assert out["economics"]["consolidated_cash_difference_claimed_scope"] is None
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["consenting_principals"] == []
    assert out["profit"] == {"operator": "UNKNOWN", "participants": "UNKNOWN", "system_increment": "UNKNOWN"}
    assert simulate(deepcopy(d)) == out


def test_native_economic_claims_link_to_dynamically_requested_work_only_after_creation():
    d = fixture()
    work = deepcopy(d["works"][0])
    d["works"] = []
    d["events"] = [{"at": 1, "action": "request", "actor": "b", "work_spec": work}]
    d["economic_claims"] = money_claims()
    out = simulate(d)
    assert out["economics"]["linked_work_result_states"] == {"w1": "NOT_SUBMITTED"}
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_native_economic_claims_refuse_false_document_owner():
    d = fixture()
    d["economic_claims"] = money_claims()
    d["economic_claims"]["transfers"][0]["source"] = "o1"
    with pytest.raises(InputError, match="SOURCE_OWNER_NOT_PARTY"):
        simulate(d)


def test_preexisting_native_mesa_scenario_retains_original_result_shape():
    d = fixture()
    d["events"] = []
    result = simulate(d)
    assert "economics" not in result
    assert result["profit"]["operator"] == "UNKNOWN"


def test_native_entire_portfolio_can_report_unidentified_economics_without_invented_money():
    source = Path(__file__).resolve().parents[1] / "fixtures" / "portfolio_economics_unknown.json"
    with source.open(encoding="utf-8") as handle:
        d = json.load(handle)
    out = simulate(d)
    assert out["counts"] == {"applied": 18, "blocked": 5}
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["economics"]["evidence"] == "MODEL_ONLY"
    assert out["economics"]["source_count"] == 0
    assert out["economics"]["consolidated_scope_complete_declared"] is False
    assert out["economics"]["consolidated_cash_difference_claimed_scope"] is None
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["economics"]["comparative_causal_effect"] == "NOT_IDENTIFIABLE"
    assert out["portfolio"]["institutional_change"] == "NO_AUTOMATIC_CHANGE"
