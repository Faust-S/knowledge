"""R2.7B1: original 13-stage lifecycle costs align to APPLIED Work events.

The alignment references the SAME trace and ORIGINAL resource_uses. Neither a
synthetic expense nor an alternative actually executed Work is created.
"""
from copy import deepcopy
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_work_counterfactual_mesa import counterfactual_case
from .test_r2_7_nine_onboarding_work_mesa import allocated_nine_case
from .test_work_assurance_mesa import (
    scenario as quality_case, execution_events, quality_event,
)
from .test_economic_flow import fixture as money_fixture
from .test_general_system_mesa_integration import design


def choose_event(d, action, work="w2", ordinal=0):
    observed = simulate(d)["trace"]
    matches = [(i, e) for i, e in enumerate(observed)
               if e.get("work") == work and e["action"] == action
               and e["outcome"] == "APPLIED"]
    assert len(matches) > ordinal, (action, work, observed)
    return matches[ordinal]


def bind(d, resource="c1", owner="op", action="commit", work="w2", proof=None):
    index, event = choose_event(d, action, work=work)
    original = next(w for w in d["works"] if w["id"] == work)
    return {
        "resource_use_id": resource,
        "work": work, "owner": owner,
        "source": {"op": "o1", "a": "a1", "b": "b1"}[owner],
        "work_source_revision": original["source_revision"],
        "trace_position": index, "at": event["at"],
        "action": action, "org_revision": event["org_revision"],
        "cost_evidence_ref": proof or f"model://{owner}/timed-cost-{resource}",
    }


def case():
    d = counterfactual_case()
    d["economic_claims"]["lifecycle_costs"]["event_bindings"] = [
        bind(d, "c1", "op", "commit"),
        bind(d, "c2", "a", "accept"),
    ]
    return d


def test_timed_original_work_stage_costs_and_operator_distinct_no_double_money():
    d = case()
    out = simulate(d)
    original = out["economics"]["lifecycle_resource_costs"]
    timeline = original["original_work_event_timing"]
    assert timeline["original_lifecycle_timed_record_count"] == 2
    assert timeline["timed_distinct_original_work_count"] == 1
    assert timeline["original_applied_quality_rework_signal_count"] == 0
    assert original["classified_original_record_count"] == 2
    assert len(original["stages"]) == 13
    assert out["economics"]["resource_uses_count"] == 2
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["economics"]["consolidated_external_cash_from_claims"]["COOPERATION"] == "270.00"
    w = out["work_counterfactual_dynamics"]["works"][0]
    op = w["per_scenario"]["COOPERATION"]["owners"]["op"]
    assert op["original_work_model_timed_cost_count"] == 1
    assert op["original_work_costs_without_event_timing"] == []
    assert op["original_work_model_timed_lifecycle_costs"][0]["stage"] == "ONBOARDING_AND_INTEGRATION"
    assert op["original_work_model_timed_lifecycle_costs"][0]["original_cost_slice"] == "15.00"
    assert w["original_work_quality_rejection_or_rework_event_count"] == 0
    assert w["source_declared_rework_noncash_cost_event_binding_count"] == 0
    summary = out["general_akis_model"]
    assert summary["economic_time_and_cost_feedback"][
        "original_work_source_declared_timed_cost_link_count"] == 2
    assert not summary["economic_time_and_cost_feedback"][
        "lifecycle_private_cost_sources_and_event_dates_redisclosed"]
    assert summary["work_counterfactual_feedback"][
        "original_work_timed_rework_cost_work_count"] == 0
    raw = json.dumps(summary)
    assert "timed-cost-c1" not in raw
    assert "original_work_model_timed_lifecycle_costs" not in raw
    assert simulate(deepcopy(d)) == out


def test_missing_timestamp_does_not_delete_original_cost_and_is_unknown_not_zero():
    d = case()
    d["economic_claims"]["lifecycle_costs"]["event_bindings"].pop(1)
    out = simulate(d)
    w = out["work_counterfactual_dynamics"]["works"][0]
    owner_a = w["per_scenario"]["COOPERATION"]["owners"]["a"]
    assert owner_a["original_work_costs_without_event_timing"] == ["c2"]
    assert owner_a["original_work_timed_cost_coverage"] == (
        "PARTIAL_OR_UNKNOWN_ORIGINAL_WORK_EVENT_TIMING"
    )
    assert owner_a["original_work_noncash_resource_uses"] == "9.00"
    assert out["economics"]["resource_uses_count"] == 2


def test_accepted_cooperation_event_does_not_prove_executed_outside_alternative():
    d = allocated_nine_case()
    original = bind(d, "r-coop-interview", "op", "commit")
    outside = bind(d, "r-outside-interview", "op", "commit",
                   proof="model://op/outside-counterfactual-cost")
    d["economic_claims"]["lifecycle_costs"]["event_bindings"] = [original, outside]
    out = simulate(d)
    timed = out["economics"]["lifecycle_resource_costs"]["original_work_event_timing"]
    alt = timed["by_original_work"]["w2"]["per_original_scenario_owner"][
        "INDEPENDENT_ALTERNATIVE"]["op"][0]
    assert alt["outside_option_action_was_not_executed"]
    assert alt["source_declared_noncash_original_work_cost"] == "4.00"
    assert out["work_counterfactual_dynamics"]["works"][0][
        "network_declared_external_cash_difference"] == "125.00"


def test_proven_original_common_work_slice_not_charged_at_full_shared_amount():
    d = allocated_nine_case("0.50")
    d["economic_claims"]["lifecycle_costs"]["event_bindings"] = [
        bind(d, "r-coop-interview", "op", "commit")
    ]
    out = simulate(d)
    item = out["economics"]["lifecycle_resource_costs"][
        "original_work_event_timing"]["by_original_work"]["w2"][
            "per_original_scenario_owner"]["COOPERATION"]["op"][0]
    assert item["source_declared_noncash_original_work_cost"] == "0.50"
    assert out["economics"]["common_work_allocations"][
        "unallocated_remainders"]["r-coop-interview"] == "0.50"
    assert out["work_counterfactual_dynamics"]["works"][0][
        "network_nine_onboarding_noncash_difference_outside_minus_cooperation"] is None


def quality_rework_case():
    d = quality_case()
    d["events"] = execution_events() + [
        quality_event(12, verdict="DOES_NOT_MEET"),
        quality_event(13, criterion_id="documents"),
        {"at":14, "action":"reject","actor":"c","work":"w1"},
        {"at":15, "action":"resubmit","actor":"a","work":"w1",
         "result_ref":"model://final-v2"},
        quality_event(16, result_ref="model://final-v2"),
        quality_event(17, criterion_id="documents", result_ref="model://final-v2"),
        {"at":18,"action":"accept","actor":"c","work":"w1"},
    ]
    d["model_horizon"] = 21
    econ = money_fixture()
    econ["resource_uses"][0]["work"] = "w1"
    econ["resource_uses"][1]["work"] = "w1"
    econ["lifecycle_costs"] = {
        "bindings": [
            {"resource_use_id":"c1","owner":"op","source":"o1",
             "stage":"ONBOARDING_AND_INTEGRATION","nature":"TRANSACTION"},
            {"resource_use_id":"c2","owner":"a","source":"a1",
             "stage":"CLAIMS_AND_REWORK","nature":"DIRECT_RESOURCE"},
        ],
        "scope_proofs": {
            "COOPERATION":{"op":"o1","a":"a1","b":"b1"},
            "INDEPENDENT_ALTERNATIVE":{"op":"o1","a":"a1","b":"b1"},
        },
    }
    d["economic_claims"] = econ
    d["general_akis"] = design()
    return d


def test_quality_rejection_and_resubmission_cost_only_original_source_and_event():
    d = quality_rework_case()
    assert simulate(d)["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    d["economic_claims"]["lifecycle_costs"]["event_bindings"] = [
        bind(d, "c1", "op", "commit", work="w1"),
        bind(d, "c2", "a", "reject", work="w1"),
    ]
    out = simulate(d)
    e = out["economics"]["lifecycle_resource_costs"]["original_work_event_timing"]
    assert e["original_applied_quality_rework_signal_count"] >= 3
    assert e["source_declared_quality_rework_cost_record_count"] == 1
    assert e["by_original_work"]["w1"]["per_original_scenario_owner"][
        "COOPERATION"]["a"][0]["stage"] == "CLAIMS_AND_REWORK"
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["economic_time_and_cost_feedback"][
        "original_work_quality_rework_signal_count"] >= 3


def test_rejection_without_bound_source_does_not_masquerade_as_zero_rework_cost():
    d = quality_rework_case()
    d["economic_claims"]["lifecycle_costs"]["event_bindings"] = []
    out = simulate(d)
    e = out["economics"]["lifecycle_resource_costs"]["original_work_event_timing"]
    assert e["original_applied_quality_rework_signal_count"] >= 3
    assert e["source_declared_quality_rework_cost_record_count"] == 0
    assert e["no_added_money_resource_cost_or_original_event"]
    assert out["economics"]["resource_uses_count"] == 2


@pytest.mark.parametrize("mutate,error", [
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(trace_position=True),
     "LIFECYCLE_TIMED_TRACE_POSITION_INVALID"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(trace_position=999),
     "LIFECYCLE_TIMED_TRACE_POSITION_INVALID"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(action="accept"),
     "LIFECYCLE_TIMED_ORIGINAL_EVENT_ACTION_OR_TIME_MISMATCH"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(at=0),
     "LIFECYCLE_TIMED_ORIGINAL_EVENT_ACTION_OR_TIME_MISMATCH"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(org_revision="fake"),
     "LIFECYCLE_TIMED_ORG_REVISION_MISMATCH"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(work_source_revision="fake"),
     "LIFECYCLE_TIMED_WORK_REVISION_MISMATCH"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(source="a1"),
     "LIFECYCLE_TIMED_OWNER_OR_SOURCE_MISMATCH"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][0].update(cost_evidence_ref="model://a/forged"),
     "LIFECYCLE_TIMED_INDEPENDENT_OWNER_COST_SOURCE_REQUIRED"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"][1].update(cost_evidence_ref="model://op/timed-cost-c1"),
     "LIFECYCLE_TIMED_INDEPENDENT_OWNER_COST_SOURCE_REQUIRED"),
    (lambda d:d["economic_claims"]["lifecycle_costs"]["event_bindings"].append(
         deepcopy(d["economic_claims"]["lifecycle_costs"]["event_bindings"][0])),
     "DUPLICATE_LIFECYCLE_ORIGINAL_WORK_EVENT_COST"),
])
def test_fake_original_event_scope_never_qualifies_timed_cost(mutate,error):
    d = case()
    mutate(d)
    with pytest.raises(InputError,match=error):
        simulate(d)


def test_stage_cannot_be_backdated_to_unrelated_applied_acceptance_action():
    d = case()
    idx, event = choose_event(d,"accept")
    row = d["economic_claims"]["lifecycle_costs"]["event_bindings"][0]
    row.update({"trace_position":idx, "action":"accept",
                "at":event["at"],"org_revision":event["org_revision"]})
    with pytest.raises(InputError,match="LIFECYCLE_TIMED_STAGE_ACTION_CONTRADICTION"):
        simulate(d)


def test_source_only_exit_stage_not_falsely_give_work_event_time():
    d=case()
    d["economic_claims"]["lifecycle_costs"]["bindings"][0]["stage"] = (
        "RENEWAL_EXIT_AND_SWITCHING"
    )
    with pytest.raises(InputError,match="LIFECYCLE_STAGE_HAS_NO_ORIGINAL_WORK_TIME_EVENT"):
        simulate(d)


def test_both_origin_and_scope_mutation_cannot_move_timed_cost_to_different_work():
    d=case()
    d["economic_claims"]["lifecycle_costs"]["event_bindings"][0]["work"]="w1"
    with pytest.raises(InputError,match="LIFECYCLE_TIMED_WRONG_ORIGINAL_WORK"):
        simulate(d)


def test_rejected_blocked_customer_decision_is_not_applied_cost_evidence():
    d = case()
    last = max(e["at"] for e in d["events"])
    d["events"].append({"at":last+1,"action":"accept","actor":"op","work":"w2"})
    d["model_horizon"]=max(d.get("model_horizon", last+2),last+2)
    out=simulate(d)
    assert out["trace"][-1]["outcome"]=="BLOCKED"
    row=d["economic_claims"]["lifecycle_costs"]["event_bindings"][1]
    row.update({"trace_position":len(out["trace"])-1,"action":"accept",
                "at":out["trace"][-1]["at"],
                "org_revision":out["trace"][-1]["org_revision"]})
    with pytest.raises(InputError,match="LIFECYCLE_TIMED_APPLIED_ORIGINAL_WORK_EVENT_REQUIRED"):
        simulate(d)


def test_quality_success_cannot_be_claimed_as_original_failed_result_rework():
    d=quality_rework_case()
    d["economic_claims"]["lifecycle_costs"]["event_bindings"]=[
        bind(d, "c2","a","assess_result_quality",work="w1")
    ]
    row=d["economic_claims"]["lifecycle_costs"]["event_bindings"][0]
    idx,ev=choose_event(d,"assess_result_quality",work="w1",ordinal=1)
    assert ev["quality_verdict"]=="MEETS_DECLARED_REQUIREMENT"
    row.update({"trace_position":idx,"at":ev["at"],
                "org_revision":ev["org_revision"]})
    with pytest.raises(InputError,match="LIFECYCLE_REWORK_REQUIRES_ORIGINAL_FAILURE_OR_CORRECTION"):
        simulate(d)
