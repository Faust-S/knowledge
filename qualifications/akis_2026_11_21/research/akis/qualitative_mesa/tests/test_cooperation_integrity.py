"""Original multi-party cooperation history and observed transaction drivers."""
from dataclasses import replace
from types import SimpleNamespace as N

import pytest

from research.akis.qualitative_mesa.cooperation import (
    cooperation_change_reviews,
    cooperative_coordination_observations,
    cooperation_system_view,
    original_cooperation_consultees,
    respond_to_cooperation_change,
    CooperationInputError,
)
from research.akis.qualitative_mesa.tests.test_cooperation_change import (
    prepared, proposal, answer, applied,
)


def complete_trace():
    subjects, owners, works, links = prepared()
    p = proposal()
    p['original_consultees'] = list(original_cooperation_consultees(p, links))
    trace = [applied(p)]
    for t, who in enumerate(p['original_consultees'], 2):
        response = answer(who, at=t)
        respond_to_cooperation_change(response, links, subjects, trace)
        trace.append(applied(response))
    return subjects, owners, works, links, trace


def test_consent_circle_is_frozen_when_future_membership_changes():
    subjects, owners, works, links, trace = complete_trace()
    before = cooperation_change_reviews(links, trace, current_org_revision='oc-1', subjects=subjects)[0]
    assert before['consultation_counts_originally_frozen'] is True
    assert before['required_count'] == 5
    assert before['supporting_model_declarations'] == 5
    subjects['e'] = N(kind='SME', active=True)
    future = (replace(links[0], participants=('a','c','d','e','op'), source_revision='r2'),)
    after = cooperation_change_reviews(future, trace, current_org_revision='oc-1', subjects=subjects)[0]
    assert after['historical_review_status'] == before['historical_review_status']
    assert after['required_count'] == 5
    assert after['supporting_model_declarations'] == 5
    assert after['review_status'] == 'MODEL_REVIEW_STALE_COOPERATION_SOURCE_REVALIDATION_REQUIRED'
    assert after['original_consultees_provenance'] == 'SNAPSHOT_IN_ORIGINAL_TRACE'
    assert trace[0]['original_consultees'] == ['a','b','c','d','op']
    assert links[0].participants == ('a','b','c','op')
    assert works['x'].result == 'NOT_SUBMITTED'


def test_legacy_trace_is_distinguished_from_recorded_originals():
    subjects, owners, works, links = prepared()
    legacy = [applied(proposal()), applied(answer('a', at=2))]
    row = cooperation_change_reviews(links, legacy)[0]
    assert row['original_consultees_provenance'] == 'LEGACY_RECONSTRUCTION_NOT_AUTHORITATIVE'
    assert row['consultation_counts_originally_frozen'] is False
    assert row['organizational_code_authorization'] == 'NOT_IMPLEMENTED'


def test_source_revision_cannot_backdate_original_principal_response():
    subjects, owners, works, links = prepared()
    p = proposal(at=6)
    trace = [applied(p)]
    with pytest.raises(CooperationInputError, match='COOPERATION_CHANGE_RESPONSE_MUST_FOLLOW_PROPOSAL'):
        respond_to_cooperation_change(answer('a', at=5), links, subjects, trace)
    with pytest.raises(CooperationInputError, match='COOPERATION_CHANGE_RESPONSE_MUST_FOLLOW_PROPOSAL'):
        respond_to_cooperation_change(answer('a', at=6), links, subjects, trace)
    assert cooperation_change_reviews(links, trace)[0]['consulted_count'] == 0


def test_owners_bear_observed_coordination_events_not_invented_ruble_costs():
    subjects, owners, works, links = prepared()
    events = [
        {'work':'x','action':'request','outcome':'APPLIED'},
        {'work':'x','action':'consent','outcome':'BLOCKED','reason':'NOT_ORIGINAL_PRINCIPAL'},
        {'work':'x','action':'consent','outcome':'APPLIED'},
        {'work':'x','action':'start_operation','outcome':'APPLIED'},
        {'work':'x','action':'handoff_quality','outcome':'BLOCKED'},
        {'cooperation_link':'collab','action':'cooperation_change_propose','outcome':'APPLIED'},
        {'cooperation_link':'other','action':'cooperation_change_propose','outcome':'APPLIED'},
        {'requested_cooperation_link':'collab','action':'request','outcome':'BLOCKED'},
    ]
    view = cooperative_coordination_observations(links[0], events)
    assert view['observed_coordination_events']['SEARCH_AND_DISCOVERY'] == {'applied':1,'blocked':1}
    assert view['observed_coordination_events']['RIGHTS_AND_NEGOTIATION'] == {'applied':1,'blocked':1}
    assert view['observed_coordination_events']['INFORMATION_AND_VERIFICATION'] == {'applied':0,'blocked':1}
    assert view['observed_coordination_events']['RENEGOTIATION_AND_ADAPTATION'] == {'applied':1,'blocked':0}
    assert view['original_execution_events_not_deemed_transaction_costs']==1
    assert view['real_transaction_cost_amount'] is None
    assert view['event_counts_are_monetary_costs'] is False
    assert view['counterfactual_avoided_transactions']=='NOT_IDENTIFIABLE'


def test_original_nine_component_view_exposes_events_as_cost_drivers_not_savings():
    subjects, owners, works, links, trace = complete_trace()
    row=cooperation_system_view(links,works,owners,subjects,N(mode='SOLE',revision='oc-1'),trace)['relations'][0]
    exposure=row['components']['Э']['transaction_coordination_exposures']
    assert exposure['observed_coordination_events']['RENEGOTIATION_AND_ADAPTATION']['applied']==6
    assert exposure['real_transaction_cost_amount'] is None
    assert exposure['causal_savings']=='NOT_IDENTIFIABLE'
    assert row['components']['ЖЦ']['organizational_change']=='NOT_AUTOMATIC'
    assert row['components']['ОК']['original_thirteen_code_requirements'][0]['qualified_original_field_count']==0


def test_original_membership_change_without_version_bump_never_inherits_old_consultation():
    subjects, owners, works, links, trace = complete_trace()
    trace[0]['original_relation_participants'] = ['a', 'b', 'c', 'op']
    subjects['e'] = N(kind='SME', active=True)
    future = (replace(links[0], participants=('a','c','d','e','op')),)
    row=cooperation_change_reviews(future,trace,current_org_revision='oc-1',subjects=subjects)[0]
    assert row['original_relation_membership_frozen'] is True
    assert row['required_count']==5
    assert row['historical_review_status']=='MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION'
    assert row['review_status']=='MODEL_REVIEW_RELATION_MEMBERSHIP_CHANGED_REVALIDATION_REQUIRED'
    assert works['x'].obligation=='NOT_ACCEPTED'
