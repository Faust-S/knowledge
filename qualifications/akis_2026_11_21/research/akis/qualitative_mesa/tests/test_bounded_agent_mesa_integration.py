"""Native-only original Mesa / original QualitativeAKIS causal tests.

No local substitute for Mesa is used or claimed to have run these tests.
"""
from copy import deepcopy
import pytest

pytest.importorskip('mesa', reason='Official mesa==3.5.2 is required')
from research.akis.qualitative_mesa.tests.test_org_code_mesa_integration import case
from research.akis.qualitative_mesa.mesa_model import simulate


def scenario(action='PREPARE'):
    d=case()
    context=d['context_evidence']['sources'][0]
    operation={'CHECK':'READ', 'PREPARE':'DERIVE', 'RECOMMEND':'DERIVE',
               'REQUEST_APPROVAL':'SHARE', 'EXECUTE':'EXECUTE'}[action]
    if operation not in context['operations']:
        context['operations'].append(operation)
    g=d['general_akis']
    g['context_cores'].append({
        'owner':'b','source_ref':'model://b/context-review',
        'revision':'oc-1','available_at':0,'expires_at':12,
        'core':'corporate','recipient':'op','purpose':'decision-review',
        'operation':operation,'basis_source':'d1','basis_revision':'r1'})
    g['agent_functions'].append({
        'id':'source-preparation','work':'w1','work_revision':'d-1',
        'owner':'op','source_ref':'model://op/process-agent',
        'revision':'oc-1','available_at':0,'expires_at':12,
        'autonomy':g['morphology']['autonomy'], 'action':action,
        'basis_source':'d1','basis_revision':'r1',
        'purpose':'decision-review','operation':operation})
    return d


def at(output,time):
    views=[row['projection'] for row in output['general_akis_model']['read_only_evolution']
           if row['at']==float(time)]
    assert views, (time, [v['at'] for v in output['general_akis_model']['read_only_evolution']])
    return views[-1]


def test_actual_accepted_original_result_and_revoked_source_have_distinct_causal_snapshots():
    d=scenario()
    d['events'].extend([
        {'at':6,'action':'source_update','actor':'b','source':'d1','status':'UNKNOWN'},
        {'at':7,'action':'start','actor':'a','work':'w1'},
        {'at':8,'action':'complete','actor':'a','work':'w1','result_ref':'model://accepted-evidence'},
        {'at':9,'action':'accept','actor':'b','work':'w1'},
    ])
    d['model_horizon']=10
    out=simulate(d)
    assert out['counts']=={'applied':9,'blocked':0}
    before=at(out,5)['bounded_process_function_outputs'][0]
    after=at(out,6)['bounded_process_function_outputs'][0]
    assert before['status']=='NONBINDING_PROCESS_COMPUTATION_PERFORMED'
    assert before['artifact']['kind']=='SOURCE_BOUND_PREPARATION_PACKET'
    assert after['status']=='HELD_FOR_ORIGINAL_REVIEW'
    assert after['artifact'] is None
    assert out['works']['w1']['result']=='ACCEPTED_BY_ORIGINAL_RECIPIENT'
    assert out['works']['w1']['commitment_org_revision']=='oc-1'
    assert all(not row.get('original_event_created') for v in out['general_akis_model']['read_only_evolution']
               for row in v['projection']['bounded_process_function_outputs'])
    assert len(out['trace'])==len(d['events'])
    assert simulate(deepcopy(d))==out


def test_original_source_scope_required_for_actual_preparation():
    d=scenario('CHECK')
    del d['general_akis']['context_cores'][0]['basis_source']
    del d['general_akis']['context_cores'][0]['basis_revision']
    out=simulate(d)
    item=out['general_akis_model']['bounded_process_function_outputs'][0]
    assert item['status']=='HELD_FOR_ORIGINAL_REVIEW'
    assert item['artifact'] is None
    assert out['counts']=={'applied':5,'blocked':0}


def test_model_autonomy_lower_than_preparation_blocks_computational_output():
    d=scenario('PREPARE')
    max_agent=next(row for row in d['general_akis']['organizational_code']
                   if row['field']=='Авт')
    max_agent['control']['max_agent_function']='CHECK'
    out=simulate(d)
    item=out['general_akis_model']['bounded_process_function_outputs'][0]
    assert item['status']=='HELD_FOR_ORIGINAL_REVIEW'
    assert item['reason']=='OC_AGENT_AUTONOMY_LIMIT_EXCEEDED'
    assert out['works']['w1']['obligation']=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'


def test_prepared_review_is_not_an_approval_or_an_original_work_event():
    d=scenario('REQUEST_APPROVAL')
    limit=next(row for row in d['general_akis']['organizational_code']
               if row['field']=='Авт')
    limit['control']['max_agent_function']='REQUEST_APPROVAL'
    d['events']=d['events'][:2]  # No original principal consents were issued.
    d['model_horizon']=3
    out=simulate(d)
    packet=out['general_akis_model']['bounded_process_function_outputs'][0]
    assert packet['status']=='HUMAN_REVIEW_PACKET_COMPUTED'
    assert packet['artifact']['kind']=='HUMAN_REVIEW_PACKET_NOT_SENT'
    assert packet['artifact']['review_request_sent'] is False
    assert packet['human_decision_recorded'] is False
    assert out['works']['w1']['obligation']=='NOT_ACCEPTED'
    assert out['counts']=={'applied':2,'blocked':0}


def test_even_matched_execute_source_cannot_create_agent_or_original_event():
    d=scenario('EXECUTE')
    out=simulate(d)
    item=out['general_akis_model']['bounded_process_function_outputs'][0]
    assert item['status']=='HUMAN_AUTHORIZATION_REQUIRED'
    assert item['external_action_executed'] is False
    assert item['original_event_created'] is False
    assert out['general_akis_model']['new_agent_runtime_created'] is False