"""R2.4: one SAME original cash row has one network-wide posting date.

Source-qualified, MODEL_ONLY coherent network settlement trajectory supplements
owner-adverse due-date stress; it NEVER legalizes overdue obligations.
"""
from copy import deepcopy

from research.akis.qualitative_mesa.economic_flow import evaluate_economic_claims
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_liquidity_mesa_integration import case, subject_state, work_state
from .test_rules import fixture as akis_fixture


def calc(data):
    return evaluate_economic_claims(data, subject_state(), work_state())


def test_same_original_internal_transfer_posts_once_for_both_network_parties():
    d=case()
    d["cash_timing"]["transfer_windows"][1]["late_at"]=7  # b -> op
    result=calc(d)
    projection=result["cash_timing"]["joint_network_settlement"]
    path=projection["scenarios"]["COOPERATION"]
    assert path["status"]=="SOURCE_DECLARED_JOINT_SETTLEMENT_ARITHMETIC_ONLY"
    assert path["internal_original_transfer_count"]==2
    assert path["original_transfer_count"]==4
    assert path["internal_cash_nets_to_zero_at_every_tick"] is True
    assert path["sum_owner_cash_changes_equals_original_external_cash_at_every_tick"] is True
    assert path["expected_original_external_cash_delta"]=="270.00"
    assert path["late_original_external_cash_delta"]=="270.00"
    owner=path["per_original_owner_private_research_projection"]
    op=owner["op"]
    assert op["joint_posted_late_case"]["status"]=="SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    assert op["joint_posted_late_case"]["minimum_before_unverified_same_tick_inflows"]=="-80.00"
    b=owner["b"]
    assert b["joint_posted_late_case"]["minimum_before_unverified_same_tick_inflows"]=="0.00"
    # Joint posting delays b's actual cash outflow, but contractual duty at
    # original time remains: owner-private stress can still reveal a gap.
    b_due=result["cash_timing"]["per_original_owner_private_research_projection"]["b"]
    assert b_due["scenario_paths"]["COOPERATION"]["declared_late_case"]["minimum_before_unverified_same_tick_inflows"]=="-120.00"
    assert projection["joint_posting_does_not_reschedule_original_legal_due_dates"] is True
    assert projection["individual_due_date_stress_remains_independently_required"] is True
    assert projection["bank_settlement_or_legal_extension_verified"] is False
    assert result["profit"]=="UNKNOWN"
    assert result["consolidated_external_cash_from_claims"]["COOPERATION"]=="270.00"


def test_independent_alternative_calculated_on_its_own_network_clock():
    d=case()
    result=calc(d)["cash_timing"]["joint_network_settlement"]
    sc=result["scenarios"]["INDEPENDENT_ALTERNATIVE"]
    assert sc["status"]=="SOURCE_DECLARED_JOINT_SETTLEMENT_ARITHMETIC_ONLY"
    assert sc["internal_original_transfer_count"]==0
    assert sc["expected_original_external_cash_delta"]=="145.00"
    assert sc["late_original_external_cash_delta"]=="145.00"
    assert result["network_comparability"]=="OUTSIDE_OPTION_NOT_SOURCE_QUALIFIED_FOR_EVERY_OWNER"
    d["outside_feasibility"]["op"]={"state":"FEASIBLE_DECLARED","source":"o1"}
    complete=calc(d)["cash_timing"]["joint_network_settlement"]
    assert complete["network_comparability"]=="TWO_DECLARED_NETWORK_SETTLEMENT_SCOPES_NOT_CAUSAL_VALUE"


def test_network_missing_original_position_or_timing_remains_unknown_not_zero():
    d=case()
    d["cash_timing"]["owner_positions"].pop()
    first=calc(d)["cash_timing"]["joint_network_settlement"]
    assert first["scenarios"]["COOPERATION"]["status"]=="NETWORK_JOINT_SETTLEMENT_SCOPE_INCOMPLETE"
    assert "per_original_owner_private_research_projection" not in first["scenarios"]["COOPERATION"]
    assert first["scenarios"]["COOPERATION"]["missing_original_owner_positions_count"]==1
    d=case()
    d["cash_timing"]["transfer_windows"].pop(1)
    second=calc(d)["cash_timing"]["joint_network_settlement"]
    assert second["scenarios"]["COOPERATION"]["status"]=="NETWORK_JOINT_SETTLEMENT_SCOPE_INCOMPLETE"
    assert second["scenarios"]["COOPERATION"]["missing_original_transfer_windows_count"]==1
    assert "per_original_owner_private_research_projection" not in second["scenarios"]["COOPERATION"]
    assert second["network_comparability"]=="INCOMPLETE_NETWORK_SETTLEMENT_SCOPE"


def test_network_settlement_order_invariant_and_original_money_unchanged():
    d=case()
    expected=calc(deepcopy(d))
    d["cash_timing"]["transfer_windows"].reverse()
    d["cash_timing"]["owner_positions"].reverse()
    observed=calc(d)
    assert observed==expected
    assert observed["cash_timing"]["original_money_and_resource_uses_unchanged"]
    assert observed["cash_timing"]["joint_network_settlement"]["no_extra_cash_or_financing_created"]
    assert observed["cash_timing"]["joint_network_settlement"]["same_original_internal_transfer_only_one_joint_date"]


def test_work_result_and_general_nine_component_view_not_granted_new_rights():
    d=akis_fixture()
    d["events"]=[]
    d["economic_claims"]=case()
    d["general_akis"]={
        "configuration":"operator","morphology":[],"goals":[],
        "processes":[],"agents":[],"context_kpb":[],"organizational_code":[],
        "knowledge_journal":[],"economics":[],"lifecycle":[],
    }
    # Generic AKIS fixture may not accept a manually authored blank design.
    # Instead prove original Work/Result states using the economics-only path.
    d.pop("general_akis")
    out=simulate(d)
    assert out["works"]["w1"]["obligation"]=="NOT_ACCEPTED"
    assert out["works"]["w1"]["result"]=="NOT_SUBMITTED"
    assert out["trace"]==[]
    assert out["economics"]["cash_timing"]["joint_network_settlement"]["legal_payment_or_owner_consent_created"] is False
    assert simulate(deepcopy(d))==out
