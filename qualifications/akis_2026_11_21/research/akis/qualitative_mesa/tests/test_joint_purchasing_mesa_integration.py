"""Official Mesa integration of voluntary purchase groups and current original rights.

Not a legal signature, real supplier quotation, business savings or field trial.
Tests stay NOT_RUN until genuine mesa==3.5.2 and original IWXA source are available.
"""
from copy import deepcopy

import pytest

mesa = pytest.importorskip('mesa', reason='Official native Mesa required; no synthetic qualification')

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_rules import fixture
from research.akis.qualitative_mesa.tests.test_joint_purchasing import plan


def scenario():
    d = fixture()
    d['subjects'].append({'id':'c', 'kind':'SME'})
    d['resources'] = [
        {'id':f'r-{owner}', 'owner':owner, 'availability':'AVAILABLE'}
        for owner in ('a','b','c')
    ]
    d['works'] = [
        {'id':f'w-{owner}', 'customer':owner, 'resource':f'r-{owner}',
         'source_revision':f'r-{owner}', 'slot_start':20+i*4,
         'slot_end':24+i*4}
        for i, owner in enumerate(('a','b','c'))
    ]
    d['cooperation_links'] = [{
        'id':'network', 'purpose':'voluntary shared purchasing',
        'coordinator':'op', 'participants':['a','b','c','op'],
        'works':['w-a','w-b','w-c'],
        'mechanisms':['JOINT_PURCHASING','TRANSACTION_COST','SHARED_MARKETING'],
        'source_ref':'model://network', 'source_revision':'link-r1',
    }]
    d['decision_profiles'] = [
        {'subject':owner, 'work':f'w-{owner}',
         'source_revision':f'r-{owner}', 'org_revision':'oc-1',
         'willingness':'WILLING', 'outside_option':'UNKNOWN'}
        for owner in ('a','b','c')
    ]
    d['joint_purchasing_proposals']=[plan()]
    d['events']=[
        {'at':n, 'action':a, 'actor':'op', 'work':f'w-{owner}'}
        for n,(a,owner) in enumerate([
            ('offer','a'),('offer','b'),('offer','c'),
            ('authorize','a'),('authorize','b'),('authorize','c'),
        ], 1)
    ]
    d['model_horizon']=8
    return d


def interest(at, value='WILLING', outside='UNKNOWN'):
    return {
        'at':at, 'action':'interest_update', 'actor':'b', 'work':'w-b',
        'source_revision':'r-b', 'org_revision':'oc-1',
        'cooperation_link':'network', 'cooperation_source_revision':'link-r1',
        'economic_channel':'JOINT_PURCHASING',
        'new_willingness':value, 'new_outside_option':outside,
        'interest_evidence_ref':f'model://b-interest-{at}',
    }


def observe(out,owner,at):
    rows = [x for x in out['decision_observations']
            if x['subject']==owner and x['work']==f'w-{owner}' and x['at']==float(at)]
    assert rows
    return rows[-1]


def test_joint_pool_from_original_willing_needs_changes_model_decisions():
    d=scenario()
    out=simulate(d)
    for owner in ('a','b','c'):
        row=observe(out, owner, 6)
        assert row['assessment']=='REVIEWABLE_NOT_CONSENTED'
        assert row['joint_purchasing_position']=='COOPERATION_PREFERRED'
    view=out['cooperation']['joint_purchasing_model']['proposals'][0]
    assert view['status']=='UNIQUE_PROSPECTIVE_GROUP_NOT_CONSENTED'
    assert view['prospective_quantity_units']==25
    assert view['prospective_buyer_count']==3
    assert 'positions' not in view and '86.40' not in str(out)
    assert all(not out['works'][w]['consenting_principals'] for w in out['works'])
    assert out['profit']['system_increment']=='UNKNOWN'
    assert simulate(deepcopy(d))==out


def test_owner_decline_collapses_discount_without_changing_original_obligations():
    d=scenario()
    d['events'].append(interest(7, 'DECLINES', 'OUTSIDE_PREFERRED'))
    out=simulate(d)
    assert out['counts']['blocked']==0
    assert observe(out,'a',7)['assessment']=='OUTSIDE_OPTION_UNKNOWN'
    assert observe(out,'b',7)['assessment']=='INDEPENDENT_DECLINE'
    assert observe(out,'c',7)['joint_purchasing_group_status']=='NO_VOLUNTARILY_VIABLE_GROUP'
    assert all(row['obligation']=='NOT_ACCEPTED' for row in out['works'].values())
    assert all(row['result']=='NOT_SUBMITTED' for row in out['works'].values())
    assert out['cooperation']['joint_purchasing_model']['proposals'][0]['feasible_group_count']==0


def test_owner_resume_requires_new_declared_interest_not_operator_substitution():
    d=scenario()
    d['events'].extend([interest(7,'DECLINES','OUTSIDE_PREFERRED'),interest(8)])
    out=simulate(d)
    assert observe(out,'a',7)['assessment']=='OUTSIDE_OPTION_UNKNOWN'
    assert observe(out,'a',8)['assessment']=='REVIEWABLE_NOT_CONSENTED'
    assert observe(out,'b',8)['assessment']=='REVIEWABLE_NOT_CONSENTED'
    assert out['cooperation']['joint_purchasing_model']['proposals'][0]['prospective_buyer_count']==3
    assert all(not row['consenting_principals'] for row in out['works'].values())


def test_current_purchasing_source_expires_after_explicit_horizon():
    d=scenario()
    d['model_horizon']=20
    out=simulate(d)
    assert observe(out,'a',20)['joint_purchasing_group_status']=='SOURCE_NOT_CURRENT'
    assert observe(out,'a',20)['assessment']=='OUTSIDE_OPTION_UNKNOWN'
    assert out['cooperation']['joint_purchasing_model']['proposals'][0]['status']=='SOURCE_NOT_CURRENT'


def test_multiple_price_plans_same_owner_work_cannot_be_auto_selected():
    d=scenario()
    second=deepcopy(d['joint_purchasing_proposals'][0])
    second['id']='another-price-plan'
    d['joint_purchasing_proposals'].append(second)
    out=simulate(d)
    for owner in ('a','b','c'):
        row=observe(out,owner,6)
        assert row['joint_purchasing_position']=='UNKNOWN'
        assert row['joint_purchasing_reason']=='MULTIPLE_PURCHASE_PLANS_OWNER_CHOICE_REQUIRED'
        assert row['assessment']=='OUTSIDE_OPTION_UNKNOWN'

def test_one_original_work_in_two_relations_does_not_select_purchasing_partner():
    d=scenario()
    other=deepcopy(d['cooperation_links'][0])
    other['id']='other-network'
    other['source_ref']='model://other-network'
    other['source_revision']='link-r2'
    d['cooperation_links'].append(other)
    out=simulate(d)
    for owner in ('a','b','c'):
        row=observe(out,owner,6)
        assert row['joint_purchasing_position']=='UNKNOWN'
        assert row['joint_purchasing_reason']=='MULTIPLE_RELATIONS_REQUIRE_OWNER_CHOICE'
        assert row['assessment']=='OUTSIDE_OPTION_UNKNOWN'
    assert all(not row['consenting_principals'] for row in out['works'].values())
