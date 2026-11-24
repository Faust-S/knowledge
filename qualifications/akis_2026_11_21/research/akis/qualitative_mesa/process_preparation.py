"""Source-bound execution of non-binding process functions inside the ONE AKIS model.

A=F(P,OC,KPB) has only a limited PREPARATION/CHECK research realization here.
This is not an alternate agent, event scheduler, ContextBasis, ToolRuntime or IAM.
It operates on the original Work snapshot, after the source/OC verdict has been
computed by general_system_view, and cannot write to the original model.
"""
from __future__ import annotations

from typing import Any, Mapping

MODEL_READY = 'MODEL_SOURCE_SCOPED_PREPARATION_ONLY'
FUNCTION_TYPES = frozenset({'CHECK', 'PREPARE', 'RECOMMEND', 'REQUEST_APPROVAL', 'EXECUTE'})


def perform_bounded_process_step(
    function: Mapping[str, Any],
    source_verdict: str,
    work_scope: Mapping[str, Any] | None,
    original_state: Any,
    *,
    at: float,
) -> dict[str, Any]:
    """Perform a deterministic, evidence-limited process computation.

    No original event, consent, resource reservation, external act or Result is
    created. The output is ephemeral, replayable, and inherits the original
    source and Work revision: a later revocation cannot retroactively rewrite
    the original execution history.
    """
    action = function.get('action')
    if action not in FUNCTION_TYPES:
        raise ValueError('AGENT_UNKNOWN_MODEL_FUNCTION')
    function_id = function.get('id')
    work_id = function.get('work')
    for key, value in [('id', function_id), ('work', work_id)]:
        if not isinstance(value, str) or not value or len(value) > 160:
            raise ValueError('AGENT_INVALID_' + key.upper())
    base = {
        'schema': 'AKIS_BOUNDED_PROCESS_STEP/0.1',
        'at': at,
        'function': function_id,
        'work': work_id,
        'model_function': action,
        'declaration_owner': function.get('owner'),
        'source_ref': function.get('source_ref'),
        'source_revision': function.get('revision'),
        'original_work_revision': function.get('work_revision'),
        'original_context_source': function.get('basis_source'),
        'basis_revision': function.get('basis_revision'),
        'source_verdict': source_verdict,
        'original_trace_position': len(getattr(original_state, 'trace', ())),
        'original_event_created': False,
        'original_work_changed': False,
        'original_result_created': False,
        'external_action_executed': False,
        'human_decision_recorded': False,
        'observed_cost_or_time_saving': 'NOT_IDENTIFIABLE',
    }
    if action == 'EXECUTE':
        return {**base, 'status': 'HUMAN_AUTHORIZATION_REQUIRED',
                'reason': 'ORIGINAL_PROGRAM_EXECUTION_NOT_DELEGATED',
                'artifact': None}
    if source_verdict != MODEL_READY:
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': source_verdict, 'artifact': None}
    work = getattr(original_state, 'works', {}).get(work_id)
    if work is None or getattr(work, 'source_revision', None) != function.get('work_revision'):
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': 'ORIGINAL_WORK_REVISION_MISMATCH', 'artifact': None}
    if work_scope is None or work_scope.get('work') != work_id:
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': 'ORIGINAL_PROCESS_SCOPE_MISSING', 'artifact': None}
    # This is the existing morphology module's original-principal analysis,
    # not a second calculation of owners/Work acceptance.
    principals = work_scope.get('original_principals')
    missing = work_scope.get('unresolved_original_consultation')
    if (not isinstance(principals, list) or not principals or
            not isinstance(missing, list) or
            any(not isinstance(p, str) or not p for p in principals + missing) or
            len(set(principals)) != len(principals) or
            len(set(missing)) != len(missing) or
            not set(missing) <= set(principals)):
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': 'ORIGINAL_PRINCIPAL_PROJECTION_INCOMPLETE', 'artifact': None}
    customer = getattr(work, 'customer', None)
    if customer not in principals:
        return {**base, 'status': 'HELD_FOR_ORIGINAL_REVIEW',
                'reason': 'ORIGINAL_CUSTOMER_NOT_QUALIFIED', 'artifact': None}
    status = ('HUMAN_REVIEW_PACKET_COMPUTED' if action == 'REQUEST_APPROVAL'
              else 'NONBINDING_PROCESS_COMPUTATION_PERFORMED')
    common = {
        'work': work_id,
        'original_customer': customer,
        'original_principals': list(principals),
        'missing_original_consents': list(missing),
        'original_work_state': {
            'proposal': getattr(work, 'proposal', 'UNKNOWN'),
            'authorized': bool(getattr(work, 'admitted', False)),
            'obligation': getattr(work, 'obligation', 'UNKNOWN'),
            'execution': getattr(work, 'execution', 'UNKNOWN'),
            'result': getattr(work, 'result', 'UNKNOWN'),
        },
        'research_next_step': work_scope.get('research_next_step', 'UNQUALIFIED'),
        'independent_original_review_required': True,
        'source_values_or_private_documents_republished': False,
    }
    # Functions are actual computations on state, not asserted capabilities.
    # The output remains strictly a metadata-only research artifact.
    if action == 'CHECK':
        common['computed_checks'] = {
            'original_customer_in_principals': True,
            'original_authorization_recorded': bool(getattr(work, 'admitted', False)),
            'independent_consents_currently_present': len(missing) == 0,
            'original_accepted_obligation': getattr(work, 'obligation', None)
                in {'ACCEPTED_BY_ORIGINAL_PRINCIPALS', 'FULFILLED'},
            'accepted_original_result': getattr(work, 'result', None)
                == 'ACCEPTED_BY_ORIGINAL_RECIPIENT',
        }
        kind = 'SOURCE_BOUND_PROCESS_CHECK'
    elif action == 'PREPARE':
        common['preparation_items'] = [
            'VERIFY_CURRENT_ORIGINAL_WORK_AND_CONTEXT',
            'CHECK_ORIGINAL_DECISION_AUTHORITY_AND_CONSENTS',
            'REVIEW_RESOURCE_TECHNOLOGY_AND_OUTSIDE_ALTERNATIVE',
            'SUBMIT_ANY_BINDING_CHANGES_TO_ORIGINAL_PRINCIPALS',
        ]
        kind = 'SOURCE_BOUND_PREPARATION_PACKET'
    elif action == 'RECOMMEND':
        common['model_recommendation'] = work_scope.get('research_next_step', 'UNQUALIFIED')
        common['recommendation_is_not_an_original_decision'] = True
        kind = 'NONBINDING_RESEARCH_RECOMMENDATION'
    else:
        # Requesting approval here prepares a packet; never messages a person,
        # creates a Task, fabricates an approval, or schedules an original event.
        common['proposed_original_reviewers'] = sorted(set(missing or [customer]))
        common['review_request_sent'] = False
        kind = 'HUMAN_REVIEW_PACKET_NOT_SENT'
    return {**base, 'status': status, 'reason': 'SOURCE_AND_OC_MODEL_CHECKS_PASSED',
            'artifact': {'kind': kind, **common}}

# Dissertation S0/S1/S2: a controlled preparation sub-process, not three
# different organizations. The same original qualified audit packet and
# independent decision gates remain in force in all three methods.
PREPARATION_MODES = ("S0", "S1", "S2")
PREPARATION_ACTIVITY_UNITS = (
    "human_entry", "program_fill", "human_validation", "packet_overhead",
)


def model_preparation_activity(state: Any, work: Any, mode: str) -> dict[str, Any]:
    """Count the field operations of preparing the same current Work packet.

    S0: manual transcription; S1: fixed document template fills header only;
    S2: source-bound bounded computation fills current values as well.
    Every field remains subject to modeled human verification, and the
    original customer's subsequent independent review is NOT replaced.
    These are structural work units, not measured seconds or LLM tokens.
    """
    if mode not in PREPARATION_MODES:
        raise ValueError("PREPARATION_MODE_INVALID")
    from .configuration_behavior import _original_principals

    # Build the SAME task set from the current original Work, rather than
    # assigning a percentage of time saving to a mode.
    header = ("work", "work_revision", "org_revision", "function")
    state_fields = ("proposal", "authorized", "obligation", "execution", "result")
    principals = _original_principals(state, work)
    current = state_fields + tuple(
        field for principal in principals
        for field in (("principal", principal), ("consent_status", principal))
    )
    fields = len(header) + len(current)
    program = {"S0": 0, "S1": len(header), "S2": fields}[mode]
    return {
        "mode": mode,
        "original_header_field_count": len(header),
        "original_current_field_count": len(current),
        "original_principal_count": len(principals),
        "units": {
            "human_entry": fields - program,
            "program_fill": program,
            "human_validation": fields,
            "packet_overhead": 1,
        },
        "basis": "MODEL_FIELD_OPERATIONS_ON_ORIGINAL_QUALIFIED_PACKET",
        "independent_customer_review_remains_required": True,
        "actual_labor_time_or_software_runtime_measured": False,
    }
