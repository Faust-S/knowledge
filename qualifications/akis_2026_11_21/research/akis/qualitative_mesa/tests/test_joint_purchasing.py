from copy import deepcopy
from types import SimpleNamespace as N

import pytest
from research.akis.qualitative_mesa.joint_purchasing import PurchasingInputError, parse_plans, evaluate_plan, _shared_cents, _quote

SUBJECTS = {k: N(kind="SME",active=True) for k in ("a","b","c")}
SUBJECTS['op'] = N(kind="OPERATOR",active=True)
WORKS = {f'w-{k}':N(key=f'w-{k}',source_revision=f'r-{k}',customer=k,result='NOT_SUBMITTED') for k in ('a','b','c')}
LINK = N(key='network', source_revision='link-r1', participants=('a','b','c','op'),
         coordinator='op', works=tuple(WORKS))


def money(amount): return f'{amount:.2f}'


def buyer(owner, qty):
    return {
        'owner':owner, 'work':f'w-{owner}', 'work_source_revision':f'r-{owner}',
        'source_ref':f'model://{owner}/need-1',
        'available_at':1,'expires_at':20,'quantity_units':qty,
        'outside_unit_cash':'100.00',
        'outside_transaction_cash':'0.00', 'outside_marketing_cash':'0.00',
        'outside_logistics_cash':'0.00', 'cooperation_transaction_cash':'0.00',
        'cooperation_marketing_cash':'0.00', 'cooperation_logistics_cash':'0.00',
        'switching_cash':'0.00', 'minimum_net_gain_cash':'10.00',
        'requires_accepted_results':[],
    }


def plan(q3=5):
    return {
        'id':'p1','relation':'network','relation_source_revision':'link-r1',
        'org_revision':'oc-1','product':'model-part','unit':'piece',
        'period':'2026-11','currency':'RUB',
        'supplier_source_ref':'model://supplier/offer-1',
        'supplier_valid_from':1,'supplier_valid_until':20,'capacity_units':50,
        'price_tiers':[{'minimum_units':1,'unit_cash':'100.00'},
                       {'minimum_units':20,'unit_cash':'80.00'}],
        'shared_costs':{'transaction_cash':'120.00','marketing_cash':'100.00',
                        'logistics_cash':'60.00','operator_fee_cash':'40.00'},
        'buyers':[buyer('a',12),buyer('b',8),buyer('c',q3)],
    }


def run(source=None, *, willing={'a','b','c'}, at=5, works=None, org='oc-1', link=LINK):
    source=plan() if source is None else source
    parsed=parse_plans([source],SUBJECTS,[link],{**WORKS,**(works or {})})[0]
    state=dict(WORKS)
    if works: state.update(works)
    return evaluate_plan(parsed,at=at,org_revision=org,links=[link],
                         subjects=SUBJECTS,works=state,willing_owners=set(willing))


def test_all_three_viable_with_quantity_discount_and_shared_costs():
    out=run()
    assert out['status']=='UNIQUE_PROSPECTIVE_GROUP_NOT_CONSENTED'
    assert out['prospective_buyer_count']==3
    assert out['prospective_quantity_units']==25
    assert out['tier_minimum_units']==20
    assert out['feasible_group_count'] >= 1
    parsed=parse_plans([plan()],SUBJECTS,[LINK],WORKS)[0]
    quote=_quote(parsed, parsed.buyers)
    assert {k:f'{v:.2f}' for k,v in quote['deltas'].items()}=={
        'a':'86.40','b':'57.60','c':'36.00'
    }
    assert '86.40' not in str(out)  # private amounts never leave pool evaluator
    assert out['system_profit']=='NOT_IDENTIFIABLE'
    assert not out['actual_coalition_created']


def test_one_owner_declines_and_size_discount_lost():
    out=run(willing={'a','c'})
    assert out['status']=='NO_VOLUNTARILY_VIABLE_GROUP'
    assert out['feasible_group_count']==0
    assert out['positions']['b']['position']=='UNKNOWN'


def test_operator_and_coordination_costs_reverse_group_benefit():
    p=plan();p['shared_costs']['operator_fee_cash']='2000.00'
    assert run(p)['status']=='NO_VOLUNTARILY_VIABLE_GROUP'


def test_small_supplier_capacity_blocks_joint_quantity():
    p=plan();p['capacity_units']=18
    p['price_tiers']=[{'minimum_units':1,'unit_cash':'100.00'}]
    assert run(p)['status']=='NO_VOLUNTARILY_VIABLE_GROUP'


def test_ambiguous_buyer_groups_do_not_automatically_select_winners():
    p=plan(q3=8)
    p['capacity_units']=20
    out=run(p)
    assert out['status']=='MULTIPLE_POSSIBLE_GROUPS_OWNER_CHOICE_REQUIRED'
    assert out['feasible_group_count']==2
    assert all(v['position']=='UNKNOWN' for v in out['positions'].values())


def test_no_unknown_buyers_auto_opt_in():
    assert run(willing=set())['eligible_buyer_count']==0
    assert run(willing={'a'})['status']=='NO_VOLUNTARILY_VIABLE_GROUP'


def test_quote_and_owned_need_are_time_qualified():
    assert run(at=0)['status']=='SOURCE_NOT_CURRENT'
    assert run(at=20)['status']=='SOURCE_NOT_CURRENT'
    assert run(at=5,org='oc-2')['status']=='SOURCE_NOT_CURRENT'
    p=plan();p['buyers'][0]['expires_at']=3
    assert run(p,willing={'a','b'})['eligible_buyer_count']==1


def test_future_request_must_enter_original_work_and_relation_first():
    state=dict(WORKS);state.pop('w-c')
    parsed=parse_plans([plan()],SUBJECTS,[LINK],WORKS)[0]
    row=evaluate_plan(parsed,at=5,org_revision='oc-1',links=[LINK],
                      subjects=SUBJECTS,works=state,willing_owners={'a','b','c'})
    assert row['eligible_buyer_count']==2
    assert row['prospective_buyer_count']==2


def test_prior_original_result_gate_blocks_or_releases_joining():
    p=plan();p['buyers'][2]['requires_accepted_results']=[{'work':'w-a','source_revision':'r-a'}]
    assert run(p)['prospective_buyer_count']==2
    accepted=N(key='w-a',source_revision='r-a',customer='a',result='ACCEPTED_BY_ORIGINAL_RECIPIENT')
    assert run(p,works={'w-a':accepted})['prospective_buyer_count']==3
    wrong=N(key='w-a',source_revision='r-x',customer='a',result='ACCEPTED_BY_ORIGINAL_RECIPIENT')
    parsed=parse_plans([p],SUBJECTS,[LINK],WORKS)[0]
    altered=evaluate_plan(parsed,at=5,org_revision='oc-1',links=[LINK],
                          subjects=SUBJECTS,works={**WORKS,'w-a':wrong},
                          willing_owners={'a','b','c'})
    assert altered['status']=='NO_VOLUNTARILY_VIABLE_GROUP' 


def test_proportional_allocation_conserves_cents_even_with_remainder():
    p=plan();p['shared_costs']={k:'0.00' for k in p['shared_costs']}
    p['shared_costs']['transaction_cash']='0.01'
    parsed=parse_plans([p],SUBJECTS,[LINK],WORKS)[0]
    cents=_shared_cents(parsed,parsed.buyers)
    assert sorted(cents.values()) == [0,0,1]
    assert sum(cents.values())==1


@pytest.mark.parametrize('modify,reason',[
    (lambda p:p.update(currency='USDT'),'PURCHASING_INVALID_CURRENCY'),
    (lambda p:p['buyers'][0].update(quantity_units=0),'PURCHASING_INVALID_QUANTITY'),
    (lambda p:p['buyers'][0].update(source_ref='model://b/stolen'),'PURCHASING_OWNER_OR_SUPPLIER_SOURCE_REQUIRED'),
    (lambda p:p['buyers'][0].update(outside_unit_cash=100.0),'PURCHASING_INVALID_CASH_AMOUNT'),
    (lambda p:p['buyers'][0].update(owner='op'),'PURCHASING_BUYER_NOT_ENTERPRISE'),
    (lambda p:p['buyers'][1].update(owner='a'),'PURCHASING_ORIGINAL_BUYER_WORK_REQUIRED'),
    (lambda p:p.update(supplier_source_ref='model://a/stolen'),'PURCHASING_OWNER_OR_SUPPLIER_SOURCE_REQUIRED'),
    (lambda p:p['price_tiers'].append({'minimum_units':2,'unit_cash':'90.00'}),'PURCHASING_TIER_ORDER_OR_CAPACITY_INVALID'),
    (lambda p:p['buyers'][0].update(available_at=20),'PURCHASING_INVALID_VALIDITY_INTERVAL'),
    (lambda p:p['buyers'][0].update(requires_accepted_results=[{'work':'w-a','source_revision':'r-a'}]),'PURCHASING_INVALID_PRIOR_WORK'),
])
def test_malformed_and_owner_transgressions_rejected(modify,reason):
    p=plan();modify(p)
    with pytest.raises(PurchasingInputError,match=reason):
        parse_plans([p],SUBJECTS,[LINK],WORKS)


def test_model_source_unchanged_during_simulated_quote():
    p=plan();before=deepcopy(p)
    run(p)
    assert p==before


def test_same_buyer_or_plan_cannot_be_double_counted():
    p=plan();p['buyers'][1]['owner']='a';p['buyers'][1]['work']='w-a';p['buyers'][1]['work_source_revision']='r-a'
    with pytest.raises(PurchasingInputError,match='PURCHASING_DUPLICATE_BUYER_OR_WORK'):
        parse_plans([p],SUBJECTS,[LINK],WORKS)
    with pytest.raises(PurchasingInputError,match='PURCHASING_DUPLICATE_PLAN'):
        parse_plans([plan(),plan()],SUBJECTS,[LINK],WORKS)

def test_largest_partial_group_is_not_a_right_to_exclude_willing_member():
    p=plan();p['buyers'][2]['minimum_net_gain_cash']='999.00'
    result=run(p)
    assert result['status']=='PARTIAL_GROUP_REQUIRES_INDEPENDENT_MEMBERSHIP_SELECTION'
    assert result['feasible_group_count']>=1
    assert all(x['position']=='UNKNOWN' for x in result['positions'].values())
