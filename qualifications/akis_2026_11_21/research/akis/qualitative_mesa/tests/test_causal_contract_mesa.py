"""R1: author's nine-component and six-edge contract is diagnostic, not a grant.

It must change as the *same* original Work, Result and source economics change,
without adding an actor, contract, finance, task engine, or original Result.
"""
from copy import deepcopy

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_work_counterfactual_mesa import counterfactual_case


EXPECTED = [
    "NEED_CHANGES_PROCESS",
    "AGENT_FUNCTION_IS_DERIVED",
    "SCOPED_RESOURCES_NEED_OWNER_CONFIRMATION",
    "WORK_AND_ACCEPTANCE_ARE_SEPARATE_OWNER_EVENTS",
    "REAL_EVENTS_SUPPORT_SPECIFIC_ECONOMIC_OBSERVATIONS",
    "PROPOSE_REVISION_NOT_AUTOMATIC_OVERRIDE_OF_OWNERS",
]


def test_author_six_edges_diagnose_original_mesa_and_original_work_economics():
    d=counterfactual_case()
    before=deepcopy(d)
    result=simulate(d)
    assert d==before
    v=result["general_akis_model"]["author_causal_dependency_diagnostics"]
    edges=v["six_author_original_dependency_relations"]
    assert [e["meaning"] for e in edges] == EXPECTED
    assert v["author_original_nine_components"] == [
        "Ц","У","А","П","КПБ","ОК","КЖ","Э","ЖЦ"
    ]
    assert edges[1]["real_A_equals_F_P_OK_KPB_qualified"] is False
    assert edges[3]["status"] == "MODEL_ACCEPTED_ORIGINAL_RESULT_WITH_SEPARATE_OWNER_ACTION"
    assert edges[4]["status"] == "MODEL_WORK_ARITHMETIC_NOT_REAL_ECONOMIC_CAUSALITY"
    assert v["nine_component_causal_closure_scientifically_proved"] is False
    assert result["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["economics"]["profit"]=="UNKNOWN"
    assert simulate(deepcopy(d))==result


def test_weakening_original_cost_evidence_changes_economic_edge_not_history():
    d=counterfactual_case()
    d["work_counterfactuals"][0]["equivalence"]["quality"]=False
    out=simulate(d)
    v=out["general_akis_model"]["author_causal_dependency_diagnostics"]
    edges=v["six_author_original_dependency_relations"]
    assert edges[4]["status"]=="WORK_SPECIFIC_REAL_COST_AND_RESULT_NOT_QUALIFIED"
    assert edges[4]["model_comparable_work_arithmetic"] is False
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert v["nine_component_causal_closure_scientifically_proved"] is False


def test_without_original_economics_no_fake_causal_gain():
    d=counterfactual_case()
    del d["economic_claims"]
    del d["work_counterfactuals"]
    out=simulate(d)
    relation=out["general_akis_model"]["author_causal_dependency_diagnostics"][
        "six_author_original_dependency_relations"][4]
    assert relation["status"]=="WORK_SPECIFIC_REAL_COST_AND_RESULT_NOT_QUALIFIED"
    assert relation["original_economic_records_present"] is False
    assert out["general_akis_model"]["readiness"]!="FULL_SCIENTIFIC_AKIS"


def test_no_delegation_or_original_goal_created_by_relational_review():
    d=counterfactual_case()
    d["general_akis"]["goals"]=[]
    out=simulate(d)
    v=out["general_akis_model"]["author_causal_dependency_diagnostics"]
    assert v["six_author_original_dependency_relations"][0]["status"]=="MODEL_GOAL_TO_REQUEST_NOT_OBSERVED"
    assert v["original_owner_decisions_not_synthesized"] is True
    assert v["software_delegation_A_still_absent"] is True
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_original_author_relation_catalog_unchanged_and_no_new_agent():
    d=counterfactual_case()
    out=simulate(d)
    v=out["general_akis_model"]["author_causal_dependency_diagnostics"]
    assert len(v["six_author_original_dependency_relations"])==6
    assert v["outside_w_t_market_process_not_endogenously_modelled"] is True
    assert v["original_13_OC_and_eight_phases_not_automatically_qualified"] is True
    assert v["technical_modelled_links_not_real_economic_or_institutional_causality"] is True
    assert out["general_akis_model"]["new_agent_runtime_created"] is False


def test_r1_owner_context_economy_link_counts_only_bilateral_model_source_closure():
    from .test_common_cost_allocations_mesa import bilateral_internal_case
    d=bilateral_internal_case()
    out=simulate(d)
    link=out["general_akis_model"]["author_causal_dependency_diagnostics"][
        "six_author_original_dependency_relations"][4]
    assert link["meaning"]=="REAL_EVENTS_SUPPORT_SPECIFIC_ECONOMIC_OBSERVATIONS"
    assert link["status"]=="MODEL_WORK_ARITHMETIC_NOT_REAL_ECONOMIC_CAUSALITY"
    assert link["original_model_payer_payee_common_cash_slices"]==1
    assert link["paired_owner_sources_restrict_work_economic_attribution"] is True
    assert link["bilateral_claims_are_not_verified_real_signatures"] is True
    assert link["original_internal_transfers_are_not_network_value_added"] is True
    assert out["general_akis_model"]["author_causal_dependency_diagnostics"][
        "nine_component_causal_closure_scientifically_proved"] is False
    assert out["economics"]["profit"]=="UNKNOWN"


def _r1h_source_work_fixture():
    """Minimal original-state witness, deliberately not a second Mesa model."""
    from types import SimpleNamespace
    from research.akis.qualitative_mesa.causal_contract import AUTHOR_EDGES

    def work(result):
        return SimpleNamespace(
            customer="b", source_revision="d-1", resource_requirements=(),
            result=result, obligation="FULFILLED",
        )
    original = SimpleNamespace(
        institution=SimpleNamespace(revision="oc-2"),
        works={"w1":work("ACCEPTED_BY_ORIGINAL_RECIPIENT"),
               "w2":work("SUBMITTED")},
        trace=[
            {"at":2, "action":"request", "actor":"b", "work":"w1",
             "outcome":"APPLIED", "org_revision":"oc-1"},
            {"at":3, "action":"commit", "actor":"op", "work":"w1",
             "outcome":"APPLIED", "org_revision":"oc-1"},
            {"at":4, "action":"accept", "actor":"b", "work":"w1",
             "outcome":"APPLIED", "org_revision":"oc-1"},
        ],
        capacity_ledger=SimpleNamespace(specs={}),
        context_basis=None, model_org_policy=None,
    )
    goal={"owner":"b", "work":"w1", "work_revision":"d-1",
          "revision":"oc-1", "available_at":1, "expires_at":3}
    design=SimpleNamespace(
        catalog={"integrated_operator_model":{
            "dynamics_revision_2026_11_20":{"dependency_relations":[
                {"from":source,"to":target,"meaning":meaning}
                for source,target,meaning in AUTHOR_EDGES
            ]}
        }},
        declarations={"goals":(goal,)},
    )
    components={key:({"bounded_process_computations":0} if key=="А" else {})
                for key in ("Ц","У","А","П","КПБ","ОК","КЖ","Э","ЖЦ")}
    return design,original,{"components":components}


def test_r1h_time_of_request_is_original_not_end_of_simulation():
    from research.akis.qualitative_mesa.causal_contract import assess_author_causal_edges
    design,original,view=_r1h_source_work_fixture()
    out=assess_author_causal_edges(design,original,view,at=20)
    assert out["historical_goal_to_original_request_source_match_count"]==1
    assert out["nine_component_typed_transition_contract"][
        "goal_source_must_be_valid_at_original_request_not_final_snapshot"] is True
    assert [row["component"] for row in out[
        "nine_component_typed_transition_contract"]["components"]] == [
        "Ц","У","А","П","КПБ","ОК","КЖ","Э","ЖЦ"]
    import json
    assert '"source_work_ids"' not in json.dumps(out)
    assert '"accepted_original_result_work_ids"' not in json.dumps(out)


def test_r1h_late_or_unowned_or_wrong_revision_goal_cannot_qualify_original_request():
    from research.akis.qualitative_mesa.causal_contract import assess_author_causal_edges
    from copy import deepcopy
    for mutation in (
        {"available_at":3},
        {"expires_at":2},
        {"revision":"oc-2"},
        {"owner":"op"},
        {"work_revision":"d-old"},
    ):
        design,original,view=_r1h_source_work_fixture()
        goal=deepcopy(design.declarations["goals"][0])
        goal.update(mutation)
        design.declarations["goals"]=(goal,)
        out=assess_author_causal_edges(design,original,view,at=20)
        assert out["historical_goal_to_original_request_source_match_count"]==0
        assert out["six_author_original_dependency_relations"][0]["status"]==(
            "MODEL_GOAL_TO_REQUEST_NOT_OBSERVED"
        )


def test_r1h_unrelated_work_economics_cannot_qualify_another_accepted_result():
    from research.akis.qualitative_mesa.causal_contract import assess_author_causal_edges
    design,original,view=_r1h_source_work_fixture()
    unrelated={"works":[{"work":"w2",
        "status":"DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"}]}
    out=assess_author_causal_edges(
        design,original,view,at=20,economics={},
        work_counterfactual=unrelated,
    )
    link=out["six_author_original_dependency_relations"][4]
    assert link["status"]=="WORK_SPECIFIC_REAL_COST_AND_RESULT_NOT_QUALIFIED"
    assert link["same_accepted_original_work_counterfactual_count"]==0
    unrelated["works"][0]["work"]="w1"
    matched=assess_author_causal_edges(
        design,original,view,at=20,economics={},
        work_counterfactual=unrelated,
    )
    assert matched["six_author_original_dependency_relations"][4]["status"]==(
        "MODEL_WORK_ARITHMETIC_NOT_REAL_ECONOMIC_CAUSALITY"
    )
    assert matched["nine_component_causal_closure_scientifically_proved"] is False
