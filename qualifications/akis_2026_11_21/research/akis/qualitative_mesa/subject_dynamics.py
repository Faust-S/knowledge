"""Endogenous, non-binding decisions of original economic principals in Mesa.

These are *model-generated* choices, not owner declarations, legal consent, IWXA
software-agent grants, contracts, or results. The original QualitativeAKIS state
is the only authority for actual modeled Work and Result transitions.
"""

from __future__ import annotations

from typing import Any, Mapping


# Author configurations are not aliases for the original SOLE/COLLEGIAL/MIXED
# governance modes. Missing original roles must not be invented by an ABM.
CONFIGURATION_REVIEW = {
    "operator": "SEEK_ORIGINAL_INDEPENDENT_REVIEW",
    "inter": "SEEK_INTERFIRM_ORIGINAL_REVIEW",
    "intra": "AWAIT_INTRA_ORIGINAL_ROLE_QUALIFICATION",
    "sector": "AWAIT_SECTOR_ORIGINAL_RULE_QUALIFICATION",
    "macro": "AWAIT_PUBLIC_ORIGINAL_AUTHORITY_QUALIFICATION",
    "trace": "AWAIT_PERSON_CONTEXT_RIGHT_QUALIFICATION",
}

WITHDRAWAL_REASONS = frozenset({"INDEPENDENT_DECLINE", "PREFERS_OUTSIDE_OPTION"})
PRIOR_OBLIGATION_REASONS = frozenset({"OBLIGATION_ALREADY_COMMITTED"})
SOURCE_REQUALIFICATION_REASONS = frozenset({
    "PROFILE_REVISION_STALE", "CONTEXT_SOURCE_REVOKED",
    "CONTEXT_SOURCE_EXPIRED", "CONTEXT_SOURCE_UNAVAILABLE",
    "CONTEXT_SOURCE_REVISION_STALE", "CONTEXT_SOURCE_NOT_AUTHORIZED",
})
RESOURCE_HOLD_REASONS = frozenset({
    "PARTICIPANT_INACTIVE", "RESOURCE_NOT_AVAILABLE", "RESOURCE_READINESS_UNKNOWN",
    "RESOURCE_READINESS_UNSUPPORTED", "RESOURCE_CAPACITY_UNSUPPORTED",
    "RESOURCE_CALENDAR_UNSUPPORTED", "COOPERATION_FUTURE_PARTICIPATION_PAUSED",
})


def choose_model_action(observation: Mapping[str, Any], *, configuration: str) -> dict[str, str]:
    """Choose a research action using ONLY one principal's current assessment.

    No utility weights, willingness, trust or economic effects are inferred. The
    input comes from EconomicSubject.assess, which already applies actor-scoped
    original source revisions, outside options, resource gates and owner rights.
    """
    if configuration not in CONFIGURATION_REVIEW:
        raise ValueError("UNKNOWN_AUTHOR_CONFIGURATION")
    reason = observation["assessment"]
    if reason in PRIOR_OBLIGATION_REASONS:
        action = "HONOR_PRIOR_OBLIGATION"
    elif reason in WITHDRAWAL_REASONS:
        action = "DECLINE_NEW_OPPORTUNITY"
    elif reason in SOURCE_REQUALIFICATION_REASONS:
        action = "REQUEST_OWNER_SOURCE_REQUALIFICATION"
    elif reason in RESOURCE_HOLD_REASONS:
        action = "HOLD_NEW_OPPORTUNITY_RESOURCE_OR_PARTICIPATION"
    elif (reason in {"OUTSIDE_OPTION_UNKNOWN", "REVIEWABLE_NOT_CONSENTED"}
          and observation.get("_private_owner_cash_review_required")):
        # The original owner privately sees source-qualified portfolio timing.
        # The action is intentionally generic: neither a cash gap nor its
        # owner-specific figures/causes may leak to the common trace.
        action = "REQUEST_INDEPENDENT_EVIDENCE_REVIEW"
    elif (reason in {"OUTSIDE_OPTION_UNKNOWN", "REVIEWABLE_NOT_CONSENTED"}
          and observation.get("goal_comparison") == "INCOMPARABLE_OBJECTIVES"):
        action = "REQUEST_OWNER_MULTI_OBJECTIVE_TRADEOFF_REVIEW"
    elif (reason in {"OUTSIDE_OPTION_UNKNOWN", "REVIEWABLE_NOT_CONSENTED"}
          and observation.get("goal_source_conflict")):
        action = "REQUEST_OWNER_EVIDENCE_RECONCILIATION"
    elif (reason == "REVIEWABLE_NOT_CONSENTED"
          and observation.get("goal_reason") in {
              "STALE_GOAL_SOURCE_OR_ORG_REVISION", "GOAL_SOURCE_EXPIRED",
              "DEPENDENT_ORIGINAL_RESULT_NOT_ACCEPTED",
          }):
        action = "REQUEST_OWNER_GOAL_SOURCE_REQUALIFICATION"
    elif reason == "REVIEWABLE_NOT_CONSENTED":
        if observation.get("execution_gate", "NONE") != "NONE":
            action = "WAIT_FOR_ORIGINAL_PREREQUISITE_RESULT"
        else:
            action = CONFIGURATION_REVIEW[configuration]
    elif reason == "NO_CURRENT_OFFER":
        action = "WAIT_FOR_ORIGINAL_OFFER"
    elif reason in {"MODE_NOT_SELECTED", "CURRENT_AUTHORIZATION_MISSING"}:
        action = "WAIT_FOR_ORIGINAL_AUTHORIZATION"
    else:
        action = "REQUEST_INDEPENDENT_EVIDENCE_REVIEW"
    return {
        "action": action,
        "assessment_reason": reason,
        "evidence": "MODEL_ONLY_SIMULATED_CHOICE",
        "effect_on_original_rights": "NONE",
        "actual_subject_statement": "NOT_OBSERVED",
    }


def cooperative_choice_state(
    state: Any,
    owner_choices: Mapping[str, Mapping[str, Mapping[str, Any]]],
    work_id: str,
    *,
    at: float,
    trace_position: int,
    outlook_epoch: int,
) -> dict[str, Any]:
    """One causal research snapshot; not consensus or a proposed contract.

    The view is current only when all *original* principals have independently
    reacted to the same source event and economic-outlook epoch at this Mesa
    time. No vote, mandate, signature or revised obligation is manufactured.
    """
    work = state.works[work_id]
    principals = sorted(
        state.capacity_ledger.original_owners(work.resource_requirements) | {work.customer}
    )
    if work.obligation != "NOT_ACCEPTED":
        status = "PRIOR_ORIGINAL_OBLIGATION_PRESERVED"
    else:
        current = [owner_choices.get(subject, {}).get(work_id) for subject in principals]
        if any(row is None or row["at"] != at
               or row["source_trace_position"] != trace_position
               or row["outlook_epoch"] != outlook_epoch
               or row["source_revision"] != work.source_revision
               or row["org_revision"] != state.institution.revision
               for row in current):
            status = "WAIT_FOR_ALL_CURRENT_INDEPENDENT_CHOICES"
        elif any(row["action"] == "DECLINE_NEW_OPPORTUNITY" for row in current):
            status = "INDEPENDENT_REFUSAL_PREVENTS_REVIEW_CONSENSUS"
        elif all(row["action"].startswith("SEEK_") for row in current):
            status = "UNSIGNED_MULTILATERAL_REVIEW_CANDIDATE"
        else:
            status = "SOURCE_RESOURCE_OR_INSTITUTIONAL_REVIEW_REQUIRED"
    return {
        "work": work_id,
        "at": at,
        "original_principals": principals,
        "status": status,
        "original_obligation": work.obligation,
        "original_result": work.result,
        "original_consent_not_inferred": True,
        "legal_cooperation_not_formed": True,
    }
