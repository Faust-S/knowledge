"""Official Mesa 3.5.2-only integration; NOT_RUN in offline research sandboxes.

Uses original QualitativeAKIS, original Work, original Result and a single Mesa
scheduler. It cannot prove 13-field legal governance or four authenticated cores.
"""
from copy import deepcopy
import pytest

mesa = pytest.importorskip("mesa", reason="Official Mesa 3.5.2 unavailable: NOT_RUN")

from research.akis.qualitative_mesa.general_system import author_catalog
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_rules import fixture


def design():
    taxonomy = author_catalog()["taxonomy"]
    morphology = {axis["key"]: axis["values"][0]
                  for axis in taxonomy["morphological_axes"]}
    return {"configuration": "operator", "morphology": morphology,
            "goals": [], "organizational_code": [],
            "formation_phases": [], "context_cores": [], "agent_functions": []}


def goal(at=2):
    return {"owner":"b", "source_ref":f"model://b/goal-{at}",
            "revision":"oc-1", "available_at":at, "expires_at":9,
            "work":"w1", "work_revision":"d-1", "objective":"TRANSACTION_COST",
            "priority":1}


def at(output, when):
    return [o["projection"] for o in output["general_akis_model"]["read_only_evolution"]
            if o["at"] == when]


def test_current_original_work_and_time_qualified_goals_flow_into_one_nine_component_state():
    data=fixture()
    d=design();d["goals"]=[goal(2)]
    data["general_akis"]=d
    data["model_horizon"]=9
    data["events"]=[{"at":1,"action":"offer","actor":"op","work":"w1"}]
    out=simulate(data)
    assert "general_akis_model" in out
    assert out["general_akis_model"]["schema"]=="AKIS_GENERAL_NINE_COMPONENT_MODEL/0.1"
    assert at(out,0.0)[-1]["components"]["Ц"]["current_independent_goal_claims"]==0
    assert at(out,2.0)[-1]["components"]["Ц"]["current_independent_goal_claims"]==1
    assert at(out,9.0)[-1]["components"]["Ц"]["current_independent_goal_claims"]==0
    assert out["works"]["w1"]["obligation"]=="NOT_ACCEPTED"
    assert out["general_akis_model"]["single_original_scheduler"] is True
    assert simulate(deepcopy(data))==out


def test_author_claims_do_not_overwrite_original_grants_or_valid_accepted_old_work():
    data=fixture()
    d=design()
    catalog=author_catalog()["taxonomy"]
    d["organizational_code"]=[{
       "field":field, "owner":"op", "source_ref":"model://op/all-fields-source",
       "revision":"oc-1", "available_at":0,"expires_at":10,
    } for field in catalog["organizational_code_components"]]
    data["general_akis"]=d
    data["events"]=[
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        {"at":3,"action":"consent","actor":"a","work":"w1","source_revision":"d-1","org_revision":"oc-1"},
        {"at":4,"action":"consent","actor":"b","work":"w1","source_revision":"d-1","org_revision":"oc-1"},
        {"at":5,"action":"commit","actor":"op","work":"w1"},
        {"at":6,"action":"change_mode","actor":"FOUNDERS", "authorized_by":["op","a","b"],
         "expected_revision":"oc-1","new_revision":"oc-2","new_mode":"COLLEGIAL"},
    ]
    data["model_horizon"]=8
    out=simulate(data)
    assert at(out,5.0)[-1]["organizational_code"]["missing_fields"]==[]
    assert len(at(out,6.0)[-1]["organizational_code"]["missing_fields"])==13
    assert out["works"]["w1"]["obligation"]=="ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert out["works"]["w1"]["commitment_org_revision"]=="oc-1"
    assert out["institution"]["revision"]=="oc-2"
    assert out["general_akis_model"]["original_results_and_org_code_unmodified"]


def test_empty_general_structure_always_reports_incomplete_without_auto_agent_execution():
    data=fixture();data["general_akis"]=design();out=simulate(data)
    view=out["general_akis_model"]
    assert view["components"]["А"]["autonomous_execution_qualified"] is False
    assert view["components"]["ЖЦ"]["actual_formational_transitions"]=="NOT_PROVEN"
    assert len(view["formation_phases"])==8
    assert view["legal_consent_created"] is False
    assert out["counts"]=={"applied":0,"blocked":0}


def test_old_mesa_output_without_general_akis_is_backward_compatible():
    data=fixture();out=simulate(data)
    assert "general_akis_model" not in out
    assert "read_only_evolution" not in out
    assert "decision_observations" not in out


def test_invalid_author_nine_axes_refused_before_model_advance():
    data=fixture();d=design();del d["morphology"]["scale"]
    data["general_akis"]=d
    from research.akis.qualitative_mesa.rules import InputError
    with pytest.raises(InputError,match="GENERAL_AUTHOR_MORPHOLOGY_NINE_AXES_REQUIRED"):
        simulate(data)


def test_configuration_dynamics_tracks_original_consents_without_signing_on_behalf_of_firms():
    data=fixture()
    d=design();d['configuration']='inter';d['morphology']['scale']='межфирменные'
    data['general_akis']=d
    data['events']=[
      {'at':1,'action':'offer','actor':'op','work':'w1'},
      {'at':2,'action':'authorize','actor':'op','work':'w1'},
      {'at':3,'action':'consent','actor':'a','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
      {'at':4,'action':'consent','actor':'b','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
      {'at':5,'action':'commit','actor':'op','work':'w1'},
    ]
    out=simulate(data)
    def step(t):
        return at(out,float(t))[-1]['configuration_dynamics']['original_work_scope'][0]['research_next_step']
    assert step(0)=='PREPARE_ORIGINAL_AUTHORIZATION_REVIEW'
    assert step(2)=='REQUEST_INDEPENDENT_ORIGINAL_PRINCIPAL_CONSULTATION'
    assert step(3)=='REQUEST_INDEPENDENT_ORIGINAL_PRINCIPAL_CONSULTATION'
    assert step(4)=='PREPARE_ORIGINAL_COMMIT_REVIEW_NO_AUTOMATIC_CONTRACT'
    assert step(5)=='CONTINUE_ORIGINAL_ACCEPTED_WORK'
    assert out['works']['w1']['obligation']=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert out['general_akis_model']['legal_consent_created'] is False
    assert simulate(deepcopy(data))==out


def test_intrafirm_selection_cannot_launder_interfirm_work_into_one_party():
    data=fixture();d=design();d['configuration']='intra';data['general_akis']=d
    out=simulate(data)
    item=out['general_akis_model']['configuration_dynamics']['original_work_scope'][0]
    assert item['original_principals']==['a','b']
    assert item['configuration_applicability']=='INTERFIRM_ORIGINALS_OUTSIDE_INTRA_SCOPE'
    assert item['research_next_step']=='RECONSIDER_AUTHOR_CONFIGURATION_AND_ORIGINAL_ROLES'
    assert out['works']['w1']['obligation']=='NOT_ACCEPTED'


@pytest.mark.parametrize('configuration',['intra','inter','operator','sector','macro','trace'])
def test_all_author_forms_keep_legal_original_contract_transitions_independent(configuration):
    data=fixture();d=design();d['configuration']=configuration;data['general_akis']=d
    data['events']=[
      {'at':1,'action':'offer','actor':'op','work':'w1'},
      {'at':2,'action':'authorize','actor':'op','work':'w1'},
      {'at':3,'action':'consent','actor':'a','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
      {'at':4,'action':'consent','actor':'b','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
      {'at':5,'action':'commit','actor':'op','work':'w1'},
    ]
    out=simulate(data)
    assert out['counts']['blocked']==0
    assert out['works']['w1']['obligation']=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    conf=out['general_akis_model']['configuration_dynamics']
    assert conf['configuration']==configuration
    assert not conf['program_agent_execution_created']
    assert not conf['membership_reconfiguration_created']


def test_model_core_source_expiry_changes_data_consequence_on_original_mesa_clock():
    data=fixture();d=design();d['context_cores']=[{
        'owner':'b','source_ref':'model://b/context','revision':'oc-1',
        'available_at':1,'expires_at':4,'core':'corporate','recipient':'op',
        'purpose':'work assistance','operation':'READ',
    }]
    data['general_akis']=d;data['model_horizon']=5
    out=simulate(data)
    def condition(t):
        return at(out,float(t))[-1]['configuration_dynamics']['morphological_consequences']['data']['observed']
    assert condition(1)=='MODEL_CORE_CLAIMS_NOT_AUTHENTICATED'
    assert condition(4)=='CONTEXT_CORE_SOURCE_MISSING'
    assert out['counts']=={'applied':0,'blocked':0}

def test_one_original_mesa_clock_links_four_component_research_with_owner_revocation():
    data=fixture()
    d=design()
    catalog=author_catalog()["taxonomy"]
    d["organizational_code"]=[{
        "owner":"op","source_ref":"model://op/code-all","revision":"oc-1",
        "available_at":0,"expires_at":12,"field":field
    } for field in catalog["organizational_code_components"]]
    d["context_cores"]=[{
        "owner":"b","source_ref":"model://b/corporate-scope","revision":"oc-1",
        "available_at":0,"expires_at":12,"core":"corporate",
        "recipient":"op","purpose":"original-contract-review","operation":"READ",
        "basis_source":"corp-1","basis_revision":"ctx1"
    }]
    d["agent_functions"]=[{
        "owner":"op","source_ref":"model://op/preparation","revision":"oc-1",
        "available_at":0,"expires_at":12,"id":"F1","work":"w1",
        "work_revision":"d-1","autonomy":d["morphology"]["autonomy"],
        "action":"CHECK","basis_source":"corp-1","basis_revision":"ctx1",
        "purpose":"original-contract-review","operation":"READ"
    }]
    data["general_akis"]=d
    data["context_evidence"]={
        "strict":False,
        "sources":[{
            "id":"corp-1","owner":"b","revision":"ctx1",
            "status":"CONFIRMED","usable_by":["op"],"valid_until":8,
            "core":"corporate","purposes":["original-contract-review"],
            "operations":["READ","ACCEPT"],"valid_from":1
        }],
        "requirements":[{
            "work":"w1","action":"commit","sources":["corp-1"],
            "expected_revisions":["ctx1"],"core":"corporate",
            "purpose":"original-contract-review","operation":"ACCEPT"
        }]
    }
    data["model_horizon"]=9
    data["events"]=[
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        {"at":3,"action":"consent","actor":"a","work":"w1","source_revision":"d-1","org_revision":"oc-1"},
        {"at":4,"action":"consent","actor":"b","work":"w1","source_revision":"d-1","org_revision":"oc-1"},
        {"at":5,"action":"source_update","actor":"b","source":"corp-1","status":"UNKNOWN"},
        {"at":6,"action":"commit","actor":"op","work":"w1"},
        {"at":7,"action":"source_update","actor":"b","source":"corp-1","status":"CONFIRMED"},
        {"at":8,"action":"commit","actor":"op","work":"w1"},
    ]
    out=simulate(data)
    assert out["counts"]=={"applied":7,"blocked":1}
    blocked=[ev for ev in out["trace"] if ev["at"]==6][0]
    assert blocked["reason"]=="CONTEXT_SOURCE_UNKNOWN"
    assert at(out,2.0)[-1]["context_cores"]["model_source_scoped_cores"]==["corporate"]
    assert at(out,2.0)[-1]["agent_function_scope_review"][0]["research_review"]=="MODEL_SOURCE_SCOPED_PREPARATION_ONLY"
    assert at(out,5.0)[-1]["context_cores"]["model_source_scoped_cores"]==[]
    assert at(out,7.0)[-1]["context_cores"]["model_source_scoped_cores"]==["corporate"]
    assert at(out,9.0)[-1]["context_cores"]["model_source_scoped_cores"]==[]
    assert out["works"]["w1"]["obligation"]=="ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert out["general_akis_model"]["new_agent_runtime_created"] is False
    assert out["general_akis_model"]["legal_consent_created"] is False
    assert simulate(deepcopy(data))==out


def test_four_context_paper_claims_without_original_basis_do_not_unlock_agent():
    data=fixture()
    d=design()
    for i,core in enumerate(("personal","corporate","operator","institutional")):
        d["context_cores"].append({
            "owner":"b","source_ref":f"model://b/independent-{i}",
            "revision":"oc-1","available_at":0,"expires_at":5,
            "core":core,"recipient":"op","purpose":"original-contract-review","operation":"READ"
        })
    data["general_akis"]=d
    out=simulate(data)
    view=out["general_akis_model"]
    assert view["context_cores"]["missing"]==[]
    assert view["context_cores"]["model_source_scoped_cores"]==[]
    assert view["components"]["КПБ"]["authenticated_source_grants"] is False
    assert view["formation_phases"][3]["actual_formation_phase_completed"] is False
