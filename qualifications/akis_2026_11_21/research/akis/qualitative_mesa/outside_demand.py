"""R4 buyer-originated outside demand in ONE original Mesa event trace.

An independent buyer's model-source-scoped statement is NOT a new Work,
offer accepted by a supplier, contract, external market price, bank payment,
reservation or authenticated third-party identity. It can only narrow the
owner's nonbinding economic comparison after original ContextBasis checks.
"""
from __future__ import annotations

from decimal import Decimal
import re
from typing import Any, Mapping, Sequence

from .context_basis import ContextBlocked
from .strict_economic_source_review import original_owner_economic_core


class OutsideDemandBlocked(ValueError):
    """External request is not independently source-qualified in original Mesa."""


_MONEY = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?\Z")
_CURRENCY = re.compile(r"[A-Z]{3}\Z")
_SOURCE_FIELDS = frozenset({
    "at", "action", "actor", "outside_demand_id", "outside_supplier",
    "outside_relation", "outside_relation_revision",
    "outside_candidate_work", "outside_work_revision", "outside_resource",
    "outside_units", "outside_slot_start", "outside_slot_end",
    "outside_deliverable", "outside_quality_basis", "outside_currency",
    "outside_price_ceiling", "outside_demand_source_ref",
    "outside_demand_source_revision", "outside_demand_valid_until",
})


def _identifier(raw: Any) -> bool:
    return isinstance(raw, str) and 0 < len(raw.strip()) <= 128


def _original_relation(state: Any, key: str, revision: str) -> Any | None:
    return next(
        (link for link in state.cooperation_links
         if link.key == key and link.source_revision == revision), None
    )


def qualify_original_outside_demand_signal(
    state: Any, event: Mapping[str, Any], at: int,
) -> dict[str, Any]:
    """Check the buyer's own original source before applying ONE trace event."""
    if set(event) != _SOURCE_FIELDS or event.get("action") != "outside_demand_signal":
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_ORIGINAL_EVENT_FIELDS_REQUIRED")
    buyer = event["actor"]
    seller = event["outside_supplier"]
    demand_id = event["outside_demand_id"]
    if any(not _identifier(event[k]) for k in (
        "actor", "outside_supplier", "outside_demand_id",
        "outside_relation", "outside_relation_revision",
        "outside_candidate_work", "outside_work_revision",
        "outside_resource", "outside_deliverable", "outside_quality_basis",
        "outside_demand_source_ref", "outside_demand_source_revision",
    )):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_IDENTIFIERS_REQUIRED")
    participants = state.subjects
    if (
        buyer == seller or buyer == state.institution.operator
        or buyer not in participants or seller not in participants
        or not participants[buyer].active or not participants[seller].active
    ):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_INDEPENDENT_ACTIVE_BUYER_REQUIRED")
    link = _original_relation(
        state, event["outside_relation"], event["outside_relation_revision"],
    )
    if (link is None or seller not in link.participants
            or buyer in link.participants):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_BUYER_NOT_EXTERNAL_TO_COOPERATION")
    if state.resources.get(event["outside_resource"]) != seller:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_ORIGINAL_SUPPLIER_RESOURCE_REQUIRED")
    start, end = event["outside_slot_start"], event["outside_slot_end"]
    units = event["outside_units"]
    until = event["outside_demand_valid_until"]
    if (type(at) is not int or type(start) is not int or type(end) is not int
            or type(units) is not int or type(until) is not int
            or not 0 <= at < until <= 10000
            or not 0 <= start < end <= 10000
            or not 1 <= units <= 1000000):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_TIME_OR_RESOURCE_UNITS_INVALID")
    price = event["outside_price_ceiling"]
    currency = event["outside_currency"]
    if (not isinstance(price, str) or not _MONEY.fullmatch(price)
            or Decimal(price) <= 0 or not isinstance(currency, str)
            or not _CURRENCY.fullmatch(currency)):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_PRICE_OR_CURRENCY_INVALID")
    if any(
        item.get("action") == "outside_demand_signal"
        and item.get("outcome") == "APPLIED"
        and item.get("outside_demand_id") == demand_id
        for item in state.trace
    ):
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_DUPLICATE_ORIGINAL_SIGNAL")
    context = state.context_basis
    core = original_owner_economic_core(participants[buyer].kind)
    if context is None or core is None:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_ORIGINAL_KPB_REQUIRED")
    try:
        context.assert_original_independent_outside_demand_source(
            buyer,
            event["outside_demand_source_ref"],
            event["outside_demand_source_revision"],
            core=core, recipient=seller, at=at,
        )
    except ContextBlocked as exc:
        raise OutsideDemandBlocked("OUTSIDE_DEMAND_BUYER_SOURCE_NOT_QUALIFIED") from exc
    return {
        "outside_demand_id": demand_id,
        "outside_supplier": seller,
        "outside_relation": link.key,
        "outside_relation_revision": link.source_revision,
        "outside_candidate_work": event["outside_candidate_work"],
        "outside_work_revision": event["outside_work_revision"],
        "outside_resource": event["outside_resource"],
        "outside_units": units,
        "outside_slot_start": start,
        "outside_slot_end": end,
        "outside_deliverable": event["outside_deliverable"],
        "outside_quality_basis": event["outside_quality_basis"],
        "outside_currency": currency,
        "outside_price_ceiling": f"{Decimal(price):.2f}",
        "outside_demand_source_ref": event["outside_demand_source_ref"],
        "outside_demand_source_revision": event["outside_demand_source_revision"],
        "outside_demand_valid_until": until,
        "model_buyer_source_not_real_offer_or_contract": True,
    }


def assess_original_independent_outside_demand(
    *, demand: tuple[str, str, str] | None, owner: str,
    work: Any, relation: str, relation_revision: str,
    probe: tuple[str, int, int, int] | None,
    outside_external_sales: Decimal, currency: str,
    trace: Sequence[Mapping[str, Any]] | None,
    subjects: Mapping[str, Any] | None,
    links: Sequence[Any], context_basis: Any, at: int,
) -> str | None:
    """Return a precise missing-demand reason; None means model match only.

    Read ONE previously applied ORIGINAL buyer event, recheck source rights
    NOW, and compare the buyer's source-declared horizon/quality/price to
    the seller's forecast. An event never creates a sale or consent.
    """
    if demand is None:
        return None
    if probe is None or trace is None or subjects is None or context_basis is None:
        return "OUTSIDE_DEMAND_ORIGINAL_TRACE_KPB_AND_CAPACITY_REQUIRED"
    demand_id, deliverable, quality_basis = demand
    rows = [
        item for item in trace
        if item.get("action") == "outside_demand_signal"
        and item.get("outcome") == "APPLIED"
        and item.get("outside_demand_id") == demand_id
    ]
    if len(rows) != 1:
        return "OUTSIDE_DEMAND_INDEPENDENT_ORIGINAL_BUYER_SIGNAL_REQUIRED"
    source = rows[0]
    buyer = source.get("actor")
    buyer_subject = subjects.get(buyer) if isinstance(buyer, str) else None
    link = next(
        (link for link in links if link.key == relation
         and link.source_revision == relation_revision), None
    )
    if (
        buyer_subject is None or not buyer_subject.active
        or buyer == owner or buyer_subject.kind == "OPERATOR"
        or link is None or owner not in link.participants
        or buyer in link.participants
        or source.get("outside_supplier") != owner
        or source.get("outside_relation") != relation
        or source.get("outside_relation_revision") != relation_revision
    ):
        return "OUTSIDE_DEMAND_CURRENT_EXTERNAL_BUYER_NOT_INDEPENDENT"
    if (type(source.get("at")) is not int or source["at"] >= at
            or type(source.get("outside_demand_valid_until")) is not int
            or at >= source["outside_demand_valid_until"]):
        return "OUTSIDE_DEMAND_NOT_PRIOR_OR_CURRENT"
    resource, units, start, end = probe
    if (
        source.get("outside_candidate_work") != work.key
        or source.get("outside_work_revision") != work.source_revision
        or source.get("outside_resource") != resource
        or source.get("outside_units") != units
        or source.get("outside_slot_start") != start
        or source.get("outside_slot_end") != end
        or source.get("outside_deliverable") != deliverable
        or source.get("outside_quality_basis") != quality_basis
    ):
        return "OUTSIDE_DEMAND_PRODUCT_QUANTITY_QUALITY_OR_PERIOD_MISMATCH"
    if (source.get("outside_currency") != currency
            or not isinstance(source.get("outside_price_ceiling"), str)
            or not _MONEY.fullmatch(source["outside_price_ceiling"])
            or Decimal(source["outside_price_ceiling"]) < outside_external_sales):
        return "OUTSIDE_DEMAND_PRICE_CEILING_OR_CURRENCY_NOT_COMPARABLE"
    core = original_owner_economic_core(buyer_subject.kind)
    if core is None:
        return "OUTSIDE_DEMAND_BUYER_CORE_UNKNOWN"
    try:
        context_basis.assert_original_independent_outside_demand_source(
            buyer, source["outside_demand_source_ref"],
            source["outside_demand_source_revision"],
            core=core, recipient=owner, at=at,
        )
    except ContextBlocked:
        return "OUTSIDE_DEMAND_CURRENT_BUYER_SOURCE_NO_LONGER_READABLE"
    return None
