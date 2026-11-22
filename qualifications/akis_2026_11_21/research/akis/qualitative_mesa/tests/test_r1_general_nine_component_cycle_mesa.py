"""R1-G: ONE nine-component AKIS causal sequence, not a fourth economic model.

Original Result -> independent source-declared future need -> later original
customer request is not automatically a new Work or proven endogenous demand.
Original Result -> comparable reuse -> owner adoption -> later accepted Work
is a separate model-qualified reproduction fragment, not proven real learning.
"""
from copy import deepcopy
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_future_need_mesa_integration import setup, future
from .test_general_system_mesa_integration import design, goal
from .test_capability_dynamics_mesa import capability_case


def need_to_next_order_case(*, accept=True, source_at=1, request_actor="b",
                            change_request_scope=False, with_request=True):
    d=setup()
    d["general_akis"]=design()
    d["general_akis"]["goals"]=[goal(2)]
    claim=future(start=source_at,end=12,prereq=[
        {"work":"w1","source_revision":"d-1"}
    ])
    d["future_need_signals"]=[claim]
    d["model_horizon"]=12
    d["events"]=[
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        {"at":3,"action":"consent","actor":"a","work":"w1",
         "source_revision":"d-1","org_revision":"oc-1"},
        {"at":4,"action":"consent","actor":"b","work":"w1",
         "source_revision":"d-1","org_revision":"oc-1"},
        {"at":5,"action":"commit","actor":"op","work":"w1"},
        {"at":6,"action":"start","actor":"a","work":"w1"},
        {"at":7,"action":"complete","actor":"a","work":"w1",
         "result_ref":"model://w1-result"},
    ]
    if accept:
        d["events"].append({"at":8,"action":"accept","actor":"b","work":"w1"})
    if with_request:
        next_work=deepcopy(claim["work_spec"])
        if change_request_scope:
            next_work["slot_start"]=21
        d["events"].append({
            "at":9,"action":"request","actor":request_actor,
            "work_spec":next_work,
        })
    return d


def projection(result):
    return result["general_akis_model"]["system_causal_cycle_feedback"]


def proof(result):
    return result["general_akis_private_cycle_evidence"]


def test_one_original_accepted_result_unlocks_declared_next_need_and_independent_request():
    d=need_to_next_order_case()
    out=simulate(d)
    shared=projection(out)
    private=proof(out)
    assert list(shared["nine_component_model_partially_observed"]) == [
        "Ц","У","А","П","КПБ","ОК","КЖ","Э","ЖЦ"
    ]
    assert shared["original_recipient_accepted_result_event_count"] == 1
    assert shared["original_customer_request_event_count"] == 1
    assert shared["historical_result_to_owner_new_request_model_link_count"] == 1
    assert shared["accepted_follow_on_original_work_link_count"] == 0
    assert shared["owner_declared_result_dependent_future_need_count"] == 1
    assert shared["nine_component_model_partially_observed"]["ЖЦ"] is True
    assert shared["nine_component_model_partially_observed"]["А"] is False
    assert not shared["all_nine_component_original_causal_closure_proven"]
    assert not shared["all_eight_formation_phases_executable"]
    assert not shared["author_agent_A_F_P_OC_KPB_executable"]
    assert not shared["full_real_lifecycle_or_causal_value_added_proven"]
    assert shared["readiness"] == "PARTIAL_ORIGINAL_SYSTEM_CAUSAL_FRAGMENTS_NOT_WHOLE_AKIS"
    row=private["source_declared_follow_on_need_links"][0]
    assert row["original_prerequisite_work_ids"] == ["w1"]
    assert row["later_original_work"] == "w2"
    assert row["original_customer_request_at"] == 9
    assert row["source_active_at_request"]
    assert row["all_prior_results_accepted_before_request"]
    assert row["research_causal_sequence"] == (
        "MODEL_SOURCE_DECLARED_RESULT_TO_LATER_ORIGINAL_CUSTOMER_REQUEST"
    )
    assert not row["later_original_work_accepted"]
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
    assert out["counts"] == {"applied": 9,"blocked": 0}
    assert out["general_akis_model"]["legal_consent_created"] is False
    assert "original_customer_request_at" not in json.dumps(
        out["general_akis_model"], ensure_ascii=False
    )
    assert "later_original_work" not in json.dumps(
        out["general_akis_model"], ensure_ascii=False
    )
    assert out == simulate(deepcopy(d))


@pytest.mark.parametrize("kwargs",[
    {"accept":False},
    {"source_at":10},
    {"request_actor":"a"},
    {"change_request_scope":True},
    {"with_request":False},
])
def test_no_source_complete_result_to_new_customer_request_cannot_be_inferred(kwargs):
    d=need_to_next_order_case(**kwargs)
    out=simulate(d)
    assert projection(out)[
        "historical_result_to_owner_new_request_model_link_count"
    ] == 0
    assert projection(out)[
        "all_nine_component_original_causal_closure_proven"
    ] is False
    assert out["general_akis_model"]["new_agent_runtime_created"] is False


def test_original_owner_adopted_measured_reuse_can_link_a_later_accepted_work():
    d=capability_case()
    out=simulate(d)
    shared=projection(out)
    assert shared["owner_adopted_result_to_future_accepted_work_model_link_count"] == 1
    assert shared["nine_component_model_partially_observed"]["ЖЦ"] is True
    assert shared["all_nine_component_original_causal_closure_proven"] is False
    cap=proof(out)["owner_adopted_capability_reuse_links"][0]
    assert cap["original_resource_owner"] == "b"
    assert cap["adoption_after_prior_accepted_results"]
    assert cap["later_original_accepted_work_ids"] == ["w3"]
    assert cap["model_reproduction_sequence"] == (
        "ORIGINAL_ACCEPTED_RESULT_REUSE_OWNER_ADOPTION_AND_LATER_ACCEPTED_WORK"
    )
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["capability_dynamics"]["original_owner_adopted_count"] == 1
    assert not shared["full_real_lifecycle_or_causal_value_added_proven"]
    assert "capacity-b-1" not in json.dumps(
        out["general_akis_model"], ensure_ascii=False
    )


def test_unauthorized_or_missing_owner_adoption_never_creates_system_reproduction():
    d=capability_case(with_adoption=False,with_commit=False,with_finish=False)
    out=simulate(d)
    shared=projection(out)
    assert shared["owner_adopted_result_to_future_accepted_work_model_link_count"] == 0
    assert not any(
        x["adoption_after_prior_accepted_results"]
        for x in proof(out)["owner_adopted_capability_reuse_links"]
    )
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"


def test_all_six_author_configurations_remain_incomplete_even_when_work_accepted():
    from .test_general_system_mesa_integration import design
    for configuration in ("intra","inter","operator","sector","macro","trace"):
        d=need_to_next_order_case()
        d["general_akis"]=design()
        d["general_akis"]["configuration"]=configuration
        out=simulate(d)
        assert len(projection(out)["nine_component_model_partially_observed"]) == 9
        assert projection(out)["all_nine_component_original_causal_closure_proven"] is False
        assert out["general_akis_model"]["configuration_fully_implemented"] is False


def test_no_general_akis_opt_in_no_new_model_or_private_cycle_observations():
    d=need_to_next_order_case()
    del d["general_akis"]
    out=simulate(d)
    assert "general_akis_model" not in out
    assert "general_akis_private_cycle_evidence" not in out
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
