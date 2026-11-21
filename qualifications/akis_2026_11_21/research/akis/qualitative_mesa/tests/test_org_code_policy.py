"""Pure tests: claimed OC can constrain original actions but cannot grant rights."""
from __future__ import annotations
from copy import deepcopy
from types import SimpleNamespace as N
import pytest
from research.akis.qualitative_mesa.org_code_policy import (FIELDS, OrgCodeInputError, OrgCodeBlocked,
                             parse_org_code_policy)

ACTIONS = set('request offer authorize consent commit interest_update start complete accept reject change_mode exclude'.split())


def raw():
    controls = {
      'С': {'subjects': ['op','a','b','COUNCIL']},
      'ИД': {'model_identified': ['op','a','b','COUNCIL']},
      'Рол': {'role_bindings': [
          {'subject':'op','items':['OPERATOR']},
          {'subject':'a','items':['CUSTOMER']},
          {'subject':'b','items':['RESOURCE_OWNER']},
          {'subject':'COUNCIL','items':['COUNCIL']},
      ]},
      'Пр': {'permitted': [
          {'subject':'OPERATOR','items':['offer','authorize','commit']},
          {'subject':'CUSTOMER','items':['consent','request']},
          {'subject':'RESOURCE_OWNER','items':['consent','interest_update']},
          {'subject':'COUNCIL','items':['authorize']},
      ]},
      'Запр': {'denied': [{'subject':'OPERATOR','items':['consent']}]},
      'Ист': {'require_scoped_context_for': ['commit']},
      'Событ': {'new_work_events': ['request','offer','authorize','consent','commit']},
      'Прав': {'require_admitted_for':['consent','commit']},
      'Авт': {'max_agent_function':'PREPARE'},
      'Эск': {'reviewers':[{'action':'commit','subject':'a'}]},
      'Отв': {'responsibilities':[{'action':'commit','original_principals':['a','b']}]},
      'Журн': {'require_original_trace':True},
      'Пересм': {'expected_revision':'oc-1'},
    }
    return [{**{'field':f, 'owner':'op','source_ref':f'model://op/{i}',
                'revision':'oc-1','available_at':0,'expires_at':20},
             'control':controls[f]} for i,f in enumerate(FIELDS)]


def subjects():
    return {'op':N(kind='OPERATOR',active=True),'a':N(kind='SME',active=True),
            'b':N(kind='SME',active=True)}


def state(*, admitted=True, revision='oc-1', context=True):
    req=N(scope=('corporate','decision-review','ACCEPT'))
    basis=N(requirements={('w1','commit'):req}, assert_allowed=lambda *a:None) if context else None
    ledger=N(original_owners=lambda needs:{'b'})
    return N(institution=N(operator='op',revision=revision),subjects=subjects(),
             context_basis=basis,capacity_ledger=ledger,
             works={'w1':N(key='w1',customer='a',admitted=admitted,
                           resource_requirements=(), obligation='NOT_ACCEPTED')})


def policy(records=None):
    return parse_org_code_policy(raw() if records is None else records,subjects(),
                                 N(operator='op',revision='oc-1'),actions=ACTIONS)


def event(action='commit',actor='op'):
    return {'action':action,'actor':actor,'work':'w1'}


def alter(field, modification):
    o=raw()
    item=next(r for r in o if r['field']==field)
    modification(item)
    return o


def test_all_thirteen_fields_are_source_backed_without_automatic_rights():
    p=policy(); assert set(p.records)==set(FIELDS)
    assessment=p.inspect(state(),event(),5)
    assert assessment['original_authority_unmodified']
    assert assessment['accountable_original_subjects']==['a','b']
    assert assessment['model_identity_not_authenticated']
    assert p.agent_decision('EXECUTE')=='OC_AGENT_EXECUTE_REQUIRES_ORIGINAL_HUMAN_MANDATE'
    assert p.agent_decision('PREPARE')=='OC_MODEL_PREPARATION_CANDIDATE_NOT_AUTHORIZED'


def test_explicit_model_denial_dominates_any_positive_right():
    p=policy(alter('Запр',lambda x:x['control']['denied'][0]['items'].append('commit')))
    with pytest.raises(OrgCodeBlocked,match='OC_EXPLICIT_PROHIBITION'):
        p.inspect(state(),event(),5)


def test_actor_not_in_original_current_identity_claim_cannot_use_role():
    p=policy(alter('ИД',lambda x:x['control']['model_identified'].remove('op')))
    with pytest.raises(OrgCodeBlocked,match='OC_ORIGINAL_SUBJECT_OR_IDENTITY_CLAIM_MISSING'):
        p.inspect(state(),event(),5)


def test_role_and_permission_require_positive_match():
    p=policy(alter('Пр',lambda x:x['control']['permitted'][0]['items'].remove('commit')))
    with pytest.raises(OrgCodeBlocked,match='OC_POSITIVE_RIGHT_NOT_DECLARED'):
        p.inspect(state(),event(),5)


def test_declared_event_set_restricts_unlisted_new_work_action():
    p=policy(alter('Событ',lambda x:x['control']['new_work_events'].remove('commit')))
    with pytest.raises(OrgCodeBlocked,match='OC_EVENT_OUTSIDE_DECLARED_SCOPE'):
        p.inspect(state(),event(),5)


def test_action_uses_actual_original_work_admission():
    with pytest.raises(OrgCodeBlocked,match='OC_ORIGINAL_AUTHORIZATION_NOT_REACHED'):
        policy().inspect(state(admitted=False),event(),5)


def test_existing_context_scope_is_not_replaced_with_a_new_source_registry():
    with pytest.raises(OrgCodeBlocked,match='OC_SCOPED_ORIGINAL_CONTEXT_REQUIRED'):
        policy().inspect(state(context=False),event(),5)


def test_original_context_qualification_is_called_after_scope_presence():
    calls=[]
    x=state()
    x.context_basis.assert_allowed=lambda *a:calls.append(a)
    policy().inspect(x,event(),5)
    assert calls==[('w1','commit','op',5)]


def test_original_principals_cannot_be_replaced_by_organizational_code():
    p=policy(alter('Отв',lambda x:x['control']['responsibilities'][0]
                   .update(original_principals=['op'])))
    with pytest.raises(OrgCodeBlocked,match='OC_RESPONSIBILITY_NOT_ORIGINAL_PRINCIPAL'):
        p.inspect(state(),event(),5)


def test_existing_accepted_obligation_not_cancelled_by_source_expiry():
    p=policy(); x=state(revision='oc-2')
    x.works['w1'].obligation='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert p.inspect(x,event('complete','b'),50)['status']=='ORIGINAL_ACTION_OUTSIDE_NEW_WORK_MODEL_POLICY'
    assert x.works['w1'].obligation=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'


def test_original_revision_and_source_time_gate_future_decisions():
    p=policy()
    for x,t in ((state(revision='oc-2'),5),(state(),20)):
        with pytest.raises(OrgCodeBlocked,match='OC_SOURCE_STALE_OR_EXPIRED'):
            p.inspect(x,event(),t)


def test_revision_change_alone_never_changes_a_work_or_original_result():
    x=state(revision='oc-2')
    x.works['w1'].obligation='FULFILLED'
    x.works['w1'].result='ACCEPTED_BY_ORIGINAL_RECIPIENT'
    before=deepcopy(x.works['w1'].__dict__)
    with pytest.raises(OrgCodeBlocked):policy().inspect(x,event(),6)
    assert x.works['w1'].__dict__==before

@pytest.mark.parametrize('field,error',[
    ('С','OC_CONTROL_INVALID_ORIGINAL_SUBJECTS'),
    ('ИД','OC_IDENTITY_OUTSIDE_DECLARED_SUBJECTS'),
    ('Журн','OC_ORIGINAL_JOURNAL_REQUIRED'),
    ('Пересм','OC_REVISION_EXPECTATION_STALE'),
    ('Авт','OC_UNBOUNDED_MODEL_AGENT_AUTONOMY'),
])
def test_controls_invalid_values_refused_before_original_mesa(field,error):
    def bad(row):
        if field=='С':row['control']['subjects']=['unknown','op']
        elif field=='ИД':row['control']['model_identified']=['unknown']
        elif field=='Журн':row['control']['require_original_trace']=False
        elif field=='Пересм':row['control']['expected_revision']='oc-2'
        else:row['control']['max_agent_function']='EXECUTE'
    with pytest.raises(OrgCodeInputError,match=error):policy(alter(field,bad))


def test_partial_thirteen_fields_cannot_turn_on_model_enforcement():
    with pytest.raises(OrgCodeInputError,match='OC_ENFORCEMENT_REQUIRES_THIRTEEN_CONTROLS'):
        policy(raw()[:-1])


def test_other_operator_cannot_authenticate_independent_controls():
    with pytest.raises(OrgCodeInputError,match='OC_POLICY_ORIGINAL_OPERATOR_SOURCE_REQUIRED'):
        policy(alter('Отв',lambda x:x.update(owner='a')))


def test_no_source_inference_from_an_unknown_original_work():
    x=state();x.works.clear()
    with pytest.raises(OrgCodeBlocked,match='OC_ORIGINAL_AUTHORIZATION_NOT_REACHED'):
        policy().inspect(x,event(),5)


def test_unknown_actor_or_missing_revision_never_silent():
    p=policy()
    with pytest.raises(OrgCodeBlocked,match='OC_ORIGINAL_SUBJECT_OR_IDENTITY_CLAIM_MISSING'):
        p.inspect(state(),event(actor='ghost'),5)
    y=alter('Пересм',lambda row:row['control'].update(expected_revision=None))
    with pytest.raises(OrgCodeInputError):policy(y)

def test_paper_rights_cannot_masquerade_as_enforcing_old_result_acceptance():
    item=alter('Пр',lambda x:x['control']['permitted'][0]['items'].append('accept'))
    with pytest.raises(OrgCodeInputError,match='OC_CONTROL_UNKNOWN_ACTION'):
        policy(item)


def test_initial_request_does_not_replace_original_responsibility():
    rows=alter('Отв',lambda x:x['control']['responsibilities'].append(
        {'action':'request','original_principals':['op']}))
    p=policy(rows)
    ev={'action':'request','actor':'a','work_spec':{
        'id':'w2','customer':'a','resource':'r2',
    }}
    source=state();source.resources={'r2':'b'}
    with pytest.raises(OrgCodeBlocked, match='OC_RESPONSIBILITY_NOT_ORIGINAL_PRINCIPAL'):
        p.inspect(source,ev,2)