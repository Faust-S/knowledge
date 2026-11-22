"""M3.3: one original economic ledger -> Work + participant + operator + network."""
from copy import deepcopy
import pytest
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_competence_transfer_mesa import interfirm_case
from .test_economic_flow import fixture as original_money, source
from .test_general_system_mesa_integration import design


def counterfactual_case():
    d=interfirm_case()
    money=original_money()
    money["sources"].append(source("customer-proof","c"))
    for sc in ("COOPERATION","INDEPENDENT_ALTERNATIVE"):
        money["coverage"][sc]["c"]="customer-proof"
    money["outside_feasibility"]["c"]={"state":"FEASIBLE_DECLARED","source":"customer-proof"}
    money["outside_feasibility"]["op"]={"state":"FEASIBLE_DECLARED","source":"o1"}
    for record in money["transfers"]+money["resource_uses"]:
        record["work"]="w2"
    money["lifecycle_costs"]={
        "bindings":[
            {"resource_use_id":"c1","owner":"op","source":"o1",
             "stage":"ONBOARDING_AND_INTEGRATION","nature":"SHARED_OPERATOR_CAPABILITY"},
            {"resource_use_id":"c2","owner":"a","source":"a1",
             "stage":"LEARNING_AND_REUSE","nature":"TRANSACTION"},
        ],
        "scope_proofs":{
            "COOPERATION":{"a":"a1","b":"b1","op":"o1","c":"customer-proof"},
            "INDEPENDENT_ALTERNATIVE":{"a":"a1","b":"b1","op":"o1","c":"customer-proof"},
        }
    }
    money["modern_cost_bindings"]=[
        {"owner":"op","category":"human_reviewer_training","resource_use_id":"c1","source":"o1"},
        {"owner":"a","category":"interoperability_and_semantics","resource_use_id":"c2","source":"a1"},
    ]
    d["economic_claims"]=money
    sources={"a":"a1","b":"b1","op":"o1","c":"customer-proof"}
    owner_proofs={}
    for sc in ("COOPERATION","INDEPENDENT_ALTERNATIVE"):
        owner_proofs[sc]={}
        for owner, proof in sources.items():
            transfers=[v for v in money["transfers"] if v["scenario"]==sc and
                       owner in (v["payer"],v["payee"])]
            uses=[v for v in money["resource_uses"] if v["scenario"]==sc and
                  v["owner"]==owner]
            owner_proofs[sc][owner]={
                "source":proof,"complete":True,
                "declared_zero_cash":not bool(transfers),
                "declared_zero_noncash":not bool(uses),
            }
    d["work_counterfactuals"]=[{
        "work":"w2","reuse_claim":"reuse-1","comparison_source":"customer-proof",
        "equivalence":{"deliverable":True,"quantity":True,"quality":True,
                       "risk":True,"horizon":True},
        "owner_scope":owner_proofs,
    }]
    d["general_akis"]=design()
    return d


def test_work_scoped_comparison_separates_individual_operator_network():
    d=counterfactual_case()
    out=simulate(d)
    assert out["counts"]["blocked"]==0,out["trace"]
    view=out["work_counterfactual_dynamics"]
    assert view["declared_comparable_work_count"]==1
    w=view["works"][0]
    assert w["status"]=="DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
    assert w["network_declared_external_cash_difference"]=="125.00"
    owners=w["per_original_owner"]
    assert owners["b"]["declared_work_cash_difference_cooperation_minus_alternative"]=="15.00"
    assert owners["op"]["declared_work_cash_difference_cooperation_minus_alternative"]=="40.00"
    assert owners["a"]["declared_work_cash_difference_cooperation_minus_alternative"]=="70.00"
    assert owners["c"]["declared_work_cash_difference_cooperation_minus_alternative"]=="0.00"
    assert owners["op"]["declared_work_noncash_cost_difference_separate_from_cash"]=="15.00"
    assert w["operator_owner_ids"]==["op"]
    assert w["per_scenario"]["COOPERATION"]["original_work_internal_transfer_count"]==2
    assert w["per_scenario"]["COOPERATION"]["owners"]["op"][
        "historical_nine_onboarding_categories_with_bound_rows"]==["human_reviewer_training"]
    assert view["actual_profit"]=="UNKNOWN"
    assert view["cash_and_resource_use_not_added_twice"]
    assert out["economics"]["profit"]=="UNKNOWN"
    assert out["general_akis_model"]["work_counterfactual_feedback"]["declared_arithmetic_eligible_work_count"]==1
    assert simulate(deepcopy(d))==out


@pytest.mark.parametrize("change,explanation",[
    (lambda d:d["work_counterfactuals"][0]["equivalence"].update(quality=False),
     "COMPARABLE_QUANTITY_QUALITY_RISK_SCOPE_NOT_DECLARED"),
    (lambda d:d["work_counterfactuals"][0]["owner_scope"]["COOPERATION"].pop("op"),
     "ORIGINAL_OWNER_WORK_COST_SCOPE_NOT_COMPLETE_DECLARED"),
    (lambda d:d["work_counterfactuals"][0]["owner_scope"]["INDEPENDENT_ALTERNATIVE"]["c"].update(declared_zero_cash=False),
     "ZERO_CASH_NOT_OWNER_ATTESTED"),
    (lambda d:d["economic_claims"]["resource_uses"][0].update(work=None),
     "COMMON_NONCASH_COST_NOT_ATTRIBUTED_TO_WORK"),
    (lambda d:d["economic_claims"].pop("lifecycle_costs"),
     "WORK_COST_NOT_LIFECYCLE_CLASSIFIED"),
    (lambda d:d["economic_claims"]["outside_feasibility"]["op"].update(state="UNKNOWN"),
     "INDEPENDENT_ALTERNATIVE_NOT_FEASIBLE_DECLARED"),
])
def test_missing_comparability_scope_allocation_never_becomes_zero(change,explanation):
    d=counterfactual_case()
    change(d)
    out=simulate(d)["work_counterfactual_dynamics"]["works"][0]
    assert out["status"]=="COUNTERFACTUAL_WORK_SCOPE_NOT_QUALIFIED"
    assert out["network_declared_external_cash_difference"] is None
    reasons=out["global_reasons"][:]
    for party in out["per_scenario"].values():
        for owner in party["owners"].values():
            reasons.extend(owner["reasons"])
    assert explanation in reasons


@pytest.mark.parametrize("change",[
    lambda d:d["work_counterfactuals"][0].update(comparison_source="o1"),
    lambda d:d["work_counterfactuals"][0]["owner_scope"]["COOPERATION"]["a"].update(source="o1"),
    lambda d:d["work_counterfactuals"][0]["equivalence"].update(quality="yes"),
    lambda d:d["work_counterfactuals"][0].update(work="missing"),
])
def test_counterfactual_rejects_unowned_or_malformed_source(change):
    d=counterfactual_case()
    change(d)
    with pytest.raises(ValueError,match="COUNTERFACTUAL"):
        simulate(d)


def test_historical_source_revocation_does_not_delete_money_or_result():
    d=counterfactual_case()
    d["events"].append({"at":23,"action":"source_update","actor":"a",
                        "source":"license-a","new_revision":"lic-2",
                        "status":"UNKNOWN","usable_by":["a"]})
    out=simulate(d)
    view=out["work_counterfactual_dynamics"]["works"][0]
    assert view["status"]=="COUNTERFACTUAL_WORK_SCOPE_NOT_QUALIFIED"
    assert "REUSE_SEQUENCE_OR_OWNER_PERMISSION_NOT_QUALIFIED" in view["global_reasons"]
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"]=="270.00"


def test_work_counterfactual_does_not_assume_reuse_or_new_result():
    d=counterfactual_case()
    d["work_counterfactuals"][0]["reuse_claim"]=None
    del d["competence_reuse_permissions"]
    del d["competence_reuse_evidence"]
    out=simulate(d)
    assert out["work_counterfactual_dynamics"]["works"][0]["network_declared_external_cash_difference"]=="125.00"
    assert "competence_reuse_dynamics" not in out
    assert out["work_counterfactual_dynamics"]["causal_transaction_savings"]=="NOT_IDENTIFIABLE"
