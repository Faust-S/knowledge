from types import SimpleNamespace as N
from decimal import Decimal
import pytest
from research.akis.qualitative_mesa.rules import Work
from research.akis.qualitative_mesa.capacity import ResourceNeed
from research.akis.qualitative_mesa.cooperation import parse_cooperation_links,cooperation_view,evaluate_cooperation_cost_channels,CooperationInputError

def scenario():
    subs={x:N(kind='SME') for x in ['a','b','c']};subs['op']=N(kind='OPERATOR')
    res={'ra':'a','rb':'b'}
    # Use the actual original Work contract, including its assurance fields.
    # This fixture deliberately declares no quality criteria; it never claims
    # qualified quality for the accepted model Result.
    works={'x':Work(key='x', customer='c', resource='ra', source_revision='d-x',
                    slot_start=1, slot_end=2,
                    resource_requirements=(ResourceNeed('ra', 1), ResourceNeed('rb', 1)))}
    links=[{'id':'collab','purpose':'joint purchasing and sales', 'coordinator':'op','participants':['a','b','c','op'],'works':['x'],'mechanisms':['JOINT_PURCHASE','SHARED_MARKETING','MEMBER_SOURCING','TRANSACTION_COST','SHARED_LOGISTICS'],'source_ref':'model://collab','source_revision':'r1'}]
    return subs,res,works,links

def prepared():
    subjects,res,works,raw=scenario()
    return parse_cooperation_links(raw,subjects,works,res,'op'),works,res

def ledgers():
    transfers={
       'ec':{'scenario':'COOPERATION','payer':'c','payee':'b','decimal_amount':Decimal('70.00')},
       'ei':{'scenario':'INDEPENDENT_ALTERNATIVE','payer':'c','payee':'EXTERNAL','decimal_amount':Decimal('100.00')},
       'ex':{'scenario':'COOPERATION','payer':'c','payee':'EXTERNAL','decimal_amount':Decimal('5.00')},
    }
    costs={
       'rc':{'scenario':'COOPERATION','owner':'c','decimal_amount':Decimal('12.00')},
       'ri':{'scenario':'INDEPENDENT_ALTERNATIVE','owner':'c','decimal_amount':Decimal('25.00')},
       'rb':{'scenario':'COOPERATION','owner':'b','decimal_amount':Decimal('50.00')},
    }
    sources={x:{'owner':'c'} for x in ['src','cmp','covc','covi']}
    coverage={'COOPERATION':{'c':'covc'},'INDEPENDENT_ALTERNATIVE':{'c':'covi'}}
    return sources,transfers,costs,coverage,{'c':'FEASIBLE_DECLARED'}

def entry():
    return {'id':'m1','link':'collab','owner':'c','channel':'MEMBER_SOURCING','source':'src','comparability_source':'cmp', 'comparability_state':'COMPARABLE_DECLARED', 'cooperation_scope_source':'covc','outside_scope_source':'covi',
            'cooperation_resource_use_ids':['rc'],'outside_resource_use_ids':['ri'],
            'cooperation_cash_outflow_ids':['ec','ex'],'outside_cash_outflow_ids':['ei']}

def test_link_original_status_and_causality():
    links,works,res=prepared(); view=cooperation_view(links,works,res,[])
    row=view['links'][0]
    assert row['relation_state']=='FORMATION_NOT_FULLY_COMMITTED'
    assert row['missing_original_consents_by_work']=={'x':['a','b','c']}
    works['x'].obligation='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert cooperation_view(links,works,res,[])['links'][0]['relation_state']=='ORIGINAL_COMMITMENTS_ACTIVE'
    works['x'].result='ACCEPTED_BY_ORIGINAL_RECIPIENT'
    assert cooperation_view(links,works,res,[])['links'][0]['relation_state']=='LINKED_MODEL_RESULTS_ACCEPTED'
    assert row['effects_by_mechanism']['JOINT_PURCHASE'].startswith('NOT_IDENTIFIABLE')

def test_ledger_claim_not_profit_or_zero():
    links,*_=prepared(); src,tr,cost,cover,out=ledgers()
    x=evaluate_cooperation_cost_channels([entry()],links,src,tr,cost,cover,out)
    m=x['claimed_channels'][0]
    assert m['buyer_cash_outlay_reduction_claim']=='25.00'  # 100 - 75; internal sale transfers to B
    assert m['external_cash_outlay_reduction_claim']=='95.00' # system cannot treat internal sale as loss
    assert m['resource_cost_reduction_claim']=='13.00'
    assert m['combined_savings'] is None and x['economic_effect']=='NOT_EMPIRICALLY_IDENTIFIED'

def test_incomplete_counterfactual_yields_null():
    links,*_=prepared(); src,tr,cost,cover,out=ledgers()
    cover['INDEPENDENT_ALTERNATIVE'].clear()
    m=evaluate_cooperation_cost_channels([entry()],links,src,tr,cost,cover,out)['claimed_channels'][0]
    assert m['buyer_cash_outlay_reduction_claim'] is None

@pytest.mark.parametrize('mutate,reason',[
 (lambda x: x['participants'].remove('b'),'COOPERATION_ORIGINAL_PARTICIPANTS_REQUIRED'),
 (lambda x: x.update(source_ref='https://fake'),'COOPERATION_MODEL_SOURCE_REQUIRED'),
 (lambda x: x['works'].append('unknown'),'COOPERATION_UNKNOWN_WORK'),
 (lambda x: x.update(coordinator='stranger'),'COOPERATION_UNKNOWN_PARTICIPANT'),
])
def test_link_invalid(mutate,reason):
    subs,res,works,raw=scenario();mutate(raw[0]);
    with pytest.raises(CooperationInputError,match=reason):parse_cooperation_links(raw,subs,works,res,'op')

@pytest.mark.parametrize('mutate,reason',[
 (lambda x:x.update(channel='OTHER'),'COOPERATION_COST_CHANNEL_NOT_DECLARED'),
 (lambda x:x.update(cooperation_cash_outflow_ids=['ei']),'COOPERATION_COST_SCENARIO_MISMATCH'),
 (lambda x:x.update(cooperation_cash_outflow_ids=['rc']),'COOPERATION_COST_RECORD_NOT_IN_LEDGER'),
 (lambda x:x.update(source='bad'),'COOPERATION_COST_SOURCE_OWNER_REQUIRED'),
])
def test_cost_invalid(mutate,reason):
    links,*_=prepared();src,tr,cost,cover,out=ledgers();one=entry();mutate(one)
    with pytest.raises(CooperationInputError,match=reason):evaluate_cooperation_cost_channels([one],links,src,tr,cost,cover,out)

def test_unknown_comparability_has_no_declared_saving():
    links,*_=prepared();src,tr,cost,cover,out=ledgers();one=entry()
    one['comparability_state']='UNKNOWN'
    m=evaluate_cooperation_cost_channels([one],links,src,tr,cost,cover,out)['claimed_channels'][0]
    assert m['resource_cost_reduction_claim'] is None


def test_cost_duplicate_across_mechanisms_disallowed():
    links,*_=prepared();src,tr,cost,cover,out=ledgers(); one=entry();other=entry();other['id']='m2';other['channel']='SHARED_MARKETING'
    with pytest.raises(CooperationInputError,match='DOUBLE_ALLOCATED'):
        evaluate_cooperation_cost_channels([one,other],links,src,tr,cost,cover,out)


def test_multiwork_relation_never_becomes_a_second_result():
    subjects, res, works, raw = scenario()
    works['y'] = N(customer='a', resource_requirements=[N(resource='rb')],
                   consents={}, obligation='NOT_ACCEPTED', result='NOT_SUBMITTED')
    raw[0]['works'].append('y')
    links = parse_cooperation_links(raw, subjects, works, res, 'op')
    works['x'].obligation = 'FULFILLED'
    works['x'].result = 'ACCEPTED_BY_ORIGINAL_RECIPIENT'
    view = cooperation_view(links, works, res, [])['links'][0]
    assert view['relation_state'] == 'FORMATION_NOT_FULLY_COMMITTED'
    assert view['work_results'] == {'x':'ACCEPTED_BY_ORIGINAL_RECIPIENT', 'y':'NOT_SUBMITTED'}
    works['y'].obligation = 'ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    works['y'].result = 'REJECTED'
    assert cooperation_view(links,works,res,[])['links'][0]['relation_state'] == 'ORIGINAL_RESULT_CORRECTION_PENDING'


def test_expensive_shared_service_may_increase_costs():
    links,*_=prepared();src,tr,cost,cover,out=ledgers();one=entry()
    cost['rc']['decimal_amount'] = Decimal('31.00')
    cost['ri']['decimal_amount'] = Decimal('25.00')
    result=evaluate_cooperation_cost_channels([one],links,src,tr,cost,cover,out)
    assert result['claimed_channels'][0]['resource_cost_reduction_claim'] == '-6.00'
    assert result['claimed_channels'][0]['causal_attribution'] == 'NOT_IDENTIFIABLE'


def test_blocked_original_actions_visible_without_a_new_scheduler():
    links,works,res=prepared()
    view=cooperation_view(links,works,res,[
        {'work':'x','outcome':'BLOCKED','reason':'INDEPENDENT_ACCEPTANCE_MISSING'},
        {'work':'x','outcome':'APPLIED','reason':'NONE'},
    ])
    assert view['links'][0]['blocked_event_reasons']==['INDEPENDENT_ACCEPTANCE_MISSING']
    assert view['event_owner']=='EXISTING_QUALITATIVE_AKIS_TRACE'


def test_new_customer_request_joins_existing_cooperation_only_with_original_parties():
    from research.akis.qualitative_mesa.cooperation import attach_requested_work
    links, works, res = prepared()
    new_work = N(key='new',customer='c',resource_requirements=[N(resource='rb')],
                 consents={},obligation='NOT_ACCEPTED',result='NOT_SUBMITTED',result_ref=None)
    previous = tuple(links)
    changed = attach_requested_work(links, new_work, res, link_id='collab', expected_revision='r1')
    assert changed[0].works == ('x', 'new')
    assert previous[0].works == ('x',)
    assert attach_requested_work(links,new_work,res,link_id=None,expected_revision=None) == previous


@pytest.mark.parametrize('link,rev,customer,resource,reason', [
    ('missing','r1','c','ra','COOPERATION_LINK_UNKNOWN'),
    ('collab','old','c','rb','COOPERATION_SOURCE_REVISION_STALE'),
    ('collab',None,'c','rb','COOPERATION_SOURCE_REVISION_REQUIRED'),
    ('collab','r1','new_party','ra','COOPERATION_NEW_ORIGINAL_PARTY_REQUIRES_REVIEW'),
    ('collab','r1','c','new_resource','COOPERATION_NEW_ORIGINAL_PARTY_REQUIRES_REVIEW'),
])
def test_new_demand_cannot_overwrite_cooperation_rights(link,rev,customer,resource,reason):
    from research.akis.qualitative_mesa.cooperation import attach_requested_work
    links,works,res=prepared()
    res.update(new_resource='new_party')
    candidate=N(key='new',customer=customer,resource_requirements=[N(resource=resource)])
    with pytest.raises(CooperationInputError,match=reason):
        attach_requested_work(links,candidate,res,link_id=link,expected_revision=rev)
    assert links[0].works == ('x',)


def test_nine_component_projection_from_original_state_not_new_engine():
    from research.akis.qualitative_mesa.cooperation import cooperation_system_view
    subjects,resources,works,raw=scenario()
    works['x'].result_ref=None
    for party in subjects.values():
        party.active=True
    links=parse_cooperation_links(raw,subjects,works,resources,'op')
    econ={'per_subject':{'a':{'outside_feasibility':'UNKNOWN'},
                         'b':{'outside_feasibility':'FEASIBLE_DECLARED'}},
          'cooperation_cost_channels':{'claimed_channels':[{
              'link':'collab','owner':'c','channel':'SHARED_MARKETING',
              'comparison':'DECLARED_SCOPE_ARITHMETIC_ONLY',
              'resource_cost_reduction_claim':'-7.00',
              'buyer_cash_outlay_reduction_claim':'4.00'}]}}
    adapter=N(mode='SOLE',revision='oc-1')
    snapshot=cooperation_system_view(links,works,resources,subjects,adapter,
        [{'work':'x','at':2,'action':'offer','outcome':'APPLIED','reason':'NONE'}],
        economics=econ,adaptation={'cooperation_cost_review_signals':[{
            'link':'collab','signal':'DECLARED_POSSIBLE_COOPERATION_COST_DISADVANTAGE'}]})
    assert set(snapshot['relations'][0]['components'])=={'Ц','У','А','П','КПБ','ОК','КЖ','Э','ЖЦ'}
    row=snapshot['relations'][0]
    assert row['components']['А']['status']=='AUTHOR_PROGRAM_AGENT_NOT_IMPLEMENTED'
    assert row['components']['П']['all_original_obligations_accepted'] is False
    assert row['components']['Э']['comparable_declared_channel_count']==1
    assert row['components']['ЖЦ']['organizational_change']=='NOT_AUTOMATIC'
    assert row['components']['КЖ']['last_applied_event_at']==2
    assert row['components']['У']['missing_original_consents']['x']==['a','b','c']
    assert row['all_nine_components_fully_implemented'] is False
    assert snapshot['original_results_only'] is True
    assert row['economic_claims']=='OWNER_SCOPED_NOT_REDISCLOSED'
    assert row['components']['КЖ']['original_result_references']=='OWNER_SCOPED_NOT_REDISCLOSED'
    assert row['components']['Ц']['outside_options']=='OWNER_SCOPED_NOT_REDISCLOSED'


def test_economics_cannot_attribute_an_unrelated_work_to_cooperation_link():
    links,*_=prepared()
    sources,transfers,costs,coverage,outside=ledgers()
    entry_with_wrong_work=entry()
    costs['rc']['work']='not-in-this-relation'
    with pytest.raises(CooperationInputError,match='COOPERATION_COST_WORK_NOT_IN_LINK'):
        evaluate_cooperation_cost_channels([entry_with_wrong_work],links,sources,transfers,costs,coverage,outside)


def test_original_owner_interest_is_only_from_the_prior_applied_event_trace():
    from research.akis.qualitative_mesa.cooperation import latest_owner_interest_claim
    log = [
      {"at": 1, "action": "interest_update", "outcome": "APPLIED", "actor": "a", "work": "x",
       "org_revision": "oc-1", "interest_source_revision": "d1",
       "interest_willingness": "DECLINES", "interest_outside_option": "OUTSIDE_PREFERRED"},
      {"at": 2, "action": "interest_update", "outcome": "BLOCKED", "actor": "a", "work": "x",
       "org_revision": "oc-1", "interest_source_revision": "d1",
       "interest_willingness": "WILLING", "interest_outside_option": "COOPERATION_PREFERRED"},
    ]
    assert latest_owner_interest_claim(log, "a", "x", "d1", "oc-1") == ("DECLINES", "OUTSIDE_PREFERRED")
    assert latest_owner_interest_claim(log, "b", "x", "d1", "oc-1") is None
    assert latest_owner_interest_claim(log, "a", "x", "old", "oc-1") is None
    assert latest_owner_interest_claim(log, "a", "x", "d1", "oc-2") is None
    # The next information event can change later modeled assessment, never the original earlier consent.
    log.append({"at":3,"action":"interest_update","outcome":"APPLIED","actor":"a",
                "work":"x","org_revision":"oc-1","interest_source_revision":"d1",
                "interest_willingness":"WILLING","interest_outside_option":"COOPERATION_PREFERRED"})
    assert latest_owner_interest_claim(log, "a", "x", "d1", "oc-1") == ("WILLING", "COOPERATION_PREFERRED")

def test_original_owner_interest_updates_appear_only_as_nonbinding_aggregate_cues():
    from research.akis.qualitative_mesa.cooperation import cooperation_system_view
    subjects,res,works,raw=scenario()
    for party in subjects.values():
        party.active=True
    works['x'].result_ref=None
    links=parse_cooperation_links(raw,subjects,works,res,'op')
    result=cooperation_system_view(links,works,res,subjects,N(mode='SOLE',revision='oc-1'),[
        {'at':1,'work':'x','action':'interest_update','actor':'a',
         'outcome':'APPLIED','reason':'NONE','org_revision':'oc-1'},
        {'at':2,'work':'x','action':'interest_update','actor':'b',
         'outcome':'BLOCKED','reason':'CONTEXT_REQUIREMENT_MISSING','org_revision':'oc-1'}])
    row=result['relations'][0]
    assert row['components']['У']['independent_interest_updates_declared']==1
    assert row['components']['ЖЦ']['owner_interest_review_count']==1
    assert row['components']['Э']['ex_post_claims_cannot_drive_past_decisions'] is True
    assert 'interest_willingness' not in str(result)
    assert row['components']['ЖЦ']['organizational_change']=='NOT_AUTOMATIC'
