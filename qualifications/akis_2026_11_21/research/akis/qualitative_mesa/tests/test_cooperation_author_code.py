"""Author-original 13-field code is NOT satisfied by mere model consultation."""
from types import SimpleNamespace as N
from dataclasses import replace
import pytest
from research.akis.qualitative_mesa.cooperation import (
    CooperationInputError, ORIGINAL_ORGANIZATIONAL_CODE_FIELDS,
    organizational_code_readiness, cooperation_change_reviews,
    cooperation_system_view, respond_to_cooperation_change,
)
from research.akis.qualitative_mesa.tests.test_cooperation_change import (
    prepared, proposal, answer, applied,
)

EXPECTED_ORIGINAL_CODE = ('\u0421', '\u0418\u0414', '\u0420\u043e\u043b', '\u041f\u0440', '\u0417\u0430\u043f\u0440',
                          '\u0418\u0441\u0442', '\u0421\u043e\u0431\u044b\u0442', '\u041f\u0440\u0430\u0432', '\u0410\u0432\u0442',
                          '\u042d\u0441\u043a', '\u041e\u0442\u0432', '\u0416\u0443\u0440\u043d', '\u041f\u0435\u0440\u0435\u0441\u043c')


def complete_review():
    subjects, owners, works, links = prepared()
    trace=[applied(proposal())]
    for at, actor in enumerate(('a','b','c','op','d'),start=2):
        trace.append(applied(answer(actor,at=at)))
    return subjects,owners,works,links,trace


def test_exact_author_13_fields_do_not_turn_consultation_into_a_contract():
    subjects,owners,works,links,trace=complete_review()
    review=cooperation_change_reviews(links,trace,current_org_revision='oc-1',subjects=subjects)[0]
    assert review['review_status']=='MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION'
    gate=organizational_code_readiness(review)
    assert ORIGINAL_ORGANIZATIONAL_CODE_FIELDS==EXPECTED_ORIGINAL_CODE
    assert tuple(item['original_field'] for item in gate['original_fields'])==EXPECTED_ORIGINAL_CODE
    assert gate['original_field_count']==13
    assert gate['qualified_original_field_count']==0
    assert gate['legal_effect']=='NONE'
    assert not any(item['qualified_original_evidence'] for item in gate['original_fields'])
    assert works['x'].consents=={}


def test_mode_change_invalidates_current_consultation_without_erasing_history():
    subjects,owners,works,links,trace=complete_review()
    review=cooperation_change_reviews(links,trace,current_org_revision='oc-2',subjects=subjects)[0]
    assert review['historical_review_status']=='MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION'
    assert review['review_status']=='MODEL_REVIEW_STALE_ORGANIZATIONAL_CODE_REVALIDATION_REQUIRED'
    assert review['requires_fresh_original_qualification'] is True
    view=cooperation_system_view(links,works,owners,subjects,N(mode='SOLE',revision='oc-2'),trace)
    row=view['relations'][0]
    assert row['components']['\u0416\u0426']['reconfiguration_reviews'][0]['fresh_original_qualification_required']
    assert row['components']['\u041e\u041a']['original_thirteen_code_requirements'][0]['legal_authorization']=='NOT_ESTABLISHED'
    assert row['components']['\u042d']['reconfiguration_costs']=='REBASELINE_REQUIRED'


def test_source_version_change_requires_requalification_even_if_all_previously_supported():
    subjects, owners, works, links, trace=complete_review()
    links=(replace(links[0],source_revision='r2'),)
    row=cooperation_change_reviews(links,trace,current_org_revision='oc-1',subjects=subjects)[0]
    assert row['review_status']=='MODEL_REVIEW_STALE_COOPERATION_SOURCE_REVALIDATION_REQUIRED'
    assert row['consultation_source_revision']=='r1'
    assert row['requires_fresh_original_qualification'] is True
    assert links[0].participants==('a','b','c','op')


def test_inactive_incoming_party_cannot_remain_silently_qualified():
    subjects, owners, works, links, trace=complete_review()
    subjects['d'].active=False
    row=cooperation_change_reviews(links,trace,current_org_revision='oc-1',subjects=subjects)[0]
    assert row['review_status']=='MODEL_REVIEW_PARTICIPANT_AVAILABILITY_REVALIDATION_REQUIRED'
    assert row['historical_review_status']=='MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION'


def test_different_org_code_reply_cannot_change_historical_consultation():
    subjects,owners,works,links,trace=complete_review()
    wrong=answer('a',at=9,org_revision='oc-2',decision='OBJECT_MODEL_PROPOSAL')
    with pytest.raises(CooperationInputError,match='COOPERATION_CHANGE_PROPOSAL_REVISION_STALE'):
        respond_to_cooperation_change(wrong,links,subjects,trace)
    trace.append(applied(wrong))  # even externally injected bad record cannot count
    row=cooperation_change_reviews(links,trace,current_org_revision='oc-1',subjects=subjects)[0]
    assert row['objecting_model_declarations']==0
    assert row['supporting_model_declarations']==5


def test_missing_response_is_not_consent_and_all_fields_remain_unqualified():
    subjects,owners,works,links,trace=complete_review()
    trace=[e for e in trace if e.get('actor')!='c']
    review=cooperation_change_reviews(links,trace,current_org_revision='oc-1',subjects=subjects)[0]
    assert review['review_status']=='INDEPENDENT_CONSULTATION_INCOMPLETE'
    assert review['required_count']-review['consulted_count']==1
    gate=organizational_code_readiness(review)
    assert gate['qualified_original_field_count']==0


def test_objection_still_preserved_when_governance_revision_is_stale():
    subjects,owners,works,links,trace=complete_review()
    trace.append(applied(answer('a',at=9,decision='OBJECT_MODEL_PROPOSAL')))
    row=cooperation_change_reviews(links,trace,current_org_revision='oc-2',subjects=subjects)[0]
    assert row['historical_review_status']=='SOURCE_DECLARED_OBJECTION_REQUIRES_REVIEW'
    assert row['review_status']=='MODEL_REVIEW_STALE_ORGANIZATIONAL_CODE_REVALIDATION_REQUIRED'
    assert row['objecting_model_declarations']==1


def test_reconfiguration_requires_counterfactual_and_transition_transaction_costs():
    from research.akis.qualitative_mesa.cooperation import cooperation_reconfiguration_economics
    subjects,owners,works,links,trace=complete_review()
    change=cooperation_change_reviews(links,trace)[0]
    result=cooperation_reconfiguration_economics(change=change,link=links[0],evidence={})
    assert result['original_principals']==4
    assert result['model_claims_for_mechanism']==0
    assert result['principals_with_comparable_claims']==0
    assert result['requires_new_entrant_economic_basis'] is True
    assert result['transition_transaction_costs']=='NOT_IDENTIFIED'
    assert result['source_time_available_before_proposal']=='NOT_QUALIFIED'
    assert result['system_wide_net_gain'] is None
    assert result['rights_from_alleged_saving']=='NONE'


def test_negative_individual_economics_are_visible_without_disclosing_prices():
    from research.akis.qualitative_mesa.cooperation import cooperation_reconfiguration_economics
    subjects,owners,works,links,trace=complete_review()
    change=cooperation_change_reviews(links,trace)[0]
    sample={'cooperation_cost_channels':{'claimed_channels':[
        {'link':'collab','channel':'JOINT_PURCHASE','owner':'a',
         'comparison':'DECLARED_SCOPE_ARITHMETIC_ONLY',
         'resource_cost_reduction_claim':'-15.00',
         'buyer_cash_outlay_reduction_claim':'4.00'},
        {'link':'collab','channel':'JOINT_PURCHASE','owner':'b',
         'comparison':'DECLARED_SCOPE_ARITHMETIC_ONLY',
         'resource_cost_reduction_claim':'3.00',
         'buyer_cash_outlay_reduction_claim':'2.00'},
        {'link':'collab','channel':'SHARED_MARKETING','owner':'c',
         'comparison':'DECLARED_SCOPE_ARITHMETIC_ONLY',
         'resource_cost_reduction_claim':'500.00',
         'buyer_cash_outlay_reduction_claim':'500.00'},
    ]}, 'per_subject':{'a':{'outside_feasibility':'FEASIBLE_DECLARED'},
                      'b':{'outside_feasibility':'UNKNOWN'}}}
    result=cooperation_reconfiguration_economics(change=change,link=links[0],evidence=sample)
    assert result['principals_with_comparable_claims']==2
    assert result['principals_with_declared_feasible_alternatives']==1
    assert result['model_claims_for_mechanism']==2
    assert result['channels_with_possible_disadvantage']==1
    assert result['system_wide_net_gain'] is None
    assert '15.00' not in str(result)
    assert '500.00' not in str(result)


def test_economic_report_is_in_unchanged_original_nine_component_view():
    subjects,owners,works,links,trace=complete_review()
    economic={'cooperation_cost_channels':{'claimed_channels':[]}}
    view=cooperation_system_view(links,works,owners,subjects,N(mode='SOLE',revision='oc-1'),trace,economics=economic)
    e=view['relations'][0]['components']['\u042d']['reconfiguration_economic_evidence'][0]
    assert e['counterfactual_joint_feasibility']=='NOT_VERIFIED'
    assert e['transition_transaction_costs']=='NOT_IDENTIFIED'
    assert view['relations'][0]['components']['\u0416\u0426']['organizational_change']=='NOT_AUTOMATIC'
