"""Direct pure source-bound function tests; no Mesa substituted for real Mesa."""
from copy import deepcopy
from types import SimpleNamespace as NS
import pytest
from research.akis.qualitative_mesa.process_preparation import perform_bounded_process_step as perform


def fixture(action='CHECK', *, source='MODEL_SOURCE_SCOPED_PREPARATION_ONLY', consent=False):
    fn={'id':'f-1','owner':'op','action':action,'work':'w1','work_revision':'d-1',
        'source_ref':'model://op/agent-f1','revision':'oc-1',
        'basis_source':'corp-1','basis_revision':'r1'}
    work=NS(customer='b',source_revision='d-1',proposal='OFFERED',admitted=True,
            obligation='NOT_ACCEPTED',execution='NOT_STARTED',result='NOT_SUBMITTED')
    state=NS(works={'w1':work},trace=[{'outcome':'APPLIED','action':'offer'}])
    scope={'work':'w1','original_customer':'b','original_principals':['a','b'],
           'unresolved_original_consultation':[] if consent else ['a'],
           'research_next_step':'REQUEST_INDEPENDENT_ORIGINAL_PRINCIPAL_CONSULTATION'}
    return fn, source, scope, state


@pytest.mark.parametrize('action,expected_kind',[
    ('CHECK','SOURCE_BOUND_PROCESS_CHECK'),
    ('PREPARE','SOURCE_BOUND_PREPARATION_PACKET'),
    ('RECOMMEND','NONBINDING_RESEARCH_RECOMMENDATION'),
    ('REQUEST_APPROVAL','HUMAN_REVIEW_PACKET_NOT_SENT'),
])
def test_computes_real_process_metadata_without_original_events(action,expected_kind):
    fn, verdict, scope, state = fixture(action)
    before = deepcopy(state.__dict__)
    out=perform(fn, verdict, scope, state,at=4.)
    assert out['status'] in {'NONBINDING_PROCESS_COMPUTATION_PERFORMED',
                             'HUMAN_REVIEW_PACKET_COMPUTED'}
    assert out['artifact']['kind']==expected_kind
    assert out['original_trace_position']==1
    assert out['artifact']['missing_original_consents']==['a']
    assert out['external_action_executed'] is False
    assert out['original_event_created'] is False
    assert out['original_work_changed'] is False
    assert out['original_result_created'] is False
    assert out['human_decision_recorded'] is False
    assert out['observed_cost_or_time_saving']=='NOT_IDENTIFIABLE'
    assert state.__dict__==before
    assert out==perform(fn,verdict,scope,state,at=4.)


def test_check_is_computed_from_work_not_declaration():
    fn,v,scope,state=fixture(consent=True)
    state.works['w1'].result='ACCEPTED_BY_ORIGINAL_RECIPIENT'
    state.works['w1'].obligation='FULFILLED'
    x=perform(fn,v,scope,state,at=5.)
    assert x['artifact']['computed_checks']['accepted_original_result']
    assert x['artifact']['computed_checks']['original_accepted_obligation']
    state.works['w1'].result='REJECTED'
    assert perform(fn,v,scope,state,at=5.)['artifact']['computed_checks']['accepted_original_result'] is False


@pytest.mark.parametrize('verdict',[
    'NO_CURRENT_ORIGINAL_CORE_SCOPE_FOR_FUNCTION',
    'AMBIGUOUS_ORIGINAL_CORE_FOR_FUNCTION',
    'ORIGINAL_ORGANIZATIONAL_CODE_INCOMPLETE',
    'OC_AGENT_AUTONOMY_LIMIT_EXCEEDED',
    'PROGRAM_EXECUTION_REQUIRES_ORIGINAL_AUTHORIZATION',
    'DECLARED_FUNCTION_WITHOUT_CONTEXT_SOURCE',
])
def test_missing_or_revoked_original_basis_fails_closed(verdict):
    fn,v,scope,state=fixture('PREPARE')
    out=perform(fn,verdict,scope,state,at=5.)
    assert out['status']=='HELD_FOR_ORIGINAL_REVIEW'
    assert out['reason']==verdict
    assert out['artifact'] is None


def test_execute_is_never_allowed_even_with_a_forged_passed_verdict():
    fn,v,scope,state=fixture('EXECUTE')
    out=perform(fn,v,scope,state,at=3.)
    assert out['status']=='HUMAN_AUTHORIZATION_REQUIRED'
    assert out['original_event_created'] is False
    assert out['artifact'] is None


def test_work_revision_change_stops_stale_computation():
    fn,v,scope,state=fixture()
    state.works['w1'].source_revision='d-2'
    assert perform(fn,v,scope,state,at=5.)['reason']=='ORIGINAL_WORK_REVISION_MISMATCH'


def test_unknown_work_does_not_invent_process():
    fn,v,scope,state=fixture()
    del state.works['w1']
    assert perform(fn,v,scope,state,at=5.)['reason']=='ORIGINAL_WORK_REVISION_MISMATCH'


def test_outside_work_scope_cannot_be_accepted():
    fn,v,scope,state=fixture()
    scope['work']='w2'
    assert perform(fn,v,scope,state,at=5.)['reason']=='ORIGINAL_PROCESS_SCOPE_MISSING'


@pytest.mark.parametrize('bad', [[], 'not-set', ['a','a','b'],['x']])
def test_missing_or_invalid_original_principal_evidence_held(bad):
    fn,v,scope,state=fixture()
    scope['original_principals']=bad
    assert perform(fn,v,scope,state,at=5.)['status']=='HELD_FOR_ORIGINAL_REVIEW'


def test_customer_outside_original_principals_is_not_inferred():
    fn,v,scope,state=fixture()
    scope['original_principals']=['a']
    scope['unresolved_original_consultation']=[]
    assert perform(fn,v,scope,state,at=5.)['reason']=='ORIGINAL_CUSTOMER_NOT_QUALIFIED'


def test_review_packet_stays_unsent_and_owned_by_original_principals():
    fn,v,scope,state=fixture('REQUEST_APPROVAL')
    out=perform(fn,v,scope,state,at=3.)
    assert out['artifact']['proposed_original_reviewers']==['a']
    assert out['artifact']['review_request_sent'] is False
    assert out['human_decision_recorded'] is False
    scope['unresolved_original_consultation']=[]
    assert perform(fn,v,scope,state,at=3.)['artifact']['proposed_original_reviewers']==['b']


def test_work_states_and_private_source_contents_not_republished():
    fn,v,scope,state=fixture()
    state.context_basis=NS(sources={'corp-1':NS(secret='private-content')})
    out=perform(fn,v,scope,state,at=5.)
    assert 'private-content' not in str(out)
    assert out['artifact']['source_values_or_private_documents_republished'] is False


@pytest.mark.parametrize('action',[None,'','PUBLISH','DELETE'])
def test_unsupported_agent_function_refused(action):
    fn,v,scope,state=fixture()
    fn['action']=action
    with pytest.raises(ValueError,match='AGENT_UNKNOWN_MODEL_FUNCTION'):
        perform(fn,v,scope,state,at=5.)