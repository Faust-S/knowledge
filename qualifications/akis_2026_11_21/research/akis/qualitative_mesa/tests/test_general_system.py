"""Addressable pure research tests; native Mesa is independently required."""
from copy import deepcopy
from types import SimpleNamespace as N
import pytest

from research.akis.qualitative_mesa.general_system import (GeneralSystemInputError, parse_general_system,
                            general_system_view, COMPONENTS, CORES)

AXES = {
 "scale": ["Внутрифирменные", "межфирменные"],
 "governance": ["Централизованные", "операторские"],
 "autonomy": ["Рекомендательные", "подготовительные", "доверенно-исполнительные"],
 "process": ["Жесткие", "межфирменные"],
 "knowledge": ["Локальный", "операторский"],
 "data": ["Внутренние", "смешанные"],
 "platform": ["Внутриплатформенные", "независимые"],
 "economics": ["Абонентские", "результатные"],
 "human": ["Ручной контроль", "контроль по исключениям"],
}
CODES = ["С", "ИД", "Рол", "Пр", "Запр", "Ист", "Событ", "Прав", "Авт", "Эск", "Отв", "Журн", "Пересм"]
CONFIGS=["intra", "inter", "operator", "sector", "macro", "trace"]
CATALOG={"taxonomy":{
 "morphological_axes": [{"key": k, "values": v} for k,v in AXES.items()],
 "subject_configurations":[{"id": c} for c in CONFIGS],
 "organizational_code_components": CODES,
 "formation_phases":[{"phase":p, "name":f"Phase {p}"} for p in range(1,9)]}}
SUBJECTS={"a":N(kind="SME",active=True),"op":N(kind="OPERATOR",active=True)}
WORKS={"w1":N(key="w1", customer="a",source_revision="wr1",result="NOT_SUBMITTED")}

def claim(owner="a",n=1,**changes):
    d={"owner":owner, "source_ref":f"model://{owner}/source-{n}",
       "revision":"oc1", "available_at":0, "expires_at":10}
    d.update(changes)
    return d


def design():
    return {"configuration":"operator", "morphology":{k:v[0] for k,v in AXES.items()},
            "goals":[], "organizational_code":[],"formation_phases":[],
            "context_cores":[],"agent_functions":[]}


def state():
    return N(institution=N(revision="oc1"), subjects=deepcopy(SUBJECTS),
             works=deepcopy(WORKS), trace=[],
             resource_specs={"r":N(basis="MODEL_DECLARED")}, context_basis=None)


def parse(data):
    return parse_general_system(data,SUBJECTS,WORKS,catalog=CATALOG)


def test_all_nine_components_without_invented_legal_readiness():
    p=parse(design());result=general_system_view(p,state(),at=0)
    assert tuple(result['components'])==COMPONENTS
    assert result['readiness'].startswith('PARTIAL_')
    assert result['legal_consent_created'] is False
    assert result['new_agent_runtime_created'] is False
    assert result['morphology']['behavioral_effects_across_all_forms']=='NOT_IMPLEMENTED'
    assert len(result['organizational_code']['missing_fields'])==13
    assert set(result['context_cores']['missing'])==set(CORES)
    assert len(result['formation_phases'])==8

@pytest.mark.parametrize("configuration", CONFIGS)
def test_all_author_configurations_accepted_but_only_current_operator_is_executable(configuration):
    d=design();d['configuration']=configuration;result=general_system_view(parse(d),state(),at=0)
    assert result['configuration']==configuration
    assert result['configuration_fully_implemented'] is False
    assert result['configuration_coverage'] == (
        'PARTIAL_OPERATOR_RESEARCH_ONLY' if configuration == 'operator'
        else 'NOT_EXECUTABLE_IN_CURRENT_PARTY_TYPES')

@pytest.mark.parametrize("fault,error", [
   (lambda x:x['morphology'].pop('scale'),"GENERAL_AUTHOR_MORPHOLOGY_NINE_AXES_REQUIRED"),
   (lambda x:x['morphology'].update(scale='something'),"GENERAL_UNKNOWN_AUTHOR_MORPHOLOGY_VALUE"),
   (lambda x:x.update(configuration='new_fake_form'),"GENERAL_CONFIGURATION_NOT_AUTHOR_DEFINED"),
])
def test_morphology_cannot_be_silently_rewritten(fault,error):
    x=design();fault(x)
    with pytest.raises(GeneralSystemInputError,match=error):parse(x)


def test_dynamic_goals_and_code_revocation_do_not_affect_existing_obligation():
    x=design();x['goals']=[{
        **claim(n=1,available_at=2,expires_at=8),"work":"w1", "work_revision":"wr1",
        "objective":"TRANSACTION_COST", "priority":2}]
    x['organizational_code']=[{**claim(owner='op',n=i+10),"field":s} for i,s in enumerate(CODES)]
    source=parse(x);s=state()
    assert general_system_view(source,s,at=1)['components']['Ц']['current_independent_goal_claims']==0
    assert general_system_view(source,s,at=2)['components']['Ц']['current_independent_goal_claims']==1
    assert general_system_view(source,s,at=8)['components']['Ц']['current_independent_goal_claims']==0
    assert not general_system_view(source,s,at=3)['organizational_code']['missing_fields']
    s.institution.revision='oc2'
    assert len(general_system_view(source,s,at=3)['organizational_code']['missing_fields'])==13
    assert s.works['w1'].result=='NOT_SUBMITTED'


def test_declared_agent_functions_are_not_qualified_runtime():
    x=design();x['agent_functions']=[{**claim(n=9),"id":"F1", "work":"w1",
         "work_revision":"wr1", "autonomy":"доверенно-исполнительные",
         "action":"EXECUTE"}]
    v=general_system_view(parse(x),state(),at=0)
    assert v['components']['А']['declared_agent_functions']==1
    assert v['components']['А']['autonomous_execution_qualified'] is False
    assert v['new_agent_runtime_created'] is False


def test_complete_model_claims_do_not_certify_all_eight_phases():
    x=design()
    x['goals']=[{**claim(n=1),"work":"w1", "work_revision":"wr1",
                "objective":"QUALITY", "priority":1}]
    x['formation_phases']=[{**claim(owner='op',n=10+i),"phase":i} for i in range(1,9)]
    x['organizational_code']=[{**claim(owner='op',n=20+i),"field":f} for i,f in enumerate(CODES)]
    x['agent_functions']=[{**claim(n=50),"id":"F1", "work":"w1",
                          "work_revision":"wr1", "autonomy":"Рекомендательные",
                          "action":"RECOMMEND"}]
    x['context_cores']=[{**claim(n=60+i),"core":core,"recipient":"op",
                         "purpose":"model scientific", "operation":"READ"}
                        for i,core in enumerate(CORES)]
    s=state();s.trace=[{"outcome":"APPLIED", "action":"offer"}]
    v=general_system_view(parse(x),s,at=0)
    assert len(v['organizational_code']['missing_fields'])==0
    assert len(v['context_cores']['missing'])==0
    assert v['formation_phases'][3]['conditional_diagnostic']=='NOT_YET_EVIDENCED'
    assert all(not row['actual_formation_phase_completed'] for row in v['formation_phases'])

@pytest.mark.parametrize('mutator,error',[ 
    (lambda x:x['goals'].append({**claim(owner='op'),"work":"w1","work_revision":"wr1",
                        "objective":"COST","priority":1}),"GENERAL_GOAL_ORIGINAL_CUSTOMER_REQUIRED"),
    (lambda x:x['goals'].append({**claim(),"work":"w1","work_revision":"stale",
                        "objective":"COST","priority":1}),"GENERAL_WORK_SOURCE_MISMATCH"),
    (lambda x:x['organizational_code'].append({**claim(owner='op'),"field":"unknown"}),"GENERAL_NOT_AUTHOR_CODE_FIELD"),
    (lambda x:x['goals'].append({**claim(source_ref="model://op/fraud"),"work":"w1",
                 "work_revision":"wr1", "objective":"COST","priority":1}),"GENERAL_SOURCE_OWNER_MISMATCH"),
    (lambda x:x['formation_phases'].append({**claim(expires_at=0),"phase":1}),"GENERAL_SOURCE_TIME_INVALID"),
    (lambda x:x['context_cores'].append({**claim(),"core":"corporate", "recipient":"unknown",
                      "purpose":"review", "operation":"READ"}),"GENERAL_RECIPIENT_UNKNOWN"),
])
def test_invalid_owner_revision_phases_and_context_do_not_enter_state(mutator,error):
    x=design();mutator(x)
    with pytest.raises(GeneralSystemInputError,match=error):parse(x)


def test_accepted_original_result_updates_process_count_not_causal_profit():
    d=design();p=parse(d);s=state()
    s.works['w1'].result='ACCEPTED_BY_ORIGINAL_RECIPIENT'
    v=general_system_view(p,s,at=3,economic_status="SOURCE_DECLARED_ONLY")
    assert v['components']['П']['accepted_results']==1
    assert v['components']['Э']['network_profit_or_causal_effect']=='NOT_IDENTIFIABLE'
    assert len(v['components']['ОК']['missing_author_fields']) == 13


def test_original_owner_active_state_is_dynamic_and_does_not_change_private_sources():
    d=design();p=parse(d);s=state()
    s.subjects['a'].active=False
    v=general_system_view(p,s,at=3)
    assert v['components']['У']['active_for_new_work']==1
    assert v['source_claim_counts_current']['goals']==0


def test_duplicate_claim_source_cannot_be_reused_for_another_component():
    d=design();d['organizational_code'].append({**claim(n=9),"field":"С"})
    d['organizational_code'].append({**claim(n=10),"field":"С"})
    with pytest.raises(GeneralSystemInputError,match="GENERAL_DUPLICATE_LOGICAL_CLAIM"):
        parse(d)


def test_source_validity_changes_are_explicit_schedulable_instants():
    d=design();d['organizational_code']=[{**claim(owner='op',n=5,available_at=3,expires_at=7),"field":"С"}]
    assert parse(d).source_times==(3,7)


def test_single_source_can_cover_all_thirteen_distinct_author_org_elements():
    d=design()
    d["organizational_code"]=[{**claim(owner="op",source_ref="model://op/code-document"),
                                "field":field} for field in CODES]
    v=general_system_view(parse(d),state(),at=0)
    assert len(v["organizational_code"]["current_fields"]) == 13
    assert v["organizational_code"]["actual_identity_and_mandates"]=="NOT_VERIFIED"


def test_seven_constitutive_signs_are_never_faked_by_filled_paperwork():
    d = design()
    d["organizational_code"] = [{**claim(owner="op", n=i + 10), "field": field}
                                 for i, field in enumerate(CODES)]
    s = state()
    s.works["w1"].result = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    v = general_system_view(parse(d), s, at=3, economic_status="SOURCE_DECLARED_ONLY")
    assert len(v["seven_constitutive_signs"]) == 7
    assert v["seven_constitutive_signs"]["delegated_program_process_function"] == "NOT_IMPLEMENTED"
    assert v["doctoral_business_classification"].startswith("NOT_QUALIFIED")
    assert v["author_operator_reproducibility"]["experience_return_ratio"].startswith("UNKNOWN")


def test_invalid_source_horizon_cannot_schedule_millions_of_model_steps():
    d = design()
    d["formation_phases"] = [{**claim(expires_at=10001), "phase": 1}]
    with pytest.raises(GeneralSystemInputError, match="GENERAL_SOURCE_TIME_INVALID"):
        parse(d)


def test_conflicting_two_owner_org_code_source_blocks_phase_five_diagnostic():
    d=design()
    d['organizational_code']=[{**claim(owner='op',n=40+i), 'field':field}
                              for i,field in enumerate(CODES)]
    d['organizational_code'].append({**claim(owner='a',n=66),'field':'С'})
    view=general_system_view(parse(d),state(),at=0)
    assert view['organizational_code']['missing_fields']==[]
    assert view['organizational_code']['ambiguous_owner_fields']==['С']
    assert view['components']['ОК']['ambiguous_owner_sources']==['С']


def test_exact_author_source_catalog_contract_when_repository_is_present():
    from research.akis.qualitative_mesa.general_system import CATALOG_PATH, author_catalog
    if not CATALOG_PATH.exists():
        pytest.skip("Canonical repository concept map is not mounted in isolated test")
    catalog = author_catalog()
    assert len(catalog["taxonomy"]["morphological_axes"]) == 9
    assert len(catalog["taxonomy"]["subject_configurations"]) == 6
    assert len(catalog["taxonomy"]["organizational_code_components"]) == 13
    assert len(catalog["taxonomy"]["formation_phases"]) == 8
    raw = design()
    raw["morphology"] = {row["key"]: row["values"][0]
                         for row in catalog["taxonomy"]["morphological_axes"]}
    parsed = parse_general_system(raw, SUBJECTS, WORKS)
    assert len(parsed.morphology) == 9


def test_incomplete_declared_economics_cannot_qualify_phase_eight():
    d = design()
    d["formation_phases"] = [{**claim(owner="op", n=120 + i), "phase": i}
                             for i in range(1, 9)]
    s = state()
    s.works["w1"].result = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    view = general_system_view(parse(d), s, at=3, economic_status="INCOMPLETE_SOURCE_SCOPE")
    assert view["formation_phases"][-1]["conditional_diagnostic"] == "NOT_YET_EVIDENCED"
    assert view["components"]["Э"]["network_profit_or_causal_effect"] == "NOT_IDENTIFIABLE"