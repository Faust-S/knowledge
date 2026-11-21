"""Pure source-bounded discovery tests; no claim of real contract or matching."""
from copy import deepcopy
from types import SimpleNamespace as NS
import pytest

from research.akis.qualitative_mesa.partner_discovery import (
    DiscoveryInputError, parse_discovery, discover,
)
from research.akis.qualitative_mesa.capacity import (
    CapacityLedger, CalendarWindow, ResourceCalendar, ResourceNeed, Reservation,
)


def raw():
    return {
        'demands':[{
            'id':'D1','buyer':'buyer','work':'w1','work_source_revision':'wr1',
            'original_resource':'old-machine','capability':'fabricate','capacity_unit':'units',
            'source_ref':'model://buyer/need-1','available_at':1,'expires_at':20,
        }],
        'offers':[{
            'id':'S1','owner':'supplier','resource':'new-machine',
            'capability':'fabricate','capacity_unit':'units',
            'source_ref':'model://supplier/cap-1','available_at':2,'expires_at':19,
        }]
    }


def world(*, second=False):
    parties={k:NS(kind='SME',active=True) for k in ('buyer','supplier','other','old')}
    resources={'old-machine':'old','new-machine':'supplier','another-machine':'other'}
    specs={r:NS(owner=owner,units=2 if r=='new-machine' else 8,
                unit='units',basis='MODEL_DECLARED',calendar=None)
           for r,owner in resources.items()}
    w1=NS(key='w1',customer='buyer',source_revision='wr1',
          resource_requirements=(ResourceNeed('old-machine',2),),
          proposal='REQUESTED',slot_start=10,slot_end=14,obligation='NOT_ACCEPTED',operations=())
    works={'w1':w1}
    if second:
        works['w2']=NS(key='w2',customer='buyer',source_revision='wr2',
                       resource_requirements=(ResourceNeed('old-machine',2),),
                       proposal='REQUESTED',slot_start=12,slot_end=15,
                       obligation='NOT_ACCEPTED',operations=())
    ledger=CapacityLedger(specs)
    return NS(subjects=parties, resources=resources, resource_specs=specs,
              resource_availability={r:'AVAILABLE' for r in resources},
              resource_availability_origin={r:'MODEL_INPUT' for r in resources},
              works=works, capacity_ledger=ledger)


def trial(raw_input=None,state=None,at=4):
    state=state or world()
    inp=raw_input if raw_input is not None else raw()
    d,o=parse_discovery(inp,state.subjects,state.works,state.resources)
    return discover(d,o,state,at=at)


def assert_unchanged(original,after):
    assert after.works['w1'].obligation == original.works['w1'].obligation
    assert after.works['w1'].resource_requirements == original.works['w1'].resource_requirements


def test_buyer_discovers_alternate_source_without_creating_new_contract():
    s=world();old=deepcopy(s)
    out=trial(state=s)
    assert out['current_opportunity_count']==1
    assert out['candidates'][0]['status']=='POTENTIAL_PARTNER_REQUIRES_FRESH_ORIGINAL_OWNER_REVIEW'
    assert out['candidates'][0]['candidate_count']==1
    assert out['capacity_reserved']==out['original_consents_created']==out['original_works_changed']==0
    assert out['cash_or_profit']=='NOT_CALCULATED'
    assert_unchanged(old,s)
    assert 'supplier' not in str(out)


def test_demand_before_activation_or_after_expiry_does_not_borrow_future():
    assert trial(at=0)['candidates'][0]['status']=='DEMAND_SOURCE_NOT_CURRENT'
    assert trial(at=20)['candidates'][0]['status']=='DEMAND_SOURCE_NOT_CURRENT'
    assert trial(at=1)['candidates'][0]['status']=='NO_MATCHING_INDEPENDENT_CAPABILITY_SOURCE'
    assert trial(at=19)['candidates'][0]['status']=='NO_MATCHING_INDEPENDENT_CAPABILITY_SOURCE'


def test_work_requested_later_makes_existing_supplier_offer_relevant():
    s=world();existing=s.works.pop('w1')
    d,o=parse_discovery(raw(),s.subjects,{'w1':existing},s.resources)
    assert discover(d,o,s,at=4)['candidates'][0]['status']=='ORIGINAL_WORK_NOT_REQUESTED'
    s.works['w1']=existing
    assert discover(d,o,s,at=4)['current_opportunity_count']==1


def test_no_rewriting_accepted_original_work_by_new_supplier():
    s=world();s.works['w1'].obligation='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert trial(state=s)['candidates'][0]['status']=='ORIGINAL_OBLIGATION_UNCHANGED'
    assert s.works['w1'].obligation=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'


def test_declared_capability_does_not_establish_technical_or_economic_proof():
    out=trial()
    row=out['candidates'][0]
    assert row['technology_qualification']=='MODEL_COMPATIBILITY_NOT_FIELD_VERIFIED'
    assert row['economic_effect']=='NOT_IDENTIFIABLE'


def test_strict_resource_availability_and_capacity_basis():
    s=world();s.resource_availability['new-machine']='UNAVAILABLE'
    assert trial(state=s)['current_opportunity_count']==0
    s.resource_availability['new-machine']='AVAILABLE'
    s.resource_specs['new-machine'].basis='LEGACY_FIXTURE_DEFAULT'
    assert trial(state=s)['candidates'][0]['status']=='CAPACITY_SOURCE_NOT_DECLARED'
    s.resource_specs['new-machine'].basis='MODEL_DECLARED'
    s.resource_specs['new-machine'].units=1
    assert trial(state=s)['candidates'][0]['status']=='NO_FEASIBLE_OR_AVAILABLE_PARTNER'


def test_original_ledger_reservation_blocks_new_hypothetical_partner():
    s=world()
    s.capacity_ledger.reservations=[Reservation('new-machine','other-old',11,13,1)]
    assert trial(state=s)['current_opportunity_count']==0
    assert len(s.capacity_ledger.reservations)==1
    s.capacity_ledger.reservations=[]
    s.resource_specs['new-machine'].calendar=ResourceCalendar(
        'cal-1','model://supplier/calendar',
        (CalendarWindow(0,11,2), CalendarWindow(11,14,0)),
    )
    assert trial(state=s)['current_opportunity_count']==0


def test_mismatched_skill_unit_and_original_owner_are_not_new_partner():
    p=raw();p['offers'][0]['capability']='different'
    assert trial(p)['current_opportunity_count']==0
    p=raw();p['offers'][0]['capacity_unit']='kg'
    assert trial(p)['current_opportunity_count']==0
    p=raw();p['offers'][0]['owner']='old';p['offers'][0]['resource']='old-machine';p['offers'][0]['source_ref']='model://old/cap'
    assert trial(p)['current_opportunity_count']==0


def test_multiple_alternatives_preserve_original_buyer_choice():
    p=raw()
    second=deepcopy(p['offers'][0]);second.update(id='S2',owner='other',resource='another-machine',source_ref='model://other/cap-2')
    p['offers'].append(second)
    row=trial(p)['candidates'][0]
    assert row['status']=='MULTIPLE_PARTNERS_REQUIRE_ORIGINAL_BUYER_CHOICE'
    assert row['candidate_count']==2


def test_two_independently_feasible_demands_compete_for_single_capacity():
    s=world(second=True)
    p=raw();second=deepcopy(p['demands'][0]);second.update(id='D2',work='w2',work_source_revision='wr2',source_ref='model://buyer/need-2')
    p['demands'].append(second)
    out=trial(p,s)
    assert out['contested_opportunity_count']==2
    assert {row['status'] for row in out['candidates']}=={'POTENTIAL_PARTNERS_COMPETE_FOR_OWNER_CAPACITY'}
    # Nonoverlapping demands are not capacity competition.
    s.works['w2'].slot_start=15;s.works['w2'].slot_end=18
    out=trial(p,s)
    assert out['contested_opportunity_count']==0


def test_complex_multi_resource_work_does_not_infer_an_equivalent_substitute():
    s=world();s.works['w1'].resource_requirements+=(ResourceNeed('another-machine',1),)
    assert trial(state=s)['candidates'][0]['status']=='COMPLEX_TECHNOLOGY_REQUIRES_INDEPENDENT_REPLAN'
    s=world();s.works['w1'].operations=(NS(key='stage'),)
    assert trial(state=s)['candidates'][0]['status']=='COMPLEX_TECHNOLOGY_REQUIRES_INDEPENDENT_REPLAN'


@pytest.mark.parametrize('edit,reason',[
    (lambda x:x['demands'][0].update(source_ref='model://supplier/fake'),'DISCOVERY_ORIGINAL_OWNER_SOURCE_REQUIRED'),
    (lambda x:x['offers'][0].update(source_ref='model://buyer/fake'),'DISCOVERY_ORIGINAL_OWNER_SOURCE_REQUIRED'),
    (lambda x:x['demands'][0].update(buyer='supplier'),'DISCOVERY_ORIGINAL_BUYER_WORK_REQUIRED'),
    (lambda x:x['offers'][0].update(owner='buyer'),'DISCOVERY_ORIGINAL_RESOURCE_OWNER_REQUIRED'),
    (lambda x:x['demands'][0].update(available_at=True),'DISCOVERY_TIME_INVALID'),
    (lambda x:x['demands'][0].update(expires_at=1),'DISCOVERY_TIME_INVALID'),
    (lambda x:x['offers'][0].update(id='D1'),'DISCOVERY_DUPLICATE_SIGNAL'),
    (lambda x:x['demands'][0].update(original_resource='unknown'),'DISCOVERY_ORIGINAL_RESOURCE_UNKNOWN'),
    (lambda x:x['demands'][0].update(work_source_revision='old'),'DISCOVERY_ORIGINAL_BUYER_WORK_REQUIRED'),
    (lambda x:x['offers'][0].update(extra=True),'DISCOVERY_OFFER_FIELDS_INVALID'),
])
def test_owner_source_and_input_guards(edit,reason):
    p=raw();edit(p);s=world()
    with pytest.raises(DiscoveryInputError,match=reason):
        parse_discovery(p,s.subjects,s.works,s.resources)


def test_same_input_same_output_and_no_private_candidate_ids():
    a=trial();b=trial()
    assert a==b
    assert 'new-machine' not in str(a)
    assert 'model://supplier' not in str(a)


def test_overlapping_same_resource_offers_cannot_double_count_one_supplier():
    p=raw();another=deepcopy(p['offers'][0]);another.update(id='S2',source_ref='model://supplier/cap-new')
    p['offers'].append(another)
    with pytest.raises(DiscoveryInputError,match='DISCOVERY_OVERLAPPING_OFFER_SOURCES'):
        trial(p)
    another['available_at']=19;another['expires_at']=25
    assert trial(p,at=9)['candidates'][0]['candidate_count']==1
    assert trial(p,at=20)['candidates'][0]['status']=='DEMAND_SOURCE_NOT_CURRENT'


def test_same_work_overlapping_claims_cannot_multiply_demand():
    p=raw();other=deepcopy(p['demands'][0]);other.update(id='D2',source_ref='model://buyer/different')
    p['demands'].append(other)
    with pytest.raises(DiscoveryInputError,match='DISCOVERY_OVERLAPPING_DEMAND_SOURCES'):
        trial(p)


def test_time_separated_capability_offers_are_version_safe():
    p=raw();p['offers'][0]['expires_at']=10
    other=deepcopy(p['offers'][0]);other.update(id='S2',available_at=10,expires_at=19,source_ref='model://supplier/update')
    p['offers'].append(other)
    assert trial(p,at=5)['candidates'][0]['candidate_count']==1
    assert trial(p,at=10)['candidates'][0]['candidate_count']==1


def test_legacy_default_availability_cannot_become_a_qualified_partner_offer():
    s=world()
    s.resource_availability_origin['new-machine']='LEGACY_FIXTURE_DEFAULT'
    result=trial(state=s)
    assert result['candidates'][0]['status']=='RESOURCE_AVAILABILITY_SOURCE_MISSING'
    assert result['current_opportunity_count']==0
    s.resource_availability_origin['new-machine']='MODEL_EVENT'
    assert trial(state=s)['current_opportunity_count']==1


def test_buyer_original_resource_unit_must_be_explicitly_compatible():
    s=world()
    s.resource_specs['old-machine'].basis='LEGACY_FIXTURE_DEFAULT'
    assert trial(state=s)['candidates'][0]['status']=='ORIGINAL_WORK_CAPACITY_UNIT_UNQUALIFIED'
    s.resource_specs['old-machine'].basis='MODEL_DECLARED'
    s.resource_specs['old-machine'].unit='other'
    assert trial(state=s)['candidates'][0]['status']=='ORIGINAL_WORK_CAPACITY_UNIT_UNQUALIFIED'


def test_two_resources_from_one_original_owner_are_not_two_independent_partners():
    s=world();s.resources['second-supplier-machine']='supplier'
    s.resource_specs['second-supplier-machine']=NS(owner='supplier',units=2,
            unit='units',basis='MODEL_DECLARED',calendar=None)
    s.resource_availability['second-supplier-machine']='AVAILABLE'
    s.resource_availability_origin['second-supplier-machine']='MODEL_INPUT'
    # Original CapacityLedger copies initial specs. A test-created resource
    # must be explicitly added to that same original ledger before preview.
    s.capacity_ledger.specs['second-supplier-machine']=s.resource_specs['second-supplier-machine']
    p=raw()
    second=deepcopy(p['offers'][0]);second.update(id='S2',resource='second-supplier-machine',
                                                  source_ref='model://supplier/second-source')
    p['offers'].append(second)
    out=trial(p,state=s)
    assert out['candidates'][0]['status']=='ONE_PARTNER_MULTIPLE_RESOURCES_REQUIRES_PROCESS_CHOICE'
    assert out['current_opportunity_count']==1