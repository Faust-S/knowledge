"""Native Mesa only: discovery is state-dependent, not cooperative enrollment.

These are NOT_RUN without the official Mesa 3.5.2 and original QualitativeAKIS.
Do not interpret synthetic capability sources as authenticated quality or assent.
"""
from copy import deepcopy

import pytest

mesa = pytest.importorskip('mesa', reason='Official native Mesa 3.5.2 required')
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from research.akis.qualitative_mesa.tests.test_rules import fixture


def scenario():
    d = fixture()
    d['subjects'].append({'id':'c','kind':'SME'})
    d['resources'] = [
        {'id':'ra','owner':'a','availability':'AVAILABLE',
         'capacity_units':1,'capacity_unit':'team'},
        {'id':'rc','owner':'c','availability':'AVAILABLE',
         'capacity_units':1,'capacity_unit':'team'},
    ]
    d['works'] = [
        {'id':'w1','customer':'b','resource':'ra',
         'source_revision':'d-1','slot_start':12,'slot_end':15},
    ]
    d['partner_discovery'] = {
        'demands':[{
            'id':'D1','buyer':'b','work':'w1','work_source_revision':'d-1',
            'original_resource':'ra','capability':'fabricate','capacity_unit':'team',
            'source_ref':'model://b/need','available_at':0,'expires_at':12,
        }],
        'offers':[{
            'id':'O1','owner':'c','resource':'rc','capability':'fabricate',
            'capacity_unit':'team','source_ref':'model://c/capability',
            'available_at':3,'expires_at':10,
        }],
    }
    d['events'] = [
        {'at':1,'action':'offer','actor':'op','work':'w1'},
        {'at':2,'action':'authorize','actor':'op','work':'w1'},
        {'at':5,'action':'resource_status','actor':'c','resource':'rc','availability':'UNAVAILABLE'},
        {'at':6,'action':'resource_status','actor':'c','resource':'rc','availability':'AVAILABLE'},
    ]
    d['model_horizon'] = 11
    return d


def at(out,time):
    return next(row['work_proposals'][0] for row in out['formation_opportunities']['evolution']
                if row['at']==float(time))


def test_qualified_supplier_opportunity_emerges_disappears_and_restores_on_one_mesa_clock():
    d=scenario()
    out=simulate(d)
    assert at(out,0)['status']=='NO_MATCHING_INDEPENDENT_CAPABILITY_SOURCE'
    assert at(out,3)['status']=='POTENTIAL_PARTNER_REQUIRES_FRESH_ORIGINAL_OWNER_REVIEW'
    assert at(out,5)['status']=='NO_FEASIBLE_OR_AVAILABLE_PARTNER'
    assert at(out,6)['status']=='POTENTIAL_PARTNER_REQUIRES_FRESH_ORIGINAL_OWNER_REVIEW'
    assert at(out,10)['status']=='NO_MATCHING_INDEPENDENT_CAPABILITY_SOURCE'
    assert out['formation_opportunities']['new_cooperation_relation_created'] is False
    assert out['formation_opportunities']['same_mesa_scheduler'] is True
    assert out['works']['w1']['obligation']=='NOT_ACCEPTED'
    assert out['works']['w1']['consenting_principals']==[]
    assert out['works']['w1']['resource_owner']=='a'
    assert 'cooperation' not in out
    assert simulate(deepcopy(d))==out


def test_existing_accepted_obligation_cannot_be_reassigned_by_discovered_supplier():
    d=scenario()
    d['events'] = [
        {'at':1,'action':'offer','actor':'op','work':'w1'},
        {'at':2,'action':'authorize','actor':'op','work':'w1'},
        {'at':3,'action':'consent','actor':'a','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
        {'at':4,'action':'consent','actor':'b','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
        {'at':5,'action':'commit','actor':'op','work':'w1'},
    ]
    out=simulate(d)
    assert out['works']['w1']['obligation']=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert out['works']['w1']['resource_owner']=='a'
    assert out['works']['w1']['consenting_principals']==['a','b']
    assert at(out,5)['status']=='ORIGINAL_OBLIGATION_UNCHANGED'
    assert out['works']['w1']['result']=='NOT_SUBMITTED'


def test_future_request_creates_a_need_but_no_supplier_contract():
    d=scenario()
    original=deepcopy(d['works'][0])
    d['works']=[]
    d['events']=[
        {'at':4,'action':'request','actor':'b','work_spec':original},
        {'at':5,'action':'offer','actor':'op','work':'w1'},
    ]
    out=simulate(d)
    assert at(out,0)['status']=='ORIGINAL_WORK_NOT_REQUESTED'
    assert at(out,4)['status']=='POTENTIAL_PARTNER_REQUIRES_FRESH_ORIGINAL_OWNER_REVIEW'
    assert out['works']['w1']['proposal']=='OFFERED'
    assert out['works']['w1']['consenting_principals']==[]


def test_two_supplier_capabilities_do_not_create_an_automatic_partner_choice():
    d=scenario()
    d['subjects'].append({'id':'d','kind':'SME'})
    d['resources'].append({'id':'rd','owner':'d','availability':'AVAILABLE',
                           'capacity_units':1,'capacity_unit':'team'})
    new=deepcopy(d['partner_discovery']['offers'][0]);new.update({
        'id':'O2','owner':'d','resource':'rd','source_ref':'model://d/capability',
    })
    d['partner_discovery']['offers'].append(new)
    out=simulate(d)
    assert at(out,3)['status']=='MULTIPLE_PARTNERS_REQUIRE_ORIGINAL_BUYER_CHOICE'
    assert at(out,3)['candidate_count']==2
    assert out['works']['w1']['resource_owner']=='a'


def test_input_wrong_original_owner_rejected_before_clock_advances():
    d=scenario()
    d['partner_discovery']['offers'][0]['source_ref']='model://op/fake'
    with pytest.raises(InputError,match='DISCOVERY_ORIGINAL_OWNER_SOURCE_REQUIRED'):
        simulate(d)


def test_legacy_without_discovery_preserves_result_shape():
    d=fixture()
    d['events']=[{'at':1,'action':'offer','actor':'op','work':'w1'}]
    out=simulate(d)
    assert 'formation_opportunities' not in out
    assert 'partner_discovery' not in out
    assert 'decision_observations' not in out


def native_bilateral_claims():
    from research.akis.qualitative_mesa.tests.test_formation_finance import pair
    claims=pair()
    for item in claims:
        side=item['side']
        item['owner']='b' if side=='BUYER' else 'c'
        item['source_ref']='model://b/owner-finance' if side=='BUYER' else 'model://c/owner-finance'
        item['demand_source_ref']='model://b/need'
        item['offer_source_ref']='model://c/capability'
        item['work_source_revision']='d-1'
        item['available_at']=4
        item['expires_at']=9
    return claims


def test_owner_sources_produce_time_qualified_prospective_payment_range_without_consent():
    d=scenario()
    d['partner_discovery']['formation_finance']=native_bilateral_claims()
    out=simulate(d)
    assert at(out,3)['economic_status']=='BILATERAL_OWNER_EVIDENCE_INCOMPLETE'
    assert at(out,4)['economic_status']=='ONE_PROSPECTIVE_BILATERAL_INTERVAL_NOT_CONSENTED'
    assert at(out,4)['economically_possible_count']==1
    assert at(out,5)['economic_status']=='NO_TECHNICALLY_FEASIBLE_PAIR'
    assert at(out,6)['economically_possible_count']==1
    assert at(out,9)['economic_status']=='BILATERAL_OWNER_EVIDENCE_INCOMPLETE'
    assert out['formation_opportunities']['economic_choice']=='SOURCE_DECLARED_BILATERAL_INTERVAL_ONLY'
    assert out['formation_opportunities']['new_cooperation_relation_created'] is False
    assert '155.00' not in str(out)
    assert '150.00' not in str(out)
    assert out['works']['w1']['resource_owner']=='a'
    assert out['works']['w1']['consenting_principals']==[]
    assert simulate(deepcopy(d))==out


def test_provider_financial_refusal_or_capital_shortage_prevents_fictitious_deal():
    d=scenario()
    d['partner_discovery']['formation_finance']=native_bilateral_claims()
    d['partner_discovery']['formation_finance'][1]['intent']='DECLINES'
    result=simulate(d)
    assert at(result,4)['economically_possible_count']==0
    d['partner_discovery']['formation_finance'][1]['intent']='WILLING'
    d['partner_discovery']['formation_finance'][1]['liquidity']['available_working_capital_cash']='10.00'
    result=simulate(d)
    assert at(result,4)['economically_possible_count']==0
    assert result['works']['w1']['obligation']=='NOT_ACCEPTED'


def test_unilateral_financial_quote_cannot_be_promoted_to_common_economic_evidence():
    d=scenario()
    d['partner_discovery']['formation_finance']=native_bilateral_claims()[:1]
    out=simulate(d)
    assert at(out,4)['economic_status']=='BILATERAL_OWNER_EVIDENCE_INCOMPLETE'
    assert at(out,4)['economically_possible_count']==0
    assert 'cooperation' not in out

def test_source_default_cannot_masquerade_as_an_owner_available_resource():
    d=scenario()
    del d['resources'][1]['availability']
    out=simulate(d)
    assert at(out,3)['status']=='RESOURCE_AVAILABILITY_SOURCE_MISSING'
    assert at(out,6)['status']=='POTENTIAL_PARTNER_REQUIRES_FRESH_ORIGINAL_OWNER_REVIEW'
    assert out['works']['w1']['resource_owner']=='a'


def test_original_need_must_have_explicit_matching_capacity_unit():
    d=scenario()
    del d['resources'][0]['capacity_units']
    del d['resources'][0]['capacity_unit']
    out=simulate(d)
    assert at(out,3)['status']=='ORIGINAL_WORK_CAPACITY_UNIT_UNQUALIFIED'
    assert out['formation_opportunities']['current_opportunity_count']==0
    assert out['works']['w1']['consenting_principals']==[]
