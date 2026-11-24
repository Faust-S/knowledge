"""Source-bound empirical bridge: coordination events -> original economic rows.

References only, never a new money ledger, legal consent or automatic saving.
"""
from decimal import Decimal
from types import SimpleNamespace as N

import pytest

from research.akis.qualitative_mesa.cooperation import (
    CooperationInputError, attribute_cooperative_event_costs,
    cooperation_system_view, evaluate_cooperation_cost_channels,
)
from research.akis.qualitative_mesa.tests.test_cooperation import (
    prepared, ledgers, entry, scenario, parse_cooperation_links,
)


def setup():
    links, works, owners = prepared()
    sources, transfers, resources, coverage, alternative = ledgers()
    resources['rc']['bucket'] = 'COORDINATION'
    resources['rc']['source'] = 'src'
    resources['rc']['work'] = 'x'
    mechanism = entry()
    channel = evaluate_cooperation_cost_channels(
        [mechanism], links, sources, transfers, resources, coverage, alternative,
    )
    trace = [
        {'at':3, 'work':'x','action':'request','actor':'c','outcome':'APPLIED'},
        {'at':4, 'work':'x','action':'consent','actor':'c','outcome':'APPLIED'},
        {'at':5, 'work':'x','action':'start_operation','actor':'b','outcome':'APPLIED'},
    ]
    claim = {'link':'collab','owner':'c','channel':'MEMBER_SOURCING',
             'event_at':4,'resource_use_id':'rc','source':'src'}
    return links, works, owners, sources, resources, channel, trace, claim


def eval_claims(links, sources, resources, channel, trace, claims):
    return attribute_cooperative_event_costs(claims, links, trace,
                                              sources, resources, channel)


def test_existing_resource_use_is_linked_to_owner_original_consent_not_repriced():
    links, works, owners, sources, resources, channel, trace, claim = setup()
    result=eval_claims(links, sources, resources, channel, trace, [claim])
    assert result['linked_cost_rows'] == 1
    assert result['economic_records_created'] == 0
    row=result['relations'][0]
    assert row['distinct_original_events_with_cost_rows'] == 1
    assert row['declared_existing_resource_use_amount'] == '12.00'
    assert row['possible_cooperative_events_without_cost_binding'] == 1
    assert row['original_cost_rows_not_duplicated'] is True
    assert row['resource_uses_additive_to_cash'] is False
    assert row['same_period_independent_alternative'] == 'NOT_ESTABLISHED_BY_EVENT_BINDING'
    assert row['real_transaction_cost_verified'] is False
    assert result['causal_effect'] == 'NOT_IDENTIFIABLE'
    assert resources['rc']['decimal_amount'] == Decimal('12.00')


def test_noncooperative_execution_cannot_be_money_cost_attributed():
    l,w,o,src,res,channel,trace,claim=setup()
    with pytest.raises(CooperationInputError,match='NOT_COORDINATION_EVENT'):
        eval_claims(l,src,res,channel,trace,[claim | {'event_at':5}])


@pytest.mark.parametrize('changed,reason', [
    ({'link':'missing'},'LINK_UNKNOWN'),
    ({'owner':'op'},'SOURCE_OWNER_REQUIRED'),
    ({'owner':'other'},'PARTY_OR_CHANNEL_UNKNOWN'),
    ({'channel':'SHARED_MARKETING'},'NOT_IN_EXISTING_CHANNEL'),
    ({'event_at':99},'EVENT_NOT_IN_TRACE'),
    ({'event_at':True},'TIME_INVALID'),
    ({'event_at':'4'},'TIME_INVALID'),
    ({'resource_use_id':'bad'},'RESOURCE_USE_UNKNOWN'),
    ({'source':'bad'},'SOURCE_OWNER_REQUIRED'),
])
def test_invalid_event_cost_evidence_never_accepted(changed,reason):
    l,w,o,src,res,channel,trace,claim=setup()
    with pytest.raises(CooperationInputError,match=reason):
        eval_claims(l,src,res,channel,trace,[claim | changed])


def test_owner_does_not_claim_other_sme_communication_cost():
    l,w,o,src,res,channel,trace,claim=setup()
    trace[1]['actor']='b'
    with pytest.raises(CooperationInputError,match='UNAUTHORIZED_CROSS_OWNER_ATTRIBUTION'):
        eval_claims(l,src,res,channel,trace,[claim])


def test_two_cost_rows_one_original_event_not_two_transactions():
    l,w,o,src,res,channel,trace,claim=setup()
    res['rc2']={'scenario':'COOPERATION','owner':'c','work':'x',
                'bucket':'FAILURE','decimal_amount':Decimal('3.00'),'source':'src'}
    channel['claimed_channels'][0]['ledger_record_ids']['cooperation_resource_uses'].append('rc2')
    claims=[claim, claim | {'resource_use_id':'rc2'}]
    result=eval_claims(l,src,res,channel,trace,claims)['relations'][0]
    assert result['resource_use_rows_already_in_original_ledger'] == 2
    assert result['distinct_original_events_with_cost_rows'] == 1
    assert result['declared_existing_resource_use_amount'] == '15.00'
    with pytest.raises(CooperationInputError,match='RESOURCE_DOUBLE_LINKED'):
        eval_claims(l,src,res,channel,trace,[claim,claim])


def test_blocked_original_negotiation_can_have_cost_but_not_consensual_effect():
    l,w,o,src,res,channel,trace,claim=setup()
    trace[1]['outcome']='BLOCKED'
    result=eval_claims(l,src,res,channel,trace,[claim])
    assert result['linked_cost_rows']==1
    assert result['source_and_rights_authentication']=='NOT_QUALIFIED'
    assert result['relations'][0]['causal_cost_reduction']=='NOT_IDENTIFIABLE'


def test_wrong_period_scenario_or_work_cannot_consume_original_cost():
    l,w,o,src,res,channel,trace,claim=setup()
    res['rc']['scenario']='INDEPENDENT_ALTERNATIVE'
    with pytest.raises(CooperationInputError,match='LEDGER_SCOPE_INVALID'):
        eval_claims(l,src,res,channel,trace,[claim])
    res['rc']['scenario']='COOPERATION'
    res['rc']['work']='other'
    with pytest.raises(CooperationInputError,match='WORK_MISMATCH'):
        eval_claims(l,src,res,channel,trace,[claim])


def test_separate_relation_or_ambiguous_model_time_cannot_be_cost_source():
    l,w,o,src,res,channel,trace,claim=setup()
    trace[1]['work']='other'
    with pytest.raises(CooperationInputError,match='EVENT_UNRELATED'):
        eval_claims(l,src,res,channel,trace,[claim])
    trace[1]['work']='x'
    trace.append({'at':4,'work':'x','action':'consent','actor':'c','outcome':'APPLIED'})
    with pytest.raises(CooperationInputError,match='EVENT_AMBIGUOUS'):
        eval_claims(l,src,res,channel,trace,[claim])


def test_whole_system_view_never_rediscloses_individual_evidence_amount():
    l,w,o,src,res,channel,trace,claim=setup()
    for item in scenario()[0].values():
        item.active=True
    subjects, owners, works, raw=scenario()
    for value in subjects.values():value.active=True
    works['x'].result_ref=None
    economics={'cooperative_event_costs':eval_claims(l,src,res,channel,trace,[claim])}
    view=cooperation_system_view(l,works,owners,subjects,N(mode='SOLE',revision='oc-1'),trace,
                                 economics=economics)['relations'][0]
    visible=view['components']['Э']['original_event_cost_evidence']
    assert visible['linked_cost_rows']==1
    assert visible['linked_events']==1
    assert visible['cost_claims']=='OWNER_SCOPED_NOT_REDISCLOSED'
    assert '12.00' not in str(view)
    assert view['components']['ЖЦ']['organizational_change']=='NOT_AUTOMATIC'


def test_event_cost_source_must_match_the_actual_existing_owner_ledger_row():
    links,works,owners,sources,costs,channels,trace,claim=setup()
    sources['another']={'owner':'c'}
    with pytest.raises(CooperationInputError,match='SOURCE_ROW_MISMATCH'):
        eval_claims(links,sources,costs,channels,trace,[claim | {'source':'another'}])


def test_original_operator_may_bear_its_own_cost_for_sme_coordination_event():
    links,works,owners,src,res,channel,trace,claim=setup()
    src['opsource']={'owner':'op'}
    res['operator_coordination']={'owner':'op','source':'opsource',
                                  'scenario':'COOPERATION','work':'x',
                                  'bucket':'COORDINATION','decimal_amount':Decimal('5.00')}
    channels={'claimed_channels':[{'id':'operator-channel','link':'collab',
             'channel':'TRANSACTION_COST','owner':'op','comparison':'NOT_IDENTIFIABLE',
             'ledger_record_ids':{'cooperation_resource_uses':['operator_coordination']}}]}
    item=claim | {'owner':'op','channel':'TRANSACTION_COST',
                  'resource_use_id':'operator_coordination','source':'opsource'}
    result=eval_claims(links,src,res,channels,trace,[item])
    assert result['linked_cost_rows']==1
    assert result['relations'][0]['owners_with_source_declared_cost_evidence']==1
    assert result['relations'][0]['declared_existing_resource_use_amount']=='5.00'
    assert result['relations'][0]['causal_cost_reduction']=='NOT_IDENTIFIABLE'
