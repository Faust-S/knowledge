"""Research checks: author forms change source-qualified applicability, not rights."""
from copy import deepcopy
from types import SimpleNamespace as N
import pytest

from research.akis.qualitative_mesa.tests.test_general_system import AXES, CODES, CATALOG, SUBJECTS, WORKS, claim, design, state
from research.akis.qualitative_mesa.general_system import parse_general_system, general_system_view


def view(d=None, s=None, *, at=3, economic='NOT_IDENTIFIABLE'):
    return general_system_view(parse_general_system(d or design(), SUBJECTS, WORKS, catalog=CATALOG),
                               s or state(), at=at, economic_status=economic)['configuration_dynamics']


def test_operator_keeps_original_rights_and_counterparties():
    s=state()
    s.institution=N(revision='oc1',operator='op', mode='SOLE')
    s.resources={'r':'op'}
    w=s.works['w1']
    w.resource='r';w.obligation='NOT_ACCEPTED';w.consents={}
    v=view(s=s)
    assert v['status']=='ORIGINAL_OPERATOR_COORDINATION_PARTIAL'
    assert v['original_work_scope'][0]['original_principals']==['a','op']
    assert v['original_work_scope'][0]['unresolved_original_consultation']==['a','op']
    assert not v['original_work_scope'][0]['legal_or_autonomous_action_authorized']
    assert w.obligation=='NOT_ACCEPTED'


def test_original_accepted_obligation_cannot_be_erased_by_form_change():
    s=state();s.resources={'r':'op'}
    w=s.works['w1'];w.resource='r';w.obligation='ACCEPTED_BY_ORIGINAL_PRINCIPALS';w.result='SUBMITTED'
    w.consents={'a':('wr1','oc1'),'op':('wr1','oc1')}
    d=design();d['configuration']='intra'
    v=view(d,s)
    assert v['original_work_scope'][0]['configuration_applicability']=='INTERFIRM_ORIGINALS_OUTSIDE_INTRA_SCOPE'
    assert not v['original_work_scope'][0]['unresolved_original_consultation']
    assert w.obligation=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert w.consents=={'a':('wr1','oc1'),'op':('wr1','oc1')}


def test_operator_and_inter_are_not_the_same_organizational_form():
    s=state();s.resources={'r':'op'};s.works['w1'].resource='r'
    s.institution=N(revision='oc1',operator='op', mode='UNSELECTED')
    d=design();d['configuration']='inter'
    assert view(d,s)['status']=='MULTI_FIRM_PREPARATORY_SCOPE_ONLY'
    d['configuration']='operator'
    assert view(d,s)['status']=='OPERATOR_GOVERNANCE_UNSELECTED'
    assert view(d,s)['morphological_consequences']['governance']['original_institution_mode']=='UNSELECTED'


@pytest.mark.parametrize('conf,required',[
    ('intra','DIVISION'),('sector','SECTOR_STANDARD'),
    ('macro','PUBLIC_INSTITUTION'),('trace','NATURAL_PERSON'),
])
def test_missing_subject_classes_are_not_fake_enterprises(conf,required):
    d=design();d['configuration']=conf
    v=view(d)
    assert required in v['required_but_unmodelled_roles']
    assert v['status'] in {'INTRA_DIVISION_AND_EMPLOYEE_ROLES_NOT_EXECUTABLE',
                           'AUTHOR_EXTENDED_CONFIGURATION_ROLES_NOT_EXECUTABLE'}
    assert not v['program_agent_execution_created']


def test_no_intra_staff_support_even_if_one_original_owner():
    s=state();s.resources={'r':'a'};s.works['w1'].resource='r'
    d=design();d['configuration']='intra'
    v=view(d,s)
    assert v['cross_owner_original_work_count']==0
    assert v['original_work_scope'][0]['configuration_applicability']=='INTRA_STAFF_AND_DIVISIONS_NOT_MODELLED'


def test_morphological_scale_evidences_distinct_original_owners_not_network_sizes():
    s=state();s.resources={'r':'op'};s.works['w1'].resource='r'
    d=design();d['morphology']['scale']='межфирменные'
    assert view(d,s)['morphological_consequences']['scale']['observed']=='MULTI_OWNER_WORK_DECLARED'
    d['morphology']['scale']='Внутрифирменные'
    assert view(d,s)['morphological_consequences']['scale']['observed']=='INTERFIRM_OWNER_SCOPE_CONFLICT'


def test_selected_governance_never_replaces_original_council_and_mandates():
    s=state();s.institution=N(revision='oc1',operator='op',mode='COLLEGIAL')
    d=design();d['morphology']['governance']='операторские'
    r=view(d,s)['morphological_consequences']['governance']
    assert r['observed']=='EXPLICIT_OPERATOR_GOVERNANCE_PARTIAL'
    assert r['original_institution_mode']=='COLLEGIAL'
    assert r['operational_consequence']=='KEEP_ORIGINAL_MANDATES_AND_COUNCIL_RULES'
    d['morphology']['governance']='Централизованные'
    assert view(d,s)['morphological_consequences']['governance']['observed']=='MORPHOLOGY_NOT_IDENTICAL_TO_SOLE_COLLEGIAL_MIXED'


def test_agent_function_claims_increase_observation_not_right_to_execute():
    d=design();d['agent_functions']=[{**claim(n=1),"id":"F1","work":"w1", "work_revision":"wr1",
                                 "autonomy":"доверенно-исполнительные", "action":"EXECUTE"}]
    d['morphology']['autonomy']='доверенно-исполнительные'
    v=view(d)
    assert v['morphological_consequences']['autonomy']['observed']=='SELECTED_LEVEL_HAS_DECLARED_FUNCTION'
    assert v['morphological_consequences']['autonomy']['operational_consequence']=='NO_PROGRAM_RUNTIME_OR_DELEGATED_EXECUTION'
    assert v['original_work_scope'][0]['legal_or_autonomous_action_authorized'] is False
    assert view(d,at=10)['morphological_consequences']['autonomy']['observed']=='NO_CURRENT_FUNCTION_AT_SELECTED_LEVEL'


def test_no_assumed_knowledge_or_context_grants_from_data_morphology():
    d=design();d['morphology']['data']='смешанные'
    d['context_cores']=[{**claim(n=3), 'core':'corporate','recipient':'op',
                         'purpose':'research','operation':'READ'}]
    r=view(d)['morphological_consequences']['data']
    assert r['observed']=='MODEL_CORE_CLAIMS_NOT_AUTHENTICATED'
    assert r['operational_consequence']=='NO_PERMISSION_TO_USE_OTHERS_CONTEXT'
    assert view(d,at=10)['morphological_consequences']['data']['observed']=='CONTEXT_CORE_SOURCE_MISSING'


@pytest.mark.parametrize('proc,expected',[
    ('межфирменные','INTERFIRM_REPLAN_REQUIRES_ORIGINAL_NEW_WORK_AND_CONSENT'),
    ('Жесткие','NO_AUTOMATIC_CHANGE_TO_ORIGINAL_PROCESS'),
])
def test_process_axis_changes_replanning_requirements_not_work_source(proc,expected):
    d=design();d['morphology']['process']=proc
    v=view(d)
    assert v['morphological_consequences']['process']['operational_consequence']==expected
    assert WORKS['w1'].source_revision=='wr1'


def test_original_operations_are_reflected_in_process_assessment():
    s=state();s.works['w1'].operations=(N(key='o1'),)
    assert view(s=s)['morphological_consequences']['process']['observed']=='ORIGINAL_TECHNOLOGY_PRESENT'


def test_economic_questions_vary_by_configuration_no_false_profit():
    d=design()
    results={}
    for c in ('operator','inter','intra','sector','macro','trace'):
        d['configuration']=c
        r=view(d,economic='DECLARED_CONSOLIDATED_ARITHMETIC_ONLY')
        results[c]=tuple(r['source_dependent_current_economic_questions'])
        assert not r['verified_comparative_effect']
    assert len(set(results.values()))==6
    assert 'ONBOARDING_COST' in results['operator']
    assert 'TRANSACTION_COST' in results['inter']
    assert 'CONTEXT_PORTABILITY' in results['trace']


def test_deactivation_changes_principals_not_original_contract():
    s=state();s.resources={'r':'op'};s.works['w1'].resource='r'
    s.works['w1'].obligation='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    s.subjects['op'].active=False
    r=view(s=s)
    row=r['original_work_scope'][0]
    assert row['original_principals']==['a','op']
    assert row['active_original_principals']==['a']
    assert row['original_obligation']=='ACCEPTED_BY_ORIGINAL_PRINCIPALS'


def test_multiple_resources_same_original_owner_not_two_firms():
    s=state()
    s.resources={'r1':'a','r2':'a'}
    s.works['w1'].resource='r1'
    s.works['w1'].resource_requirements=[N(resource='r1'),N(resource='r2')]
    s.capacity_ledger=N(original_owners=lambda needs:{'a'})
    d=design();d['configuration']='inter'
    v=view(d,s)
    assert v['cross_owner_original_work_count']==0
    assert v['status']=='INTERFIRM_PROCESS_NOT_DECLARED'


def test_actual_original_responsibility_not_transferred_to_morphological_category():
    d=design();d['morphology']['human']='контроль по исключениям'
    r=view(d)['morphological_consequences']['human']
    assert r['operational_consequence']=='CANNOT_SILENTLY_REMOVE_HUMAN_REVIEW'


def test_all_nine_morphological_axes_have_explicit_consequences():
    r=view()
    assert set(r['morphological_consequences'])==set(AXES)
    assert all('operational_consequence' in value for value in r['morphological_consequences'].values())
    assert not r['membership_reconfiguration_created']


def test_research_next_step_evolves_without_original_event_side_effect():
    s=state();s.resources={'r':'op'}
    s.institution=N(revision='oc1',operator='op',mode='SOLE')
    w=s.works['w1'];w.resource='r';w.obligation='NOT_ACCEPTED';w.admitted=False;w.consents={}
    assert view(s=s)['original_work_scope'][0]['research_next_step']=='PREPARE_ORIGINAL_AUTHORIZATION_REVIEW'
    w.admitted=True
    assert view(s=s)['original_work_scope'][0]['research_next_step']=='REQUEST_INDEPENDENT_ORIGINAL_PRINCIPAL_CONSULTATION'
    w.consents={'a':('wr1','oc1'), 'op':('wr1','oc1')}
    assert view(s=s)['original_work_scope'][0]['research_next_step']=='PREPARE_ORIGINAL_COMMIT_REVIEW_NO_AUTOMATIC_CONTRACT'
    assert w.obligation=='NOT_ACCEPTED'
    w.obligation='ACCEPTED_BY_ORIGINAL_PRINCIPALS';w.result='SUBMITTED'
    assert view(s=s)['original_work_scope'][0]['research_next_step']=='AWAIT_ORIGINAL_RECIPIENT_RESULT_DECISION'
    w.result='REJECTED'
    assert view(s=s)['original_work_scope'][0]['research_next_step']=='REQUIRE_ORIGINAL_PROVIDER_CORRECTION'
    w.result='ACCEPTED_BY_ORIGINAL_RECIPIENT';w.obligation='FULFILLED'
    assert view(s=s)['original_work_scope'][0]['research_next_step']=='PRESERVE_ORIGINAL_ACCEPTED_RESULT'


def test_lost_original_participant_holds_new_work_but_not_accepted_work():
    s=state();s.resources={'r':'op'}
    s.institution=N(revision='oc1',operator='op',mode='SOLE')
    w=s.works['w1'];w.resource='r';w.obligation='NOT_ACCEPTED';w.consents={}
    s.subjects['op'].active=False
    assert view(s=s)['original_work_scope'][0]['research_next_step']=='HOLD_NEW_WORK_UNAVAILABLE_ORIGINAL_PRINCIPAL'
    w.obligation='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert view(s=s)['original_work_scope'][0]['research_next_step']=='CONTINUE_ORIGINAL_ACCEPTED_WORK'


def test_scope_conflict_precedes_new_interfirm_review_and_old_work_is_retained():
    s=state();s.resources={'r':'op'}
    w=s.works['w1'];w.resource='r';w.admitted=True
    d=design();d['configuration']='intra'
    assert view(d,s)['original_work_scope'][0]['research_next_step']=='RECONSIDER_AUTHOR_CONFIGURATION_AND_ORIGINAL_ROLES'
    w.obligation='ACCEPTED_BY_ORIGINAL_PRINCIPALS'
    assert view(d,s)['original_work_scope'][0]['research_next_step']=='CONTINUE_ORIGINAL_ACCEPTED_WORK'