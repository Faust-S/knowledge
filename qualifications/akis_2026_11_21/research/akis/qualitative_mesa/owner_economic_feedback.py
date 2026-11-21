"""Owner-private economic constraint on new Work: ONE existing Mesa actor choice.

This is a narrow model-only bridge from the ORIGINAL economic_claims cash
timing and independent objective rights to the existing EconomicSubject.
A claim is only a time-scoped *research permission to consider* the
original owner's portfolio-level timing evidence. It is not a new bank
entry, new goal, contract, actual grant or delegated financial decision.

Crucially, the private reason/amount must NEVER be placed in shared
decision_observations or general_akis_model; only a generic nonbinding
request for independent review may leave the owner's in-memory assessor.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .context_basis import ContextBlocked


class OwnerFinanceInputError(ValueError):
    """Unqualified owner source must not affect an independent actor."""


@dataclass(frozen=True)
class OwnerFinanceClaim:
    owner: str
    work: str
    work_revision: str
    org_revision: str
    source_ref: str
    cash_source: str
    cash_source_revision: str
    available_at: int
    expires_at: int
    prerequisites: tuple[tuple[str, str], ...]


def _id(v: Any, code: str) -> str:
    if not isinstance(v, str) or not v.strip() or len(v) > 128:
        raise OwnerFinanceInputError(code)
    return v


def parse_owner_finance(
    raw: Any, *, state: Any, original_money: Mapping[str, Any],
) -> tuple[OwnerFinanceClaim, ...]:
    """Bind a separate original principal's source to the existing cash data.

    The cash_scope constant intentionally prevents misrepresenting an owner's
    whole portfolio forecast as *incremental profit* caused by one Work.
    """
    if not isinstance(raw, list) or len(raw) > 256:
        raise OwnerFinanceInputError("INVALID_OWNER_FINANCE_CLAIM_COUNT")
    if raw and (not isinstance(original_money, dict) or
                not isinstance(original_money.get("cash_timing"), dict) or
                not isinstance(original_money.get("sources"), list)):
        raise OwnerFinanceInputError("OWNER_FINANCE_REQUIRES_ORIGINAL_CASH_TIMING")
    cash_sources = {
        s.get("id"): s for s in original_money.get("sources", [])
        if isinstance(s, dict) and isinstance(s.get("id"), str)
    } if isinstance(original_money, dict) else {}
    claims: list[OwnerFinanceClaim] = []
    intervals: dict[tuple[str, str], list[tuple[int, int]]] = {}
    required = {
        "owner", "work", "work_source_revision", "org_revision",
        "source_ref", "cash_source", "cash_source_revision",
        "available_at", "expires_at", "cash_scope",
    }
    for row in raw:
        if (not isinstance(row, dict) or not required.issubset(row)
                or set(row) - required - {"requires_accepted_results"}):
            raise OwnerFinanceInputError("INVALID_OWNER_FINANCE_CLAIM_FIELDS")
        owner = _id(row["owner"], "INVALID_OWNER_FINANCE_OWNER")
        work_id = _id(row["work"], "INVALID_OWNER_FINANCE_WORK")
        work_rev = _id(row["work_source_revision"], "INVALID_OWNER_FINANCE_WORK_REVISION")
        org_rev = _id(row["org_revision"], "INVALID_OWNER_FINANCE_ORG_REVISION")
        source_ref = _id(row["source_ref"], "INVALID_OWNER_FINANCE_SOURCE_REF")
        cash_source = _id(row["cash_source"], "INVALID_OWNER_FINANCE_CASH_SOURCE")
        cash_rev = _id(row["cash_source_revision"], "INVALID_OWNER_FINANCE_CASH_REVISION")
        if owner not in state.subjects:
            raise OwnerFinanceInputError("OWNER_FINANCE_UNKNOWN_ORIGINAL_OWNER")
        work = state.works.get(work_id)
        if work is None:
            raise OwnerFinanceInputError("OWNER_FINANCE_REQUIRES_EXISTING_ORIGINAL_WORK")
        original_principals = (
            state.capacity_ledger.original_owners(work.resource_requirements)
            | {work.customer}
        )
        if owner not in original_principals or work.source_revision != work_rev:
            raise OwnerFinanceInputError("OWNER_FINANCE_NOT_ORIGINAL_WORK_PRINCIPAL")
        if not source_ref.startswith(f"model://{owner}/") or (
                len(source_ref) <= len(f"model://{owner}/")):
            raise OwnerFinanceInputError("OWNER_FINANCE_INDEPENDENT_OWNER_SOURCE_REQUIRED")
        csource = cash_sources.get(cash_source, {})
        if csource.get("owner") != owner or csource.get("revision") != cash_rev:
            raise OwnerFinanceInputError("OWNER_FINANCE_CASH_SOURCE_OWNER_OR_REVISION_MISMATCH")
        if row["cash_scope"] != "OWNER_PORTFOLIO_NOT_WORK_INCREMENTAL":
            raise OwnerFinanceInputError("OWNER_FINANCE_CASH_SCOPE_MUST_BE_PORTFOLIO")
        start, end = row["available_at"], row["expires_at"]
        if (type(start) is not int or type(end) is not int or
                not 0 <= start < end <= 10000):
            raise OwnerFinanceInputError("OWNER_FINANCE_SOURCE_TIME_INVALID")
        prior = intervals.setdefault((owner, work_id), [])
        if any(start < prev_end and prev_start < end for prev_start, prev_end in prior):
            raise OwnerFinanceInputError("OVERLAPPING_OWNER_FINANCE_SOURCE_WINDOWS")
        prior.append((start, end))
        depraw = row.get("requires_accepted_results", [])
        if not isinstance(depraw, list) or len(depraw) > 32:
            raise OwnerFinanceInputError("INVALID_OWNER_FINANCE_PREREQUISITES")
        deps = []
        for dep in depraw:
            if not isinstance(dep, dict) or set(dep) != {"work", "source_revision"}:
                raise OwnerFinanceInputError("INVALID_OWNER_FINANCE_PREREQUISITE_FIELDS")
            prior_work = _id(dep["work"], "INVALID_OWNER_FINANCE_PRIOR_WORK")
            prior_revision = _id(dep["source_revision"], "INVALID_OWNER_FINANCE_PRIOR_REVISION")
            if prior_work == work_id or prior_work not in state.works or prior_work in [p for p, _ in deps]:
                raise OwnerFinanceInputError("OWNER_FINANCE_PREREQUISITE_NOT_ORIGINAL")
            deps.append((prior_work, prior_revision))
        claims.append(OwnerFinanceClaim(
            owner, work_id, work_rev, org_rev, source_ref, cash_source,
            cash_rev, start, end, tuple(sorted(deps)),
        ))
    return tuple(sorted(claims, key=lambda c: (c.available_at, c.owner, c.work)))


def private_owner_financial_review(
    claims: Sequence[OwnerFinanceClaim], *, owner: str, work: Any, state: Any,
    at: float, economics: Mapping[str, Any],
) -> bool:
    """Return a private review gate, not a preference, refusal, or cash value.

    A missing current source, original result, or required ContextBasis
    authority prevents any use of this financial signal. Only an active,
    eligible source with adverse or incomplete cash evidence prompts a
    generic review without disclosing why.
    The returned boolean is NOT serialized into global model observations.
    """
    current = [c for c in claims if c.owner == owner and c.work == work.key
               and c.available_at <= at < c.expires_at]
    if not current:
        return False
    if len(current) != 1:
        return True
    c = current[0]
    if c.work_revision != work.source_revision or c.org_revision != state.institution.revision:
        return False
    if not state.subjects[owner].active:
        return False
    if state.context_basis is not None and state.context_basis.strict:
        try:
            state.context_basis.assert_allowed(work.key, "interest_update", owner, int(at))
        except ContextBlocked:
            # Never use an inaccessible source even for a generic
            # financial-origin review action: no information leakage.
            return False
    for prior_work, prior_rev in c.prerequisites:
        w = state.works.get(prior_work)
        if w is None or w.source_revision != prior_rev or w.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT":
            return False

    cash = economics.get("cash_timing", {})
    owner_path = cash.get("per_original_owner_private_research_projection", {}).get(owner, {})
    scenario_paths = owner_path.get("scenario_paths", {})
    coop = scenario_paths.get("COOPERATION", {})
    outside = scenario_paths.get("INDEPENDENT_ALTERNATIVE", {})
    if (coop.get("status") != "SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY"
            or outside.get("status") != "SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY"):
        return True
    # Timing and outside option must be independently source-declared.
    if economics.get("per_subject", {}).get(owner, {}).get("outside_feasibility") != "FEASIBLE_DECLARED":
        return True
    # An original owner's reserve may not be exposed here; all four statuses
    # are evaluated privately, without converting them into a utility score.
    for scenario in (coop, outside):
        for variant in ("expected", "declared_late_case"):
            if scenario.get(variant, {}).get("status") != "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS":
                return True
    return False
