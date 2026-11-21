"""Source-scoped, multi-objective MODEL_ONLY comparisons for original AKIS principals.

A partial order avoids inventing a utility function, weights, legal acceptance or
realized economic gain. Claim sources and comparisons are NOT authenticated.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


class GoalInputError(ValueError):
    """Invalid research assertion (not an observed business refusal)."""


# Operational research criteria, NOT an additional author morphology/taxonomy.
DIMENSIONS = frozenset({
    "economic_surplus", "transaction_cost", "liquidity", "delivery_time",
    "quality", "risk", "resource_utilization", "market_access",
    "knowledge_access", "context_autonomy", "operator_sustainability",
    "environmental_impact",
})
COMPARISONS = frozenset({
    "COOPERATION_BETTER", "OUTSIDE_BETTER", "EQUIVALENT", "UNKNOWN",
})
FIELDS = frozenset({
    "owner", "work", "work_source_revision", "org_revision", "source_ref",
    "available_at", "expires_at", "objectives",
})
OPTIONAL = frozenset({"requires_accepted_results"})
MAX_CLAIMS = 512  # Input guard, not a behavioral coefficient.


def _identifier(value: Any, error: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise GoalInputError(error)
    return value


@dataclass(frozen=True)
class OwnerGoals:
    owner: str
    work: str
    work_source_revision: str
    org_revision: str
    source_ref: str
    available_at: int
    expires_at: int
    objectives: tuple[tuple[str, str], ...]
    requires_accepted_results: tuple[tuple[str, str], ...]


def parse_subject_goals(
    raw: Any, subjects: Mapping[str, Any], known_works: Mapping[str, Any],
) -> tuple[OwnerGoals, ...]:
    """Validate owner-scoped time slices; conflicting overlaps fail closed."""
    if not isinstance(raw, list) or len(raw) > MAX_CLAIMS:
        raise GoalInputError("INVALID_GOAL_CLAIM_COUNT")
    records: list[OwnerGoals] = []
    intervals: dict[tuple[str, str], list[tuple[int, int]]] = {}
    for record in raw:
        if (not isinstance(record, dict) or not FIELDS.issubset(record)
                or set(record) - FIELDS - OPTIONAL):
            raise GoalInputError("INVALID_GOAL_CLAIM_FIELDS")
        owner = _identifier(record["owner"], "INVALID_GOAL_OWNER")
        work = _identifier(record["work"], "INVALID_GOAL_WORK")
        if owner not in subjects:
            raise GoalInputError("GOAL_OWNER_UNKNOWN")
        if work not in known_works:
            raise GoalInputError("GOAL_WORK_UNKNOWN")
        work_rev = _identifier(record["work_source_revision"], "INVALID_GOAL_WORK_REVISION")
        org_rev = _identifier(record["org_revision"], "INVALID_GOAL_ORG_REVISION")
        source = _identifier(record["source_ref"], "INVALID_GOAL_SOURCE")
        if not source.startswith(f"model://{owner}/") or len(source) <= len(f"model://{owner}/"):
            raise GoalInputError("OWNER_SCOPED_GOAL_SOURCE_REQUIRED")
        start, end = record["available_at"], record["expires_at"]
        if (type(start) is not int or type(end) is not int
                or start < 0 or end <= start or end > 10000):
            raise GoalInputError("INVALID_GOAL_SOURCE_WINDOW")
        criteria = record["objectives"]
        if not isinstance(criteria, dict) or not criteria or len(criteria) > len(DIMENSIONS):
            raise GoalInputError("INVALID_GOAL_CRITERIA")
        if any(key not in DIMENSIONS or value not in COMPARISONS
               or not isinstance(value, str) for key, value in criteria.items()):
            raise GoalInputError("UNKNOWN_GOAL_CRITERION_OR_COMPARISON")
        dependencies = record.get("requires_accepted_results", [])
        if not isinstance(dependencies, list) or len(dependencies) > 32:
            raise GoalInputError("INVALID_GOAL_RESULT_DEPENDENCIES")
        deps = []
        for item in dependencies:
            if not isinstance(item, dict) or set(item) != {"work", "source_revision"}:
                raise GoalInputError("INVALID_GOAL_RESULT_DEPENDENCY")
            prior = _identifier(item["work"], "INVALID_GOAL_RESULT_WORK")
            rev = _identifier(item["source_revision"], "INVALID_GOAL_RESULT_REVISION")
            if prior == work or prior not in known_works or prior in {x[0] for x in deps}:
                raise GoalInputError("INVALID_GOAL_RESULT_REFERENCE")
            deps.append((prior, rev))
        key = owner, work
        if any(start < earlier_end and earlier_start < end
               for earlier_start, earlier_end in intervals.get(key, ())):
            raise GoalInputError("OVERLAPPING_OWNER_GOAL_WINDOWS")
        intervals.setdefault(key, []).append((start, end))
        records.append(OwnerGoals(
            owner, work, work_rev, org_rev, source, start, end,
            tuple(sorted(criteria.items())), tuple(sorted(deps)),
        ))
    return tuple(sorted(records, key=lambda row: (row.available_at, row.owner, row.work)))


def compare_objectives(objectives: Sequence[tuple[str, str]]) -> str:
    """Strict Pareto test, without cardinal weights or implied trade-off rates."""
    values = set(value for _, value in objectives)
    if "COOPERATION_BETTER" in values and "OUTSIDE_BETTER" in values:
        return "INCOMPARABLE_OBJECTIVES"
    if "UNKNOWN" in values:
        return "INCOMPLETE_OBJECTIVE_EVIDENCE"
    if "COOPERATION_BETTER" in values:
        return "COOPERATION_DOMINATES_DECLARED_CRITERIA"
    if "OUTSIDE_BETTER" in values:
        return "OUTSIDE_DOMINATES_DECLARED_CRITERIA"
    return "NO_STRICT_OBJECTIVE_PREFERENCE"


def evaluate_subject_goals(
    goals: Sequence[OwnerGoals], *, owner: str, work: Any, org_revision: str,
    at: float, works: Mapping[str, Any], context_basis: Any = None,
    original_owners: set[str] | None = None,
) -> dict[str, Any]:
    """Use only current owner data and accepted original Results as prerequisites.

    This is evidence for a subject's future research decision, never itself
    a delegated decision, consent, inference of willingness, or realized gain.
    """
    base: dict[str, Any] = {
        "position": "UNKNOWN", "comparison": "UNQUALIFIED", "reason": "NO_OWNER_GOAL_CLAIM",
        "basis": "MODEL_ONLY_OWNER_ASSERTION_NOT_AUTHENTICATED",
    }
    if original_owners is not None and owner not in original_owners:
        return {**base, "reason": "GOAL_NOT_ORIGINAL_PRINCIPAL"}
    matching = [row for row in goals if row.owner == owner and row.work == work.key]
    if not matching:
        return base
    current = [row for row in matching if row.available_at <= at < row.expires_at]
    if not current:
        reason = ("GOAL_SOURCE_NOT_YET_AVAILABLE" if any(row.available_at > at for row in matching)
                  else "GOAL_SOURCE_EXPIRED")
        return {**base, "reason": reason}
    if len(current) != 1:
        return {**base, "reason": "AMBIGUOUS_OWNER_GOAL_SOURCE"}
    row = current[0]
    if row.work_source_revision != work.source_revision or row.org_revision != org_revision:
        return {**base, "reason": "STALE_GOAL_SOURCE_OR_ORG_REVISION"}
    if context_basis is not None and context_basis.strict:
        from .context_basis import ContextBlocked
        try:
            context_basis.assert_allowed(work.key, "interest_update", owner, int(at))
        except ContextBlocked as exc:
            return {**base, "reason": "GOAL_CONTEXT_" + exc.reason}
    for prior, revision in row.requires_accepted_results:
        previous = works.get(prior)
        if (previous is None or previous.source_revision != revision
                or previous.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
            return {**base, "reason": "DEPENDENT_ORIGINAL_RESULT_NOT_ACCEPTED"}
    comparison = compare_objectives(row.objectives)
    position = (
        "COOPERATION_PREFERRED" if comparison == "COOPERATION_DOMINATES_DECLARED_CRITERIA"
        else "OUTSIDE_PREFERRED" if comparison == "OUTSIDE_DOMINATES_DECLARED_CRITERIA"
        else "UNKNOWN"
    )
    return {
        **base, "position": position, "comparison": comparison,
        "reason": "CURRENT_OWNER_GOAL_EVIDENCE", "available_at": row.available_at,
        "private_objectives": "NOT_REDISCLOSED",
        "source_authenticated": False, "not_consent": True,
    }
