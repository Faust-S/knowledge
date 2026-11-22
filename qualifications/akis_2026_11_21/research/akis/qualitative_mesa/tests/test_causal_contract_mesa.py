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
