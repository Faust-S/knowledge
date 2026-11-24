"""Mass organization contract regressions; tiny sizes here are invariant tests.

Production-scale research qualification runs separately at 100..30000
original enterprises, never multiplying these regression outputs.
"""
from copy import deepcopy
from decimal import Decimal
import pytest

pytest.importorskip("mesa", reason="Official Mesa 3.5.2 is required")
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from research.akis.qualitative_mesa.experiments.export_original_network_organization import (
    organization_document, compare_network_modes, run_organization,
)

def test_original_network_mode_comparison_retains_every_owner_and_all_original_costs():
    report=compare_network_modes(10,1)
    assert report["profit"]=="UNKNOWN"
    assert not report["full_without_akis_comparison_qualified"]
    assert set(report["modes"])=={"S0","S1","S2"}
    for row in report["modes"].values():
        assert row["original_subjects"]==11
        assert row["original_works"]==11
        assert row["accepted_results"]==10
        assert row["capacity_blocked_works"]==1
        assert row["applied_original_formation_confirmations"]==121
        assert row["applied_original_independent_customer_reviews"]==11
        assert row["original_common_cost_rows"]==11
        assert row["original_cost_events_source_qualified"]==42
    s2=report["relative_to_S0"]["S2"]
    assert Decimal(s2["declared_preparation_cost_reduction_rub"])==528
    assert Decimal(s2["declared_incremental_platform_cost_rub"])==50000
    assert Decimal(s2["declared_net_cost_reduction_rub"])==-49472
    assert s2["enterprises_unchanged"]==10
    assert s2["enterprises_improved"]==s2["enterprises_worsened"]==0

def test_s2_can_cost_more_even_before_platform_overhead():
    report=compare_network_modes(10,1,agent_fill="8.00",modes=("S0","S2"))
    assert Decimal(report["relative_to_S0"]["S2"]["declared_preparation_cost_reduction_rub"])<0

def test_mass_indexed_work_gates_match_original_six_phase_trace_without_sampling():
    d=organization_document(10,1,"S2",strict_period=False)
    d.pop("economic_claims")
    small=deepcopy(d)
    small.pop("network_scale")
    small.pop("network_observation_ticks")
    mass=simulate(d)
    original=simulate(small)
    for key in ("counts","trace","works","subjects","capacity"):
        assert mass[key]==original[key],key
    assert mass["general_akis_model"]["network_observation_design"][
        "all_original_transition_guards_still_executed"]

@pytest.mark.parametrize("fault",["missing_owner","missing_transfer","missing_common",
                                 "missing_blocked","missing_cost_anchor","foreign_scope"])
def test_incomplete_mass_owner_period_cannot_be_qualified(fault):
    doc=organization_document(10,1)
    money=doc["economic_claims"]
    scope=money["network_period_scope"]
    owner="enterprise-00000"
    if fault=="missing_owner":
        scope["owners"].pop(owner)
    elif fault=="missing_transfer":
        scope["owners"][owner]["transfer_ids"].pop()
    elif fault=="missing_common":
        scope["common_resource_use_ids"].pop()
    elif fault=="missing_blocked":
        scope["uncommitted_works"].pop()
    elif fault=="missing_cost_anchor":
        money["lifecycle_costs"]["event_bindings"].pop()
    else:
        scope["owners"][owner]["source"]=scope["owners"]["op"]["source"]
    with pytest.raises(InputError,match="NETWORK_ORIGINAL_PERIOD_SCOPE_INCOMPLETE"):
        simulate(doc)

def test_network_period_cannot_skip_original_strict_gate():
    d=organization_document(10,1)
    d.pop("strict_economic_source_works")
    with pytest.raises(InputError,match="NETWORK_ORIGINAL_PERIOD_STRICT_SCOPE_REQUIRED"):
        simulate(d)

def test_foreign_or_revoked_source_stops_original_commit_not_other_independent_works():
    d=organization_document(10,1)
    d.pop("economic_claims")
    d.pop("strict_economic_source_works")
    target="conflict-0-00000"
    row=next(r for r in d["context_evidence"]["sources"]
             if r["id"]==f"decision-{target}-enterprise-00000")
    # Isolate the failure to the commitment source, not earlier authorization.
    revoked={**row,"id":row["id"]+"-commit","status":"UNKNOWN"}
    d["context_evidence"]["sources"].append(revoked)
    rule=next(r for r in d["context_evidence"]["requirements"]
              if r["work"]==target and r["action"]=="commit")
    rule["sources"]=[revoked["id"] if key==row["id"] else key for key in rule["sources"]]
    out=simulate(d)
    commit=next(r for r in out["trace"] if r["action"]=="commit" and r["work"]==target)
    assert commit["outcome"]=="BLOCKED"
    assert commit["reason"]=="CONTEXT_SOURCE_UNKNOWN"
    assert sum(w["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT" for w in out["works"].values())==10

def test_missing_independent_customer_review_is_not_filled_by_model_code():
    d=organization_document(10,1)
    d.pop("economic_claims")
    d.pop("strict_economic_source_works")
    target="conflict-0-00000"
    d["events"]=[r for r in d["events"] if not(
        r["action"]=="function_review" and r["work"]==target)]
    out=simulate(d)
    commit=next(r for r in out["trace"] if r["action"]=="commit" and r["work"]==target)
    assert commit["reason"]=="FORMATION_AGENT_ORIGINAL_CUSTOMER_APPROVAL_REQUIRED"
    assert out["works"][target]["obligation"]=="NOT_ACCEPTED"
    assert sum(w["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT" for w in out["works"].values())==10

def test_cost_scope_does_not_turn_missing_or_zero_amount_into_saving():
    d=organization_document(10,1)
    next(row for row in d["economic_claims"]["resource_uses"]
         if row["id"].endswith("-operator-preparation"))["amount"]="0.00"
    with pytest.raises(InputError,match="PREPARATION_ACTIVITY_COST_AMOUNT_MISMATCH"):
        simulate(d)
