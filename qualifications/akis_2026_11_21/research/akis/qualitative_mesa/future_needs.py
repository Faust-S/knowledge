"""Causal pre-order needs and portfolio constraints in the ONE AKIS Mesa model.

An independent owner may declare a *prospective* need before any original Work
request. A source claim can become reviewable following accepted original Result;
it NEVER creates a Work, consent, reservation, contract, revenue or membership.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .capacity import CapacityBlocked, Reservation
from .technology import operation_reservations
from .context_basis import ContextBlocked
from .rules import InputError


class FutureNeedInputError(ValueError):
    """Malformed research claim, never a real business refusal."""


@dataclass(frozen=True)
class FutureNeed:
    key: str
    owner: str
    source: str
    revision: str
    org_revision: str
    available_at: int
    expires_at: int
    work: Any  # Parsed via ORIGINAL QualitativeAKIS._parse_work, not inserted.
    prerequisite_results: tuple[tuple[str, str], ...]


def _id(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise FutureNeedInputError(code)
    return value


def parse_future_needs(raw: Any, state: Any) -> tuple[FutureNeed, ...]:
    """Accept only original-customer signals; never invent independent demand."""
    if not isinstance(raw, list) or len(raw) > 256:
        raise FutureNeedInputError("INVALID_FUTURE_NEED_COUNT")
    result: list[FutureNeed] = []
    ids: set[str] = set()
    intervals: dict[str, list[tuple[int, int]]] = {}
    fields = {
        "id", "owner", "source_ref", "source_revision", "org_revision",
        "available_at", "expires_at", "work_spec",
    }
    for item in raw:
        if not isinstance(item, dict) or not fields.issubset(item) or (
                set(item) - fields - {"requires_accepted_results"}):
            raise FutureNeedInputError("INVALID_FUTURE_NEED_FIELDS")
        key = _id(item["id"], "INVALID_FUTURE_NEED_ID")
        owner = _id(item["owner"], "INVALID_FUTURE_NEED_OWNER")
        if key in ids:
            raise FutureNeedInputError("DUPLICATE_FUTURE_NEED_ID")
        ids.add(key)
        if owner not in state.subjects:
            raise FutureNeedInputError("FUTURE_NEED_OWNER_UNKNOWN")
        source = _id(item["source_ref"], "INVALID_FUTURE_NEED_SOURCE")
        if not source.startswith(f"model://{owner}/") or len(source) <= len(f"model://{owner}/"):
            raise FutureNeedInputError("FUTURE_NEED_OWNER_SOURCE_REQUIRED")
        revision = _id(item["source_revision"], "INVALID_FUTURE_NEED_REVISION")
        org_revision = _id(item["org_revision"], "INVALID_FUTURE_NEED_ORG_REVISION")
        start, end = item["available_at"], item["expires_at"]
        if (type(start) is not int or type(end) is not int or
                start < 0 or start >= end or end > 10000):
            raise FutureNeedInputError("FUTURE_NEED_TIME_INVALID")
        try:
            work = state._parse_work(item["work_spec"])
        except (InputError, TypeError, KeyError) as exc:
            raise FutureNeedInputError("FUTURE_NEED_WORK_SPEC_INVALID") from exc
        if work.customer != owner:
            raise FutureNeedInputError("FUTURE_NEED_ORIGINAL_CUSTOMER_REQUIRED")
        if work.key in intervals and any(start < earlier_end and earlier_start < end
                                         for earlier_start, earlier_end in intervals[work.key]):
            raise FutureNeedInputError("OVERLAPPING_FUTURE_NEED_SOURCE")
        intervals.setdefault(work.key, []).append((start, end))
        original = state.works.get(work.key)
        if original is not None and (
            original.customer != work.customer or original.source_revision != work.source_revision
            or original.resource != work.resource or original.slot_start != work.slot_start
            or original.slot_end != work.slot_end or
            original.resource_requirements != work.resource_requirements or
            original.operations != work.operations
        ):
            raise FutureNeedInputError("FUTURE_NEED_DISAGREES_WITH_ORIGINAL_WORK")
        raw_prerequisites = item.get("requires_accepted_results", [])
        if not isinstance(raw_prerequisites, list) or len(raw_prerequisites) > 32:
            raise FutureNeedInputError("INVALID_FUTURE_NEED_PREREQUISITES")
        prerequisites = []
        for dep in raw_prerequisites:
            if not isinstance(dep, dict) or set(dep) != {"work", "source_revision"}:
                raise FutureNeedInputError("INVALID_FUTURE_NEED_PREREQUISITE")
            prior = _id(dep["work"], "INVALID_FUTURE_NEED_PRIOR_WORK")
            rev = _id(dep["source_revision"], "INVALID_FUTURE_NEED_PRIOR_REVISION")
            if prior == work.key or prior not in state.works or prior in [p for p, _ in prerequisites]:
                raise FutureNeedInputError("FUTURE_NEED_PREREQUISITE_MUST_BE_ORIGINAL_WORK")
            prerequisites.append((prior, rev))
        for prior in work.requires_accepted:
            if prior not in state.works:
                raise FutureNeedInputError("FUTURE_NEED_TECHNOLOGY_PREDECESSOR_NOT_ORIGINAL")
            if prior not in [p for p, _ in prerequisites]:
                prerequisites.append((prior, state.works[prior].source_revision))
        result.append(FutureNeed(
            key, owner, source, revision, org_revision, start, end, work,
            tuple(sorted(prerequisites)),
        ))
    return tuple(sorted(result, key=lambda n: (n.available_at, n.key)))


def _capacity_plan(need: FutureNeed) -> tuple[Reservation, ...]:
    work = need.work
    if work.operations:
        return tuple(operation_reservations(work.key, work.operations))
    return tuple(Reservation(item.resource, work.key,
                             work.slot_start, work.slot_end, item.units)
                 for item in work.resource_requirements)


def future_need_projection(
    state: Any, signals: Sequence[FutureNeed],
    *, at: float, actor_choices: Mapping[str, Mapping[str, Mapping[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Derived current research possibilities; preview ONLY, no original writes."""
    choices = actor_choices or {}
    rows: list[dict[str, Any]] = []
    options: dict[str, tuple[Reservation, ...]] = {}
    for item in signals:
        work = item.work
        row = {
            "need": item.key, "original_customer": item.owner, "work": work.key,
            "model_only_source": "OWNER_DECLARED_NOT_AUTHENTICATED",
            "new_original_work_created": False, "contract_created": False,
            "economic_effect": "NOT_IDENTIFIABLE",
            "transaction_cost_effect": "NOT_IDENTIFIABLE",
            "resource_competition": "NOT_EVALUATED",
            "original_result_modified": False,
        }
        if at < item.available_at:
            status = "FUTURE_OWNER_NEED_SOURCE_NOT_AVAILABLE"
        elif at >= item.expires_at:
            status = "FUTURE_OWNER_NEED_SOURCE_EXPIRED"
        elif item.org_revision != state.institution.revision:
            status = "FUTURE_NEED_ORG_REVISION_STALE"
        elif not state.subjects[item.owner].active:
            status = "FUTURE_NEED_ORIGINAL_CUSTOMER_INACTIVE"
        elif any(state.works[prior].source_revision != rev or
                 state.works[prior].result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                 for prior, rev in item.prerequisite_results):
            status = "FUTURE_NEED_AWAIT_ORIGINAL_ACCEPTED_RESULT"
        else:
            status = "SOURCE_ACTIVE_FOR_RESEARCH"
            existing = state.works.get(work.key)
            if existing is not None and existing.obligation != "NOT_ACCEPTED":
                status = "FUTURE_NEED_ORIGINAL_OBLIGATION_PRESERVED"
            elif existing is not None and (existing.customer != item.owner or
                     existing.source_revision != work.source_revision):
                status = "FUTURE_NEED_ORIGINAL_WORK_SOURCE_CHANGED"
            elif existing is not None and existing.requester not in (None, item.owner):
                status = "FUTURE_NEED_ORIGINAL_REQUEST_NOT_OWNER_QUALIFIED"
            if status == "SOURCE_ACTIVE_FOR_RESEARCH" and state.context_basis is not None:
                # In strict mode there must be a declared original-owner basis
                # even for a MODEL_ONLY use. Existing ContextBasis never
                # authenticates a real corporate source or creates a grant.
                try:
                    state.context_basis.assert_allowed(work.key, "interest_update",
                                                       item.owner, int(at))
                except ContextBlocked as exc:
                    status = "FUTURE_NEED_" + exc.reason
            if status == "SOURCE_ACTIVE_FOR_RESEARCH":
                own_choice = choices.get(item.owner, {}).get(work.key)
                if own_choice is not None and own_choice.get("action") == "DECLINE_NEW_OPPORTUNITY":
                    status = "FUTURE_NEED_INDEPENDENT_OWNER_DECLINES"
                elif own_choice is not None and own_choice.get("action") in {
                    "REQUEST_OWNER_MULTI_OBJECTIVE_TRADEOFF_REVIEW",
                    "REQUEST_OWNER_EVIDENCE_RECONCILIATION",
                }:
                    status = "FUTURE_NEED_OWNER_GOAL_CONFLICT"
            if status == "SOURCE_ACTIVE_FOR_RESEARCH":
                original_owners = state.capacity_ledger.original_owners(work.resource_requirements)
                if any(not state.subjects[x].active for x in original_owners):
                    status = "FUTURE_NEED_RESOURCE_OWNER_INACTIVE"
                elif any(state.resource_availability_origin[n.resource] == "LEGACY_FIXTURE_DEFAULT"
                         for n in work.resource_requirements):
                    status = "FUTURE_NEED_RESOURCE_AVAILABILITY_UNQUALIFIED"
                elif any(state.resource_availability[n.resource] != "AVAILABLE"
                         for n in work.resource_requirements):
                    status = "FUTURE_NEED_RESOURCE_NOT_CURRENTLY_AVAILABLE"
                elif any(state.resource_specs[n.resource].basis == "LEGACY_FIXTURE_DEFAULT"
                         for n in work.resource_requirements):
                    status = "FUTURE_NEED_CAPACITY_UNQUALIFIED"
                elif (state.calendar_strict and any(
                      state.resource_specs[n.resource].calendar is None
                      for n in work.resource_requirements)):
                    status = "FUTURE_NEED_CALENDAR_UNQUALIFIED"
                else:
                    plan = _capacity_plan(item)
                    try:
                        state.capacity_ledger.preview_plan(work.key, plan)
                        options[work.key] = plan
                    except CapacityBlocked:
                        status = "FUTURE_NEED_CONFLICTS_WITH_ACCEPTED_CAPACITY"
        row["status"] = status
        row["original_work_request_confirmed"] = bool(
            state.works.get(work.key) is not None
            and state.works[work.key].requester == item.owner
        )
        rows.append(row)
    competition = state.capacity_ledger.preview_options(options) if options else []
    contested = {work for issue in competition for work in issue["works"]
                 if work in options}
    for row in rows:
        if row["work"] in options:
            row["resource_competition"] = (
                "MULTIPLE_PROSPECTIVE_NEEDS_EXCEED_SOURCE_DECLARED_CAPACITY"
                if row["work"] in contested else "NO_IDENTIFIED_COMPETITION_IN_DECLARED_WINDOWS"
            )
        if row["resource_competition"] == "MULTIPLE_PROSPECTIVE_NEEDS_EXCEED_SOURCE_DECLARED_CAPACITY":
            row["status"] = "FUTURE_NEED_REQUIRES_INDEPENDENT_CAPACITY_ALLOCATION_REVIEW"
    # These are owner-scoped model inputs, not general access to their private
    # alternative prices or contractual terms.
    return {
        "at": at,
        "needs": rows,
        "count": len(rows),
        "reviewable_count": sum(x["status"] == "SOURCE_ACTIVE_FOR_RESEARCH" for x in rows),
        "capacity_contested_count": len(contested),
        "original_work_created": False,
        "original_obligations_changed": False,
        "private_money_and_owner_objective_values": "NOT_REDISCLOSED",
        "collective_cooperation_legal_status": "NOT_FORMED_BY_RESEARCH_SIGNAL",
        "single_original_capacity_ledger": True,
    }
