"""Isolated general AKIS triad: original context + original code + delegated proposal.

The original Mesa and legal identity are not represented in these unit tests.
"""
from copy import deepcopy
from types import SimpleNamespace as S
import pytest
from research.akis.qualitative_mesa.general_system import parse_general_system, general_system_view, GeneralSystemInputError
from research.akis.qualitative_mesa.scope_policy import parse_scope

AXES={
    'scale':['межфирменные'],'governance':['операторские'],
    'autonomy':['подготовительные'],'process':['межфирменные'],
    'knowledge':['операторский'],'data':['смешанные'],
    'platform':['независимые'],'economics':['результатные'],
    'human':['Ручной контроль'],
}
CODES=['С','ИД','Рол','Пр','Запр','Ист','Событ','Прав','Авт','Эск','Отв','Журн','Пересм']
CORES=['personal','corporate','operator','institutional']
CAT={'taxonomy':{
 'morphological_axes':[{'key':k,'values':v} for k,v in AXES.items()],
 'subject_configurations':[{'id':'operator'}],
 'organizational_code_components':CODES,
 'formation_phases':[{'phase':i,'name':str(i)} for i in range(1,9)],
}}
SUBJECTS={'a':S(kind='SME',active=True),'op':S(kind='OPERATOR',active=True)}
WORKS={'w1':S(key='w1',customer='a',source_revision='wr1',result='NOT_SUBMITTED')}


def claim(owner='a',**extra):
 return {'owner':owner,'source_ref':f'model://{owner}/original',
         'revision':'oc1','available_at':0,'expires_at':12,**extra}


def data():
 return {'configuration':'operator','morphology':{k:v[0] for k,v in AXES.items()},
         'goals':[],'organizational_code':[], 'formation_phases':[],
         'context_cores':[],'agent_functions':[]}


def model_state():
 state=S(institution=S(revision='oc1',operator='op',mode='SOLE'),
         subjects=deepcopy(SUBJECTS),works=deepcopy(WORKS),trace=[],
         resource_specs={},resource_availability_origin={},
         resources={},capacity_ledger=None,context_basis=None)
 return state


def insert_scopes(x, with_code=True):
 basis_sources={}
 for core in CORES:
  sid=f'{core}-original'
  src=S(id=sid,owner='a',revision='source-r1',status='CONFIRMED',usable_by=('op',),valid_until=10,
        scope=parse_scope({'core':core,'purposes':['fulfill-w1'],
                           'operations':['READ','DERIVE','SHARE','EXECUTE'],
                           'valid_from':2,'valid_until':10}))
  basis_sources[sid]=src
  x['context_cores'].append(claim(core=core,recipient='op',purpose='fulfill-w1',
                                  operation='DERIVE',basis_source=sid,basis_revision='source-r1'))
 if with_code:
  x['organizational_code']=[claim(owner='op',field=code) for code in CODES]
 return S(sources=basis_sources,strict=True)


def view(x,state,at=4):
 return general_system_view(parse_general_system(x,SUBJECTS,WORKS,catalog=CAT),state,at=at)


def test_four_scoped_model_cores_require_original_source_and_do_not_authenticate_rights():
 x=data();st=model_state();st.context_basis=insert_scopes(x)
 q=view(x,st)
 assert q['context_cores']['model_source_scoped_cores']==sorted(CORES)
 assert q['context_cores']['actual_source_use_rights']=='NOT_VERIFIED'
 assert q['components']['КПБ']['model_source_scoped_cores']==4
 assert q['seven_constitutive_signs']['delegated_program_process_function']=='NOT_IMPLEMENTED'
 assert q['legal_consent_created'] is False


def test_four_unbound_paper_claims_do_not_pass_original_source_gate():
 x=data();st=model_state()
 x['context_cores']=[claim(core=c,recipient='op',purpose='fulfill-w1',operation='DERIVE') for c in CORES]
 q=view(x,st)
 assert q['context_cores']['model_source_scoped_cores']==[]
 assert q['components']['КПБ']['model_source_scoped_cores']==0
 assert q['context_cores']['model_source_scope_status_counts']['ORIGINAL_CONTEXT_BASIS_MISSING']==4


def test_actual_source_time_and_revocation_change_read_only_context_results():
 x=data();st=model_state();st.context_basis=insert_scopes(x)
 assert view(x,st,1)['context_cores']['model_source_scoped_cores']==[]
 assert len(view(x,st,2)['context_cores']['model_source_scoped_cores'])==4
 st.context_basis.sources['corporate-original'].status='UNKNOWN'
 assert len(view(x,st,3)['context_cores']['model_source_scoped_cores'])==3
 assert view(x,st,11)['context_cores']['model_source_scoped_cores']==[]


def test_agent_prepare_is_research_proposal_only_with_scope_and_code():
 x=data();st=model_state();st.context_basis=insert_scopes(x)
 x['agent_functions']=[claim(owner='op',id='F1',work='w1',work_revision='wr1',
                             autonomy='подготовительные',action='PREPARE',
                             basis_source='corporate-original',basis_revision='source-r1',
                             purpose='fulfill-w1',operation='DERIVE')]
 q=view(x,st)
 assert q['agent_function_scope_review'][0]['research_review']=='MODEL_SOURCE_SCOPED_PREPARATION_ONLY'
 assert q['agent_function_scope_review'][0]['real_agent_action_authorized'] is False
 assert q['components']['А']['model_source_scoped_preparations']==1
 assert q['new_agent_runtime_created'] is False


def test_revoke_one_original_source_stops_delegated_preparatory_review():
 x=data();st=model_state();st.context_basis=insert_scopes(x)
 x['agent_functions']=[claim(owner='op',id='F1',work='w1',work_revision='wr1',
                             autonomy='подготовительные',action='PREPARE',
                             basis_source='corporate-original',basis_revision='source-r1',
                             purpose='fulfill-w1',operation='DERIVE')]
 st.context_basis.sources['corporate-original'].status='UNKNOWN'
 assert view(x,st)['agent_function_scope_review'][0]['research_review']=='NO_CURRENT_ORIGINAL_CORE_SCOPE_FOR_FUNCTION'
 st.context_basis.sources['corporate-original'].status='CONFIRMED'
 st.context_basis.sources['corporate-original'].usable_by=('a',)
 assert view(x,st)['agent_function_scope_review'][0]['research_review']=='NO_CURRENT_ORIGINAL_CORE_SCOPE_FOR_FUNCTION'


def test_missing_author_code_does_not_qualify_even_readonly_preparation():
 x=data();st=model_state();st.context_basis=insert_scopes(x,with_code=False)
 x['agent_functions']=[claim(owner='op',id='F1',work='w1',work_revision='wr1',
                             autonomy='подготовительные',action='PREPARE',
                             basis_source='corporate-original',basis_revision='source-r1',
                             purpose='fulfill-w1',operation='DERIVE')]
 assert view(x,st)['agent_function_scope_review'][0]['research_review']=='ORIGINAL_ORGANIZATIONAL_CODE_INCOMPLETE'


def test_execute_requires_external_authorization_even_if_everything_is_scoped():
 x=data();st=model_state();st.context_basis=insert_scopes(x)
 st.context_basis.sources['corporate-original'].scope = parse_scope({'core':'corporate',
   'purposes':['fulfill-w1'],'operations':['EXECUTE','DERIVE'], 'valid_from':2})
 x['context_cores']=[{**r,'operation':'EXECUTE'} if r['core']=='corporate' else r for r in x['context_cores']]
 x['agent_functions']=[claim(owner='op',id='F1',work='w1',work_revision='wr1',
                             autonomy='подготовительные',action='EXECUTE',
                             basis_source='corporate-original',basis_revision='source-r1',
                             purpose='fulfill-w1',operation='EXECUTE')]
 assert view(x,st)['agent_function_scope_review'][0]['research_review']=='PROGRAM_EXECUTION_REQUIRES_ORIGINAL_AUTHORIZATION'


@pytest.mark.parametrize('fragment',[
 {'basis_source':'corporate-original'},
 {'basis_revision':'source-r1'},
])
def test_partial_context_binding_is_rejected(fragment):
 x=data();x['context_cores']=[claim(core='corporate',recipient='op',purpose='p',operation='READ',**fragment)]
 with pytest.raises(GeneralSystemInputError,match='GENERAL_PARTIAL_ORIGINAL_SCOPE_BINDING'):
  view(x,model_state())


def test_agent_action_cannot_be_laundered_through_readonly_operation():
 x=data();x['agent_functions']=[claim(owner='op',id='F',work='w1',work_revision='wr1',
                                      autonomy='подготовительные',action='EXECUTE',
                                      basis_source='corporate-original',basis_revision='r1',
                                      purpose='p',operation='READ')]
 with pytest.raises(GeneralSystemInputError,match='GENERAL_AGENT_ACTION_SCOPE_MISMATCH'):
  view(x,model_state())