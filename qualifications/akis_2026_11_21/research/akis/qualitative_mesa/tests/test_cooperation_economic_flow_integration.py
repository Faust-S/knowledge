"""Economic-flow integration on the exact original closed-repository module.

The first bridge is references, not a new cost ledger or authenticated evidence.
"""
from copy import deepcopy
from types import SimpleNamespace as N

import pytest

from research.akis.qualitative_mesa.economic_flow import (
    EconomicInputError, evaluate_economic_claims,
)
from research.akis.qualitative_mesa.tests.test_cooperation import prepared, scenario


def case():
    links, works, _ = prepared()
    parties, _, _, _ = scenario()
    doc = {
        'period':'model-2026-11','currency':'RUB',
        'sources':[{'id':'src','owner':'c','reference':'model://c-cost-reference','revision':'r1'}],
        'transfers':[],
        'resource_uses':[
            {'id':'rc','scenario':'COOPERATION','owner':'c','amount':'12.00',
             'bucket':'COORDINATION','source':'src','work':'x'},
            {'id':'ri','scenario':'INDEPENDENT_ALTERNATIVE','owner':'c',
             'amount':'25.00','bucket':'COORDINATION','source':'src','work':'x'},
        ],
        'coverage':{'COOPERATION':{'c':'src'},'INDEPENDENT_ALTERNATIVE':{'c':'src'}},
        'outside_feasibility':{'c':{'state':'FEASIBLE_DECLARED','source':'src'}},
        'mechanism_allocations':[
            {'id':'m1','link':'collab','owner':'c','channel':'TRANSACTION_COST',
             'source':'src','comparability_source':'src',
             'comparability_state':'COMPARABLE_DECLARED',
             'cooperation_scope_source':'src','outside_scope_source':'src',
             'cooperation_resource_use_ids':['rc'],'outside_resource_use_ids':['ri'],
             'cooperation_cash_outflow_ids':[],'outside_cash_outflow_ids':[]},
        ],
        'coordination_event_bindings':[
            {'link':'collab','owner':'c','channel':'TRANSACTION_COST','event_at':3,
             'resource_use_id':'rc','source':'src'},
        ],
    }
    trace=[{'at':3,'action':'request','actor':'c','work':'x','outcome':'APPLIED'},
           {'at':4,'action':'consent','actor':'c','work':'x','outcome':'BLOCKED'}]
    return doc, parties, works, links, trace


def test_optional_event_bindings_are_zero_new_economic_records():
    doc, parties, works, links, trace=case()
    baseline=deepcopy(doc)
    baseline.pop('coordination_event_bindings')
    before=evaluate_economic_claims(baseline,parties,works,links)
    after=evaluate_economic_claims(doc,parties,works,links,trace)
    assert before['resource_uses_count']==after['resource_uses_count']==2
    assert before['transfers_count']==after['transfers_count']==0
    assert before['consolidated_external_cash_from_claims']==after['consolidated_external_cash_from_claims']
    assert before['per_subject']==after['per_subject']
    assert after['resource_costs_additive_to_cash'] is False
    assert after['cooperation_cost_channels']['claimed_channels'][0]['resource_cost_reduction_claim']=='13.00'
    assert after['cooperative_event_costs']['linked_cost_rows']==1
    row=after['cooperative_event_costs']['relations'][0]
    assert row['declared_existing_resource_use_amount']=='12.00'
    assert row['real_transaction_cost_verified'] is False
    assert row['resource_uses_additive_to_cash'] is False
    assert after['comparative_causal_effect']=='NOT_IDENTIFIABLE'


def test_increasing_actual_declared_coordination_cost_can_reverse_declared_saving():
    doc, parties, works, links, trace=case()
    doc['resource_uses'][0]['amount']='30.00'
    output=evaluate_economic_claims(doc,parties,works,links,trace)
    assert output['cooperation_cost_channels']['claimed_channels'][0]['resource_cost_reduction_claim']=='-5.00'
    assert output['cooperative_event_costs']['relations'][0]['declared_existing_resource_use_amount']=='30.00'
    assert output['cooperative_event_costs']['causal_effect']=='NOT_IDENTIFIABLE'
    assert output['profit']=='UNKNOWN'


def test_original_legacy_economics_works_without_any_new_key():
    doc, parties, works, links, trace=case()
    doc.pop('coordination_event_bindings')
    doc.pop('mechanism_allocations')
    output=evaluate_economic_claims(doc,parties,works,links)
    assert 'cooperative_event_costs' not in output
    assert 'cooperation_cost_channels' not in output
    assert output['resource_uses_count']==2


def test_event_cost_claim_requires_existing_mechanism_allocation():
    doc, parties, works, links, trace=case()
    doc.pop('mechanism_allocations')
    with pytest.raises(EconomicInputError,match='COOPERATION_EVENT_COST_REQUIRES_EXISTING_CHANNELS'):
        evaluate_economic_claims(doc,parties,works,links,trace)


def test_work_event_without_trace_or_wrong_owner_cannot_claim_a_cost():
    doc, parties, works, links, trace=case()
    with pytest.raises(EconomicInputError,match='EVENT_NOT_IN_TRACE'):
        evaluate_economic_claims(doc,parties,works,links)
    doc['coordination_event_bindings'][0]['source']='bad'
    with pytest.raises(EconomicInputError,match='SOURCE_OWNER_REQUIRED'):
        evaluate_economic_claims(doc,parties,works,links,trace)


def test_invalid_extra_record_not_admitted_to_existing_economic_document():
    doc, parties, works, links, trace=case()
    doc['unknown_economic_ledger']={}
    with pytest.raises(EconomicInputError,match='INVALID_ECONOMICS_FIELDS'):
        evaluate_economic_claims(doc,parties,works,links,trace)


def test_joint_purchase_cash_discount_does_not_cancel_coordination_or_marketing_losses():
    """One cooperative relation, three economic mechanisms, no fictitious net."""
    doc, parties, works, links, trace = case()
    doc['resource_uses'][0]['amount']='30.00'
    doc['resource_uses'][1]['amount']='10.00'
    doc['transfers'] += [
        {'id':'joint','scenario':'COOPERATION','payer':'c','payee':'EXTERNAL',
         'amount':'70.00','source':'src','work':'x'},
        {'id':'alone','scenario':'INDEPENDENT_ALTERNATIVE','payer':'c','payee':'EXTERNAL',
         'amount':'90.00','source':'src','work':'x'},
    ]
    doc['resource_uses'] += [
        {'id':'marketing_joint','scenario':'COOPERATION','owner':'c','amount':'40.00',
         'bucket':'COMMON_CAPABILITY','source':'src','work':'x'},
        {'id':'marketing_alone','scenario':'INDEPENDENT_ALTERNATIVE','owner':'c','amount':'15.00',
         'bucket':'COMMON_CAPABILITY','source':'src','work':'x'},
    ]
    m = deepcopy(doc['mechanism_allocations'][0])
    m.update(id='m-purchase', channel='JOINT_PURCHASE',
             cooperation_resource_use_ids=[],outside_resource_use_ids=[],
             cooperation_cash_outflow_ids=['joint'], outside_cash_outflow_ids=['alone'])
    doc['mechanism_allocations'].append(m)
    m2=deepcopy(m)
    m2.update(id='m-marketing',channel='SHARED_MARKETING',
              cooperation_resource_use_ids=['marketing_joint'],
              outside_resource_use_ids=['marketing_alone'],
              cooperation_cash_outflow_ids=[],outside_cash_outflow_ids=[])
    doc['mechanism_allocations'].append(m2)
    output=evaluate_economic_claims(doc,parties,works,links,trace)
    channels={item['channel']:item for item in output['cooperation_cost_channels']['claimed_channels']}
    assert channels['JOINT_PURCHASE']['buyer_cash_outlay_reduction_claim']=='20.00'
    assert channels['TRANSACTION_COST']['resource_cost_reduction_claim']=='-20.00'
    assert channels['SHARED_MARKETING']['resource_cost_reduction_claim']=='-25.00'
    assert all(item['combined_savings'] is None for item in channels.values())
    assert output['cooperative_event_costs']['linked_cost_rows']==1
    assert output['resource_uses_count']==4
    assert output['transfers_count']==2
    assert output['consolidated_comparable_declared'] is False
    assert output['profit']=='UNKNOWN'
    assert output['economic_value_added']=='NOT_IDENTIFIABLE'
    assert output['organizational_change']=='NOT_AUTOMATIC'
