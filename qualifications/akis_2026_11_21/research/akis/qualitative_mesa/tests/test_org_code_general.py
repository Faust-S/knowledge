from copy import deepcopy
from types import SimpleNamespace as N
import pytest
from research.akis.qualitative_mesa.org_code_policy import parse_org_code_policy, OrgCodeInputError
from research.akis.qualitative_mesa.tests.test_org_code_policy import raw, subjects, ACTIONS
from research.akis.qualitative_mesa.tests.test_general_system import CATALOG, AXES, design, state
from research.akis.qualitative_mesa.general_system import parse_general_system, general_system_view, GeneralSystemInputError


def input_data():
    x=design();x['organizational_code']=raw();x['enforce_model_org_code']=True
    return x


def registered(data=None):
    return parse_general_system(input_data() if data is None else data,
                                subjects(),{'w1':N(key='w1',customer='a',source_revision='wr1')},catalog=CATALOG)


def test_author_morphology_and_all_13_control_fields_remain_same_single_source():
    design=registered()
    assert design.enforce_model_org_code is True
    assert len(design.declarations['organizational_code'])==13
    assert all('control' in r for r in design.declarations['organizational_code'])
    orig=state();orig.institution.operator='op';orig.institution.revision='oc-1'
    orig.subjects=subjects()
    orig.model_org_policy=parse_org_code_policy(input_data()['organizational_code'],orig.subjects,
                                                  orig.institution,actions=ACTIONS)
    orig.model_org_policy=orig.model_org_policy
    result=general_system_view(design,orig,at=4)
    assert result['model_organizational_code_review']['all_thirteen_model_controls_active']
    assert result['components']['ОК']['model_13_control_predicates_active']
    assert result['components']['ОК']['full_real_organizational_authority'] is False
    assert result['new_agent_runtime_created'] is False


def test_stale_policy_never_passes_a_paper_13_field_check():
    p=registered(); s=state();s.institution.operator='op';s.institution.revision='oc-1';s.subjects=subjects()
    s.model_org_policy=parse_org_code_policy(input_data()['organizational_code'],s.subjects,
                                                s.institution,actions=ACTIONS)
    assert general_system_view(p,s,at=20)['model_organizational_code_review']['all_thirteen_model_controls_active'] is False
    s.institution.revision='oc-2'
    assert general_system_view(p,s,at=5)['components']['ОК']['model_13_control_predicates_active'] is False


def test_plain_historical_org_fields_remain_non_enforcing():
    d=design();parsed=parse_general_system(d,subjects(),{'w1':N(customer='a',source_revision='wr1')},catalog=CATALOG)
    assert parsed.enforce_model_org_code is False
    assert not general_system_view(parsed,state(),at=3)['model_organizational_code_review']['opted_in']


def test_partial_controls_do_not_masquerade_as_authoritative_original_code():
    d=input_data();d['organizational_code']=d['organizational_code'][:8]
    design=registered(d)
    with pytest.raises(OrgCodeInputError):
        parse_org_code_policy(design.declarations['organizational_code'],subjects(),
                              N(operator='op',revision='oc-1'),actions=ACTIONS)


@pytest.mark.parametrize('mod,error',[
  (lambda x:x.update(enforce_model_org_code='yes'),'GENERAL_MODEL_OC_ENFORCEMENT_MUST_BE_BOOLEAN'),
  (lambda x:x['organizational_code'][0].pop('control'),'GENERAL_MODEL_OC_CONTROL_OPT_IN_REQUIRED'),
  (lambda x:x.pop('enforce_model_org_code'),'GENERAL_MODEL_OC_CONTROL_OPT_IN_REQUIRED'),
])
def test_enforcement_must_be_explicit_and_complete(mod,error):
    d=input_data();mod(d)
    with pytest.raises(GeneralSystemInputError,match=error):registered(d)

def test_original_event_observation_counts_without_inventing_transaction_cash_savings():
    d=registered();s=state();s.institution.operator='op';s.institution.revision='oc-1'
    s.trace=[
      {'at':1,'action':'offer','outcome':'APPLIED',
       'model_org_code_review':'MODEL_CODE_CHECKED_ORIGINAL_DECISION_STILL_REQUIRED'},
      {'at':2,'action':'commit','outcome':'BLOCKED', 'reason':'OC_EXPLICIT_PROHIBITION',
       'model_org_code_review':'BLOCKED_BY_ORIGINAL_OR_MODEL_SOURCE_RULE'},
      {'at':3,'action':'source_update','outcome':'APPLIED'},
    ]
    result=general_system_view(d,s,at=4)
    assert result['components']['КЖ']['model_org_code_events_observed']==2
    assert result['components']['Э']['observed_model_governance_blocks']==1
    assert result['components']['Э']['observed_model_governance_checks']==2
    assert result['components']['Э']['transaction_cost_cash_effect'].startswith('NOT_IDENTIFIABLE')
    assert result['components']['Э']['network_profit_or_causal_effect']=='NOT_IDENTIFIABLE'
