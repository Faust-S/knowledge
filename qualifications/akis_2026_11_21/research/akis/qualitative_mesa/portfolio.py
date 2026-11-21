"""Causal portfolio links and institutional review cues within one AKIS.

Research-only projection. Nothing here can create a contract, resource allocation,
organizational permission, real Result, or economically measured effect.
"""
from __future__ import annotations

from typing import Any, Mapping


class PortfolioInputError(ValueError):
    """Malformed dependency specification, not an organizational refusal."""


def _work_id(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise PortfolioInputError("INVALID_DEPENDENCY_WORK_ID")
    return value


def parse_dependencies(raw: Any, work_id: str) -> tuple[str, ...]:
    """Validate links without interpreting them as contracts or causation proof."""
    if not isinstance(raw, list) or len(raw) > 256:
        raise PortfolioInputError("INVALID_DEPENDENCY_LIST")
    targets = tuple(_work_id(s) for s in raw)
    if len(targets) != len(set(targets)):
        raise PortfolioInputError("DUPLICATE_DEPENDENCY")
    if work_id in targets:
        raise PortfolioInputError("SELF_DEPENDENCY")
    return targets


def validate_dependency_graph(works: Mapping[str, Any]) -> None:
    """Ensure all source-grounded links exist and causal precedence is acyclic."""
    visited: set[str] = set()
    visiting: set[str] = set()

    def visit(key: str) -> None:
        if key in visiting:
            raise PortfolioInputError("CYCLIC_WORK_DEPENDENCY")
        if key in visited:
            return
        visiting.add(key)
        for dep in works[key].requires_accepted:
            if dep not in works:
                raise PortfolioInputError("DEPENDENCY_WORK_UNKNOWN")
            visit(dep)
        visiting.remove(key)
        visited.add(key)

    for name in sorted(works):
        visit(name)


def readiness(works: Mapping[str, Any], work_id: str) -> dict[str, Any]:
    """Check an actual prerequisite *result acceptance*, never mere completion."""
    work = works[work_id]
    required = tuple(work.requires_accepted)
    missing = [name for name in required if works[name].result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"]
    rejected = [name for name in missing if works[name].result == "REJECTED"]
    reason = "UPSTREAM_RESULT_REJECTED" if rejected else ("DEPENDENCY_AWAITING_ACCEPTANCE" if missing else "NONE")
    return {
        "work": work_id,
        "requires_accepted": list(required),
        "unmet": missing,
        "rejected": rejected,
        "dependency_status": "BLOCKED" if missing else "SATISFIED",
        "reason": reason,
        "evidence": "MODEL_ONLY",
    }


# These are non-binding possibilities for inquiry, not claims about root causes.
BLOCKED_REVIEW_CUES = {
    "RESOURCE_ALREADY_COMMITTED": "RESOURCE_PORTFOLIO_REVIEW",
    "RESOURCE_CAPACITY_EXCEEDED": "RESOURCE_PORTFOLIO_REVIEW",
    "RESOURCE_CAPACITY_UNSUPPORTED": "RESOURCE_SOURCE_REVIEW",
    "RESOURCE_CALENDAR_UNSUPPORTED": "RESOURCE_CALENDAR_SOURCE_REVIEW",
    "RESOURCE_CALENDAR_CAPACITY_EXCEEDED": "RESOURCE_CALENDAR_FEASIBILITY_REVIEW",
    "RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT": "EXISTING_CAPACITY_OBLIGATION_RISK",
    "RESOURCE_READINESS_UNKNOWN": "RESOURCE_SOURCE_REVIEW",
    "RESOURCE_READINESS_UNSUPPORTED": "RESOURCE_SOURCE_REVIEW",
    "CONTEXT_REQUIREMENT_MISSING": "KPB_REQUIREMENT_REVIEW",
    "CONTEXT_SOURCE_UNKNOWN": "KPB_UNCERTAINTY_REVIEW",
    "CONTEXT_SOURCE_DISPROVED": "KPB_CONFLICT_REVIEW",
    "CONTEXT_CONTRADICTORY_ORIGINALS": "KPB_CONFLICT_REVIEW",
    "CONTEXT_REVISION_STALE": "KPB_VERSION_REVIEW",
    "CONTEXT_SOURCE_EXPIRED": "KPB_VERSION_REVIEW",
    "CONTEXT_USE_NOT_PERMITTED": "KPB_USE_RIGHTS_REVIEW",
    "RESOURCE_NOT_AVAILABLE": "RESOURCE_CAPABILITY_REVIEW",
    "DEPENDENCY_AWAITING_ACCEPTANCE": "PROCESS_DEPENDENCY_REVIEW",
    "UPSTREAM_RESULT_REJECTED": "PROCESS_CORRECTION_REVIEW",
    "OPERATION_PREDECESSOR_INCOMPLETE": "TECHNOLOGY_PRECEDENCE_REVIEW",
    "TECHNOLOGY_OPERATIONS_INCOMPLETE": "TECHNOLOGY_COMPLETENESS_REVIEW",
    "HANDOFF_RECEIPT_NOT_DECLARED": "CROSS_OWNER_HANDOFF_REVIEW",
    "HANDOFF_DISPATCH_REFERENCE_MISMATCH": "CROSS_OWNER_SOURCE_REVIEW",
    "MATERIAL_QUANTITY_SHORT": "CROSS_OWNER_MATERIAL_SHORTAGE_REVIEW",
    "MATERIAL_QUALITY_NOT_ASSESSED": "CROSS_OWNER_QUALITY_REVIEW",
    "MATERIAL_QUALITY_INSUFFICIENT": "CROSS_OWNER_QUALITY_REVIEW",
    "COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK": "ORIGINAL_FUTURE_PARTICIPATION_REVIEW",
    "COOPERATION_CHANGE_SOURCE_RIGHTS_NOT_QUALIFIED": "COOPERATION_CONTEXT_SCOPE_REVIEW",
    "COOPERATION_CHANGE_SOURCE_REVISION_STALE": "COOPERATION_ORIGINAL_SOURCE_REVIEW",
    "COOPERATION_CHANGE_PROPOSAL_NOT_FOUND": "COOPERATION_PROPOSAL_ORDER_REVIEW",
    "PARTICIPATION_ORIGINAL_MEMBER_REQUIRED": "COOPERATIVE_RELATIONSHIP_RIGHTS_REVIEW",
    "MATERIAL_REPORTED_TIME_CONTRADICTION": "CROSS_OWNER_EVENT_TIME_REVIEW",
    "QUORUM_NOT_MET": "GOVERNANCE_PROCEDURE_REVIEW",
    "COUNCIL_NOT_UNANIMOUS": "GOVERNANCE_PROCEDURE_REVIEW",
    "COUNCIL_MAJORITY_NOT_MET": "GOVERNANCE_PROCEDURE_REVIEW",
    "MODE_NOT_SELECTED": "GOVERNANCE_SOURCE_REVIEW",
}
APPLIED_REVIEW_CUES = {
    "reject": "RESULT_CORRECTION_REVIEW",
    "change_mode": "INSTITUTIONAL_CHANGE_RECORDED",
    "exclude": "FUTURE_NETWORK_CAPABILITY_REVIEW",
    "resubmit": "CORRECTION_SUBMITTED_FOR_REVIEW",
    "source_update": "KPB_SOURCE_CHANGE_RECORDED",
    "resource_calendar_update": "CAPACITY_CALENDAR_REVISED",
    "handoff_dispatch": "CROSS_OWNER_DISPATCH_DECLARED",
    "handoff_receive": "CROSS_OWNER_RECEIPT_DECLARED",
    "handoff_quality": "CROSS_OWNER_QUALITY_DECLARED",
    "interest_update": "ORIGINAL_COOPERATIVE_INTEREST_DECLARED",
    "participation_status": "ORIGINAL_FUTURE_PARTICIPATION_DECLARED",
    "cooperation_change_propose": "MULTILATERAL_COOPERATION_REVIEW_PROPOSED",
    "cooperation_change_response": "ORIGINAL_PARTICIPANT_REVIEW_DECLARED",
}


def review_cues(trace: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Explain what may need examination, not how an institution must change."""
    cues: list[dict[str, Any]] = []
    for event in trace:
        kind = (BLOCKED_REVIEW_CUES.get(event["reason"]) if event["outcome"] == "BLOCKED"
                else APPLIED_REVIEW_CUES.get(event["action"]))
        if kind is None:
            continue
        cues.append({
            "at": event["at"],
            "event_action": event["action"],
            "work": event.get("work"),
            "resource": event.get("resource"),
            "org_revision": event["org_revision"],
            "signal": kind,
            "basis": event["reason"] if event["outcome"] == "BLOCKED" else "MODEL_EVENT",
            "evidence": "MODEL_ONLY",
            "decision": "NOT_AUTOMATIC",
            "causal_attribution": "NOT_IDENTIFIABLE",
            **({"reservation_risks": list(event["reservation_risks"])}
               if "reservation_risks" in event else {}),
        })
    return cues


def portfolio_view(works: Mapping[str, Any], trace: list[dict[str, Any]]) -> dict[str, Any]:
    """Observable projection of modeled inter-work constraints and review cues."""
    return {
        "evidence": "MODEL_ONLY",
        "dependencies": {key: readiness(works, key) for key in sorted(works)},
        "review_cues": review_cues(trace),
        "economic_effect": "UNKNOWN",
        "institutional_change": "NO_AUTOMATIC_CHANGE",
    }
