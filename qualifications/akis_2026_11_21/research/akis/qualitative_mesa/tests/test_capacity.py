"""Source-bounded quantitative capacity without invented real productivity."""
from types import SimpleNamespace
from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.capacity import (
    CapacityLedger, CapacityInputError, CapacityBlocked,
    parse_resource_capacity, parse_resource_needs, ResourceNeed,
)


def r(name, owner='a', cap=2, unit='machine', site='a-shop'):
    return parse_resource_capacity({
        'id': name, 'owner': owner, 'capacity_units': cap,
        'capacity_unit': unit, 'site': site,
    })


def ledger():
    return CapacityLedger({'a': r('a'), 'b': r('b', owner='b', cap=1, unit='person')})


def needs(primary='a', other=True, count=1):
    resources = {'a': 'a', 'b': 'b'}
    return parse_resource_needs({
        'resource_requirements': ([{'resource': 'a', 'units': count}]
                                  + ([{'resource': 'b', 'units': 1}] if other else []))
    }, primary, resources)


def test_legacy_capacity_is_explicitly_unverified():
    result = parse_resource_capacity({'id': 'ra', 'owner': 'a'})
    assert (result.units, result.unit, result.basis, result.site) == (1, 'UNSPECIFIED', 'LEGACY_FIXTURE_DEFAULT', None)


def test_site_owner_unit_are_independent_from_governance():
    cap = r('a', owner='a', cap=5, unit='machines', site='distant')
    assert (cap.site, cap.owner, cap.unit, cap.units) == ('distant', 'a', 'machines', 5)


@pytest.mark.parametrize('bad,reason', [
    ({'capacity_units': 2}, 'CAPACITY_UNITS_AND_UNIT_REQUIRED_TOGETHER'),
    ({'capacity_unit': 'machine'}, 'CAPACITY_UNITS_AND_UNIT_REQUIRED_TOGETHER'),
    ({'capacity_units': True, 'capacity_unit': 'machine'}, 'INVALID_CAPACITY_UNITS'),
    ({'capacity_units': 0, 'capacity_unit': 'machine'}, 'INVALID_CAPACITY_UNITS'),
    ({'capacity_units': 1.5, 'capacity_unit': 'machine'}, 'INVALID_CAPACITY_UNITS'),
    ({'capacity_units': 10**20, 'capacity_unit': 'machine'}, 'INVALID_CAPACITY_UNITS'),
    ({'capacity_units': 2, 'capacity_unit': ''}, 'INVALID_CAPACITY_UNIT'),
    ({'capacity_units': 2, 'capacity_unit': 'machine', 'site': []}, 'INVALID_RESOURCE_SITE'),
])
def test_invalid_capacity_declarations_fail_as_inputs(bad,reason):
    with pytest.raises(CapacityInputError, match=reason):
        parse_resource_capacity({'id': 'ra', 'owner': 'a', **bad})


def test_legacy_one_resource_requirement_is_explicit():
    assert parse_resource_needs({}, 'a', {'a': 1}) == (ResourceNeed('a', 1),)


@pytest.mark.parametrize('raw,reason', [
    ([], 'INVALID_RESOURCE_REQUIREMENT_LIST'),
    ([{'resource': 'a','units':1}, {'resource':'a','units':2}], 'DUPLICATE_RESOURCE_REQUIREMENT'),
    ([{'resource':'a','units':0}], 'INVALID_REQUIRED_RESOURCE_UNITS'),
    ([{'resource':'a','units':True}], 'INVALID_REQUIRED_RESOURCE_UNITS'),
    ([{'resource':'missing','units':1}], 'REQUIRED_RESOURCE_UNKNOWN'),
    ([{'resource':'b','units':1}], 'PRIMARY_RESOURCE_REQUIREMENT_MISSING'),
    ([{'resource':'a','units':1,'owner':'a'}], 'INVALID_RESOURCE_REQUIREMENT_FIELDS'),
])
def test_invalid_requirements_are_rejected(raw,reason):
    with pytest.raises(CapacityInputError, match=reason):
        parse_resource_needs({'resource_requirements': raw}, 'a', {'a':1,'b':2})


def test_two_principals_are_required_for_multiresource_work():
    z = ledger()
    assert z.original_owners(needs()) == {'a','b'}
    assert z.original_owners(needs(other=False)) == {'a'}


def test_multi_resource_reservation_is_atomic_on_conflict():
    z = ledger()
    z.reserve('w1', (ResourceNeed('b',1),), 2, 9)
    before = deepcopy(z.snapshot())
    with pytest.raises(CapacityBlocked, match='RESOURCE_CAPACITY_EXCEEDED'):
        z.reserve('w2', needs(), 4, 7)
    assert z.snapshot() == before


def test_partial_time_overlap_capacity_two_allows_two():
    z = ledger()
    z.reserve('w1', (ResourceNeed('a',1),), 0, 9)
    z.reserve('w2', (ResourceNeed('a',1),), 4, 8)
    assert len(z.reservations) == 2
    with pytest.raises(CapacityBlocked, match='RESOURCE_CAPACITY_EXCEEDED'):
        z.reserve('w3', (ResourceNeed('a',1),), 7, 9)


def test_half_open_time_boundary_is_not_a_conflict():
    z = ledger()
    z.reserve('w1', (ResourceNeed('b',1),), 0, 5)
    z.reserve('w2', (ResourceNeed('b',1),), 5, 10)
    assert len(z.reservations) == 2


def test_disjoint_existing_reservations_not_summed_as_one_overlap():
    z = ledger()
    z.reserve('w1', (ResourceNeed('a',1),), 0, 2)
    z.reserve('w2', (ResourceNeed('a',1),), 3, 5)
    z.reserve('w3', (ResourceNeed('a',1),), 1, 4)
    assert len(z.reservations) == 3


def test_one_work_cannot_be_reserved_twice():
    z = ledger()
    z.reserve('w1', (ResourceNeed('a',1),), 0, 3)
    with pytest.raises(CapacityBlocked, match='WORK_ALREADY_RESERVED'):
        z.reserve('w1', (ResourceNeed('b',1),), 4, 7)


def test_primary_demand_can_exceed_capacity_without_becoming_contract():
    z = ledger()
    with pytest.raises(CapacityBlocked, match='RESOURCE_CAPACITY_EXCEEDED'):
        z.reserve('w1', (ResourceNeed('a',3),), 0, 2)
    assert z.reservations == []


def test_all_declared_units_are_kept_with_per_owner_reservations():
    z = ledger()
    z.reserve('w1', needs(), 1, 3)
    x=z.snapshot()
    assert [(v['resource'],v['units']) for v in x['reservations']] == [('a',1),('b',1)]
    assert x['economic_productivity'] == 'NOT_IDENTIFIABLE'
    assert x['evidence'] == 'MODEL_ONLY'


def test_invalid_reservation_time_refused():
    z = ledger()
    for interval in [(2,2),(4,3),(-1,0),(True,2)]:
        with pytest.raises(CapacityInputError):
            z.reserve('w1', (ResourceNeed('a',1),), *interval)
    assert z.reservations == []


def test_reject_directly_constructed_invalid_bundle():
    z = ledger()
    for requirements in ([], (ResourceNeed('a',1), ResourceNeed('a',1)),
                         (ResourceNeed('unknown',1),), (ResourceNeed('a',-1),)):
        with pytest.raises(CapacityInputError, match='INVALID_RESOURCE_REQUIREMENTS'):
            z.reserve('w1', requirements, 1, 4)
    assert not z.reservations


def test_adaptation_review_does_not_erase_secondary_original_owner():
    from research.akis.qualitative_mesa.adaptation_review import parse_review_requests, review_adaptation
    parties = {x: SimpleNamespace(active=True) for x in ('op','a','b','c')}
    state = SimpleNamespace(
        subjects=parties, resources={'ra':'a','rb':'b'},
        works={'w1': SimpleNamespace(
            resource='ra', customer='c', resource_requirements=(ResourceNeed('ra',1),ResourceNeed('rb',1)))},
        institution=SimpleNamespace(revision='oc-1',founders=('op','a','b'),operator='op'),
        trace=[{'at':2,'work':'w1','action':'reject','outcome':'APPLIED','reason':'NONE'}]
    )
    item = {'id':'review1','proposed_by':'op','scope':'LOCAL_CORRECTION','work':'w1',
            'basis_at':2,'org_revision':'oc-1','hypothesis':'Correct work',
            'alternative_explanation':'Demand variation','affected_principals':['a','c'],
            'source_ids':[]}
    reviews=parse_review_requests([item],parties)
    portfolio={'review_cues':[{'at':2,'signal':'RESULT_CORRECTION_REVIEW','work':'w1'}]}
    result=review_adaptation(state,reviews,portfolio=portfolio)['proposals'][0]
    assert 'ORIGINAL_PRINCIPALS_NOT_LISTED' in result['unresolved_flags']
    assert set(result['decision_route']['required_roles'])=={'a','b','c'}
    item['affected_principals'].append('b')
    amended=review_adaptation(state,parse_review_requests([item],parties),portfolio=portfolio)['proposals'][0]
    assert 'ORIGINAL_PRINCIPALS_NOT_LISTED' not in amended['unresolved_flags']
    assert amended['assessment']=='REVIEWABLE_AS_HYPOTHESIS'
    assert amended['authorized_change'] is False
