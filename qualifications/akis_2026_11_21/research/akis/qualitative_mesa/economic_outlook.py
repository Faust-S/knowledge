"""Owner-scoped, time-qualified MODEL_ONLY economic alternatives before a decision.

These forecasts are not the final economic_flow ledger, authentic offers,
consents, accounting profits or permission to disclose another owner's data.
Cash line items must be disjoint within each forecast. Resource-use claims from
`economic_flow` MUST NOT be added to cash totals. No consolidated net gain is
asserted without independent matching of interfirm payments and receipts.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import re
from typing import Any, Mapping, Sequence

from .context_basis import ContextBlocked
from .capacity import CapacityBlocked, CapacityInputError, ResourceNeed
from .outside_demand import (
    assess_original_independent_outside_demand,
    assess_original_outside_supplier_offer,
    assess_original_buyer_offer_response,
    OutsideDemandBlocked, _qualify_original_operation_resource_comparison,
)


class OutlookInputError(ValueError):
    """Invalid declared hypothesis, not a real business finding."""


_AMOUNT = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")
_CURRENCY = re.compile(r"[A-Z]{3}\Z")
_RECEIPTS = ("external_sales", "member_supply_receipts")
_OUTLAYS = (
    "external_purchases", "member_supply_payments", "production_cash",
    "transaction_cash", "marketing_cash", "logistics_cash",
    "operator_fee_cash", "reconfiguration_cash",
)
_CHANNELS = frozenset(_RECEIPTS + _OUTLAYS)
_SCENARIOS = frozenset({"COOPERATION", "INDEPENDENT_ALTERNATIVE"})
_FIELDS = frozenset({
    "owner", "relation", "work", "work_source_revision", "relation_source_revision",
    "org_revision", "available_at", "expires_at", "source_ref", "period",
    "currency", "coverage", "outside_feasibility", "minimum_extra_cash", "cash",
})
_OPTIONAL_FIELDS = frozenset({"requires_accepted_results", "source_revision",
                              "outside_capacity_probe", "outside_demand_claim",
                              "outside_offer_claim",
                              "outside_buyer_response_claim"})


def _id(value: Any, key: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise OutlookInputError(f"INVALID_OUTLOOK_{key}")
    return value


def _amount(value: Any) -> Decimal:
    if not isinstance(value, str) or not _AMOUNT.fullmatch(value):
        raise OutlookInputError("INVALID_OUTLOOK_AMOUNT")
    return Decimal(value)


@dataclass(frozen=True)
class OwnerOutlook:
    owner: str
    relation: str
    work: str
    work_source_revision: str
    relation_source_revision: str
    org_revision: str
    available_at: int
    expires_at: int
    source_ref: str
    period: str
    currency: str
    coverage: str
    outside_feasibility: str
    minimum_extra_cash: Decimal
    cash: Mapping[str, Mapping[str, Decimal]]
    requires_accepted_results: tuple[tuple[str, str], ...] = ()
    source_revision: str | None = None
    # Optional current ORIGINAL CapacityLedger preview, never a reservation.
    outside_capacity_probe: tuple[str, int, int, int] | None = None
    # Buyer-originated model evidence is anchored in ORIGINAL Mesa trace.
    outside_demand_claim: tuple[str, str, str] | None = None
    # Optional independently sourced seller response to ONE buyer request.
    outside_offer_claim: str | None = None
    # Independent buyer intent explicitly pins an ORIGINAL supplier offer.
    outside_buyer_response_claim: str | None = None


def parse_outlooks(raw: Any, subjects: Mapping[str, Any], links: Sequence[Any],
                   known_works: set[str] | None = None,
                   future_membership_events: Sequence[Mapping[str, Any]] = (),
                   ) -> tuple[OwnerOutlook, ...]:
    """Require individually sourced alternatives; no operator-owned proxy consent."""
    if not isinstance(raw, list) or len(raw) > 512:
        raise OutlookInputError("INVALID_OUTLOOK_COUNT")
    link_map = {link.key: link for link in links}
    keys: set[tuple[str, str, str, int]] = set()
    parsed = []
    for record in raw:
        if (not isinstance(record, dict) or not _FIELDS.issubset(record) or
                set(record) - _FIELDS - _OPTIONAL_FIELDS):
            raise OutlookInputError("INVALID_OUTLOOK_FIELDS")
        owner = _id(record["owner"], "OWNER")
        relation = _id(record["relation"], "RELATION")
        work = _id(record["work"], "WORK")
        if owner not in subjects:
            raise OutlookInputError("OUTLOOK_OWNER_UNKNOWN")
        if relation not in link_map:
            # A hypothesis may reference a prospective successor coalition.
            # This permits parsing ONLY; the original cooperation_membership_apply
            # must still succeed before choose_outlook may use that relationship.
            possible = any(
                event.get("action") == "cooperation_membership_apply"
                and event.get("new_link_id") == relation
                and event.get("new_link_revision") == record["relation_source_revision"]
                and event.get("cooperation_link") in link_map
                and (owner in link_map[event["cooperation_link"]].participants
                     or any(p.get("action") == "cooperation_change_propose"
                            and p.get("change_id") == event.get("change_id")
                            and p.get("cooperation_link") == event.get("cooperation_link")
                            and p.get("proposed_subject") == owner
                            for p in future_membership_events if isinstance(p, Mapping)))
                for event in future_membership_events
                if isinstance(event, Mapping)
            )
            if not possible:
                raise OutlookInputError("OUTLOOK_RELATION_OWNER_REQUIRED")
        elif owner not in link_map[relation].participants:
            raise OutlookInputError("OUTLOOK_RELATION_OWNER_REQUIRED")
        source = _id(record["source_ref"], "SOURCE")
        if not source.startswith(f"model://{owner}/") or len(source) <= len(f"model://{owner}/"):
            raise OutlookInputError("OUTLOOK_OWNER_SOURCE_REQUIRED")
        available, expires = record["available_at"], record["expires_at"]
        if (type(available) is not int or type(expires) is not int or
                available < 0 or expires <= available):
            raise OutlookInputError("OUTLOOK_TIME_INVALID")
        key = (owner, relation, work, available)
        if key in keys:
            raise OutlookInputError("DUPLICATE_OUTLOOK")
        keys.add(key)
        currency = record["currency"]
        if not isinstance(currency, str) or not _CURRENCY.fullmatch(currency):
            raise OutlookInputError("INVALID_OUTLOOK_CURRENCY")
        coverage = record["coverage"]
        outside = record["outside_feasibility"]
        if coverage not in {"COMPLETE_DECLARED", "PARTIAL"}:
            raise OutlookInputError("INVALID_OUTLOOK_COVERAGE")
        if outside not in {"FEASIBLE_DECLARED", "NOT_FEASIBLE_DECLARED", "UNKNOWN"}:
            raise OutlookInputError("INVALID_OUTLOOK_OUTSIDE_FEASIBILITY")
        data = record["cash"]
        if not isinstance(data, dict) or set(data) != _SCENARIOS:
            raise OutlookInputError("INVALID_OUTLOOK_CASH_SCENARIOS")
        dependencies = record.get("requires_accepted_results", [])
        if not isinstance(dependencies, list) or len(dependencies) > 128:
            raise OutlookInputError("INVALID_OUTLOOK_PRIOR_RESULT_COUNT")
        prereqs: list[tuple[str, str]] = []
        seen_results: set[str] = set()
        for dep in dependencies:
            if not isinstance(dep, dict) or set(dep) != {"work", "source_revision"}:
                raise OutlookInputError("INVALID_OUTLOOK_PRIOR_RESULT_FIELDS")
            predecessor = _id(dep["work"], "PRIOR_WORK")
            revision = _id(dep["source_revision"], "PRIOR_WORK_REVISION")
            if predecessor == work or predecessor in seen_results:
                raise OutlookInputError("INVALID_OUTLOOK_PRIOR_RESULT_LINK")
            if known_works is not None and predecessor not in known_works:
                raise OutlookInputError("OUTLOOK_PRIOR_WORK_NOT_DECLARED")
            seen_results.add(predecessor)
            prereqs.append((predecessor, revision))
        cash: dict[str, dict[str, Decimal]] = {}
        for scenario, channels in data.items():
            if not isinstance(channels, dict) or set(channels) != _CHANNELS:
                raise OutlookInputError("INVALID_OUTLOOK_CASH_CHANNELS")
            cash[scenario] = {item: _amount(amount) for item, amount in channels.items()}
        probe_raw = record.get("outside_capacity_probe")
        probe = None
        if probe_raw is not None:
            if (not isinstance(probe_raw, dict)
                    or set(probe_raw) != {"resource", "units", "slot_start", "slot_end"}):
                raise OutlookInputError("OUTLOOK_OUTSIDE_CAPACITY_PROBE_FIELDS_INVALID")
            resource = _id(probe_raw["resource"], "OUTSIDE_RESOURCE")
            units = probe_raw["units"]
            start, end = probe_raw["slot_start"], probe_raw["slot_end"]
            if (type(units) is not int or not 1 <= units <= 1000000
                    or type(start) is not int or type(end) is not int
                    or not 0 <= start < end <= 10000):
                raise OutlookInputError("OUTLOOK_OUTSIDE_CAPACITY_PROBE_WINDOW_OR_UNITS_INVALID")
            # A capacity hypothesis attached to an anonymous/unversioned
            # forecast would bypass the owner's original KPB.
            if "source_revision" not in record:
                raise OutlookInputError("OUTLOOK_OUTSIDE_CAPACITY_REQUIRES_PINNED_OWNER_SOURCE")
            probe = (resource, units, start, end)
        demand_raw = record.get("outside_demand_claim")
        demand = None
        if demand_raw is not None:
            if (not isinstance(demand_raw, dict)
                    or set(demand_raw) != {
                        "signal_id", "deliverable", "quality_basis"
                    }):
                raise OutlookInputError("OUTLOOK_OUTSIDE_DEMAND_CLAIM_FIELDS_INVALID")
            if probe is None:
                raise OutlookInputError(
                    "OUTLOOK_OUTSIDE_DEMAND_REQUIRES_ORIGINAL_CAPACITY_PROBE"
                )
            demand = tuple(
                _id(demand_raw[key], "OUTSIDE_DEMAND")
                for key in ("signal_id", "deliverable", "quality_basis")
            )
        offer_id = None
        if "outside_offer_claim" in record:
            if demand is None:
                raise OutlookInputError(
                    "OUTLOOK_OUTSIDE_OFFER_REQUIRES_ORIGINAL_BUYER_DEMAND"
                )
            offer_id = _id(record["outside_offer_claim"], "OUTSIDE_OFFER")
        buyer_response_id = None
        if "outside_buyer_response_claim" in record:
            if offer_id is None:
                raise OutlookInputError(
                    "OUTLOOK_BUYER_RESPONSE_REQUIRES_ORIGINAL_SUPPLIER_OFFER"
                )
            buyer_response_id = _id(
                record["outside_buyer_response_claim"], "BUYER_RESPONSE"
            )
        parsed.append(OwnerOutlook(
            owner, relation, work,
            _id(record["work_source_revision"], "WORK_REVISION"),
            _id(record["relation_source_revision"], "RELATION_REVISION"),
            _id(record["org_revision"], "ORG_REVISION"), available, expires, source,
            _id(record["period"], "PERIOD"), currency, coverage, outside,
            _amount(record["minimum_extra_cash"]), cash, tuple(prereqs),
            (_id(record["source_revision"], "SOURCE_REVISION")
             if "source_revision" in record else None),
            probe,
            demand,
            offer_id,
            buyer_response_id,
        ))
    return tuple(sorted(parsed, key=lambda x: (x.available_at, x.owner, x.work, x.relation)))


def choose_outlook(outlooks: Sequence[OwnerOutlook], *, owner: str, work: Any,
                   org_revision: str, links: Sequence[Any], at: float,
                   works: Mapping[str, Any] | None = None,
                   context_basis: Any | None = None,
                   owner_core: str | None = None,
                   capacity_ledger: Any | None = None,
                   resource_owners: Mapping[str, str] | None = None,
                   resource_availability: Mapping[str, str] | None = None,
                   original_trace: Sequence[Mapping[str, Any]] | None = None,
                   subjects: Mapping[str, Any] | None = None,
                   original_state: Any | None = None) -> dict[str, Any]:
    """Use only current owner's information at model time, never end-of-run claims."""
    matching = [row for row in outlooks if row.owner == owner and row.work == work.key and
                row.available_at <= at < row.expires_at and
                row.work_source_revision == work.source_revision and
                row.org_revision == org_revision and
                any(link.key == row.relation and link.source_revision == row.relation_source_revision
                    and work.key in link.works and owner in link.participants for link in links)]
    if not matching:
        return {"position": "UNKNOWN", "reason": "NO_CURRENT_OWNER_OUTLOOK"}
    if len({row.relation for row in matching}) > 1:
        return {"position": "UNKNOWN", "reason": "MULTIPLE_RELATIONS_REQUIRE_OWNER_CHOICE"}
    latest = max(row.available_at for row in matching)
    candidates = [row for row in matching if row.available_at == latest]
    if len(candidates) != 1:
        return {"position": "UNKNOWN", "reason": "MULTIPLE_RELATIONS_REQUIRE_OWNER_CHOICE"}
    row = candidates[0]
    # Original strict KPB controls whether THIS owner may use the current
    # edition of its own economic forecast. A model:// prefix alone cannot
    # qualify a version, status, purpose, operation, owner or expiry.
    # In non-strict legacy experiments the original research-only semantics
    # remain unchanged. No forecast ever becomes a signature or actual cash.
    # Pinned owner forecasts opt into exact ORIGINAL ContextBasis checking
    # even in a legacy non-strict Work scenario. A present pin must never be
    # silently ignored merely because that scenario has other optional
    # context requirements. Global strict mode still requires every pin.
    source_qualification_required = (
        row.source_revision is not None
        or (context_basis is not None and context_basis.strict)
    )
    if source_qualification_required:
        qualified = (
            context_basis is not None
            and isinstance(row.source_revision, str)
            and owner_core in {"operator", "institutional", "corporate", "personal"}
            and type(at) in (int, float) and 0 <= at <= 10000
            and int(at) == at
        )
        if qualified:
            try:
                check_owner = (
                    context_basis.assert_original_form_role_source
                    if context_basis.strict else
                    context_basis.assert_original_pinned_owner_economic_source
                )
                check_owner(
                    owner, row.source_ref, row.source_revision,
                    core=owner_core, purpose="AKIS_ECONOMIC_WORK_EVIDENCE",
                    operation="READ", recipients={owner}, at=int(at),
                )
            except ContextBlocked:
                qualified = False
        if not qualified:
            return {
                "position": "UNKNOWN",
                "reason": "ORIGINAL_OWNER_ECONOMIC_SOURCE_NOT_QUALIFIED",
                "relation": row.relation,
                "available_at": row.available_at,
            }
    if row.requires_accepted_results:
        if works is None:
            return {"position": "UNKNOWN", "reason": "PRIOR_RESULT_CONTEXT_MISSING",
                    "relation": row.relation, "available_at": row.available_at}
        for predecessor, revision in row.requires_accepted_results:
            prior = works.get(predecessor)
            if (prior is None or prior.source_revision != revision or
                    prior.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
                return {"position": "UNKNOWN", "reason": "PRIOR_RESULT_NOT_ACCEPTED",
                        "relation": row.relation, "available_at": row.available_at}
    if row.coverage != "COMPLETE_DECLARED" or row.outside_feasibility != "FEASIBLE_DECLARED":
        return {"position": "UNKNOWN", "reason": "INCOMPLETE_OR_UNFEASIBLE_COMPARISON",
                "relation": row.relation, "available_at": row.available_at}

    # Do not inspect or compare even a model buyer's private terms before
    # confirming its CURRENT independently owned source permissions.
    if row.outside_demand_claim is not None:
        reason = assess_original_independent_outside_demand(
            demand=row.outside_demand_claim, owner=owner,
            work=work, relation=row.relation,
            relation_revision=row.relation_source_revision,
            probe=row.outside_capacity_probe,
            outside_external_sales=row.cash["INDEPENDENT_ALTERNATIVE"]["external_sales"],
            currency=row.currency, trace=original_trace, subjects=subjects,
            links=links, context_basis=context_basis, at=int(at),
        )
        if reason is not None:
            return {
                "position": "UNKNOWN", "reason": reason,
                "relation": row.relation, "available_at": row.available_at,
            }

    if row.outside_offer_claim is not None:
        # Buyer source first, supplier source second, original capacity third.
        # Both model statements remain nonbinding and source-revocable.
        buyer = next((
            evidence.get("actor") for evidence in (original_trace or ())
            if evidence.get("action") == "outside_demand_signal"
            and evidence.get("outcome") == "APPLIED"
            and evidence.get("outside_demand_id") == row.outside_demand_claim[0]
        ), None)
        offer_reason = assess_original_outside_supplier_offer(
            offer_id=row.outside_offer_claim,
            demand_id=row.outside_demand_claim[0],
            owner=owner, buyer=buyer,
            trace=original_trace, subjects=subjects,
            context_basis=context_basis,
            price=row.cash["INDEPENDENT_ALTERNATIVE"]["external_sales"],
            currency=row.currency, probe=row.outside_capacity_probe,
            deliverable=row.outside_demand_claim[1],
            quality_basis=row.outside_demand_claim[2],
            at=int(at),
        )
        if offer_reason is not None:
            return {
                "position": "UNKNOWN", "reason": offer_reason,
                "relation": row.relation,
                "available_at": row.available_at,
            }

    if row.outside_buyer_response_claim is not None:
        # The buyer alone can express nonbinding conditional intent. The
        # original buyer demand and original supplier offer rights have
        # already been qualified above; response is an additional source,
        # NOT legal consent or a verified external contract.
        buyer = next((
            evidence.get("actor") for evidence in (original_trace or ())
            if evidence.get("action") == "outside_demand_signal"
            and evidence.get("outcome") == "APPLIED"
            and evidence.get("outside_demand_id") == row.outside_demand_claim[0]
        ), None)
        response_reason = assess_original_buyer_offer_response(
            response_id=row.outside_buyer_response_claim,
            offer_id=row.outside_offer_claim,
            demand_id=row.outside_demand_claim[0],
            buyer=buyer, seller=owner,
            trace=original_trace, subjects=subjects,
            context_basis=context_basis, at=int(at),
        )
        if response_reason is not None:
            return {
                "position": "UNKNOWN", "reason": response_reason,
                "relation": row.relation,
                "available_at": row.available_at,
            }

    stage_demand = None
    if row.outside_demand_claim is not None:
        stage_demand = next((e for e in (original_trace or ())
                             if e.get("action") == "outside_demand_signal"
                             and e.get("outcome") == "APPLIED"
                             and e.get("outside_demand_id") == row.outside_demand_claim[0]
                             and "outside_candidate_operation" in e), None)
    if stage_demand is not None:
        # A stage-specific statement may compare mutually exclusive uses
        # only before commitment and after original request/market binding.
        # All three current independent buyer/seller sources are required.
        if original_state is None or row.outside_buyer_response_claim is None:
            return {"position": "UNKNOWN", "reason": "OUTSIDE_STAGE_ORIGINAL_BILATERAL_PREVIEW_REQUIRED",
                    "relation": row.relation, "available_at": row.available_at}
        try:
            _qualify_original_operation_resource_comparison(
                original_state, work, stage_demand, int(at), prospective=True)
        except OutsideDemandBlocked as exc:
            return {"position": "UNKNOWN", "reason": str(exc),
                    "relation": row.relation, "available_at": row.available_at}

    if row.outside_capacity_probe is not None:
        # This is an owner-held outside candidate, not a second Work. It
        # must fit the SAME original Work's planned horizon, be owned by the
        # same independent principal and be technically feasible against
        # already accepted reservations in the ORIGINAL CapacityLedger.
        # A successful preview is NOT proof of an external customer, price,
        # physical production, a contract or an actual outside payment.
        resource, units, start, end = row.outside_capacity_probe
        if (capacity_ledger is None or resource_owners is None
                or resource_availability is None):
            return {
                "position": "UNKNOWN",
                "reason": "OUTSIDE_CAPACITY_ORIGINAL_LEDGER_REQUIRED",
                "relation": row.relation, "available_at": row.available_at,
            }
        if resource_owners.get(resource) != owner:
            return {
                "position": "UNKNOWN",
                "reason": "OUTSIDE_CAPACITY_INDEPENDENT_RESOURCE_OWNER_REQUIRED",
                "relation": row.relation, "available_at": row.available_at,
            }
        if stage_demand is None and (start != work.slot_start or end != work.slot_end):
            return {
                "position": "UNKNOWN",
                "reason": "OUTSIDE_CAPACITY_COMPARABLE_WORK_HORIZON_REQUIRED",
                "relation": row.relation, "available_at": row.available_at,
            }
        if resource_availability.get(resource) != "AVAILABLE":
            return {
                "position": "UNKNOWN",
                "reason": "OUTSIDE_CAPACITY_ORIGINAL_RESOURCE_NOT_READY",
                "relation": row.relation, "available_at": row.available_at,
            }
        # Before an actual external request, the ephemeral candidate
        # cannot borrow a named Work's adopted capacity. Once the original
        # buyer has requested a qualified external Work, preview THAT Work
        # with its actual owner-scoped key, not a synthetic identity.
        candidate_key = f"__akis_outside_candidate__{owner}__{work.key}"
        if row.outside_buyer_response_claim is not None:
            requests = [
                event for event in (original_trace or ())
                if event.get("action") == "request"
                and event.get("outcome") == "APPLIED"
                and isinstance(event.get("outside_work_origin"), Mapping)
                and event["outside_work_origin"].get("outside_demand_id")
                    == row.outside_demand_claim[0]
                and event["at"] <= at
            ]
            if requests:
                expected_origin = {
                    "outside_demand_id": row.outside_demand_claim[0],
                    "outside_offer_id": row.outside_offer_claim,
                    "outside_buyer_response_id": row.outside_buyer_response_claim,
                }
                original = (works or {}).get(requests[0].get("work"))
                if (len(requests) != 1
                        or requests[0]["outside_work_origin"] != expected_origin
                        or original is None or original.key == work.key
                        or original.customer != buyer
                        or original.obligation != "NOT_ACCEPTED"
                        or work.obligation != "NOT_ACCEPTED"
                        or (original.slot_start, original.slot_end) != (start, end)
                        or tuple((need.resource, need.units)
                                 for need in original.resource_requirements)
                            != ((resource, units),)
                        or any(original.key in link.works for link in links)):
                    return {
                        "position": "UNKNOWN",
                        "reason": "OUTSIDE_ORIGINAL_WORK_NOT_CURRENT_UNCOMMITTED_CANDIDATE",
                        "relation": row.relation, "available_at": row.available_at,
                    }
                candidate_key = original.key
        # Never reserve/commit or append a Work in an outlook.
        try:
            capacity_ledger.preview(
                candidate_key, (ResourceNeed(resource, units),), start, end,
            )
            if stage_demand is not None:
                from .capacity import Reservation
                from .technology import operation_reservations
                conflicts = capacity_ledger.preview_options({
                    work.key: operation_reservations(work.key, work.operations),
                    candidate_key: [Reservation(resource, candidate_key, start, end, units)],
                })
                if not any(c["resource"] == resource and {work.key, candidate_key} <= set(c["works"])
                           for c in conflicts):
                    return {"position": "UNKNOWN",
                            "reason": "OUTSIDE_STAGE_BOTH_WORKS_CAPACITY_COMPATIBLE_PORTFOLIO_REQUIRED",
                            "relation": row.relation, "available_at": row.available_at}
        except (CapacityInputError, CapacityBlocked):
            return {
                "position": "UNKNOWN",
                "reason": "OUTSIDE_CAPACITY_ORIGINAL_RESERVATIONS_OR_SCOPE_BLOCK",
                "relation": row.relation, "available_at": row.available_at,
            }


    if stage_demand is not None:
        # No speculative receipts on either side of an exact stage comparison.
        # Match the cooperation forecast to the owner's original quoted amount,
        # not a later realized payment or an invented source of revenue.
        from .technology import technology_route_fingerprint
        reqs = [r for r in (original_trace or ()) if r.get("action") == "request"
                and r.get("outcome") == "APPLIED" and r.get("work") == work.key
                and r["at"] <= at and r.get("technology_route_commercial_fingerprint")]
        qualified = False
        if len(reqs) == 1:
            request = reqs[0]
            events = [e for e in original_state.events if e["action"] == "request"
                      and e["at"] == request["at"]
                      and e.get("work", e.get("work_spec", {}).get("id")) == work.key]
            terms = events[0].get("technology_route_commercial_terms") if len(events) == 1 else None
            if (isinstance(terms, dict)
                    and technology_route_fingerprint(terms) == request["technology_route_commercial_fingerprint"]
                    and terms["currency"] == row.currency):
                offers = [o for o in terms["offers"] if o["payee"] == owner]
                if len(offers) == 1:
                    quote = offers[0]
                    cooperative, independent = row.cash["COOPERATION"], row.cash["INDEPENDENT_ALTERNATIVE"]
                    if (at < quote["expires_at"] and at < quote["due_at"]
                            and cooperative["member_supply_receipts"] == _amount(quote["amount"])
                            and cooperative["external_sales"] == 0
                            and independent["member_supply_receipts"] == 0):
                        try:
                            for check, tick in (
                                    (context_basis.assert_original_historical_form_role_source, request["at"]),
                                    (context_basis.assert_original_form_role_source, int(at))):
                                check(owner, quote["source_ref"], quote["source_revision"],
                                      core="corporate", purpose="AKIS_TECHNOLOGY_ROUTE_COMMERCIAL_TERMS",
                                      operation="READ",
                                      recipients={owner, work.customer, original_state.institution.operator},
                                      at=tick)
                            qualified = True
                        except ContextBlocked:
                            pass
        if not qualified:
            return {"position": "UNKNOWN", "reason": "OUTSIDE_STAGE_ORIGINAL_COOPERATION_QUOTE_NOT_QUALIFIED",
                    "relation": row.relation, "available_at": row.available_at}


    def net(scenario: str) -> Decimal:
        p = row.cash[scenario]
        return sum((p[name] for name in _RECEIPTS), Decimal(0)) - sum(
            (p[name] for name in _OUTLAYS), Decimal(0))

    advantage = net("COOPERATION") - net("INDEPENDENT_ALTERNATIVE")
    independent, cooperative = row.cash["INDEPENDENT_ALTERNATIVE"], row.cash["COOPERATION"]
    by_channel = {
        channel: (cooperative[channel] - independent[channel] if channel in _RECEIPTS
                  else independent[channel] - cooperative[channel])
        for channel in sorted(_CHANNELS)
    }
    assert sum(by_channel.values(), Decimal(0)) == advantage
    if advantage > row.minimum_extra_cash:
        position, reason = "COOPERATION_PREFERRED", "OWNER_CASH_ADVANTAGE_ABOVE_RESERVE"
    elif advantage < 0:
        position, reason = "OUTSIDE_PREFERRED", "OWNER_OUTSIDE_CASH_BETTER"
    else:
        position, reason = "UNKNOWN", "OWNER_INCREMENT_NOT_ABOVE_RESERVE"
    return {
        "position": position, "reason": reason, "relation": row.relation,
        "available_at": row.available_at,
        "private_owner_comparison": {
            "cash_difference_cooperation_minus_outside": f"{advantage:.2f}",
            "minimum_extra_cash": f"{row.minimum_extra_cash:.2f}",
            "period": row.period, "currency": row.currency,
            "model_only": True,
            "cash_contribution_difference_by_channel": {name: f"{value:.2f}"
                                                        for name, value in by_channel.items()},
            "resource_uses_not_added": True,
            "interfirm_transfers_not_consolidated": True,
            "causal_effect": "NOT_IDENTIFIABLE",
            "outside_original_capacity_preview": (
                "MODEL_CAPACITY_PREVIEW_ONLY_NOT_EXTERNAL_OFFER"
                if row.outside_capacity_probe is not None else
                "NOT_REQUESTED"
            ),
            "outside_external_customer_and_real_price_verified": False,
            "outside_capacity_reserved_or_new_work_created": False,
            "outside_buyer_model_source_signal": (
                "ORIGINAL_INDEPENDENT_BUYER_SOURCE_SCOPED_MODEL_DEMAND"
                if row.outside_demand_claim is not None else "NOT_REQUESTED"
            ),
            "outside_buyer_request_is_not_a_concluded_contract": True,
            "buyer_declared_price_is_not_bank_or_realized_income": True,
            "supplier_model_offer_evidence": (
                "ORIGINAL_SUPPLIER_SOURCE_SCOPED_NONBINDING_OFFER"
                if row.outside_offer_claim is not None else "NOT_REQUESTED"
            ),
            "bilateral_source_comparison_not_acceptance_delivery_or_settlement": True,
            "independent_buyer_model_response": (
                "BUYER_WILLING_TO_NEGOTIATE_UNDER_SEPARATE_SOURCE"
                if row.outside_buyer_response_claim is not None else
                "NOT_REQUESTED"
            ),
            "buyer_model_intent_not_contract_or_Work_consent": True,
            **({"original_stage_competing_capacity_preview_only": True,
                "both_alternatives_individually_feasible_but_simultaneous_capacity_conflict": True,
                "only_precommit_sources_no_future_result_or_realized_ledger_used": True}
               if stage_demand is not None else {}),
        },
    }
