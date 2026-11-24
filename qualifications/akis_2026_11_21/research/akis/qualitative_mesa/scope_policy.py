"""Shared MODEL_ONLY context scope predicates for the EXISTING ContextBasis.

There is no additional core, source registry, IAM system or event scheduler here.
An independently owned source must explicitly allow the core, purpose, action
and recipient. This tests simulated data eligibility, NOT real authorization.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

CORES = frozenset({'personal', 'corporate', 'operator', 'institutional'})
OPERATIONS = frozenset({'READ', 'DERIVE', 'SHARE', 'PUBLISH', 'ACCEPT', 'EXECUTE'})
SCOPE_FIELDS = frozenset({'core', 'purposes', 'operations', 'valid_from'})
MAX_SCOPES = 24


class ScopeInputError(ValueError):
    """A declaration cannot be safely interpreted as a model-only scope."""


def identifier(value: Any) -> bool:
    return isinstance(value, str) and 0 < len(value.strip()) <= 128


def _names(value: Any, code: str, allowed: frozenset[str] | None = None) -> tuple[str, ...]:
    if (not isinstance(value, list) or not value or len(value) > MAX_SCOPES or
            any(not identifier(v) for v in value) or len(set(value)) != len(value)):
        raise ScopeInputError(code)
    if allowed is not None and any(v not in allowed for v in value):
        raise ScopeInputError(code)
    return tuple(value)


@dataclass(frozen=True)
class SourceScope:
    core: str
    purposes: tuple[str, ...]
    operations: tuple[str, ...]
    valid_from: int


def parse_scope(item: Mapping[str, Any], *, max_time: int = 10000) -> SourceScope | None:
    """Optional legacy compatibility; partially scoped sources are rejected."""
    present = set(item).intersection(SCOPE_FIELDS)
    if not present:
        return None
    if not {'core', 'purposes', 'operations'}.issubset(present):
        raise ScopeInputError('CONTEXT_SCOPE_FIELDS_INCOMPLETE')
    core = item['core']
    if not isinstance(core, str) or core not in CORES:
        raise ScopeInputError('CONTEXT_CORE_INVALID')
    purposes = _names(item['purposes'], 'CONTEXT_PURPOSES_INVALID')
    operations = _names(item['operations'], 'CONTEXT_OPERATIONS_INVALID', OPERATIONS)
    start = item.get('valid_from', 0)
    if type(start) is not int or not 0 <= start <= max_time:
        raise ScopeInputError('CONTEXT_VALID_FROM_INVALID')
    if 'valid_until' in item and item['valid_until'] is not None:
        until = item['valid_until']
        if type(until) is not int or until < 0 or start > until:
            raise ScopeInputError('CONTEXT_SCOPE_INTERVAL_INVALID')
    return SourceScope(core=core, purposes=purposes, operations=operations, valid_from=start)


def validate_requirement_scope(item: Mapping[str, Any]) -> tuple[str, str, str] | None:
    parts = {'core', 'purpose', 'operation'}.intersection(item)
    if not parts:
        return None
    if parts != {'core', 'purpose', 'operation'}:
        raise ScopeInputError('CONTEXT_REQUIREMENT_SCOPE_INCOMPLETE')
    core, purpose, operation = item['core'], item['purpose'], item['operation']
    if (not isinstance(core, str) or core not in CORES or
            not identifier(purpose) or not isinstance(operation, str) or
            operation not in OPERATIONS):
        raise ScopeInputError('CONTEXT_REQUIREMENT_SCOPE_INVALID')
    return core, purpose, operation


def check_scope(scope: SourceScope | None, *, core: str, purpose: str,
                operation: str, at: float) -> str:
    """Fail closed. Return model-specific reason, never a signature/grant."""
    if scope is None:
        return 'CONTEXT_SCOPE_UNDECLARED'
    if at < scope.valid_from:
        return 'CONTEXT_SOURCE_NOT_YET_AVAILABLE'
    if scope.core != core:
        return 'CONTEXT_CORE_MISMATCH'
    if purpose not in scope.purposes:
        return 'CONTEXT_PURPOSE_NOT_PERMITTED'
    if operation not in scope.operations:
        return 'CONTEXT_OPERATION_NOT_PERMITTED'
    return 'MODEL_SOURCE_SCOPE_CONSISTENT'


def source_link_status(basis: Any, *, source_id: str | None,
                       expected_revision: str | None, original_owner: str | None,
                       recipient: str, core: str, purpose: str,
                       operation: str, at: float) -> str:
    """Read the one existing ContextBasis. Never confer new document rights.

    When original_owner is None, the caller is evaluating a delegated actor's
    use of an independently held source. In that case the owner's identity is
    checked by the caller's source binding instead of being inferred.
    """
    if basis is None:
        return 'ORIGINAL_CONTEXT_BASIS_MISSING'
    if not source_id or not expected_revision:
        return 'MODEL_CONTEXT_SOURCE_LINK_MISSING'
    source = basis.sources.get(source_id)
    if source is None:
        return 'MODEL_CONTEXT_SOURCE_NOT_FOUND'
    if original_owner is not None and source.owner != original_owner:
        return 'MODEL_CONTEXT_ORIGINAL_OWNER_MISMATCH'
    if source.revision != expected_revision:
        return 'CONTEXT_REVISION_STALE'
    if recipient not in source.usable_by:
        return 'CONTEXT_USE_NOT_PERMITTED'
    if source.valid_until is not None and at > source.valid_until:
        return 'CONTEXT_SOURCE_EXPIRED'
    if source.status == 'DISPROVED':
        return 'CONTEXT_SOURCE_DISPROVED'
    if source.status != 'CONFIRMED':
        return 'CONTEXT_SOURCE_UNKNOWN'
    return check_scope(getattr(source, 'scope', None), core=core,
                       purpose=purpose, operation=operation, at=at)


# These mappings distinguish source claims from specific Work event authority.
# They do NOT authorize a program agent to emit any original Work event.
WORK_ACTION_OPERATIONS = {
    'authorize': frozenset({'ACCEPT'}),
    'consent': frozenset({'ACCEPT'}),
    'commit': frozenset({'ACCEPT'}),
    'start': frozenset({'EXECUTE'}),
    'start_operation': frozenset({'EXECUTE'}),
    'complete': frozenset({'EXECUTE'}),
    'complete_operation': frozenset({'EXECUTE'}),
    'resubmit': frozenset({'EXECUTE'}),
    'accept': frozenset({'ACCEPT'}),
    'handoff_dispatch': frozenset({'SHARE'}),
    'handoff_receive': frozenset({'ACCEPT'}),
    'handoff_quality': frozenset({'ACCEPT'}),
    'assess_result_quality': frozenset({'ACCEPT'}),
    'interest_update': frozenset({'ACCEPT'}),
}


def action_scope_reason(action: str, operation: str) -> str:
    allowed = WORK_ACTION_OPERATIONS.get(action)
    if allowed is not None and operation not in allowed:
        return 'CONTEXT_ACTION_OPERATION_MISMATCH'
    return 'MODEL_ACTION_OPERATION_COMPATIBLE'