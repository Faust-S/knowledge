"""Real QualitativeAKIS transitions using one multi-owner capacity ledger.

These tests require the original private-source rules.py, not only the isolated
capacity helpers. One additional native test requires mesa==3.5.2.
"""
from copy import deepcopy

import pytest

from .test_rules import fixture, apply


def world(*, strict=False, explicit=True):
    data = fixture()
    data['subjects'].append({'id': 'c', 'kind': 'SME'})
    data['capacity_strict'] = strict
    data['resources'] = [
        {'id': 'ra', 'owner': 'a', 'availability': 'AVAILABLE'},
        {'id': 'rb', 'owner': 'b', 'availability': 'AVAILABLE'},
    ]
    if explicit:
        data['resources'][0].update(capacity_units=2, capacity_unit='machine', site='a-shop')
        data['resources'][1].update(capacity_units=1, capacity_unit='worker', site='b-shop')
    data['works'] = [{
        'id': 'w1', 'customer': 'c', 'resource': 'ra',
        'source_revision': 'd-1', 'slot_start': 7, 'slot_end': 11,
        'resource_requirements': [
            {'resource':'ra', 'units':1}, {'resource':'rb', 'units':1},
        ],
    }]
    data['events'] = []
    return data


def progress(s, key='w1', start=1):
    """Review and original owners' consent; no authority created automatically."""
    assert apply(s, 'offer', start, 'op', work=key)['outcome'] == 'APPLIED'
    assert apply(s, 'authorize', start+1, 'op', work=key)['outcome'] == 'APPLIED'
    assert apply(s, 'consent', start+2, 'a', work=key, source_revision='d-1', org_revision='oc-1')['outcome'] == 'APPLIED'
    assert apply(s, 'consent', start+3, 'b', work=key, source_revision='d-1', org_revision='oc-1')['outcome'] == 'APPLIED'


def test_three_original_principals_required_before_multi_resource_commit():
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    s = QualitativeAKIS(world(strict=True))
    progress(s)
    assert apply(s, 'commit', 5, 'op', work='w1')['reason'] == 'INDEPENDENT_ACCEPTANCE_MISSING'
    assert s.capacity_ledger.reservations == []
    assert apply(s, 'consent', 6, 'c', work='w1', source_revision='d-1', org_revision='oc-1')['outcome'] == 'APPLIED'
    assert apply(s, 'commit', 7, 'op', work='w1')['outcome'] == 'APPLIED'
    assert s.works['w1'].obligation == 'ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert {r.resource for r in s.capacity_ledger.reservations} == {'ra', 'rb'}
    assert set(s.works['w1'].consents) == {'a', 'b', 'c'}


def test_exhaustion_of_second_owner_resource_has_no_partial_booking():
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    data=world(strict=True)
    next_work=deepcopy(data['works'][0]);next_work['id']='w2';next_work['slot_start']=9;next_work['slot_end']=13
    data['works'].append(next_work)
    s=QualitativeAKIS(data)
    for n,key in enumerate(('w1','w2')):
        start=n*10+1
        progress(s,key,start)
        apply(s,'consent',start+4,'c',work=key,source_revision='d-1',org_revision='oc-1')
        result=apply(s,'commit',start+5,'op',work=key)
        if key=='w1':assert result['outcome']=='APPLIED'
        else:
            assert result['reason']=='RESOURCE_CAPACITY_EXCEEDED'
            assert result['blocking_resource']=='rb'
    assert s.works['w2'].obligation=='NOT_ACCEPTED'
    assert [(r.work,r.resource) for r in s.capacity_ledger.reservations]==[('w1','ra'),('w1','rb')]


def test_secondary_owner_unavailable_blocks_new_work_and_start_only():
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    s=QualitativeAKIS(world(strict=True))
    progress(s)
    apply(s,'consent',5,'c',work='w1',source_revision='d-1',org_revision='oc-1')
    assert apply(s,'resource_status',6,'b',resource='rb',availability='UNAVAILABLE')['outcome']=='APPLIED'
    no=apply(s,'commit',7,'op',work='w1')
    assert no['reason']=='RESOURCE_NOT_AVAILABLE' and no['blocking_resource']=='rb'
    assert s.capacity_ledger.reservations==[]
    apply(s,'resource_status',8,'b',resource='rb',availability='AVAILABLE')
    assert apply(s,'commit',9,'op',work='w1')['outcome']=='APPLIED'
    apply(s,'resource_status',10,'b',resource='rb',availability='UNKNOWN')
    assert apply(s,'start',11,'a',work='w1')['reason']=='RESOURCE_READINESS_UNKNOWN'
    assert s.works['w1'].obligation=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'


def test_legacy_capacity_is_invalid_for_strict_research_but_compatible_for_old_cases():
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    raw=world(strict=True,explicit=False)
    s=QualitativeAKIS(raw)
    progress(s)
    apply(s,'consent',5,'c',work='w1',source_revision='d-1',org_revision='oc-1')
    assert apply(s,'commit',6,'op',work='w1')['reason']=='RESOURCE_CAPACITY_UNSUPPORTED'
    raw['capacity_strict']=False
    t=QualitativeAKIS(raw)
    progress(t)
    apply(t,'consent',5,'c',work='w1',source_revision='d-1',org_revision='oc-1')
    assert apply(t,'commit',6,'op',work='w1')['outcome']=='APPLIED'
    assert t.snapshot()['capacity']['resources']['ra']['capacity_basis']=='LEGACY_FIXTURE_DEFAULT'


def test_dynamic_multi_resource_request_preserves_original_owners():
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    raw=world(strict=True)
    spec=deepcopy(raw['works'][0]);raw['works']=[]
    s=QualitativeAKIS(raw)
    assert apply(s,'request',1,'c',work_spec=spec)['outcome']=='APPLIED'
    assert s.works['w1'].proposal=='REQUESTED'
    progress(s,start=2)
    apply(s,'consent',6,'c',work='w1',source_revision='d-1',org_revision='oc-1')
    assert apply(s,'commit',7,'op',work='w1')['outcome']=='APPLIED'


def test_original_customer_acceptance_still_required_and_profit_unknown():
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    s=QualitativeAKIS(world(strict=True))
    progress(s)
    apply(s,'consent',5,'c',work='w1',source_revision='d-1',org_revision='oc-1')
    apply(s,'commit',6,'op',work='w1')
    assert apply(s,'start',7,'a',work='w1')['outcome']=='APPLIED'
    apply(s,'complete',8,'a',work='w1',result_ref='model://multi')
    assert apply(s,'accept',9,'b',work='w1')['reason']=='ORIGINAL_CUSTOMER_RESULT_DECISION_REQUIRED'
    assert apply(s,'accept',10,'c',work='w1')['outcome']=='APPLIED'
    assert set(s.snapshot()['profit'].values())=={'UNKNOWN'}


def test_input_rejects_ambiguous_capacity_and_no_primary():
    from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
    raw=world()
    raw['resources'][0]['capacity_units']=True
    with pytest.raises(InputError,match='INVALID_CAPACITY_UNITS'):
        QualitativeAKIS(raw)
    raw=world()
    raw['works'][0]['resource_requirements']=[{'resource':'rb','units':1}]
    with pytest.raises(InputError,match='PRIMARY_RESOURCE_REQUIREMENT_MISSING'):
        QualitativeAKIS(raw)
    raw=world()
    raw['capacity_strict']='yes'
    with pytest.raises(InputError,match='CAPACITY_STRICT_MUST_BE_BOOLEAN'):
        QualitativeAKIS(raw)


def test_real_mesa_uses_same_ledger_without_implicit_consent():
    pytest.importorskip('mesa',reason='Official Mesa 3.5.2 required; no mocked PASS')
    from research.akis.qualitative_mesa.mesa_model import simulate
    raw=world(strict=True)
    raw['events']=[
        {'at':1,'action':'offer','actor':'op','work':'w1'},
        {'at':2,'action':'authorize','actor':'op','work':'w1'},
        {'at':3,'action':'consent','actor':'a','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
        {'at':4,'action':'consent','actor':'b','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
        {'at':5,'action':'commit','actor':'op','work':'w1'},
        {'at':6,'action':'consent','actor':'c','work':'w1','source_revision':'d-1','org_revision':'oc-1'},
        {'at':7,'action':'commit','actor':'op','work':'w1'},
        {'at':8,'action':'start','actor':'a','work':'w1'},
        {'at':9,'action':'complete','actor':'a','work':'w1','result_ref':'model://w1'},
        {'at':10,'action':'accept','actor':'c','work':'w1'},
    ]
    result=simulate(raw)
    assert result['counts']=={'applied':9,'blocked':1}
    assert result['trace'][4]['reason']=='INDEPENDENT_ACCEPTANCE_MISSING'
    assert result['works']['w1']['result']=='ACCEPTED_BY_ORIGINAL_RECIPIENT'
    assert len(result['capacity']['reservations'])==2
    assert result['profit']['operator']=='UNKNOWN'
    assert result['capacity']['economic_productivity']=='NOT_IDENTIFIABLE'
