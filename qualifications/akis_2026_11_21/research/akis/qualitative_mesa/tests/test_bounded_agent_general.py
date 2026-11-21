from copy import deepcopy
from types import SimpleNamespace as N
from research.akis.qualitative_mesa.tests.test_general_system import design, claim, CODES, parse, state
from research.akis.qualitative_mesa.scope_policy import SourceScope
from research.akis.qualitative_mesa.general_system import general_system_view


def make_case(function='PREPARE'):
    x = design()
    x['organizational_code'] = [
        {**claim(owner='op', n=101+i), 'field':fld} for i,fld in enumerate(CODES)
    ]
    x['morphology']['autonomy']='подготовительные'
    x['context_cores']=[{
        **claim(owner='a',n=501), 'core':'corporate', 'recipient':'op',
        'purpose':'preparation-for-original-w1', 'operation':'DERIVE' if function!='CHECK' else 'READ',
        'basis_source':'corp-1', 'basis_revision':'r1'
    }]
    x['agent_functions']=[{
        **claim(owner='op',n=601), 'id':'F1', 'work':'w1',
        'work_revision':'wr1', 'autonomy':'подготовительные','action':function,
        'basis_source':'corp-1', 'basis_revision':'r1',
        'purpose':'preparation-for-original-w1',
        'operation': 'DERIVE' if function not in ('CHECK','REQUEST_APPROVAL','EXECUTE') else (
            'READ' if function=='CHECK' else 'SHARE' if function=='REQUEST_APPROVAL' else 'EXECUTE')
    }]
    x['context_cores'][0]['operation']=x['agent_functions'][0]['operation']
    s=state()
    s.institution.operator='op'
    s.works['w1'].admitted=True
    s.works['w1'].proposal='OFFERED'
    s.works['w1'].consents={}
    s.works['w1'].obligation='NOT_ACCEPTED'
    s.works['w1'].execution='NOT_STARTED'
    s.context_basis=N(sources={
        'corp-1':N(owner='a',revision='r1',usable_by=['op'],valid_until=8,
                   status='CONFIRMED',scope=SourceScope(
                       core='corporate',purposes=('preparation-for-original-w1',),
                       operations=(x['context_cores'][0]['operation'],),valid_from=1))})
    return parse(x),s


def test_bound_preparation_runs_on_original_work_without_mutating_it():
    d,s=make_case()
    before=deepcopy(s.works)
    v=general_system_view(d,s,at=2)
    o=v['bounded_process_function_outputs'][0]
    assert o['status']=='NONBINDING_PROCESS_COMPUTATION_PERFORMED'
    assert o['artifact']['kind']=='SOURCE_BOUND_PREPARATION_PACKET'
    assert v['components']['А']['bounded_process_computations']==1
    assert v['seven_constitutive_signs']['delegated_program_process_function'].startswith('PARTIAL_')
    assert v['new_agent_runtime_created'] is False
    assert s.works==before
    assert general_system_view(d,s,at=2)==v


def test_owner_revocation_stops_preparation_without_rewriting_work():
    d,s=make_case()
    first=general_system_view(d,s,at=2)
    s.context_basis.sources['corp-1'].status='UNKNOWN'
    revoked=general_system_view(d,s,at=3)
    assert first['bounded_process_function_outputs'][0]['status']=='NONBINDING_PROCESS_COMPUTATION_PERFORMED'
    assert revoked['bounded_process_function_outputs'][0]['status']=='HELD_FOR_ORIGINAL_REVIEW'
    assert revoked['components']['А']['bounded_process_computations']==0
    assert s.works['w1'].obligation=='NOT_ACCEPTED'


def test_source_expiry_at_next_instant_blocks_model_computation():
    d,s=make_case()
    v=general_system_view(d,s,at=9)
    assert v['bounded_process_function_outputs'][0]['status']=='HELD_FOR_ORIGINAL_REVIEW'


def test_misleading_max_autonomy_still_cannot_execute_outward_action():
    d,s=make_case(function='EXECUTE')
    v=general_system_view(d,s,at=2)
    assert v['bounded_process_function_outputs'][0]['status']=='HUMAN_AUTHORIZATION_REQUIRED'
    assert v['components']['А']['bounded_process_computations']==0


def test_check_computes_original_status_not_a_fake_acceptance():
    d,s=make_case(function='CHECK')
    v=general_system_view(d,s,at=2)
    p=v['bounded_process_function_outputs'][0]
    assert p['status']=='NONBINDING_PROCESS_COMPUTATION_PERFORMED'
    assert p['artifact']['computed_checks']['original_authorization_recorded']
    assert p['artifact']['computed_checks']['accepted_original_result'] is False


def test_no_context_source_does_not_prepare_any_document():
    d,s=make_case(function='PREPARE')
    del s.context_basis.sources['corp-1']
    v=general_system_view(d,s,at=2)
    assert v['bounded_process_function_outputs'][0]['artifact'] is None
    assert v['components']['А']['bounded_process_computations']==0