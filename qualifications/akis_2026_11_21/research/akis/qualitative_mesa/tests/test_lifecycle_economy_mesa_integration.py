"""Full AKIS life-cycle transaction costs: source scope, outside, no second ledger."""
from copy import deepcopy
import pytest
from research.akis.qualitative_mesa.economic_flow import EconomicInputError, evaluate_economic_claims
from research.akis.qualitative_mesa.modern_economic_evidence import modern_economic_review
from .test_economic_flow import fixture as base, subject_state, work_state
from .test_rules import fixture as akis_fixture

def claims():
    d=base()
    d["lifecycle_costs"]={
        "bindings":[
            {"resource_use_id":"c1","owner":"op","source":"o1",
             "stage":"SECURITY_DATA_AND_AI_GOVERNANCE","nature":"DATA_SECURITY_GOVERNANCE"},
            {"resource_use_id":"c2","owner":"a","source":"a1",
             "stage":"ONBOARDING_AND_INTEGRATION","nature":"TRANSACTION"},
        ],
        "scope_proofs":{
            "COOPERATION":{"a":"a1","b":"b1","op":"o1"},
            "INDEPENDENT_ALTERNATIVE":{"a":"a1","b":"b1","op":"o1"},
        },
    }
    return d

def run(f):
    return evaluate_economic_claims(f,subject_state(),work_state())

def test_full_stage_catalog_and_owner_scoped_non_cash_comparison_not_profit():
    old=run(base())
    new=run(claims())
    lifecycle=new["lifecycle_resource_costs"]
    assert len(lifecycle["stages"])==13
    assert len(lifecycle["natures"])==5
    assert lifecycle["original_record_count"]==2
    assert lifecycle["classified_original_record_count"]==2
    assert lifecycle["unclassified_original_record_count"]==0
    assert lifecycle["owner_scoped_details"]["a"]["scenarios"]["COOPERATION"]["noncash_use_by_stage"]["ONBOARDING_AND_INTEGRATION"]=="9.00"
    assert lifecycle["owner_scoped_details"]["a"]["outside_minus_cooperation_noncash_resource_cost"]=="-9.00"
    assert lifecycle["owner_scoped_details"]["op"]["outside_minus_cooperation_noncash_resource_cost"] is None
    assert lifecycle["owner_scoped_details"]["op"]["status"]=="NOT_IDENTIFIABLE_FROM_ORIGINAL_SOURCE_SCOPE"
    assert lifecycle["owner_scoped_details"]["a"]["transaction_saving_causal_effect"]=="NOT_ESTABLISHED"
    assert lifecycle["resource_use_is_not_a_cash_transfer"]
    assert {k:v for k,v in new.items() if k!="lifecycle_resource_costs"}==old

def test_missing_stage_binding_or_source_proof_never_equals_zero_transaction_cost():
    d=claims()
    d["lifecycle_costs"]["bindings"].pop(1)
    lifecycle=run(d)["lifecycle_resource_costs"]
    a=lifecycle["owner_scoped_details"]["a"]
    assert a["scenarios"]["COOPERATION"]["status"]=="UNCLASSIFIED_ORIGINAL_RESOURCE_USES_REMAIN"
    assert a["outside_minus_cooperation_noncash_resource_cost"] is None
    d=claims()
    d["lifecycle_costs"]["scope_proofs"]["COOPERATION"].pop("a")
    a=run(d)["lifecycle_resource_costs"]["owner_scoped_details"]["a"]
    assert a["scenarios"]["COOPERATION"]["status"]=="SOURCE_SCOPE_PROOF_MISSING"
    assert a["outside_minus_cooperation_noncash_resource_cost"] is None

@pytest.mark.parametrize("change,error", [
    (lambda x:x["bindings"][0].update({"owner":"b"}),"LIFECYCLE_ORIGINAL_OWNER_SOURCE_MISMATCH"),
    (lambda x:x["bindings"][0].update({"source":"a1"}),"LIFECYCLE_ORIGINAL_OWNER_SOURCE_MISMATCH"),
    (lambda x:x["bindings"][0].update({"resource_use_id":"t1"}),"LIFECYCLE_REFERENCE_NOT_IN_ORIGINAL_RESOURCE_LEDGER"),
    (lambda x:x["bindings"][0].update({"stage":"INVENTED_GAIN"}),"UNKNOWN_LIFECYCLE_STAGE_OR_NATURE"),
    (lambda x:x["bindings"][0].update({"nature":"CASH_PAYMENT"}),"UNKNOWN_LIFECYCLE_STAGE_OR_NATURE"),
    (lambda x:x["bindings"].append(deepcopy(x["bindings"][0])),"DUPLICATE_LIFECYCLE_ORIGINAL_RESOURCE"),
    (lambda x:x["scope_proofs"]["COOPERATION"].update({"op":"a1"}),"LIFECYCLE_SCOPE_SOURCE_NOT_OWNER_QUALIFIED"),
])
def test_original_cost_provenance_refused_on_tampering(change,error):
    d=claims()
    change(d["lifecycle_costs"])
    with pytest.raises(EconomicInputError,match=error):
        run(d)

def test_modern_general_review_discloses_counts_not_private_original_costs():
    eco=run(claims())
    out=modern_economic_review(subject_state(),economic_view=eco)
    assert out["lifecycle_stages_defined"]==13
    assert out["lifecycle_original_records_classified"]==2
    assert out["lifecycle_owner_declared_comparison_count"]==2
    assert out["lifecycle_resource_cost_arithmetic_is_not_causal_economy"]
    assert out["real_world_causal_savings"]=="NOT_ESTABLISHED"
    assert "9.00" not in str(out["lifecycle_original_records_classified"])

def test_stage_classification_can_coexist_with_modern_cost_tag_without_double_counting():
    d=claims()
    d["modern_cost_bindings"]=[{
        "owner":"a","category":"training","resource_use_id":"c2","source":"a1",
    }]
    eco=run(d)
    assert eco["modern_cost_attribution"]["distinct_original_resource_use_references"]==1
    assert eco["lifecycle_resource_costs"]["classified_original_record_count"]==2
    assert eco["resource_uses_count"]==2
    assert eco["consolidated_external_cash_from_claims"]["COOPERATION"]=="270.00"
    assert eco["lifecycle_resource_costs"]["same_resource_may_be_tagged_elsewhere_but_not_added_again"]

def test_native_mesa_end_to_end_lifecycle_and_liquidity_optional_but_no_original_work_change():
    pytest.importorskip("mesa")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario=akis_fixture()
    scenario["events"]=[]
    scenario["modern_economy_review"]=True
    scenario["economic_claims"]=claims()
    output=simulate(scenario)
    assert output["counts"]=={"applied":0,"blocked":0}
    assert output["works"]["w1"]["obligation"]=="NOT_ACCEPTED"
    assert output["economics"]["profit"]=="UNKNOWN"
    assert output["modern_economic_review"]["lifecycle_stages_defined"]==13
    assert output["modern_economic_review"]["network_perspective"]=="NOT_IDENTIFIABLE"
    assert output["trace"]==[]
    assert output==simulate(deepcopy(scenario))
