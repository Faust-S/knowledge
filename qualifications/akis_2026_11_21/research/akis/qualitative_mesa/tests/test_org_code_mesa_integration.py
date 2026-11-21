"""Native-only original Mesa/QualitativeAKIS tests, not covered by pure stubs."""
from copy import deepcopy
import pytest

pytest.importorskip('mesa', reason='Official Mesa 3.5.2 is required for native tests')
from research.akis.qualitative_mesa.tests.test_rules import fixture
from research.akis.qualitative_mesa.tests.test_org_code_policy import raw
from research.akis.qualitative_mesa.general_system import author_catalog
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError


def case():
    d=fixture()
    cat=author_catalog()['taxonomy']
    morphology={row['key']:row['values'][0] for row in cat['morphological_axes']}
    fields=raw()
    roles=next(row['control'] for row in fields if row['field']=='Рол')
    role_bindings=roles['role_bindings']
    next(row for row in role_bindings if row['subject']=='a')['items']=['RESOURCE_OWNER']
    next(row for row in role_bindings if row['subject']=='b')['items']=['CUSTOMER']
    d['general_akis']={
        'configuration':'operator', 'morphology':morphology,
        'goals':[], 'organizational_code':fields,
        'formation_phases':[], 'context_cores':[], 'agent_functions':[],
        'enforce_model_org_code':True,
    }
    d['context_evidence']={
        'strict':False,
        'sources':[{'id':'d1','owner':'b','revision':'r1','status':'CONFIRMED',
                    'usable_by':['op'],'core':'corporate',
                    'purposes':['decision-review'],'operations':['ACCEPT'],
                    'valid_from':0,'valid_until':15}],
        'requirements':[{'work':'w1','action':'commit','sources':['d1'],
                         'expected_revisions':['r1'],'core':'corporate',
                         'purpose':'decision-review','operation':'ACCEPT'}],
    }
    d['events']=[
        {'at':1,'action':'offer','actor':'op','work':'w1'},
        {'at':2,'action':'authorize','actor':'op','work':'w1'},
        {'at':3,'action':'consent','actor':'a','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
        {'at':4,'action':'consent','actor':'b','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
        {'at':5,'action':'commit','actor':'op','work':'w1'},
    ]
    d['model_horizon']=6
    return d


def test_full_source_claims_narrow_but_never_replace_original_consents_and_acceptance():
    d=case();o=simulate(d)
    assert o['counts']=={'applied':5,'blocked':0}
    assert o['works']['w1']['obligation']=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert all(e['model_org_code_review']=='MODEL_CODE_CHECKED_ORIGINAL_DECISION_STILL_REQUIRED'
               for e in o['trace'])
    assert o['general_akis_model']['model_organizational_code_review']['all_thirteen_model_controls_active']
    assert not o['general_akis_model']['new_agent_runtime_created']
    assert simulate(deepcopy(d))==o


def test_new_model_prohibition_blocks_original_commit_even_after_independent_consents():
    d=case()
    x=next(r for r in d['general_akis']['organizational_code'] if r['field']=='Запр')
    x['control']['denied'][0]['items'].append('commit')
    o=simulate(d)
    assert o['counts']=={'applied':4,'blocked':1}
    assert o['trace'][-1]['reason']=='OC_EXPLICIT_PROHIBITION'
    assert o['trace'][-1]['org_code_model_escalation_target']=='b' or o['trace'][-1]['org_code_model_escalation_target']=='a'
    assert o['works']['w1']['obligation']=='NOT_ACCEPTED'
    assert o['works']['w1']['consenting_principals']==['a','b']


def test_missing_thirteenth_control_fails_input_without_processing_events():
    d=case()
    d['general_akis']['organizational_code'].pop()
    with pytest.raises(InputError, match='OC_ENFORCEMENT_REQUIRES_THIRTEEN_CONTROLS'):
        simulate(d)


def test_old_accepted_obligation_survives_code_revision_and_original_result():
    d=case()
    d['events'].extend([
       {'at':6,'action':'change_mode','actor':'FOUNDERS','expected_revision':'oc-1',
        'new_revision':'oc-2','new_mode':'COLLEGIAL','authorized_by':['op','a','b']},
       {'at':7,'action':'start','actor':'a','work':'w1'},
       {'at':8,'action':'complete','actor':'a','work':'w1','result_ref':'model://accepted-evidence'},
       {'at':9,'action':'accept','actor':'b','work':'w1'},
    ])
    d['model_horizon']=10
    o=simulate(d)
    assert o['counts']=={'applied':9,'blocked':0}
    assert o['works']['w1']['commitment_org_revision']=='oc-1'
    assert o['works']['w1']['obligation']=='FULFILLED'
    assert o['works']['w1']['result']=='ACCEPTED_BY_ORIGINAL_RECIPIENT'
    assert not o['general_akis_model']['model_organizational_code_review']['all_thirteen_model_controls_active']


def test_original_context_owner_revocation_blocks_commit_after_oc_model_pass():
    d=case();d['events'].insert(4,{'at':5,'action':'source_update','actor':'b',
                                   'source':'d1','status':'UNKNOWN'})
    d['events'][-1]['at']=6
    d['model_horizon']=7
    o=simulate(d)
    assert o['counts']=={'applied':5,'blocked':1}
    assert o['trace'][-1]['reason']=='CONTEXT_SOURCE_UNKNOWN'
    assert o['works']['w1']['obligation']=='NOT_ACCEPTED'


def test_collegial_original_votes_cannot_be_granted_by_model_role_claim():
    d=case();d['institution']['mode']='COLLEGIAL'
    d['events'][1]={'at':2,'action':'authorize','actor':'COUNCIL','work':'w1',
                     'votes':{'a':'YES'}}
    o=simulate(d)
    assert o['trace'][1]['reason']=='QUORUM_NOT_MET'
    assert o['works']['w1']['obligation']=='NOT_ACCEPTED'


def test_existing_plain_13_declared_fields_do_not_automatically_turn_on_policy():
    d=case();del d['general_akis']['enforce_model_org_code']
    for row in d['general_akis']['organizational_code']:
        del row['control']
    o=simulate(d)
    assert o['counts']=={'applied':5,'blocked':0}
    assert 'model_org_code_review' not in o['trace'][0]
    assert not o['general_akis_model']['model_organizational_code_review']['all_thirteen_model_controls_active']

@pytest.mark.parametrize("unsupported", ["intra", "inter", "sector", "macro", "trace"])
def test_unmodelled_subject_configuration_cannot_activate_operator_only_enforcement(unsupported):
    d=case()
    d["general_akis"]["configuration"]=unsupported
    with pytest.raises(InputError, match="OC_ENFORCEMENT_ONLY_ORIGINAL_OPERATOR_MODEL"):
        simulate(d)


def test_governance_event_counts_are_observations_not_monetary_effect():
    d=case()
    out=simulate(d)
    components=out["general_akis_model"]["components"]
    assert components["КЖ"]["model_org_code_events_observed"]==5
    assert components["Э"]["observed_model_governance_checks"]==5
    assert components["Э"]["observed_model_governance_blocks"]==0
    assert components["Э"]["transaction_cost_cash_effect"]=="NOT_IDENTIFIABLE_NO_TIMED_COST_SOURCE"
    assert out["profit"]["system_increment"]=="UNKNOWN"
