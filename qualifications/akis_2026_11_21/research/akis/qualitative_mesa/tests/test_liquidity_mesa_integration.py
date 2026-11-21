"""M2 AKIS liquidity research: expected dates, declared delay and owner rights."""
from __future__ import annotations
from copy import deepcopy
import pytest
from research.akis.qualitative_mesa.economic_flow import EconomicInputError, evaluate_economic_claims
from research.akis.qualitative_mesa.modern_economic_evidence import modern_economic_review
from .test_economic_flow import fixture as base, subject_state, work_state
from .test_rules import fixture as akis_fixture

def schedule():
    return {
        "horizon_end": 10,
        "owner_positions": [
            {"owner": "b", "source": "b1", "opening_cash": "0.00", "reserve_cash": "0.00"},
            {"owner": "a", "source": "a1", "opening_cash": "20.00", "reserve_cash": "0.00"},
            {"owner": "op", "source": "o1", "opening_cash": "0.00", "reserve_cash": "0.00"},
        ],
        "transfer_windows": [
            {"transfer_id": "t1", "at": 4, "late_at": 6, "owner_sources": {"b": "b1"}},
            {"transfer_id": "t2", "at": 1, "owner_sources": {"b": "b1", "op": "o1"}},
            {"transfer_id": "t3", "at": 2, "owner_sources": {"op": "o1", "a": "a1"}},
            {"transfer_id": "t4", "at": 3, "owner_sources": {"op": "o1"}},
            {"transfer_id": "t5", "at": 0, "owner_sources": {"b": "b1"}},
            {"transfer_id": "t6", "at": 2, "owner_sources": {"b": "b1"}},
            {"transfer_id": "t7", "at": 3, "owner_sources": {"a": "a1"}},
        ],
    }

def evaluate(d):
    return evaluate_economic_claims(d, subject_state(), work_state())

def case():
    d=base()
    d["cash_timing"]=schedule()
    return d

def test_cash_profit_does_not_prove_liquidity():
    e=evaluate(case())
    assert e["per_subject"]["b"]["cash_difference_cooperation_minus_outside"]=="15.00"
    b=e["cash_timing"]["per_original_owner_private_research_projection"]["b"]
    assert b["status"]=="DECLARED_LIQUIDITY_GAP_IN_ONE_OR_MORE_CASES"
    assert b["scenario_paths"]["COOPERATION"]["expected"]["minimum_before_unverified_same_tick_inflows"]=="-120.00"
    assert e["cash_timing"]["no_invented_credit_or_finance_cost"]
    assert e["profit"]=="UNKNOWN"

def test_declared_payment_delay_changes_liquidity_not_cash_or_resource_cost():
    d=case()
    old=evaluate(d)
    d["cash_timing"]["transfer_windows"][0]["at"]=0
    new=evaluate(d)
    coop=new["cash_timing"]["per_original_owner_private_research_projection"]["b"]["scenario_paths"]["COOPERATION"]
    assert coop["expected"]["status"]=="SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    assert coop["declared_late_case"]["status"]=="SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    assert old["consolidated_external_cash_from_claims"]==new["consolidated_external_cash_from_claims"]
    assert old["per_subject"]==new["per_subject"]
    assert old["resource_uses_count"]==new["resource_uses_count"]

def test_operator_can_face_cash_gap_while_subcontractors_look_positive():
    d=case()
    d["cash_timing"]["transfer_windows"][1]["at"]=5
    e=evaluate(d)
    view=modern_economic_review(subject_state(),economic_view=e)
    assert view["operator_declared_liquidity_gap_count"]==1
    assert view["operator_perspective"]=="SEPARATE_DECLARED_CASH_NOT_PROOF_OF_SUSTAINABILITY"
    assert view["network_perspective"]=="NOT_IDENTIFIABLE"
    assert view["timed_cash_owner_values_remain_private_not_for_interfirm_publication"]

def test_same_tick_inflow_cannot_fund_prior_outflow_without_sequence_proof():
    d=case()
    for i in (1,2,3):
        d["cash_timing"]["transfer_windows"][i]["at"]=2
    op=evaluate(d)["cash_timing"]["per_original_owner_private_research_projection"]["op"]
    expected=op["scenario_paths"]["COOPERATION"]["expected"]
    assert expected["status"]=="SAME_TICK_SETTLEMENT_ORDER_NOT_QUALIFIED"
    assert expected["minimum_before_unverified_same_tick_inflows"]=="-80.00"
    assert expected["maximum_possible_minimum_if_same_tick_receipts_first"]=="0.00"
    assert op["status"]=="LIQUIDITY_DEPENDS_ON_UNVERIFIED_SAME_TICK_ORDER"

def test_missing_balance_timing_or_coverage_fails_closed_not_zero():
    d=case()
    d["cash_timing"]["owner_positions"].pop(0)
    assert evaluate(d)["cash_timing"]["per_original_owner_private_research_projection"]["b"]["status"]=="INCOMPLETE_LIQUIDITY_EVIDENCE"
    d=case()
    d["cash_timing"]["transfer_windows"].pop(0)
    assert evaluate(d)["cash_timing"]["missing_transfer_window_count"]==1
    d=case()
    del d["coverage"]["COOPERATION"]["b"]
    assert evaluate(d)["cash_timing"]["per_original_owner_private_research_projection"]["b"]["scenario_paths"]["COOPERATION"]["status"]=="FULL_CASH_SCOPE_NOT_SOURCE_DECLARED"

@pytest.mark.parametrize("edit,error",[
    (lambda t:t["transfer_windows"][1]["owner_sources"].pop("op"),"INDEPENDENT_TIMING_ATTESTATIONS_REQUIRED"),
    (lambda t:t["transfer_windows"][1]["owner_sources"].update({"op":"b1"}),"TRANSFER_WINDOW_SOURCE_NOT_OWNER_SCOPED"),
    (lambda t:t["transfer_windows"][1]["owner_sources"].update({"b":"a1"}),"TRANSFER_WINDOW_SOURCE_NOT_OWNER_SCOPED"),
    (lambda t:t["transfer_windows"][0].update({"transfer_id":"missing"}),"UNKNOWN_OR_DUPLICATE_ORIGINAL_TRANSFER_WINDOW"),
    (lambda t:t["transfer_windows"][1].update({"transfer_id":"t1"}),"UNKNOWN_OR_DUPLICATE_ORIGINAL_TRANSFER_WINDOW"),
    (lambda t:t["transfer_windows"][0].update({"at":True}),"INVALID_LIQUIDITY_TIME"),
    (lambda t:t["transfer_windows"][0].update({"late_at":2}),"LATE_DATE_BEFORE_EXPECTED_DATE"),
    (lambda t:t["transfer_windows"][0].update({"at":10000}),"INVALID_LIQUIDITY_TIME"),
    (lambda t:t["owner_positions"][0].update({"opening_cash":"-1"}),"INVALID_LIQUIDITY_AMOUNT"),
    (lambda t:t["owner_positions"][0].update({"source":"a1"}),"LIQUIDITY_POSITION_SOURCE_NOT_OWNER_SCOPED"),
    (lambda t:t["owner_positions"].append(deepcopy(t["owner_positions"][0])),"INVALID_OR_DUPLICATE_LIQUIDITY_OWNER"),
])
def test_invalid_owner_evidence_cannot_create_liquidity_fact(edit,error):
    d=case()
    edit(d["cash_timing"])
    with pytest.raises(EconomicInputError,match=error):
        evaluate(d)

def test_original_transfer_source_cannot_be_silently_replaced():
    d=case()
    d["sources"].append({"id":"b2","owner":"b","reference":"model://b2","revision":"r2"})
    d["cash_timing"]["transfer_windows"][1]["owner_sources"]["b"]="b2"
    with pytest.raises(EconomicInputError,match="ORIGINAL_TRANSFER_SOURCE_MUST_REMAIN_ATTACHED"):
        evaluate(d)

def test_default_input_and_with_timing_keep_same_original_money_and_results():
    old=evaluate(base())
    new=evaluate(case())
    assert {k:v for k,v in new.items() if k!="cash_timing"}==old
    assert new["cash_timing"]["original_transfer_records_referenced"]==7
    assert new["cash_timing"]["stock_of_cash_not_treated_as_network_income"]

def test_native_mesa_original_tasks_remain_unchanged_and_operator_separate():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario=akis_fixture()
    scenario["events"]=[]
    scenario["economic_claims"]=case()
    scenario["modern_economy_review"]=True
    output=simulate(scenario)
    assert output["counts"]=={"applied":0,"blocked":0}
    assert output["works"]["w1"]["obligation"]=="NOT_ACCEPTED"
    assert output["economics"]["cash_timing"]["per_original_owner_private_research_projection"]["b"]["status"]=="DECLARED_LIQUIDITY_GAP_IN_ONE_OR_MORE_CASES"
    assert output["modern_economic_review"]["operator_declared_liquidity_gap_count"]==0
    assert output["modern_economic_review"]["liquidity_proof_from_individual_claims"]=="SOURCE_DECLARED_FORECAST_NOT_REAL_BANK_SOLVENCY"
    assert output["trace"]==[]
    assert simulate(deepcopy(scenario))==output
