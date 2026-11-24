"""Independent direct contracts use the ORIGINAL native Work and resource rules.

Small sizes are regression witnesses only, not the scale of economic research.
"""
from copy import deepcopy
from decimal import Decimal
import pytest

pytest.importorskip("mesa",reason="Official Mesa 3.5.2 is required")
from research.akis.qualitative_mesa.rules import InputError
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.experiments.export_original_network_direct_control import (
    matched_document, compare_network_without_akis, _fee_interval,
)


def only_decisions():
    d=matched_document(10,1,akis=False,timed_cash=False)
    d.pop("economic_claims")
    d.pop("strict_economic_source_works")
    return d


def event(out,action,work="work-0-00000"):
    return next(r for r in out["trace"] if r["action"]==action and r["work"]==work)


def test_two_independent_executions_same_physical_results_no_operator_in_control():
    report=compare_network_without_akis(10,1,timed_cash=True)
    a,b=report["with_akis"],report["without_akis_direct_contracts"]
    assert a["accepted_results"]==b["accepted_results"]==10
    assert a["capacity_blocked_works"]==b["capacity_blocked_works"]==1
    assert a["original_events"]-b["original_events"]==13*11
    assert b["declared_internal_operator_service_fee_total"]=="0.00"
    assert b["declared_connection_cost"]=="0.00"
    assert b["declared_common_capability_cost"]=="0.00"
    assert b["declared_documentation_resource_cost"]=="1155.00"
    assert a["declared_documentation_resource_cost"]=="627.00"
    assert a["declared_common_capability_cost"]=="150000.00"
    # 60..69 per participant, each once; no fictitious operator in control.
    assert a["declared_connection_cost"]=="645.00"
    assert report["economic_contrast"]["system_declared_increment"]=="-150117.00"
    assert not report["economic_contrast"]["uniform_fee_arithmetic_boundary"]["nonnegative_fee_interval_exists"]
    assert report["profit"]=="UNKNOWN"
    assert report["same_original_needs_resources_results_consents_and_external_cash"]
    for row in report["independent_declared_reserve_contrast"].values():
        assert sum(row[k] for k in ("improved","unchanged","worsened"))==10


def test_service_fee_redistributes_existing_contribution_not_system_value():
    a=compare_network_without_akis(10,1,fee="60.00",timed_cash=False)
    b=compare_network_without_akis(10,1,fee="80.00",timed_cash=False)
    left,right=(r["economic_contrast"] for r in (a,b))
    assert left["system_declared_increment"]==right["system_declared_increment"]
    assert Decimal(right["operator_declared_contribution"])-Decimal(left["operator_declared_contribution"])==200
    assert Decimal(left["enterprise_declared_increment_sum"])-Decimal(right["enterprise_declared_increment_sum"])==200
    keys=("minimum_uniform_fee_for_operator_nonnegative_contribution",
          "maximum_uniform_fee_for_every_enterprise_nonnegative_increment")
    for key in keys:
        assert left["uniform_fee_arithmetic_boundary"][key]==right["uniform_fee_arithmetic_boundary"][key]


def test_independent_local_digital_tools_are_not_forced_to_be_manual_or_expensive():
    report=compare_network_without_akis(10,1,direct_mode="S2",timed_cash=False)
    a,b=report["with_akis"],report["without_akis_direct_contracts"]
    assert a["declared_documentation_resource_cost"]==b["declared_documentation_resource_cost"]
    assert report["economic_contrast"]["system_declared_increment"]=="-150645.00"
    assert not report["economic_contrast"]["operator_and_every_enterprise_nonnegative"]


def test_independent_tool_cost_is_an_explicit_non_cash_row_not_an_invented_fee():
    a=compare_network_without_akis(10,1,direct_mode="S1",direct_tool_cost="12.00",timed_cash=False)
    b=compare_network_without_akis(10,1,direct_mode="S1",direct_tool_cost="0.00",timed_cash=False)
    assert a["without_akis_direct_contracts"]["declared_common_capability_cost"]=="120.00"
    assert Decimal(a["economic_contrast"]["system_declared_increment"])-Decimal(b["economic_contrast"]["system_declared_increment"])==120


@pytest.mark.parametrize("action,actor,reason",[
    ("offer","enterprise-00000","DIRECT_ORIGINAL_SUPPLIER_OFFER_REQUIRED"),
    ("authorize","enterprise-00001","DIRECT_ORIGINAL_BUYER_REVIEW_REQUIRED"),
    ("commit","enterprise-00001","DIRECT_ORIGINAL_BUYER_RECORDING_REQUIRED"),
])
def test_direct_owner_authority_does_not_become_another_operators_mandate(action,actor,reason):
    d=only_decisions()
    row=next(r for r in d["events"] if r["action"]==action and r.get("work")=="work-0-00000")
    row["actor"]=actor
    out=simulate(d)
    assert event(out,action)["reason"]==reason
    assert out["works"]["work-0-00000"]["obligation"]=="NOT_ACCEPTED"


def test_missing_supplier_consent_prevents_direct_commit_despite_buyer_authorization():
    d=only_decisions()
    d["events"]=[r for r in d["events"] if not(
        r["action"]=="consent" and r.get("work")=="work-0-00000"
        and r["actor"]=="enterprise-00002")]
    out=simulate(d)
    assert event(out,"commit")["reason"]=="INDEPENDENT_ACCEPTANCE_MISSING"
    assert out["works"]["work-0-00000"]["result"]=="NOT_SUBMITTED"


def test_direct_commit_requires_exact_independent_source_owners_not_one_buyers_document():
    d=only_decisions()
    rule=next(r for r in d["context_evidence"]["requirements"] if
              r["work"]=="work-0-00000" and r["action"]=="commit")
    rule["sources"]=[x for x in rule["sources"] if x.endswith("enterprise-00000")]
    rule["expected_revisions"]=["source-r1"]
    out=simulate(d)
    assert event(out,"commit")["reason"]=="DIRECT_CONTRACT_ORIGINAL_OWNER_SCOPE_REQUIRED"


def test_direct_offer_requires_current_supplier_source():
    d=only_decisions()
    source=next(r for r in d["context_evidence"]["sources"]
                if r["id"]=="decision-work-0-00000-enterprise-00001")
    source["status"]="UNKNOWN"
    out=simulate(d)
    assert event(out,"offer")["reason"]=="CONTEXT_SOURCE_UNKNOWN"


@pytest.mark.parametrize("fault,reason",[
    ("operator","DIRECT_OWNER_CONTRACTS_NO_OPERATOR_OR_GOVERNING_BODY"),
    ("agent","DIRECT_OWNER_CONTRACTS_AKIS_SERVICES_FORBIDDEN"),
    ("governance_event","DIRECT_OWNER_CONTRACTS_NO_AKIS_GOVERNANCE_EVENT"),
    ("non_strict","DIRECT_OWNER_CONTRACTS_REQUIRE_STRICT_ORIGINAL_CAPACITY_AND_SOURCES"),
])
def test_direct_comparator_cannot_silently_enable_akis(fault,reason):
    d=only_decisions()
    if fault=="operator":
        d["institution"]["operator"]="enterprise-00000"
    elif fault=="agent":
        d["general_akis"]={}
    elif fault=="governance_event":
        d["events"][0]["action"]="formation_confirm"
    else:
        d["context_evidence"]["strict"]=False
    with pytest.raises(InputError,match=reason):
        simulate(d)


@pytest.mark.parametrize("fault,reason",[
    ("wrong_amount","PREPARATION_ACTIVITY_COST_AMOUNT_MISMATCH"),
    ("missing_bindings","DIRECT_CONTRACT_ACTIVITY_COST_BINDINGS_REQUIRED"),
    ("partial_period","DIRECT_OWNER_ECONOMICS_REQUIRES_STRICT_PERIOD_SCOPE"),
])
def test_direct_own_organization_cost_is_not_a_free_unchecked_baseline(fault,reason):
    d=matched_document(10,1,akis=False,timed_cash=False)
    if fault=="wrong_amount":
        next(r for r in d["economic_claims"]["resource_uses"]
             if r["id"].endswith("-direct-documentation"))["amount"]="0.00"
    elif fault=="missing_bindings":
        d["economic_claims"]["lifecycle_costs"].pop("preparation_activity_bindings")
    else:
        d.pop("strict_economic_source_works")
    with pytest.raises(InputError,match=reason):
        simulate(d)


def test_fee_boundary_reports_feasible_interval_without_choosing_a_price():
    # Independent exact arithmetic check, not a claim that these are
    # executable household or enterprise market prices.
    av={"net":{"op":Decimal("20"),"a":Decimal("30"),"b":Decimal("15")}}
    bv={"net":{"a":Decimal("10"),"b":Decimal("10")}}
    report=_fee_interval(av,bv,{"a":2,"b":2},Decimal("10"))
    assert report["minimum_uniform_fee_for_operator_nonnegative_contribution"]=="5.00"
    assert report["maximum_uniform_fee_for_every_enterprise_nonnegative_increment"]=="12.50"
    assert report["nonnegative_fee_interval_exists"]
    assert report["declared_fee_inside_interval"]
    assert report["not_a_price_selection_or_legal_offer"]
