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
from .outside_demand import assess_original_independent_outside_demand


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
                              "outside_capacity_probe", "outside_demand_claim"})


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
                and owner in link_map[event["cooperation_link"]].participants
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
                   subjects: Mapping[str, Any] | None = None) -> dict[str, Any]:
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
        if start != work.slot_start or end != work.slot_end:
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
        # Intentionally never call reserve/commit or append a Work. The
        # generated key exists for this one ephemeral preview only.
        try:
            capacity_ledger.preview(
                f"__akis_outside_candidate__{owner}__{work.key}",
                (ResourceNeed(resource, units),), start, end,
            )
        except (CapacityInputError, CapacityBlocked):
            return {
                "position": "UNKNOWN",
                "reason": "OUTSIDE_CAPACITY_ORIGINAL_RESERVATIONS_OR_SCOPE_BLOCK",
                "relation": row.relation, "available_at": row.available_at,
            }


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
        },
    }
