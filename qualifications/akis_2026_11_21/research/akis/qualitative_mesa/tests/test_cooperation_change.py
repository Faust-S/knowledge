"""One-trace reconfiguration review, not a new organizational code or Result."""
from types import SimpleNamespace as N
import pytest

from research.akis.qualitative_mesa.cooperation import (
    CooperationInputError, cooperation_change_reviews, cooperation_system_view,
    parse_cooperation_links, propose_cooperation_change,
    respond_to_cooperation_change,
)
from research.akis.qualitative_mesa.tests.test_cooperation import scenario


def prepared():
    subjects, owners, works, rows = scenario()
    subjects['d'] = N(kind='SME', active=True)
    for subject in subjects.values():
        subject.active = True
    works['x'].result_ref = None
    links = parse_cooperation_links(rows, subjects, works, owners, 'op')
    return subjects, owners, works, links


def proposal(**change):
    row = dict(at=1, action='cooperation_change_propose', actor='b',
               cooperation_link='collab', cooperation_source_revision='r1', org_revision='oc-1',
               change_id='proposal-1', change_kind='ADD_FUTURE_PARTICIPANT',
               proposed_subject='d', economic_channel='JOINT_PURCHASE',
               change_source_ref='model://proposal-one')
    row.update(change)
    return row


def answer(actor, decision='SUPPORT_MODEL_PROPOSAL', **change):
    row = dict(at=2, action='cooperation_change_response', actor=actor,
               cooperation_link='collab', cooperation_source_revision='r1', org_revision='oc-1',
               change_id='proposal-1', change_decision=decision,
               change_source_ref=f'model://owner-{actor}')
    row.update(change)
    return row


def applied(event):
    return dict(event, outcome='APPLIED', reason='NONE')


def test_originals_and_new_party_consult_no_automatic_membership_or_result():
    subjects, owners, works, links = prepared()
    p = proposal()
    propose_cooperation_change(p, links, subjects, [])
    trace = [applied(p)]
    item = cooperation_change_reviews(links, trace)[0]
    assert item['required_count'] == 5
    assert item['consulted_count'] == 0
    assert item['review_status'] == 'INDEPENDENT_CONSULTATION_INCOMPLETE'
    for i, actor in enumerate(('a','b','c','op','d'), start=2):
        event=answer(actor, at=i)
        respond_to_cooperation_change(event, links, subjects, trace)
        trace.append(applied(event))
    item = cooperation_change_reviews(links,trace)[0]
    assert item['supporting_model_declarations'] == 5
    assert item['review_status']=='MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION'
    assert item['organizational_code_authorization'] == 'NOT_IMPLEMENTED'
    assert item['transaction_costs_and_joint_economies']=='REBASELINE_REQUIRED_NO_ASSUMED_SAVINGS'
    assert links[0].participants == ('a','b','c','op')
    assert links[0].works == ('x',)
    assert works['x'].obligation == 'NOT_ACCEPTED'
    assert works['x'].result == 'NOT_SUBMITTED'
    view = cooperation_system_view(links, works, owners, subjects,
                                   N(revision='oc-1',mode='SOLE'),trace)
    assert view['relations'][0]['proposed_cooperation_changes'] == 1
    assert view['relations'][0]['components']['ОК']['change_consultation_is_not_authorization'] is True
    assert view['relations'][0]['components']['Э']['reconfiguration_costs'] == 'REBASELINE_REQUIRED'
    assert view['relations'][0]['components']['ЖЦ']['reconfiguration_reviews'][0]['status'] == item['review_status']
    assert str(view).find('model://owner-d') == -1


def test_latest_independent_objection_supersedes_earlier_model_support():
    subjects, owners, works, links=prepared()
    p=proposal()
    trace=[applied(p)]
    trace.append(applied(answer('a',at=2)))
    trace.append(applied(answer('a',at=3,decision='OBJECT_MODEL_PROPOSAL')))
    item=cooperation_change_reviews(links,trace)[0]
    assert item['consulted_count']==1
    assert item['objecting_model_declarations']==1
    assert item['supporting_model_declarations']==0
    assert item['review_status']=='SOURCE_DECLARED_OBJECTION_REQUIRES_REVIEW'
    trace.append(dict(answer('a',at=4),outcome='BLOCKED',reason='source_missing'))
    assert cooperation_change_reviews(links,trace)[0]['objecting_model_declarations']==1


@pytest.mark.parametrize('change,reason', [
    ({'actor':'outsider'},'COOPERATION_CHANGE_ORIGINAL_PROPOSER_REQUIRED'),
    ({'cooperation_link':'missing'},'COOPERATION_CHANGE_LINK_UNKNOWN'),
    ({'cooperation_source_revision':'old'},'COOPERATION_CHANGE_SOURCE_REVISION_STALE'),
    ({'change_kind':'CREATE_NEW_CORE'},'COOPERATION_CHANGE_SCOPE_INVALID'),
    ({'economic_channel':'ERP_DISCOUNT'},'COOPERATION_CHANGE_CHANNEL_NOT_DECLARED'),
    ({'change_source_ref':'https://unsigned'},'COOPERATION_CHANGE_MODEL_SOURCE_REQUIRED'),
    ({'proposed_subject':'a'},'COOPERATION_CHANGE_NEW_PARTY_NOT_QUALIFIED'),
    ({'proposed_subject':'unknown'},'COOPERATION_CHANGE_NEW_PARTY_NOT_QUALIFIED'),
])
def test_invalid_change_proposal_is_not_a_decision(change,reason):
    subjects, owners, works, links=prepared()
    with pytest.raises(CooperationInputError,match=reason):
        propose_cooperation_change(proposal(**change),links,subjects,[])


def test_change_id_cannot_be_reused_after_applied_proposal():
    subjects,owners,works,links=prepared()
    p=proposal()
    with pytest.raises(CooperationInputError,match='COOPERATION_CHANGE_ID_ALREADY_USED'):
        propose_cooperation_change(p,links,subjects,[applied(p)])


@pytest.mark.parametrize('change,reason', [
    ({'actor':'outsider'},'COOPERATION_CHANGE_ORIGINAL_CONSULTEE_REQUIRED'),
    ({'cooperation_link':'missing'},'COOPERATION_CHANGE_LINK_UNKNOWN'),
    ({'cooperation_source_revision':'old'},'COOPERATION_CHANGE_SOURCE_REVISION_STALE'),
    ({'change_decision':'LEGAL_CONSENT'},'COOPERATION_CHANGE_RESPONSE_INVALID'),
    ({'change_source_ref':'external://undocumented'},'COOPERATION_CHANGE_MODEL_SOURCE_REQUIRED'),
    ({'change_id':'unrelated'},'COOPERATION_CHANGE_PROPOSAL_NOT_FOUND'),
])
def test_invalid_response_does_not_convert_review_into_authority(change,reason):
    subjects,owners,works,links=prepared()
    with pytest.raises(CooperationInputError,match=reason):
        respond_to_cooperation_change(answer('a') | change,links,subjects,[applied(proposal())])


def test_existing_partner_can_propose_shared_function_review_without_new_member():
    subjects,owners,works,links=prepared()
    p=proposal(change_kind='REVISE_SHARED_FUNCTION',proposed_subject=None,
               economic_channel='SHARED_MARKETING')
    propose_cooperation_change(p,links,subjects,[])
    item=cooperation_change_reviews(links,[applied(p)])[0]
    assert item['required_count']==4
    assert item['new_participant_or_removed_rights']=='NOT_AUTOMATIC'


def test_inactive_principal_retains_right_to_object_to_change():
    subjects,owners,works,links=prepared()
    subjects['a'].active=False
    p=proposal()
    event=answer('a',decision='OBJECT_MODEL_PROPOSAL')
    respond_to_cooperation_change(event,links,subjects,[applied(p)])
    assert cooperation_change_reviews(links,[applied(p),applied(event)])[0]['review_status']=='SOURCE_DECLARED_OBJECTION_REQUIRES_REVIEW'


def test_subsequent_reconfiguration_proposals_are_not_silent_implementation():
    subjects,owners,works,links=prepared()
    first=proposal()
    second=proposal(at=2,change_id='proposal-2',change_kind='REVISE_COST_SHARING',
                    proposed_subject=None,economic_channel='TRANSACTION_COST')
    propose_cooperation_change(second,links,subjects,[applied(first)])
    items=cooperation_change_reviews(links,[applied(first),applied(second)])
    assert len(items)==2
    assert all(item['actual_effect']=='NOT_IDENTIFIABLE' for item in items)
    assert all(item['old_work_obligations_and_results']=='UNCHANGED' for item in items)
