"""Dynamic cross-enterprise opportunity discovery from existing original AKIS Work.

One read-only projection of current QualitativeAKIS data, not a second process,
market, IAM, contract, assignment, result, or source-of-truth register. Demand
and supplier capability are each declared by their own original principal.
Matching is *not* technical qualification, partner acceptance or economic profit.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import re
from typing import Any, Mapping, Sequence

from .capacity import CapacityBlocked, Reservation, ResourceNeed


class DiscoveryInputError(ValueError):
    """Malformed MODEL_ONLY research hypothesis."""


MAX_SIGNALS = 256  # technical parser bound, not organizational size
_DEMAND_FIELDS = frozenset({"id", "buyer", "work", "work_source_revision",
                            "original_resource", "capability", "capacity_unit",
                            "source_ref", "available_at", "expires_at"})
_OFFER_FIELDS = frozenset({"id", "owner", "resource", "capability", "capacity_unit",
                           "source_ref", "available_at", "expires_at"})


def _id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise DiscoveryInputError(f"DISCOVERY_INVALID_{field}")
    return value


def _source(value: Any, owner: str) -> str:
    value = _id(value, "SOURCE")
    if not value.startswith(f"model://{owner}/") or len(value) <= len(f"model://{owner}/"):
        raise DiscoveryInputError("DISCOVERY_ORIGINAL_OWNER_SOURCE_REQUIRED")
    return value


def _time(row: Mapping[str, Any]) -> tuple[int, int]:
    a, b = row["available_at"], row["expires_at"]
    if type(a) is not int or type(b) is not int or a < 0 or b <= a or b > 100000:
        raise DiscoveryInputError("DISCOVERY_TIME_INVALID")
    return a, b


@dataclass(frozen=True)
class Demand:
    key: str
    buyer: str
    work: str
    revision: str
    original_resource: str
    capability: str
    capacity_unit: str
    source: str
    available_at: int
    expires_at: int


@dataclass(frozen=True)
class Offer:
    key: str
    owner: str
    resource: str
    capability: str
    capacity_unit: str
    source: str
    available_at: int
    expires_at: int


def parse_discovery(raw: Any, subjects: Mapping[str, Any],
                    known_works: Mapping[str, Any],
                    resource_owners: Mapping[str, str]) -> tuple[tuple[Demand, ...], tuple[Offer, ...]]:
    """Parse independent source declarations; never infer source ownership."""
    if not isinstance(raw, dict) or not {"demands", "offers"} <= set(raw) or set(raw) - {"demands", "offers", "formation_finance"}:
        raise DiscoveryInputError("DISCOVERY_INPUT_FIELDS_INVALID")
    ds, os = raw["demands"], raw["offers"]
    if (not isinstance(ds, list) or not isinstance(os, list) or
            len(ds) > MAX_SIGNALS or len(os) > MAX_SIGNALS):
        raise DiscoveryInputError("DISCOVERY_TOO_MANY_SIGNALS")
    seen: set[str] = set()
    demands: list[Demand] = []
    offers: list[Offer] = []
    for row in ds:
        if not isinstance(row, dict) or set(row) != _DEMAND_FIELDS:
            raise DiscoveryInputError("DISCOVERY_DEMAND_FIELDS_INVALID")
        key = _id(row["id"], "ID")
        if key in seen:
            raise DiscoveryInputError("DISCOVERY_DUPLICATE_SIGNAL")
        seen.add(key)
        buyer = _id(row["buyer"], "BUYER")
        work_id = _id(row["work"], "WORK")
        work = known_works.get(work_id)
        revision = _id(row["work_source_revision"], "WORK_REVISION")
        if (getattr(subjects.get(buyer), "kind", None) != "SME" or work is None or
                getattr(work, "customer", None) != buyer or
                getattr(work, "source_revision", None) != revision):
            raise DiscoveryInputError("DISCOVERY_ORIGINAL_BUYER_WORK_REQUIRED")
        original_resource = _id(row["original_resource"], "ORIGINAL_RESOURCE")
        if original_resource not in resource_owners:
            raise DiscoveryInputError("DISCOVERY_ORIGINAL_RESOURCE_UNKNOWN")
        original_needs = getattr(work, "resource_requirements", None)
        if original_needs and original_resource not in {need.resource for need in original_needs}:
            raise DiscoveryInputError("DISCOVERY_ORIGINAL_RESOURCE_NOT_IN_WORK")
        start, end = _time(row)
        if any(d.work == work_id and d.capability == row["capability"]
               and max(start, d.available_at) < min(end, d.expires_at) for d in demands):
            raise DiscoveryInputError("DISCOVERY_OVERLAPPING_DEMAND_SOURCES")
        demands.append(Demand(key, buyer, work_id, revision, original_resource,
                              _id(row["capability"], "CAPABILITY"),
                              _id(row["capacity_unit"], "CAPACITY_UNIT"),
                              _source(row["source_ref"], buyer), start, end))
    for row in os:
        if not isinstance(row, dict) or set(row) != _OFFER_FIELDS:
            raise DiscoveryInputError("DISCOVERY_OFFER_FIELDS_INVALID")
        key = _id(row["id"], "ID")
        if key in seen:
            raise DiscoveryInputError("DISCOVERY_DUPLICATE_SIGNAL")
        seen.add(key)
        owner = _id(row["owner"], "OWNER")
        resource = _id(row["resource"], "RESOURCE")
        if (getattr(subjects.get(owner), "kind", None) != "SME" or
                resource_owners.get(resource) != owner):
            raise DiscoveryInputError("DISCOVERY_ORIGINAL_RESOURCE_OWNER_REQUIRED")
        start, end = _time(row)
        if any(o.resource == resource and o.capability == row["capability"]
               and max(start, o.available_at) < min(end, o.expires_at) for o in offers):
            raise DiscoveryInputError("DISCOVERY_OVERLAPPING_OFFER_SOURCES")
        offers.append(Offer(key, owner, resource,
                            _id(row["capability"], "CAPABILITY"),
                            _id(row["capacity_unit"], "CAPACITY_UNIT"),
                            _source(row["source_ref"], owner), start, end))
    return (tuple(sorted(demands, key=lambda r: r.key)),
            tuple(sorted(offers, key=lambda r: r.key)))



# The economic comparison is a prospective view over *two independent source
# claims*, not an operator-controlled price or a second accounting register.
_FINANCE_CHANNELS = frozenset({
    "external_receipts_cash", "external_purchases_cash", "production_cash",
    "transaction_cash", "marketing_cash", "logistics_cash",
    "verification_cash", "switching_cash", "risk_reserve_cash",
    "operator_fee_cash", "financing_cash",
})
_FINANCE_FIELDS = frozenset({
    "side", "owner", "demand", "offer", "source_ref",
    "demand_source_ref", "offer_source_ref", "work_source_revision",
    "available_at", "expires_at", "period", "currency", "coverage",
    "outside_feasibility", "intent", "outside_net_cash",
    "minimum_increment_cash", "cooperative_external_cash", "liquidity",
})
_MONEY = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")
_SIGNED_MONEY = re.compile(r"-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")


def _cash(value: Any, signed: bool = False) -> Decimal:
    if not isinstance(value, str) or not (_SIGNED_MONEY if signed else _MONEY).fullmatch(value):
        raise DiscoveryInputError("DISCOVERY_FINANCE_INVALID_CASH")
    return Decimal(value)


@dataclass(frozen=True)
class FormationFinance:
    side: str
    owner: str
    demand: str
    offer: str
    source: str
    demand_source: str
    offer_source: str
    work_revision: str
    available_at: int
    expires_at: int
    period: str
    currency: str
    coverage: str
    outside_feasibility: str
    intent: str
    outside_net: Decimal
    reserve: Decimal
    cooperative_cash: Mapping[str, Decimal]
    liquidity: Mapping[str, Decimal]


def parse_formation_finance(raw: Any, demands: Sequence[Demand],
                            offers: Sequence[Offer]) -> tuple[FormationFinance, ...]:
    """Strict, non-transferable bilateral hypotheses, bounded by two originals."""
    if not isinstance(raw, list) or len(raw) > 512:
        raise DiscoveryInputError("DISCOVERY_FINANCE_INVALID_COUNT")
    ds, os = {row.key: row for row in demands}, {row.key: row for row in offers}
    out: list[FormationFinance] = []
    seen: dict[tuple[str, str, str], list[tuple[int, int]]] = {}
    for item in raw:
        if not isinstance(item, dict) or set(item) != _FINANCE_FIELDS:
            raise DiscoveryInputError("DISCOVERY_FINANCE_FIELDS_INVALID")
        side = item["side"]
        if side not in ("BUYER", "PROVIDER"):
            raise DiscoveryInputError("DISCOVERY_FINANCE_INVALID_SIDE")
        d, o = ds.get(item["demand"]), os.get(item["offer"])
        if d is None or o is None:
            raise DiscoveryInputError("DISCOVERY_FINANCE_UNKNOWN_PAIR")
        owner = _id(item["owner"], "OWNER")
        if owner != (d.buyer if side == "BUYER" else o.owner):
            raise DiscoveryInputError("DISCOVERY_FINANCE_INDEPENDENT_OWNER_REQUIRED")
        source = _source(item["source_ref"], owner)
        if (item["demand_source_ref"] != d.source or
                item["offer_source_ref"] != o.source or
                item["work_source_revision"] != d.revision):
            raise DiscoveryInputError("DISCOVERY_FINANCE_SOURCE_REVISION_MISMATCH")
        at, expiry = _time(item)
        key = (d.key, o.key, side)
        periods = seen.setdefault(key, [])
        if any(max(at, before) < min(expiry, after) for before, after in periods):
            raise DiscoveryInputError("DISCOVERY_FINANCE_OVERLAPPING_OWNER_QUOTES")
        periods.append((at, expiry))
        currency, period = item["currency"], _id(item["period"], "PERIOD")
        if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
            raise DiscoveryInputError("DISCOVERY_FINANCE_INVALID_CURRENCY")
        coverage, outside = item["coverage"], item["outside_feasibility"]
        if coverage not in ("COMPLETE_DECLARED", "PARTIAL") or outside not in (
                "FEASIBLE_DECLARED", "UNKNOWN", "NOT_FEASIBLE_DECLARED"):
            raise DiscoveryInputError("DISCOVERY_FINANCE_INVALID_COVERAGE")
        intent = item["intent"]
        if intent not in ("WILLING", "DECLINES", "UNKNOWN"):
            raise DiscoveryInputError("DISCOVERY_FINANCE_INVALID_INTENT")
        channels = item["cooperative_external_cash"]
        if not isinstance(channels, dict) or set(channels) != _FINANCE_CHANNELS:
            raise DiscoveryInputError("DISCOVERY_FINANCE_INVALID_CHANNELS")
        cash = {name: _cash(val) for name, val in channels.items()}
        limits = item["liquidity"]
        required = ({"max_supplier_payment_cash"} if side == "BUYER" else
                    {"upfront_required_cash", "available_working_capital_cash"})
        if not isinstance(limits, dict) or set(limits) != required:
            raise DiscoveryInputError("DISCOVERY_FINANCE_INVALID_LIQUIDITY")
        out.append(FormationFinance(
            side, owner, d.key, o.key, source, d.source, o.source, d.revision,
            at, expiry, period, currency, coverage, outside, intent,
            _cash(item["outside_net_cash"], signed=True),
            _cash(item["minimum_increment_cash"]), cash,
            {name: _cash(val) for name, val in limits.items()},
        ))
    return tuple(sorted(out, key=lambda x: (x.demand, x.offer, x.side, x.available_at)))


def assess_bilateral_finance(claims: Sequence[FormationFinance], *,
                             demand: Demand, offer: Offer, at: float) -> str:
    """No proposed transfer/amount is disclosed; one buyer and one seller only."""
    current = [row for row in claims if row.demand == demand.key and row.offer == offer.key
               and row.available_at <= at < row.expires_at and
               row.demand_source == demand.source and row.offer_source == offer.source and
               row.work_revision == demand.revision]
    by_side = {row.side: row for row in current}
    if len(current) != 2 or set(by_side) != {"BUYER", "PROVIDER"}:
        return "BILATERAL_EVIDENCE_MISSING_OR_EXPIRED"
    b, p = by_side["BUYER"], by_side["PROVIDER"]
    if (b.owner != demand.buyer or p.owner != offer.owner or
            b.currency != p.currency or b.period != p.period):
        return "INCOMPARABLE_OWNER_HORIZON_OR_CURRENCY"
    if (b.coverage != "COMPLETE_DECLARED" or p.coverage != "COMPLETE_DECLARED" or
            b.outside_feasibility != "FEASIBLE_DECLARED" or
            p.outside_feasibility != "FEASIBLE_DECLARED"):
        return "BILATERAL_EVIDENCE_INCOMPLETE"
    if b.intent != "WILLING" or p.intent != "WILLING":
        return "BILATERAL_INTEREST_NOT_MUTUAL"
    if p.liquidity["available_working_capital_cash"] < p.liquidity["upfront_required_cash"]:
        return "PROVIDER_WORKING_CAPITAL_INSUFFICIENT"

    def pre_transfer_net(row: FormationFinance) -> Decimal:
        d = row.cooperative_cash
        return d["external_receipts_cash"] - sum(
            (value for name, value in d.items() if name != "external_receipts_cash"),
            Decimal("0"),
        )

    # Price paid by B is a negative B flow and a positive P flow. It MUST
    # cancel in the pair total. The interval is internal and not an offer.
    buyer_ceiling = min(
        pre_transfer_net(b) - b.outside_net - b.reserve,
        b.liquidity["max_supplier_payment_cash"],
    )
    provider_floor = max(Decimal("0"), p.outside_net + p.reserve - pre_transfer_net(p))
    if provider_floor > buyer_ceiling:
        return "NO_MUTUALLY_ACCEPTABLE_TRANSFER_INTERVAL"
    return "PROSPECTIVE_BILATERAL_CASH_INTERVAL_NOT_CONSENTED"


def discover(demands: Sequence[Demand], offers: Sequence[Offer], state: Any,
             *, at: float, formation_finance: Sequence[FormationFinance] | None = None) -> dict[str, Any]:
    """Read-only, time-correct feasibility and source gates over original state.

    Does not silently select one seller, rewrite Work/resource owners or use a
    hypothetical partner resource for an existing accepted obligation.
    """
    result: list[dict[str, Any]] = []
    viable_by_resource: dict[str, list[tuple[Demand, Any, int]]] = {}
    viable_by_demand: dict[str, list[Offer]] = {}
    for demand in demands:
        work = state.works.get(demand.work)
        base = {"id": demand.key, "work": demand.work, "buyer": "OWNER_SCOPED",
                "relation": "NOT_YET_DECLARED", "legal_effect": "NONE",
                "technology_qualification": "MODEL_COMPATIBILITY_NOT_FIELD_VERIFIED",
                "economic_effect": "NOT_IDENTIFIABLE", "candidates": "OWNER_SCOPED_NOT_REDISCLOSED"}
        reason: str | None = None
        if not demand.available_at <= at < demand.expires_at:
            reason = "DEMAND_SOURCE_NOT_CURRENT"
        elif work is None:
            reason = "ORIGINAL_WORK_NOT_REQUESTED"
        elif work.source_revision != demand.revision or work.customer != demand.buyer:
            reason = "ORIGINAL_WORK_SOURCE_CHANGED"
        elif work.obligation != "NOT_ACCEPTED":
            reason = "ORIGINAL_OBLIGATION_UNCHANGED"
        elif not state.subjects[demand.buyer].active:
            reason = "BUYER_INACTIVE_FOR_NEW_WORK"
        elif not any(need.resource == demand.original_resource for need in work.resource_requirements):
            reason = "ORIGINAL_RESOURCE_CHANGED"
        elif len(work.resource_requirements) != 1 or work.operations:
            reason = "COMPLEX_TECHNOLOGY_REQUIRES_INDEPENDENT_REPLAN"
        elif (state.resource_specs.get(demand.original_resource) is None or
              state.resource_specs[demand.original_resource].basis != "MODEL_DECLARED" or
              state.resource_specs[demand.original_resource].unit != demand.capacity_unit):
            reason = "ORIGINAL_WORK_CAPACITY_UNIT_UNQUALIFIED"
        elif not getattr(work, "slot_start", 0) < getattr(work, "slot_end", 0):
            reason = "ORIGINAL_WORK_SLOT_UNSUPPORTED"
        if reason is not None:
            result.append({**base, "status": reason, "candidate_count": 0})
            continue
        original_owners = {state.resources[n.resource] for n in work.resource_requirements}
        units = work.resource_requirements[0].units
        viable = []
        declared = 0
        unsupported = 0
        unsupported_availability = 0
        for offer in offers:
            if not (offer.capability == demand.capability and
                    offer.capacity_unit == demand.capacity_unit and
                    offer.available_at <= at < offer.expires_at):
                continue
            # Same-work owner, or a substitute inside the old resource itself,
            # is not evidence of a NEW cross-company partner relation.
            if (offer.resource == demand.original_resource or offer.owner == demand.buyer or
                    offer.owner in original_owners):
                continue
            declared += 1
            if (offer.owner not in state.subjects or not state.subjects[offer.owner].active or
                    state.resources.get(offer.resource) != offer.owner or
                    state.resource_availability.get(offer.resource) != "AVAILABLE"):
                continue
            if state.resource_availability_origin.get(offer.resource) not in {
                    "MODEL_INPUT", "MODEL_EVENT"}:
                unsupported_availability += 1
                continue
            spec = state.resource_specs.get(offer.resource)
            if (spec is None or spec.owner != offer.owner or
                    spec.basis != "MODEL_DECLARED" or spec.unit != demand.capacity_unit):
                unsupported += 1
                continue
            try:
                state.capacity_ledger.preview(
                    f"model-prospect:{demand.key}:{offer.key}",
                    (ResourceNeed(offer.resource, units),), work.slot_start, work.slot_end,
                )
            except CapacityBlocked:
                continue
            viable.append(offer)
            viable_by_demand.setdefault(demand.key, []).append(offer)
            viable_by_resource.setdefault(offer.resource, []).append((demand, work, units))
        if len(viable) == 0:
            status = ("RESOURCE_AVAILABILITY_SOURCE_MISSING" if unsupported_availability else
                      "CAPACITY_SOURCE_NOT_DECLARED" if unsupported else
                      "NO_FEASIBLE_OR_AVAILABLE_PARTNER" if declared else
                      "NO_MATCHING_INDEPENDENT_CAPABILITY_SOURCE")
        elif len(viable) > 1:
            status = ("MULTIPLE_PARTNERS_REQUIRE_ORIGINAL_BUYER_CHOICE"
                      if len({offer.owner for offer in viable}) > 1 else
                      "ONE_PARTNER_MULTIPLE_RESOURCES_REQUIRES_PROCESS_CHOICE")
        else:
            status = "POTENTIAL_PARTNER_REQUIRES_FRESH_ORIGINAL_OWNER_REVIEW"
        result.append({**base, "status": status, "candidate_count": len(viable)})

    # Two independent demands can each pass a single-work capacity preview but
    # still compete for a single owner's finite resource. Flag competition;
    # do not choose or reserve capacity for either demand.
    contested_demands: set[str] = set()
    for resource, rows in viable_by_resource.items():
        for i, (a, aw, au) in enumerate(rows):
            for b, bw, bu in rows[i + 1:]:
                if a.key == b.key or max(aw.slot_start, bw.slot_start) >= min(aw.slot_end, bw.slot_end):
                    continue
                try:
                    # Consult the ORIGINAL calendar and ORIGINAL reservations,
                    # never assume that a static maximum is available in a
                    # particular owner-declared production window.
                    synthetic = f"model-competition:{a.key}:{b.key}"
                    state.capacity_ledger.preview_plan(synthetic, (
                        Reservation(resource, synthetic, aw.slot_start, aw.slot_end, au),
                        Reservation(resource, synthetic, bw.slot_start, bw.slot_end, bu),
                    ))
                except CapacityBlocked:
                    contested_demands.update((a.key, b.key))
    for row in result:
        if row["id"] in contested_demands and row["candidate_count"] > 0:
            row["status"] = "POTENTIAL_PARTNERS_COMPETE_FOR_OWNER_CAPACITY"
    if formation_finance is not None:
        for demand, row in zip(demands, result):
            statuses = [assess_bilateral_finance(
                formation_finance, demand=demand, offer=o, at=at,
            ) for o in viable_by_demand.get(demand.key, ())]
            count = statuses.count("PROSPECTIVE_BILATERAL_CASH_INTERVAL_NOT_CONSENTED")
            if row["status"] == "POTENTIAL_PARTNERS_COMPETE_FOR_OWNER_CAPACITY":
                # A priced pair is not a jointly available capacity assignment.
                economic_status = "BILATERAL_RESOURCE_ALLOCATION_UNRESOLVED"
                count = 0
            elif not statuses:
                economic_status = "NO_TECHNICALLY_FEASIBLE_PAIR"
            elif count and len(statuses) == 1:
                economic_status = "ONE_PROSPECTIVE_BILATERAL_INTERVAL_NOT_CONSENTED"
            elif count:
                economic_status = "MULTIPLE_OR_INCOMPLETE_ALTERNATIVES_OWNER_REVIEW"
            elif any(st == "BILATERAL_EVIDENCE_MISSING_OR_EXPIRED" for st in statuses):
                economic_status = "BILATERAL_OWNER_EVIDENCE_INCOMPLETE"
            else:
                economic_status = "NO_QUALIFIED_BILATERAL_CASH_INTERVAL"
            row["economic_status"] = economic_status
            row["economically_possible_count"] = count
            row["rights_status"] = "ORIGINAL_MULTILATERAL_CONSENT_NOT_ESTABLISHED"
    return {
        "evidence": "MODEL_ONLY", "model_scope": "SOURCE_DECLARED_CAPABILITY_MATCH_NOT_MEMBERSHIP",
        "original_works_changed": 0, "original_consents_created": 0,
        "capacity_reserved": 0, "cash_or_profit": "NOT_CALCULATED",
        "candidates": result,
        "current_opportunity_count": sum(row["candidate_count"] > 0 for row in result),
        "contested_opportunity_count": sum(row["status"] == "POTENTIAL_PARTNERS_COMPETE_FOR_OWNER_CAPACITY"
                                           for row in result),
        **({"economically_reviewable_count": sum(
            row.get("economically_possible_count", 0) > 0 for row in result),
            "economic_comparison_scope": "BILATERAL_MODEL_ONLY_NOT_SYSTEM_PROFIT",
            "interfirm_cash_transfers": "EXCLUDED_FROM_INPUTS_AND_NOT_REDISCLOSED",
            "original_consent_status": "NOT_ESTABLISHED"}
           if formation_finance is not None else {}),
    }