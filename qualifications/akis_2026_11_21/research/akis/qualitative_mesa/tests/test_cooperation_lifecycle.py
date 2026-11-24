"""Research-only original formation phases and future participation, no second core."""
import pytest
from research.akis.qualitative_mesa.tests.test_cooperation import (
    prepared, scenario, N, CooperationInputError, parse_cooperation_links,
)

def test_ongoing_cooperation_can_pause_future_requests_without_erasing_old_works():
    from research.akis.qualitative_mesa.cooperation import attach_requested_work, latest_future_participation
    links, works, resources=prepared()
    new=N(key='new', customer='c', resource_requirements=[N(resource='rb')])
    trace=[{'at':3, 'action':'participation_status','actor':'b','outcome':'APPLIED',
            'org_revision':'oc-1', 'participation_link':'collab',
            'participation_relation_revision':'r1', 'participation_value':'PAUSED_NEW_WORK'}]
    assert latest_future_participation(trace,'collab','b','r1','oc-1')=='PAUSED_NEW_WORK'
    assert latest_future_participation(trace,'collab','b','r1','oc-2')=='PAUSED_NEW_WORK'
    with pytest.raises(CooperationInputError,match='COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK'):
        attach_requested_work(links,new,resources,link_id='collab',expected_revision='r1',
                              trace=trace,org_revision='oc-1')
    assert links[0].works==('x',)
    trace.append({'at':4,'action':'participation_status','actor':'b','outcome':'BLOCKED',
                  'org_revision':'oc-1','participation_link':'collab',
                  'participation_relation_revision':'r1','participation_value':'OPEN_TO_NEW_WORK'})
    assert latest_future_participation(trace,'collab','b','r1','oc-1')=='PAUSED_NEW_WORK'
    trace.append({**trace[-1],'at':5,'outcome':'APPLIED'})
    assert latest_future_participation(trace,'collab','b','r1','oc-1')=='OPEN_TO_NEW_WORK'
    assert attach_requested_work(links,new,resources,link_id='collab',expected_revision='r1',
                                 trace=trace,org_revision='oc-1')[0].works==('x','new')


def test_all_author_eight_phases_are_evidence_not_auto_states():
    from research.akis.qualitative_mesa.cooperation import formation_phase_evidence
    links,works,res=prepared()
    phases=formation_phase_evidence(link=links[0],works=[works['x']],modeled_events=[],
                                    source_rules=set(),declared_economic_channels=0)
    assert [item['phase'] for item in phases] == list(range(1,9))
    assert all(item['original_deliverable_qualified'] is False for item in phases)
    assert all(item['does_not_authorize_next_phase'] for item in phases)
    assert all(item['author_phase'] for item in phases)
    assert phases[3]['observed_basis']=='QUALIFIED_CONTEXT_BASIS_NOT_OBSERVED'
    assert phases[5]['observed_basis']=='AGENT_DELEGATION_NOT_QUALIFIED'
    assert phases[7]['observed_basis']=='RISK_ADJUSTED_EFFECT_AND_PLAN_NOT_OBSERVED'
    works['x'].result='ACCEPTED_BY_ORIGINAL_RECIPIENT'
    later=formation_phase_evidence(link=links[0],works=[works['x']],
                                   modeled_events=[{'outcome':'APPLIED'}],
                                   source_rules={('x','consent')},declared_economic_channels=4)
    assert later[6]['observed_basis']=='MODEL_EVENTS_NOT_FIELD_LAUNCH'
    assert later[7]['observed_basis']=='DECLARED_ECONOMIC_CLAIMS_NOT_CAUSAL_EFFECT'
    assert not any(row['original_deliverable_qualified'] for row in later)


def test_system_projection_shows_future_participation_without_declaring_legal_exit():
    from research.akis.qualitative_mesa.cooperation import cooperation_system_view
    subs,resource_owners,works,raw=scenario()
    for subject in subs.values(): subject.active=True
    works['x'].result_ref=None
    links=parse_cooperation_links(raw,subs,works,resource_owners,'op')
    trace=[{'at':7,'action':'participation_status','actor':'a','outcome':'APPLIED',
            'participation_link':'collab','participation_relation_revision':'r1',
            'participation_value':'PAUSED_NEW_WORK','org_revision':'oc-1'}]
    view=cooperation_system_view(links,works,resource_owners,subs,N(revision='oc-1',mode='SOLE'),trace)
    item=view['relations'][0]
    assert item['components']['У']['paused_for_new_cooperation_count']==1
    assert item['components']['У']['independent_participation_details']=='OWNER_SCOPED_NOT_REDISCLOSED'
    assert item['components']['У']['pause_is_not_contract_exit'] is True
    assert len(item['author_formation_phases'])==8
    assert item['components']['П']['future_cooperative_processes']=='PARTICIPANT_AVAILABILITY_REVIEW_REQUIRED'
    assert item['components']['Э']['costs_after_participation_change']=='REESTIMATE_TRANSACTION_COSTS_AND_SHARED_CAPABILITIES'
    assert item['components']['ЖЦ']['reconfiguration_review']=='ORIGINAL_PRINCIPALS_MUST_DECIDE'
    assert item['components']['ЖЦ']['organizational_change']=='NOT_AUTOMATIC'
