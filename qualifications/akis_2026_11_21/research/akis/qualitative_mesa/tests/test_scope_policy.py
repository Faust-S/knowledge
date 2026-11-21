"""Pure scope predicates; authentication and real company rights NOT tested."""
from types import SimpleNamespace as S
from copy import deepcopy
import pytest
from research.akis.qualitative_mesa.scope_policy import (parse_scope, check_scope, source_link_status,
                          validate_requirement_scope, ScopeInputError, action_scope_reason)


def record(**changes):
    r={'core':'corporate','purposes':['fulfill-w1'],
       'operations':['READ','DERIVE','EXECUTE','ACCEPT'],
       'valid_from':2,'valid_until':8}
    r.update(changes)
    return r


def basis(**changes):
    attrs={'owner':'a','revision':'r1','status':'CONFIRMED',
           'usable_by':('a','op'), 'valid_until':8,
           'scope':parse_scope(record())}
    attrs.update(changes)
    return S(sources={'s1':S(**attrs)})


@pytest.mark.parametrize('mutation, code', [
    ({'core':'invalid'},'CONTEXT_CORE_INVALID'),
    ({'purposes':[]},'CONTEXT_PURPOSES_INVALID'),
    ({'purposes':['A','A']},'CONTEXT_PURPOSES_INVALID'),
    ({'operations':['READ','EXPORT']},'CONTEXT_OPERATIONS_INVALID'),
    ({'valid_from':True},'CONTEXT_VALID_FROM_INVALID'),
    ({'valid_from':10},'CONTEXT_SCOPE_INTERVAL_INVALID'),
    ({'valid_until':'later'},'CONTEXT_SCOPE_INTERVAL_INVALID'),
])
def test_invalid_source_scopes(mutation,code):
    with pytest.raises(ScopeInputError, match=code): parse_scope(record(**mutation))


def test_partial_scope_fail_closed_legacy_scope_absent_is_distinct():
    assert parse_scope({}) is None
    with pytest.raises(ScopeInputError, match='CONTEXT_SCOPE_FIELDS_INCOMPLETE'):
        parse_scope({'core':'personal'})
    assert check_scope(None,core='corporate',purpose='fulfill-w1',operation='READ',at=4) == 'CONTEXT_SCOPE_UNDECLARED'


@pytest.mark.parametrize('kwargs,code',[
    ({'at':1},'CONTEXT_SOURCE_NOT_YET_AVAILABLE'),
    ({'core':'personal'},'CONTEXT_CORE_MISMATCH'),
    ({'purpose':'other'},'CONTEXT_PURPOSE_NOT_PERMITTED'),
    ({'operation':'SHARE'},'CONTEXT_OPERATION_NOT_PERMITTED'),
])
def test_scoped_use_denied_even_when_recipient_is_declared(kwargs,code):
    p={'core':'corporate','purpose':'fulfill-w1','operation':'READ','at':3}
    p.update(kwargs)
    assert check_scope(parse_scope(record()),**p)==code


def test_matching_scope_is_only_model_consistency():
    assert check_scope(parse_scope(record()),core='corporate',purpose='fulfill-w1',operation='READ',at=3)=='MODEL_SOURCE_SCOPE_CONSISTENT'


@pytest.mark.parametrize('changes,reason',[
    ({'source_id':None},'MODEL_CONTEXT_SOURCE_LINK_MISSING'),
    ({'expected_revision':'r2'},'CONTEXT_REVISION_STALE'),
    ({'original_owner':'b'},'MODEL_CONTEXT_ORIGINAL_OWNER_MISMATCH'),
    ({'recipient':'b'},'CONTEXT_USE_NOT_PERMITTED'),
    ({'at':9},'CONTEXT_SOURCE_EXPIRED'),
    ({'purpose':'advertising'},'CONTEXT_PURPOSE_NOT_PERMITTED'),
])
def test_original_owner_and_source_link_is_required(changes,reason):
    args={'source_id':'s1','expected_revision':'r1','original_owner':'a',
          'recipient':'op','core':'corporate','purpose':'fulfill-w1','operation':'READ','at':4}
    args.update(changes)
    assert source_link_status(basis(),**args)==reason


def test_original_owner_revocation_and_recovery_without_granting_real_execution():
    b=basis(); args={'source_id':'s1','expected_revision':'r1','original_owner':'a',
          'recipient':'op','core':'corporate','purpose':'fulfill-w1','operation':'READ','at':4}
    assert source_link_status(b,**args)=='MODEL_SOURCE_SCOPE_CONSISTENT'
    b.sources['s1'].status='UNKNOWN'
    assert source_link_status(b,**args)=='CONTEXT_SOURCE_UNKNOWN'
    b.sources['s1'].status='CONFIRMED'
    b.sources['s1'].usable_by=('a',)
    assert source_link_status(b,**args)=='CONTEXT_USE_NOT_PERMITTED'


@pytest.mark.parametrize('value,reason',[
    ({'core':'corporate'},'CONTEXT_REQUIREMENT_SCOPE_INCOMPLETE'),
    ({'core':'corporate','purpose':'demo','operation':'BUY'},'CONTEXT_REQUIREMENT_SCOPE_INVALID'),
    ({'core':[], 'purpose':'demo', 'operation':'READ'},'CONTEXT_REQUIREMENT_SCOPE_INVALID'),
    ({'core':'corporate','purpose':'demo','operation':[]},'CONTEXT_REQUIREMENT_SCOPE_INVALID'),
])
def test_malformed_requirement_scope(value,reason):
    with pytest.raises(ScopeInputError,match=reason):validate_requirement_scope(value)


def test_requirement_legacy_and_current():
    assert validate_requirement_scope({}) is None
    assert validate_requirement_scope({'core':'corporate','purpose':'demo','operation':'READ'})==('corporate','demo','READ')


def test_work_actions_cannot_gain_execution_via_read_only_grant():
    assert action_scope_reason('commit','READ')=='CONTEXT_ACTION_OPERATION_MISMATCH'
    assert action_scope_reason('commit','ACCEPT')=='MODEL_ACTION_OPERATION_COMPATIBLE'
    assert action_scope_reason('start','EXECUTE')=='MODEL_ACTION_OPERATION_COMPATIBLE'