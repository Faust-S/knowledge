"""Whole nine-component AKIS research feedback from original dated cash and costs."""
from copy import deepcopy
import pytest
from .test_rules import fixture as akis_fixture
from .test_liquidity_mesa_integration import case as liquidity_claims
from .test_lifecycle_economy_mesa_integration import claims as lifecycle_claims

def test_native_mesa_general_akis_uses_single_ledger_with_no_private_cost_redisclosure():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    from .test_general_system_mesa_integration import design
    scenario=akis_fixture()
    scenario["events"]=[]
    scenario["model_horizon"]=10
    scenario["general_akis"]=design()
    economics=liquidity_claims()
    economics["lifecycle_costs"]=lifecycle_claims()["lifecycle_costs"]
    scenario["economic_claims"]=economics
    scenario["modern_economy_review"]=True
    output=simulate(scenario)
    r=output["general_akis_model"]["economic_time_and_cost_feedback"]
    assert output["general_akis_model"]["schema"]=="AKIS_GENERAL_NINE_COMPONENT_MODEL/0.1"
    assert r["original_ledger"]=="ONE_ECONOMIC_CLAIMS_TRANSFER_AND_RESOURCE_USE_SET"
    assert r["cash_risk_owner_count"]>=1
    assert r["full_lifecycle_stages_in_model"]==13
    assert r["original_cost_records_classified"]==2
    assert r["cost_source_scope_comparable_owner_count"]==2
    assert r["private_owner_cash_and_cost_values"]=="NOT_REDISCLOSED"
    assert r["independent_owner_financial_decision"]=="NOT_AUTHENTICATED"
    assert output["works"]["w1"]["obligation"]=="NOT_ACCEPTED"
    assert output["trace"]==[]
    assert output["general_akis_model"]["legal_consent_created"] is False
    assert simulate(deepcopy(scenario))==output

def test_native_general_system_without_economic_claims_does_not_imply_zero_cost():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    from .test_general_system_mesa_integration import design
    scenario=akis_fixture()
    scenario["events"]=[]
    scenario["general_akis"]=design()
    view=simulate(scenario)["general_akis_model"]
    assert "economic_time_and_cost_feedback" not in view
    assert view["components"]["Э"]["profit"]=="UNKNOWN" if "profit" in view["components"]["Э"] else True
