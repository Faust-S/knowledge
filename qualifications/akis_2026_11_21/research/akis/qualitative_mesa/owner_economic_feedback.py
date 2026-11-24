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


def review_completed_original_owner_finance(
    *, state: Any, original_money: Mapping[str, Any] | None,
    work_id: str, owner: str, review_source: str,
    review_revision: str, at: int,
) -> str:
    """Qualify an independently requested, owner-scoped completed Work review.

    A read-only selection of the original economic document goes through the
    same strict KPB, original cost anchors, and original economic evaluator.
    Later settlement/amendment reports are not available at this decision.
    This view deliberately omits a liquidity calculation from an isolated
    Work: the beginning-of-portfolio cash cannot be treated as its opening
    cash. Only a generic source-scope status may leave the private calculation.
    It neither decides the owner's verdict nor creates consent or a new Work.
    """
    from .economic_flow import EconomicInputError, evaluate_economic_claims
    from .strict_economic_source_review import (
        StrictEconomicSourceBlocked, original_owner_economic_core,
        review_original_strict_economic_sources,
    )

    unknown = "UNKNOWN"
    active, inactive = "COOPERATION", "INDEPENDENT_ALTERNATIVE"
    basis = getattr(state, "context_basis", None)
    work = state.works.get(work_id)
    subject = state.subjects.get(owner)
    if (basis is None or not basis.strict or work is None
            or subject is None or not subject.active
            or owner not in (
                state.capacity_ledger.original_owners(work.resource_requirements)
                | {work.customer}
            )
            or work.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            or type(at) is not int
            or not isinstance(review_source, str)
            or not review_source.startswith(f"model://{owner}/")
            or not isinstance(review_revision, str) or not review_revision.strip()
            or not isinstance(original_money, Mapping)
            or not any(row.get("work") == work_id
                       and row.get("action") == "accept"
                       and row.get("outcome") == "APPLIED"
                       and row["at"] < at for row in state.trace)):
        return unknown
    core = original_owner_economic_core(subject.kind)
    if core is None:
        return unknown
    try:
        basis.assert_original_form_role_source(
            owner, review_source, review_revision, core=core,
            purpose="AKIS_ECONOMIC_WORK_EVIDENCE", operation="READ",
            recipients={owner}, at=at,
        )
        doc = original_money
        transfers = [row for row in doc["transfers"]
                     if row["work"] == work_id and row["scenario"] == active]
        uses = [row for row in doc["resource_uses"]
                if row["work"] == work_id and row["scenario"] == active]
        if not transfers or not uses:
            return unknown
        tids = {row["id"] for row in transfers}
        uids = {row["id"] for row in uses}
        owners = (
            {party for row in transfers for party in (row["payer"], row["payee"])}
            | {row["owner"] for row in uses}
            | state.capacity_ledger.original_owners(work.resource_requirements)
            | {work.customer}
        ) - {"EXTERNAL"}

        def attached(rows, key, identifiers):
            if not isinstance(rows, list):
                raise ValueError("ORIGINAL_FINANCIAL_REVIEW_ROWS_REQUIRED")
            return [row for row in rows if row[key] in identifiers]

        timing = doc["cash_timing"]
        life = doc["lifecycle_costs"]
        terms = attached(doc["work_payment_conditions"], "transfer_id", tids)
        windows = attached(timing["transfer_windows"], "transfer_id", tids)
        classified = attached(life["bindings"], "resource_use_id", uids)
        cost_events = attached(life["event_bindings"], "resource_use_id", uids)
        if (len(terms) != len(transfers) or len(windows) != len(transfers)
                or len(classified) != len(uses) or len(cost_events) != len(uses)
                or any(type(row["at"]) is not int or row["at"] >= at
                       for row in cost_events)):
            return unknown
        prior_reports = {}
        for field, clock in (
            ("work_payment_settlement_claims", "at"),
            ("work_payment_due_amendments", "agreed_at"),
        ):
            candidates = attached(doc.get(field, []), "transfer_id", tids)
            if any(type(row[clock]) is not int for row in candidates):
                return unknown
            prior_reports[field] = [row for row in candidates if row[clock] < at]
        coverage = {sc: {} for sc in (active, inactive)}
        scope = {sc: {} for sc in (active, inactive)}
        coverage[active] = {key: value for key, value in doc["coverage"][active].items()
                            if key in owners}
        scope[active] = {key: value for key, value in life["scope_proofs"][active].items()
                         if key in owners}
        if owner not in coverage[active] or owner not in scope[active]:
            return unknown
        # Do not read unused sources or the other Work's future declarations.
        # The same strict reviewer still validates every referenced owner.
        referenced = set(coverage[active].values()) | set(scope[active].values())
        for row in (
            transfers + uses + terms + windows + classified + cost_events
            + prior_reports["work_payment_settlement_claims"]
            + prior_reports["work_payment_due_amendments"]
        ):
            if "source" in row:
                referenced.add(row["source"])
            referenced.update(row.get("owner_sources", {}).values())
        selected = {
            "period": doc["period"], "currency": doc["currency"],
            "sources": [row for row in doc["sources"] if row["id"] in referenced],
            "transfers": transfers, "resource_uses": uses,
            "coverage": coverage, "outside_feasibility": {},
            "cash_timing": {
                "horizon_end": timing["horizon_end"],
                "owner_positions": [], "transfer_windows": windows,
            },
            "lifecycle_costs": {
                "bindings": classified, "scope_proofs": scope,
                "event_bindings": cost_events,
            },
            "work_payment_conditions": terms,
            **prior_reports,
        }
        rights = review_original_strict_economic_sources(
            state=state, original_claims=selected, work_id=work_id, at=at,
        )
        view = evaluate_economic_claims(
            selected, state.subjects, state.works,
            state.cooperation_links, state.trace,
        )
    except (ContextBlocked, StrictEconomicSourceBlocked, EconomicInputError,
            KeyError, TypeError, ValueError, AttributeError):
        # Neither inaccessible data nor incomplete sources may appear in an
        # owner review, and an independent refusal remains possible.
        return unknown
    payment = view["work_payment_causality"]
    costs = view["lifecycle_resource_costs"]
    balance = view["per_subject"][owner]["complete_cash_balance_from_claims"][active]
    owner_cost = costs["owner_scoped_details"][owner]["scenarios"][active]
    if (payment["status"] != "DECLARED_CAUSAL_PAYMENT_ORDER_ONLY_NOT_SETTLEMENT"
            or payment["source_declared_consistent_count"] != len(transfers)
            or rights["source_scoped_original_cost_event_count"] != len(uses)
            or costs["classified_original_record_count"] != len(uses)
            or balance is None or not owner_cost["declared_resource_scope_complete_not_audited"]):
        return unknown
    return "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
