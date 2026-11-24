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


def original_executed_outside_economic_basis(
    *, state: Any, event: Mapping[str, Any], at: int,
) -> str | None:
    """Resolve an own accepted external Result as extra evidence, not a pilot.

    The member's participation_status still evaluates the real relation's
    historical pilot and must pass all existing formation gates. A prior
    outside request and commitment have already qualified the independent
    demand, offer and response at their original ticks. Do not require those
    historical commercial intents to remain open forever, or confer the
    outside customer's rights on a member. Current financial read rights
    are independently required by review_completed_original_owner_finance.
    """
    basis = event.get("evaluation_economic_outside_basis")
    if (not isinstance(basis, Mapping)
            or set(basis) != {"work", "source_revision", "result_ref", "accepted_at"}
            or not all(isinstance(basis[key], str) and basis[key]
                       for key in ("work", "source_revision", "result_ref"))
            or type(basis["accepted_at"]) is not int
            or not 0 <= basis["accepted_at"] < at):
        return None
    owner = event.get("actor")
    work = state.works.get(basis["work"])
    link = next((item for item in state.cooperation_links
                 if item.key == event.get("cooperation_link")
                 and item.source_revision == event.get("cooperation_source_revision")), None)
    if (work is None or link is None or owner not in link.participants
            or work.key in link.works or work.customer in link.participants
            or work.customer == owner
            or state.resources.get(work.resource) != owner
            or work.source_revision != basis["source_revision"]
            or work.result_ref != basis["result_ref"]
            or work.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
        return None
    requests = [
        row for row in state.trace
        if row.get("action") == "request" and row.get("outcome") == "APPLIED"
        and row.get("work") == work.key and row.get("actor") == work.customer
        and isinstance(row.get("outside_work_origin"), Mapping)
        and type(row.get("at")) is int and row["at"] < basis["accepted_at"]
    ]
    commits = [
        row for row in state.trace
        if row.get("action") == "commit" and row.get("outcome") == "APPLIED"
        and row.get("work") == work.key and type(row.get("at")) is int
    ]
    accepts = [
        row for row in state.trace
        if row.get("action") == "accept" and row.get("outcome") == "APPLIED"
        and row.get("work") == work.key and row.get("actor") == work.customer
        and row.get("at") == basis["accepted_at"]
    ]
    if (len(requests) != 1 or len(commits) != 1 or len(accepts) != 1
            or not requests[0]["at"] < commits[0]["at"] < basis["accepted_at"]):
        return None
    origin = requests[0]["outside_work_origin"]
    demands = [
        row for row in state.trace
        if row.get("action") == "outside_demand_signal"
        and row.get("outcome") == "APPLIED"
        and row.get("outside_demand_id") == origin.get("outside_demand_id")
        and row.get("actor") == work.customer
        and row.get("outside_supplier") == owner
        and row.get("outside_relation") == link.key
        and row.get("outside_relation_revision") == link.source_revision
        and type(row.get("at")) is int and row["at"] < requests[0]["at"]
    ]
    if len(demands) != 1:
        return None
    candidate = state.works.get(demands[0].get("outside_candidate_work"))
    if (candidate is None or candidate.key not in link.works
            or candidate.source_revision != demands[0].get("outside_work_revision")):
        return None
    return work.key


def review_completed_original_owner_finance(
    *, state: Any, original_money: Mapping[str, Any] | None,
    work_id: str, owner: str, review_source: str,
    review_revision: str, at: int,
    portfolio_work_ids: tuple[str, ...] | None = None,
    recipient_value: bool = False,
) -> str | dict[str, Any]:
    """Qualify an independently requested, owner-scoped completed Work review. 

    A read-only selection of the original economic document goes through the
    same strict KPB, original cost anchors, and original economic evaluator.
    Later settlement/amendment reports are not available at this decision.
    An isolated Work omits liquidity, since beginning-of-portfolio cash
    cannot become its opening cash. An explicitly requested portfolio view
    uses ALL committed-and-accepted original Works as of this decision, one
    original opening position and source-declared forecasts, never later
    Work/settlement reports. Only a generic qualification status is shared.
    It neither decides the owner's verdict nor creates consent or a new Work.
    """
    from .economic_flow import EconomicInputError, evaluate_economic_claims
    from .strict_economic_source_review import (
        StrictEconomicSourceBlocked, original_owner_economic_core,
        review_original_strict_economic_sources,
    )

    unknown = ({"status": "UNKNOWN", "private_owner_advice": "NOT_IDENTIFIABLE"}
               if recipient_value else "UNKNOWN")
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
    portfolio = portfolio_work_ids is not None
    if recipient_value and (portfolio or owner != work.customer):
        return unknown
    selected_ids = portfolio_work_ids if portfolio else (work_id,)
    if (not isinstance(selected_ids, tuple) or not 1 <= len(selected_ids) <= 256
            or len(set(selected_ids)) != len(selected_ids) or work_id not in selected_ids):
        return unknown
    selected_set = set(selected_ids)
    if portfolio:
        # Missing prior commitments must not disappear from a cash forecast.
        committed = {row.get("work") for row in state.trace
                     if row.get("action") == "commit" and row.get("outcome") == "APPLIED"
                     and row["at"] < at}
        if committed != selected_set or any(
                key not in state.works
                or state.works[key].result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                or not any(row.get("work") == key and row.get("action") == "accept"
                           and row.get("outcome") == "APPLIED" and row["at"] < at
                           for row in state.trace)
                for key in selected_ids):
            return unknown
    try:
        basis.assert_original_form_role_source(
            owner, review_source, review_revision, core=core,
            purpose="AKIS_ECONOMIC_WORK_EVIDENCE", operation="READ",
            recipients={owner}, at=at,
        )
        doc = original_money
        transfers = [row for row in doc["transfers"]
                     if row["work"] in selected_set and row["scenario"] == active]
        uses = [row for row in doc["resource_uses"]
                if row["work"] in selected_set and row["scenario"] == active]
        if not transfers or not uses:
            return unknown
        tids = {row["id"] for row in transfers}
        uids = {row["id"] for row in uses}
        owners = (
            {party for row in transfers for party in (row["payer"], row["payee"])}
            | {row["owner"] for row in uses}
            | {principal for key in selected_ids for principal in
               (state.capacity_ledger.original_owners(state.works[key].resource_requirements)
                | {state.works[key].customer})}
        ) - {"EXTERNAL"}

        def attached(rows, key, identifiers):
            if not isinstance(rows, list):
                raise ValueError("ORIGINAL_FINANCIAL_REVIEW_ROWS_REQUIRED")
            return [row for row in rows if row[key] in identifiers]

        timing = doc["cash_timing"]
        positions = ([row for row in timing["owner_positions"] if row["owner"] == owner]
                     if portfolio else [])
        if portfolio and len(positions) != 1:
            return unknown
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
            transfers + uses + terms + windows + classified + cost_events + positions
            + prior_reports["work_payment_settlement_claims"]
            + prior_reports["work_payment_due_amendments"]
        ):
            if "source" in row:
                referenced.add(row["source"])
            referenced.update(row.get("owner_sources", {}).values())
        value_records = []
        if recipient_value:
            values = doc.get("recipient_use_value_evidence", [])
            if not isinstance(values, list):
                return unknown
            value_records = [r for r in values if r["work"] == work_id and r["owner"] == owner]
            if len(value_records) != 1:
                return unknown
            value = value_records[0]
            # A future observation may not be imported just because a later
            # horizon or source is already present in the model input.
            if any(type(value[k]["at"]) is not int or value[k]["at"] >= at
                   for k in ("baseline", "rate", "outcome")):
                return unknown
            referenced.update(value[k]["source"] for k in ("baseline", "rate", "outcome"))
            referenced.add(value["nonoverlap_source"])
        selected = {
            "period": doc["period"], "currency": doc["currency"],
            "sources": [row for row in doc["sources"] if row["id"] in referenced],
            "transfers": transfers, "resource_uses": uses,
            "coverage": coverage, "outside_feasibility": {},
            "cash_timing": {
                "horizon_end": timing["horizon_end"],
                "owner_positions": positions, "transfer_windows": windows,
            },
            "lifecycle_costs": {
                "bindings": classified, "scope_proofs": scope,
                "event_bindings": cost_events,
            },
            "work_payment_conditions": terms,
            **prior_reports,
            **({"recipient_use_value_evidence": value_records} if recipient_value else {}),
        }
        # A costed preparation must be reconciled against the original
        # Work's same activity records in this as-of-time review as well.
        tagged_preparation = any(
            event.get("work") in selected_set and event.get("outcome") == "APPLIED"
            and "model_preparation_activity" in event for event in state.trace
            if event.get("at", at) < at
        )
        if tagged_preparation:
            activity = attached(life.get("preparation_activity_bindings", []),
                                "resource_use_id", uids)
            if not activity:
                return unknown
            selected["lifecycle_costs"]["preparation_activity_bindings"] = activity
        rights = review_original_strict_economic_sources(
            state=state, original_claims=selected,
            work_id=selected_ids if portfolio else work_id, at=at,
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
    if recipient_value:
        from .economic_flow import review_original_recipient_use_value
        from decimal import Decimal
        try:
            view["original_strict_context_source_qualification"] = rights
            qualified = review_original_recipient_use_value(
                selected["recipient_use_value_evidence"], economic_claims=selected,
                economic_view=view, works=state.works, trace=state.trace, strict_work_ids=work_id)
            own = qualified.get("local_research_only", {}).get(work_id)
            if own is None:
                return unknown
            surplus = Decimal(own["recipient_model_surplus_vs_declared_no_order"])
        except (EconomicInputError, KeyError, TypeError, ValueError, AttributeError):
            return unknown
        # Returned to the original owner's private assessor ONLY. The
        # caller may export a generic qualification, never the amount,
        # the sign, or the private advice to shared observations.
        return {
            "status": "MODEL_ORIGINAL_COMPLETED_RECIPIENT_VALUE_SCOPE_QUALIFIED",
            "private_owner_model_contribution": f"{surplus:.2f}",
            "private_owner_advice": ("CONSIDER_FUTURE_WORK" if surplus > 0
                                     else "REVIEW_FUTURE_WORK"),
            "declared_use_value_not_empirical_profit": True,
            "actual_owner_decision_or_consent_created": False,
        }
    if portfolio:
        path = view.get("cash_timing", {}).get(
            "per_original_owner_private_research_projection", {}).get(owner, {}).get(
                "scenario_paths", {}).get(active, {})
        if (path.get("status") != "SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY"
                or not path.get("expected") or not path.get("declared_late_case")):
            return unknown
        # The owner-specific forecast is not the actual bank balance at this
        # tick. Do not redisclose money or even a private reserve verdict.
        return "MODEL_ORIGINAL_ACCEPTED_PORTFOLIO_FORECAST_SCOPE_QUALIFIED"
    return "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
